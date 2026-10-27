import Docker from 'dockerode';
import { PassThrough } from 'node:stream';
import { buildSystemPrompt } from './blueprint.js';
import type { AgentBlueprint, AgentContainer, RuntimeConfig } from './types.js';

export class DockerProcessPool {
  private docker: Docker;
  private containers = new Map<string, AgentContainer>(); // "tenantId:agentId" → container

  constructor(private config: RuntimeConfig) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  private key(tenantId: string, agentId: string): string {
    return `${tenantId}:${agentId}`;
  }

  async create(tenantId: string, agentId: string, blueprint: AgentBlueprint): Promise<void> {
    const k = this.key(tenantId, agentId);
    if (this.containers.has(k)) {
      throw new Error(`Agent ${agentId} already running for tenant ${tenantId}`);
    }
    if (this.containers.size >= this.config.maxContainers) {
      throw new Error(`Max container limit reached: ${this.config.maxContainers}`);
    }

    const systemPrompt = buildSystemPrompt(blueprint.systemPrompt, blueprint.skillBindings);

    const env = [
      `DEEPSEEK_API_KEY=${this.config.deepseekApiKey}`,
      `DSH_TENANT_ID=${tenantId}`,
      `DSH_AGENT_ID=${agentId}`,
      `DSH_PROVIDER=${blueprint.provider}`,
      `DSH_MODEL=${blueprint.model}`,
      `DSH_MAX_TOKENS=${blueprint.maxTokens}`,
      `DSH_SYSTEM_PROMPT=${systemPrompt}`,
    ];

    if (blueprint.apiBase) {
      env.push(`DSH_API_BASE=${blueprint.apiBase}`);
    }

    for (const [key, value] of Object.entries(blueprint.credentialRefs)) {
      env.push(`${key}=${value}`);
    }

    const container = await this.docker.createContainer({
      Image: this.config.dshImage,
      name: `dsh-agent-${tenantId}-${agentId}`,
      Env: env,
      Labels: {
        'dsh.tenant_id': tenantId,
        'dsh.agent_id': agentId,
        'dsh.managed': 'true',
      },
      HostConfig: {
        Memory: this.parseMemoryLimit(this.config.containerMemoryLimit),
        NanoCpus: this.config.containerCpuLimit * 1e9,
        RestartPolicy: { Name: 'unless-stopped' },
      },
      // 容器内持续运行，等待 exec 指令
      Cmd: ['node', '/app/agent-server.js'],
      Tty: false,
      OpenStdin: true,
    });

    await container.start();

    this.containers.set(k, {
      tenantId,
      agentId,
      containerId: container.id,
      startedAt: Date.now(),
      blueprint,
    });

    console.log(`Container started: ${container.id.substring(0, 12)} for ${tenantId}/${agentId}`);
  }

  async stop(tenantId: string, agentId: string): Promise<void> {
    const k = this.key(tenantId, agentId);
    const agent = this.containers.get(k);
    if (!agent) return;

    try {
      const container = this.docker.getContainer(agent.containerId);
      await container.stop({ t: 10 });
    } catch {
      // container may already be stopped
    }
  }

  async destroy(tenantId: string, agentId: string): Promise<void> {
    const k = this.key(tenantId, agentId);
    const agent = this.containers.get(k);
    if (!agent) return;

    try {
      const container = this.docker.getContainer(agent.containerId);
      try { await container.stop({ t: 5 }); } catch { /* already stopped */ }
      await container.remove({ force: true });
    } catch {
      // container may already be removed
    }

    this.containers.delete(k);
    console.log(`Container destroyed: ${tenantId}/${agentId}`);
  }

  getStatus(tenantId: string, agentId: string) {
    const k = this.key(tenantId, agentId);
    const agent = this.containers.get(k);
    if (!agent) {
      return { status: 'not_found', activeSessions: 0, memoryUsageMb: 0, uptimeSeconds: '0' };
    }
    return {
      status: 'running',
      activeSessions: 0,
      memoryUsageMb: 0,
      uptimeSeconds: String(Math.floor((Date.now() - agent.startedAt) / 1000)),
    };
  }

  async *sendMessage(
    tenantId: string,
    agentId: string,
    sessionId: string,
    message: string,
  ): AsyncGenerator<any> {
    const k = this.key(tenantId, agentId);
    const agent = this.containers.get(k);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found for tenant ${tenantId}`);
    }

    const container = this.docker.getContainer(agent.containerId);

    // 通过 docker exec 向容器内的 agent 发送消息
    // 容器内的 agent-server.js 接收 JSON 输入，流式输出 JSON lines
    const exec = await container.exec({
      Cmd: ['node', '/app/agent-chat.js', '--session', sessionId, '--message', message],
      AttachStdout: true,
      AttachStderr: true,
    });

    const execStream = await exec.start({ Detach: false, Tty: false });
    const stdout = new PassThrough();
    const stderr = new PassThrough();

    // demux docker stream (stdout/stderr multiplexed)
    this.docker.modem.demuxStream(execStream, stdout, stderr);

    let buffer = '';
    let fullContent = '';

    for await (const chunk of stdout) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'text_delta') {
            fullContent += event.data;
            yield { sessionId, textDelta: event.data };
          } else if (event.type === 'tool_call') {
            yield {
              sessionId,
              toolCall: {
                toolName: event.tool_name,
                argumentsJson: event.arguments || '{}',
                resultJson: event.result || '{}',
              },
            };
          } else if (event.type === 'finished') {
            yield {
              sessionId,
              finished: {
                fullContent,
                promptTokens: event.prompt_tokens || 0,
                completionTokens: event.completion_tokens || 0,
                stopReason: event.stop_reason || 'end_turn',
              },
            };
          } else if (event.type === 'error') {
            yield {
              sessionId,
              error: { code: event.code || 'INTERNAL', message: event.message || 'Unknown error' },
            };
          }
        } catch {
          // skip non-JSON lines
        }
      }
    }
  }

  async destroyAll(): Promise<void> {
    const entries = [...this.containers.entries()];
    await Promise.allSettled(
      entries.map(([, agent]) => this.destroy(agent.tenantId, agent.agentId)),
    );
  }

  private parseMemoryLimit(limit: string): number {
    const match = limit.match(/^(\d+)(m|g)$/i);
    if (!match) return 512 * 1024 * 1024;
    const [, num, unit] = match;
    return parseInt(num) * (unit.toLowerCase() === 'g' ? 1024 * 1024 * 1024 : 1024 * 1024);
  }
}
