import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as toYaml } from 'yaml';
export class BlueprintTranslator {
    dataRoot;
    constructor(dataRoot) {
        this.dataRoot = dataRoot;
    }
    async translate(tenantId, agentId, bp) {
        const dir = join(this.dataRoot, tenantId, agentId);
        await mkdir(dir, { recursive: true });
        const plugins = {};
        plugins['@deepseek-ai/dsh-agent-loop'] = {
            agents: [{ id: agentId, maxParallelToolCalls: 4 }],
        };
        if (bp.provider === 'deepseek') {
            plugins['@deepseek-ai/dsh-llm-deepseek-api-key'] = {};
        }
        else {
            plugins['@deepseek-ai/dsh-llm-pi-ai'] = bp.apiBase ? { baseURL: bp.apiBase } : {};
        }
        plugins['@deepseek-ai/dsh-system-prompt'] = {
            personaPrefix: buildSystemPrompt(bp.systemPrompt, bp.skillBindings),
        };
        plugins['@deepseek-ai/dsh-tools'] = {};
        if (bp.mcpBindings && bp.mcpBindings.length > 0) {
            plugins['@deepseek-ai/dsh-mcp-client'] = {
                servers: bp.mcpBindings.map((m) => ({
                    name: m.name,
                    transport: m.serverType === 'stdio'
                        ? { type: 'stdio', command: m.command, args: m.args }
                        : { type: 'sse', url: m.url },
                })),
            };
        }
        const configPath = join(dir, 'cordis.yml');
        await writeFile(configPath, toYaml({ plugins }), 'utf-8');
        return dir;
    }
}
function buildSystemPrompt(base, skills) {
    if (!skills || skills.length === 0)
        return base;
    const sections = skills.map((s) => `\n\n## Skill: ${s.name}\n\n${s.content}`).join('');
    return base + sections;
}
