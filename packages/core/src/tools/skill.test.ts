import { describe, expect, it } from 'vitest';
import { invokeSkill, listSkillManifest } from './skill';

describe('skill tool', () => {
  it('manifest exposes builtin design skills', async () => {
    const m = await listSkillManifest();
    expect(m.length).toBeGreaterThan(0);
    expect(m.some((e) => e.category === 'design' && e.source === 'builtin')).toBe(true);
  });

  it('returns "already-loaded" for repeated invocations', async () => {
    const m = await listSkillManifest();
    const designs = m.filter((e) => e.category === 'design');
    if (designs.length === 0) return; // skip if no skills (subagent ordering)
    const first = await invokeSkill({ name: designs[0]!.name });
    expect(first.status).toBe('loaded');
    const second = await invokeSkill({
      name: designs[0]!.name,
      alreadyLoaded: new Set([designs[0]!.name]),
    });
    expect(second.status).toBe('already-loaded');
  });

  it('returns not-found for unknown names', async () => {
    const r = await invokeSkill({ name: 'no-such-skill' });
    expect(r.status).toBe('not-found');
  });
});
