import type { AgentBlueprint, RuntimeConfig } from './types.js';
export declare class DockerProcessPool {
    private config;
    private docker;
    private containers;
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
    sendMessage(tenantId: string, agentId: string, sessionId: string, message: string): AsyncGenerator<any>;
    destroyAll(): Promise<void>;
    private parseMemoryLimit;
}
