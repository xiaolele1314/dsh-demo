import type { StdioBridgeHandle } from './types.js';
export declare class StdioBridge implements StdioBridgeHandle {
    private stream;
    private lineHandlers;
    private buffer;
    private nextId;
    constructor(stream: NodeJS.ReadWriteStream);
    send(method: string, params: Record<string, unknown>, id?: number): void;
    sendRequest(method: string, params: Record<string, unknown>): number;
    waitForResponse(id: number, timeoutMs?: number): Promise<any>;
    onLine(handler: (line: string) => void): void;
    removeLine(handler: (line: string) => void): void;
    close(): void;
}
export interface ChatChunkOut {
    sessionId: string;
    textDelta?: string;
    toolCall?: {
        toolName: string;
        argumentsJson: string;
        resultJson: string;
    };
    finished?: {
        fullContent: string;
        promptTokens: number;
        completionTokens: number;
        stopReason: string;
    };
    error?: {
        code: string;
        message: string;
    };
}
export declare function bridgeChat(bridge: StdioBridge, sessionId: string, message: string): AsyncGenerator<ChatChunkOut>;
