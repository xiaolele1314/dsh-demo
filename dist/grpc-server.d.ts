import { DockerProcessPool } from './docker-pool.js';
export declare class GrpcServer {
    private server;
    private pool;
    constructor(pool: DockerProcessPool);
    listen(host: string, port: number): Promise<void>;
    shutdown(): void;
    private createAgent;
    private stopAgent;
    private destroyAgent;
    private getAgentStatus;
    private sendMessage;
}
