import * as Babel from '@babel/standalone';
import { extractAnimationComponentName } from '@open-codesign/shared';
import * as Remotion from 'remotion';
import React, { useMemo } from 'react';

export interface CompilationResult {
  Component: React.ComponentType | null;
  error: string | null;
}

const REMOTION_APIS = Object.fromEntries(
  Object.entries({ React, ...Remotion }).filter(([key]) => /^[A-Za-z_$][\w$]*$/.test(key)),
);

function stripCodeFence(code: string): string {
  const trimmed = code.trim();
  const match = trimmed.match(/^```(?:tsx|jsx|ts|js)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function stripImports(code: string): string {
  return code
    .replace(/^['"]use client['"]\s*;?\s*$/gm, '')
    .replace(/^import\s+.*?from\s+['"][^'"]*['"]\s*;?\s*$/gm, '')
    .replace(/^import\s+['"][^'"]*['"]\s*;?\s*$/gm, '')
    .trim();
}

function normalizeComponentSource(code: string): { source: string; componentName: string } {
  const stripped = stripImports(stripCodeFence(code));
  const componentName = extractAnimationComponentName(stripped) ?? 'MyComposition';
  const withoutDefaultExports = stripped
    .replace(/export\s+default\s+function\s+([A-Za-z_$][\w$]*)/g, 'function $1')
    .replace(/export\s+default\s+class\s+([A-Za-z_$][\w$]*)/g, 'class $1')
    .replace(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/g, '$1')
    .replace(/export\s+/g, '');
  return { source: withoutDefaultExports, componentName };
}

export function useCompilation(code: string): CompilationResult {
  return useMemo(() => {
    if (!code.trim()) return { Component: null, error: null };

    try {
      const { source, componentName } = normalizeComponentSource(code);
      const transpiled = Babel.transform(source, {
        presets: ['react', 'typescript'],
        filename: 'dynamic-remotion.tsx',
      });
      if (!transpiled.code) {
        return { Component: null, error: 'Transpilation produced no output.' };
      }

      const apiNames = Object.keys(REMOTION_APIS);
      const apiValues = Object.values(REMOTION_APIS);

      // biome-ignore lint/security/noGlobalEval: dynamic Remotion preview intentionally compiles generated code at runtime.
      const createComponent = new Function(
        ...apiNames,
        `${transpiled.code}\nreturn typeof ${componentName} !== 'undefined' ? ${componentName} : null;`,
      );
      const Component = createComponent(...apiValues) as React.ComponentType | null;

      if (!Component) {
        return {
          Component: null,
          error: `Could not find an exported Remotion component named "${componentName}".`,
        };
      }

      return { Component, error: null };
    } catch (error) {
      return {
        Component: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [code]);
}
