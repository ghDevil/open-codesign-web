import { describe, expect, it } from 'vitest';
import { __test } from './workspace-watcher';

describe('workspace-watcher ignore patterns', () => {
  for (const ignored of [
    'node_modules/foo/bar.js',
    'apps/desktop/node_modules/y',
    '.git/HEAD',
    'sub/.git/index',
    '.codesign/sessions/abc.jsonl',
    '.DS_Store',
    'sub/.DS_Store',
  ]) {
    it(`ignores ${ignored}`, () => {
      expect(__test.isIgnored(ignored)).toBe(true);
    });
  }
  for (const allowed of [
    'index.html',
    'src/App.tsx',
    'DESIGN.md',
    'AGENTS.md',
    'page/landing.jsx',
  ]) {
    it(`watches ${allowed}`, () => {
      expect(__test.isIgnored(allowed)).toBe(false);
    });
  }
});
