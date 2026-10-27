import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = join(__dirname, '..', 'proto', 'agent_runtime.proto');
const packageDef = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false, longs: String, enums: String, defaults: true, oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef);
export class GrpcServer {
    manager;
    server;
    constructor(manager) {
        this.manager = manager;
        this.server = new grpc.Server();
        this.server.addService(proto.dsh.cloud.v1.AgentRuntime.service, {
            createAgent: this.handleCreate.bind(this),
            stopAgent: this.handleStop.bind(this),
            destroyAgent: this.handleDestroy.bind(this),
            getAgentStatus: this.handleStatus.bind(this),
            sendMessage: this.handleSendMessage.bind(this),
        });
    }
    listen(host, port) {
        return new Promise((resolve, reject) => {
            this.server.bindAsync(`${host}:${port}`, grpc.ServerCredentials.createInsecure(), (err) => {
                if (err)
                    return reject(err);
                console.log(`gRPC listening on ${host}:${port}`);
                resolve();
            });
        });
    }
    shutdown() {
        this.server.forceShutdown();
    }
    async handleCreate(call, cb) {
        const { tenantId, agentId, blueprint } = call.request;
        try {
            await this.manager.create(tenantId, agentId, blueprint);
            cb(null, { success: true, errorMessage: '' });
        }
        catch (err) {
            console.error('CreateAgent error:', err.message);
            cb(null, { success: false, errorMessage: err.message });
        }
    }
    async handleStop(call, cb) {
        try {
            await this.manager.stop(call.request.tenantId, call.request.agentId);
            cb(null, { success: true, errorMessage: '' });
        }
        catch (err) {
            cb(null, { success: false, errorMessage: err.message });
        }
    }
    async handleDestroy(call, cb) {
        try {
            await this.manager.destroy(call.request.tenantId, call.request.agentId);
        }
        catch { /* */ }
        cb(null, { success: true });
    }
    handleStatus(call, cb) {
        cb(null, this.manager.getStatus(call.request.tenantId, call.request.agentId));
    }
    async handleSendMessage(call) {
        const { tenantId, agentId, sessionId, message } = call.request;
        try {
            for await (const chunk of this.manager.sendMessage(tenantId, agentId, sessionId, message)) {
                if (call.cancelled)
                    break;
                const out = { sessionId: chunk.sessionId };
                if (chunk.textDelta !== undefined)
                    out.textDelta = chunk.textDelta;
                if (chunk.toolCall)
                    out.toolCall = chunk.toolCall;
                if (chunk.finished)
                    out.finished = chunk.finished;
                if (chunk.error)
                    out.error = chunk.error;
                call.write(out);
            }
        }
        catch (err) {
            call.write({ sessionId, error: { code: 'INTERNAL', message: err.message } });
        }
        call.end();
    }
}
