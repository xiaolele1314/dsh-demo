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

export interface AgentContainer {
  tenantId: string;
  agentId: string;
  containerId: string;
  startedAt: number;
  blueprint: AgentBlueprint;
}

export interface RuntimeConfig {
  grpcHost: string;
  grpcPort: number;
  dataRoot: string;
  dshImage: string;
  maxContainers: number;
  containerMemoryLimit: string;
  containerCpuLimit: number;
  deepseekApiKey: string;
}
