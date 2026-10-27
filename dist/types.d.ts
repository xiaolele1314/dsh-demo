export interface AgentBlueprint {
    provider: string;
    model: string;
    maxTokens: number;
    apiBase: string;
    systemPrompt: string;
    skillBindings: SkillBinding[];
    mcpBindings: McpBinding[];
    credentialRefs: Record<string, string>;
}
export interface SkillBinding {
    skillId: string;
    name: string;
    content: string;
}
export interface McpBinding {
    mcpId: string;
    name: string;
    serverType: string;
    command: string;
    args: string[];
    url: string;
}
export interface AgentEntry {
    tenantId: string;
    agentId: string;
    containerId: string;
    startedAt: number;
    stdioBridge: StdioBridgeHandle | null;
}
export interface StdioBridgeHandle {
    send(method: string, params: Record<string, unknown>, id?: number): void;
    onLine(handler: (line: string) => void): void;
    close(): void;
}
export interface RuntimeConfig {
    grpcHost: string;
    grpcPort: number;
    dataRoot: string;
    dshImage: string;
    maxContainers: number;
    containerMemory: string;
    containerCpu: number;
    deepseekApiKey: string;
}
