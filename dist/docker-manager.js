import Docker from 'dockerode';
import { BlueprintTranslator } from './blueprint.js';
import { StdioBridge, bridgeChat } from './stdio-bridge.js';
export class DockerManager {
    config;
    docker;
    agents = new Map();
    translator;
    constructor(config) {
        this.config = config;
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
        this.translator = new BlueprintTranslator(config.dataRoot);
    }
    key(tenantId, agentId) {
        return `${tenantId}:${agentId}`;
    }
    async create(tenantId, agentId, blueprint) {
        const k = this.key(tenantId, agentId);
        if (this.agents.has(k)) {
            throw new Error(`Agent ${agentId} already exists for tenant ${tenantId}`);
        }
        if (this.agents.size >= this.config.maxContainers) {
            throw new Error(`Max container limit reached: ${this.config.maxContainers}`);
        }
        // 1. 生成 cordis.yml
        const configDir = await this.translator.translate(tenantId, agentId, blueprint);
        // 2. 构建环境变量
        const env = [
            `DEEPSEEK_API_KEY=${this.config.deepseekApiKey}`,
            `DSH_TENANT_ID=${tenantId}`,
            `DSH_AGENT_ID=${agentId}`,
        ];
        if (blueprint.apiBase)
            env.push(`DSH_API_BASE=${blueprint.apiBase}`);
        for (const [key, value] of Object.entries(blueprint.credentialRefs || {})) {
            env.push(`${key}=${value}`);
        }
        // 3. 创建容器
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
                Memory: this.parseMemory(this.config.containerMemory),
                NanoCpus: this.config.containerCpu * 1e9,
                Binds: [`${configDir}:/config:ro`],
                RestartPolicy: { Name: '' },
            },
            OpenStdin: true,
            StdinOnce: false,
            Tty: false,
        });
        // 4. 启动容器
        await container.start();
        // 5. attach 获取 stdio
        const stream = await container.attach({ stream: true, stdin: true, stdout: true, stderr: true });
        // dockerode 返回 multiplexed stream，需要 demux
        // 但当 Tty=false 时 attach stream 已经是 raw 的
        const bridge = new StdioBridge(stream);
        // 6. 发送 initialize
        const initId = bridge.sendRequest('initialize', {
            cwd: '/workspace',
            provider: blueprint.provider,
            model: blueprint.model,
            maxTokens: blueprint.maxTokens || 4096,
        });
        await bridge.waitForResponse(initId);
        // 7. 注册
        this.agents.set(k, {
            tenantId,
            agentId,
            containerId: container.id,
            startedAt: Date.now(),
            stdioBridge: bridge,
        });
        console.log(`Agent created: ${tenantId}/${agentId} → ${container.id.substring(0, 12)}`);
    }
    async stop(tenantId, agentId) {
        const k = this.key(tenantId, agentId);
        const entry = this.agents.get(k);
        if (!entry)
            return;
        entry.stdioBridge?.close();
        try {
            const container = this.docker.getContainer(entry.containerId);
            await container.stop({ t: 10 });
        }
        catch { /* already stopped */ }
    }
    async destroy(tenantId, agentId) {
        const k = this.key(tenantId, agentId);
        const entry = this.agents.get(k);
        if (!entry)
            return;
        entry.stdioBridge?.close();
        try {
            const container = this.docker.getContainer(entry.containerId);
            try {
                await container.stop({ t: 5 });
            }
            catch { /* */ }
            await container.remove({ force: true });
        }
        catch { /* */ }
        this.agents.delete(k);
        console.log(`Agent destroyed: ${tenantId}/${agentId}`);
    }
    getStatus(tenantId, agentId) {
        const k = this.key(tenantId, agentId);
        const entry = this.agents.get(k);
        if (!entry) {
            return { status: 'not_found', activeSessions: 0, memoryUsageMb: 0, uptimeSeconds: '0' };
        }
        return {
            status: 'running',
            activeSessions: 0,
            memoryUsageMb: 0,
            uptimeSeconds: String(Math.floor((Date.now() - entry.startedAt) / 1000)),
        };
    }
    async *sendMessage(tenantId, agentId, sessionId, message) {
        const k = this.key(tenantId, agentId);
        const entry = this.agents.get(k);
        if (!entry || !entry.stdioBridge) {
            throw new Error(`Agent ${agentId} not found or not connected for tenant ${tenantId}`);
        }
        yield* bridgeChat(entry.stdioBridge, sessionId, message);
    }
    async destroyAll() {
        const entries = [...this.agents.values()];
        await Promise.allSettled(entries.map((e) => this.destroy(e.tenantId, e.agentId)));
    }
    parseMemory(limit) {
        const m = limit.match(/^(\d+)(m|g)$/i);
        if (!m)
            return 512 * 1024 * 1024;
        return parseInt(m[1]) * (m[2].toLowerCase() === 'g' ? 1024 ** 3 : 1024 ** 2);
    }
}
