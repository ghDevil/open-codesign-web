import { describe, expect, it } from 'vitest';
import { validateAskInput } from './ask';

describe('validateAskInput', () => {
  it('accepts a valid single-question payload', () => {
    expect(
      validateAskInput({
        questions: [{ id: 'q1', type: 'freeform', prompt: 'who are you?' }],
      }),
    ).toEqual({ ok: true });
  });
  it('rejects empty questions', () => {
    expect(validateAskInput({ questions: [] }).ok).toBe(false);
  });
  it('rejects more than 25 questions', () => {
    expect(
      validateAskInput({
        questions: Array.from({ length: 26 }, (_, i) => ({
          id: `q${i}`,
          type: 'freeform',
          prompt: 'x',
        })),
      }).ok,
    ).toBe(false);
  });
  it('rejects non-object', () => {
    expect(validateAskInput(null).ok).toBe(false);
    expect(validateAskInput('hi').ok).toBe(false);
  });
});
