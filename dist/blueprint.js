export function buildSystemPrompt(basePrompt, skills) {
    if (!skills || skills.length === 0)
        return basePrompt;
    const sections = skills
        .map((s) => `\n\n## Skill: ${s.name}\n\n${s.content}`)
        .join('');
    return basePrompt + sections;
}
