// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSelectedDesignSystemId,
  copySelectedDesignSystemId,
  readSelectedDesignSystemId,
  writeSelectedDesignSystemId,
} from './design-system-selection';

describe('design-system-selection', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores and reads a selected design system id per design', () => {
    writeSelectedDesignSystemId('design-1', 'brand-a');
    writeSelectedDesignSystemId('design-2', 'brand-b');

    expect(readSelectedDesignSystemId('design-1')).toBe('brand-a');
    expect(readSelectedDesignSystemId('design-2')).toBe('brand-b');
  });

  it('clears a selection when null is written', () => {
    writeSelectedDesignSystemId('design-1', 'brand-a');
    writeSelectedDesignSystemId('design-1', null);

    expect(readSelectedDesignSystemId('design-1')).toBeNull();
  });

  it('copies the source design selection to the duplicated design', () => {
    writeSelectedDesignSystemId('design-source', 'brand-a');

    copySelectedDesignSystemId('design-source', 'design-copy');

    expect(readSelectedDesignSystemId('design-copy')).toBe('brand-a');
  });

  it('clearSelectedDesignSystemId removes only the target design binding', () => {
    writeSelectedDesignSystemId('design-1', 'brand-a');
    writeSelectedDesignSystemId('design-2', 'brand-b');

    clearSelectedDesignSystemId('design-1');

    expect(readSelectedDesignSystemId('design-1')).toBeNull();
    expect(readSelectedDesignSystemId('design-2')).toBe('brand-b');
  });
});
