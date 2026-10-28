import type { AgentBlueprint } from './types.js';
export declare class BlueprintTranslator {
    private dataRoot;
    private defaultApiBase;
    private defaultModel;
    constructor(dataRoot: string, defaultApiBase: string, defaultModel: string);
    translate(tenantId: string, agentId: string, bp: AgentBlueprint): Promise<string>;
}
