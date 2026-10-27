import type { AgentBlueprint } from './types.js';
export declare class BlueprintTranslator {
    private dataRoot;
    constructor(dataRoot: string);
    translate(tenantId: string, agentId: string, bp: AgentBlueprint): Promise<string>;
}
