import type { SkillBinding } from './types.js';

export function buildSystemPrompt(basePrompt: string, skills: SkillBinding[]): string {
  if (!skills || skills.length === 0) return basePrompt;
  const sections = skills
    .map((s) => `\n\n## Skill: ${s.name}\n\n${s.content}`)
    .join('');
  return basePrompt + sections;
}
