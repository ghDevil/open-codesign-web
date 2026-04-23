import { describe, expect, it } from 'vitest';
import { deriveCapabilities, exposeTools } from './tool-manifest';

describe('tool-manifest', () => {
  it('vision flag follows model.input array', () => {
    const visionCaps = deriveCapabilities({ input: ['text', 'image'] }, []);
    expect(visionCaps.vision).toBe(true);
    const textOnly = deriveCapabilities({ input: ['text'] }, []);
    expect(textOnly.vision).toBe(false);
  });

  it('imageGen follows openai provider presence', () => {
    expect(deriveCapabilities({}, [{ id: 'anthropic' }]).imageGen).toBe(false);
    expect(deriveCapabilities({}, [{ id: 'openai' }]).imageGen).toBe(true);
  });

  it('exposeTools hides gen_image without openai', () => {
    const caps = deriveCapabilities({ input: ['text'] }, [{ id: 'anthropic' }]);
    const tools = exposeTools(caps);
    expect(tools).not.toContain('gen_image');
    expect(tools).toContain('preview');
    expect(tools).toContain('ask');
  });

  it('exposeTools surfaces gen_image with openai', () => {
    const caps = deriveCapabilities({ input: ['text', 'image'] }, [{ id: 'openai' }]);
    expect(exposeTools(caps)).toContain('gen_image');
  });
});
