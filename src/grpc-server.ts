import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DockerProcessPool } from './docker-pool.js';
import type { AgentBlueprint } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, '..', 'proto', 'agent_runtime.proto');

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef) as any;

export class GrpcServer {
  private server: grpc.Server;
  private pool: DockerProcessPool;

  constructor(pool: DockerProcessPool) {
    this.pool = pool;
    this.server = new grpc.Server();
    this.server.addService(proto.dsh.cloud.v1.AgentRuntime.service, {
      createAgent: this.createAgent.bind(this),
      stopAgent: this.stopAgent.bind(this),
      destroyAgent: this.destroyAgent.bind(this),
      getAgentStatus: this.getAgentStatus.bind(this),
      sendMessage: this.sendMessage.bind(this),
    });
  }

  async listen(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.bindAsync(
        `${host}:${port}`,
        grpc.ServerCredentials.createInsecure(),
        (err) => {
          if (err) return reject(err);
          console.log(`gRPC server listening on ${host}:${port}`);
          resolve();
        },
      );
    });
  }

  shutdown(): void {
    this.server.forceShutdown();
  }

  private async createAgent(call: any, callback: any): Promise<void> {
    const { tenantId, agentId, blueprint } = call.request;
    try {
      await this.pool.create(tenantId, agentId, blueprint as AgentBlueprint);
      callback(null, { success: true, errorMessage: '' });
    } catch (err: any) {
      console.error('CreateAgent error:', err.message);
      callback(null, { success: false, errorMessage: err.message });
    }
  }

  private async stopAgent(call: any, callback: any): Promise<void> {
    const { tenantId, agentId } = call.request;
    try {
      await this.pool.stop(tenantId, agentId);
      callback(null, { success: true, errorMessage: '' });
    } catch (err: any) {
      callback(null, { success: false, errorMessage: err.message });
    }
  }

  private async destroyAgent(call: any, callback: any): Promise<void> {
    const { tenantId, agentId } = call.request;
    try {
      await this.pool.destroy(tenantId, agentId);
      callback(null, { success: true });
    } catch {
      callback(null, { success: true });
    }
  }

  private getAgentStatus(call: any, callback: any): void {
    const { tenantId, agentId } = call.request;
    const info = this.pool.getStatus(tenantId, agentId);
    callback(null, info);
  }

  private async sendMessage(call: any): Promise<void> {
    const { tenantId, agentId, sessionId, message } = call.request;
    try {
      const stream = this.pool.sendMessage(tenantId, agentId, sessionId, message);
      for await (const chunk of stream) {
        if (call.cancelled) break;
        call.write(chunk);
      }
      call.end();
    } catch (err: any) {
      call.write({
        sessionId,
        error: { code: 'INTERNAL', message: err.message },
      });
      call.end();
    }
  }
}
