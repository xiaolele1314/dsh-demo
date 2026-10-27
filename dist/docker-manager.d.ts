import { type ChatChunkOut } from './stdio-bridge.js';
import type { AgentBlueprint, RuntimeConfig } from './types.js';
export declare class DockerManager {
    private config;
    private docker;
    private agents;
    private translator;
    constructor(config: RuntimeConfig);
    private key;
    create(tenantId: string, agentId: string, blueprint: AgentBlueprint): Promise<void>;
    stop(tenantId: string, agentId: string): Promise<void>;
    destroy(tenantId: string, agentId: string): Promise<void>;
    getStatus(tenantId: string, agentId: string): {
        status: string;
        activeSessions: number;
        memoryUsageMb: number;
        uptimeSeconds: string;
    };
    sendMessage(tenantId: string, agentId: string, sessionId: string, message: string): AsyncGenerator<ChatChunkOut>;
    destroyAll(): Promise<void>;
    private parseMemory;
}
