import type { DockerManager } from './docker-manager.js';
export declare class GrpcServer {
    private manager;
    private server;
    constructor(manager: DockerManager);
    listen(host: string, port: number): Promise<void>;
    shutdown(): void;
    private handleCreate;
    private handleStop;
    private handleDestroy;
    private handleStatus;
    private handleSendMessage;
}
