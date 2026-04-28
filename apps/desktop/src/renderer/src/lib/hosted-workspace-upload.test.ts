import { describe, expect, it } from 'vitest';
import {
  buildHostedWorkspaceDisplayPath,
  normalizeHostedWorkspaceUploadPath,
} from './hosted-workspace-upload';

describe('normalizeHostedWorkspaceUploadPath', () => {
  it('normalizes slash direction and strips empty segments', () => {
    expect(normalizeHostedWorkspaceUploadPath('team\\repo\\src\\index.tsx')).toBe(
      'team/repo/src/index.tsx',
    );
    expect(normalizeHostedWorkspaceUploadPath('/team/repo//src/index.tsx')).toBe(
      'team/repo/src/index.tsx',
    );
  });

  it('drops dot segments and rejects empty paths', () => {
    expect(normalizeHostedWorkspaceUploadPath('./repo/../src/app.ts')).toBe('repo/src/app.ts');
    expect(normalizeHostedWorkspaceUploadPath('   ')).toBeNull();
  });
});

describe('buildHostedWorkspaceDisplayPath', () => {
  it('uses the first uploaded folder segment for the display label', () => {
    expect(buildHostedWorkspaceDisplayPath(['brand-system/src/tokens.ts'])).toBe(
      'hosted://codebase/brand-system',
    );
  });

  it('falls back to upload when no valid path exists', () => {
    expect(buildHostedWorkspaceDisplayPath(['', '   '])).toBe('hosted://codebase/upload');
  });
});