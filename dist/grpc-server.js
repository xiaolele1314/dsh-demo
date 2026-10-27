import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, '..', 'proto', 'agent_runtime.proto');
const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef);
export class GrpcServer {
    server;
    pool;
    constructor(pool) {
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
    async listen(host, port) {
        return new Promise((resolve, reject) => {
            this.server.bindAsync(`${host}:${port}`, grpc.ServerCredentials.createInsecure(), (err) => {
                if (err)
                    return reject(err);
                console.log(`gRPC server listening on ${host}:${port}`);
                resolve();
            });
        });
    }
    shutdown() {
        this.server.forceShutdown();
    }
    async createAgent(call, callback) {
        const { tenantId, agentId, blueprint } = call.request;
        try {
            await this.pool.create(tenantId, agentId, blueprint);
            callback(null, { success: true, errorMessage: '' });
        }
        catch (err) {
            console.error('CreateAgent error:', err.message);
            callback(null, { success: false, errorMessage: err.message });
        }
    }
    async stopAgent(call, callback) {
        const { tenantId, agentId } = call.request;
        try {
            await this.pool.stop(tenantId, agentId);
            callback(null, { success: true, errorMessage: '' });
        }
        catch (err) {
            callback(null, { success: false, errorMessage: err.message });
        }
    }
    async destroyAgent(call, callback) {
        const { tenantId, agentId } = call.request;
        try {
            await this.pool.destroy(tenantId, agentId);
            callback(null, { success: true });
        }
        catch {
            callback(null, { success: true });
        }
    }
    getAgentStatus(call, callback) {
        const { tenantId, agentId } = call.request;
        const info = this.pool.getStatus(tenantId, agentId);
        callback(null, info);
    }
    async sendMessage(call) {
        const { tenantId, agentId, sessionId, message } = call.request;
        try {
            const stream = this.pool.sendMessage(tenantId, agentId, sessionId, message);
            for await (const chunk of stream) {
                if (call.cancelled)
                    break;
                call.write(chunk);
            }
            call.end();
        }
        catch (err) {
            call.write({
                sessionId,
                error: { code: 'INTERNAL', message: err.message },
            });
            call.end();
        }
    }
}
