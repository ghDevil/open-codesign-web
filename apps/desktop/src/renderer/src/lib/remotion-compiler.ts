import * as Babel from '@babel/standalone';
import * as Remotion from 'remotion';
import * as RemotionShapes from '@remotion/shapes';
import {
  TransitionSeries,
  linearTiming,
  springTiming,
  useTransitionProgress,
} from '@remotion/transitions';
import { none } from '@remotion/transitions/none';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { flip } from '@remotion/transitions/flip';
import { clockWipe } from '@remotion/transitions/clock-wipe';
import { zoomBlur, zoomBlurShader } from '@remotion/transitions/zoom-blur';
import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface CompilationResult {
  Component: React.ComponentType | null;
  error: string | null;
}

export interface RemotionCompileAsset {
  key: string;
  dataUrl: string;
}

function stripImports(code: string): string {
  let cleaned = code;
  cleaned = cleaned.replace(
    /import\s+type\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];?/g,
    '',
  );
  cleaned = cleaned.replace(
    /import\s+\w+\s*,\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];?/g,
    '',
  );
  cleaned = cleaned.replace(
    /import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];?/g,
    '',
  );
  cleaned = cleaned.replace(
    /import\s+\*\s+as\s+\w+\s+from\s*["'][^"']+["'];?/g,
    '',
  );
  cleaned = cleaned.replace(/import\s+\w+\s+from\s*["'][^"']+["'];?/g, '');
  cleaned = cleaned.replace(/import\s*["'][^"']+["'];?/g, '');
  cleaned = cleaned.replace(/^['"]use client['"]\s*;?\s*$/gm, '');
  return cleaned.trim();
}

function extractComponentBody(code: string): { source: string; componentName: string } {
  const cleaned = stripImports(code);

  // Try to extract: `[helpers] export const X = () => { ... }`
  const arrowMatch = cleaned.match(
    /^([\s\S]*?)export\s+const\s+(\w+)\s*[:=].*?=>\s*\{([\s\S]*)\};?\s*$/,
  );
  if (arrowMatch?.[2] && arrowMatch[3] !== undefined) {
    const helpers = (arrowMatch[1] ?? '').trim();
    const componentName = arrowMatch[2];
    const body = arrowMatch[3].trim();
    const wrapped = `const ${componentName} = () => {\n${body}\n};`;
    const source = helpers ? `${helpers}\n\n${wrapped}` : wrapped;
    return { source, componentName };
  }

  // Try function form: `export function X() { ... }` or `export default function X() { ... }`
  const fnMatch = cleaned.match(/export\s+(?:default\s+)?function\s+(\w+)/);
  if (fnMatch?.[1]) {
    const componentName = fnMatch[1];
    const source = cleaned
      .replace(/export\s+default\s+function/, 'function')
      .replace(/export\s+function/, 'function')
      .replace(/export\s+default\s+/g, '')
      .replace(/export\s+/g, '');
    return { source, componentName };
  }

  // Try `export default X` (where X is a name)
  const defaultMatch = cleaned.match(/export\s+default\s+(\w+)\s*;?/);
  if (defaultMatch?.[1]) {
    const componentName = defaultMatch[1];
    const source = cleaned.replace(/export\s+default\s+\w+\s*;?/, '').trim();
    return { source, componentName };
  }

  // Last resort: assume the code is just a body, wrap in MyComposition
  return {
    source: `const MyComposition = () => {\n${cleaned}\n};`,
    componentName: 'MyComposition',
  };
}

export function compileRemotionCode(
  code: string,
  assets: RemotionCompileAsset[] = [],
): CompilationResult {
  if (!code?.trim()) {
    return { Component: null, error: null };
  }

  try {
    const { source, componentName } = extractComponentBody(code);

    const transpiled = Babel.transform(source, {
      presets: ['react', 'typescript'],
      filename: 'dynamic-animation.tsx',
    });

    if (!transpiled.code) {
      return { Component: null, error: 'Transpilation failed' };
    }

    const wrappedCode = `${transpiled.code}\nreturn typeof ${componentName} !== 'undefined' ? ${componentName} : null;`;

    const assetMap = new Map<string, string>();
    for (const asset of assets) {
      assetMap.set(asset.key, asset.dataUrl);
      const normalized = asset.key.replace(/\\/g, '/');
      assetMap.set(normalized, asset.dataUrl);
      const baseName = normalized.split('/').pop();
      if (baseName) assetMap.set(baseName, asset.dataUrl);
      if (!normalized.startsWith('assets/')) {
        assetMap.set(`assets/${normalized}`, asset.dataUrl);
        if (baseName) assetMap.set(`assets/${baseName}`, asset.dataUrl);
      }
    }

    const resolveStaticFile = (input: string): string => {
      const normalized = input.replace(/\\/g, '/');
      return (
        assetMap.get(input) ??
        assetMap.get(normalized) ??
        assetMap.get(normalized.split('/').pop() ?? normalized) ??
        assetMap.get(`assets/${normalized}`) ??
        input
      );
    };

    const scope = {
      React,
      useState,
      useEffect,
      useMemo,
      useRef,
      ...Remotion,
      ...RemotionShapes,
      TransitionSeries,
      linearTiming,
      springTiming,
      useTransitionProgress,
      fade,
      slide,
      wipe,
      flip,
      clockWipe,
      none,
      zoomBlur,
      zoomBlurShader,
      staticFile: resolveStaticFile,
    };
    const scopeKeys = Object.keys(scope).filter((key) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key));
    const prelude = `const { ${scopeKeys.join(', ')} } = __scope;`;
    const createComponent = new Function('__scope', `${prelude}\n${wrappedCode}`);

    const Component = createComponent(scope) as React.ComponentType | null;

    if (typeof Component !== 'function') {
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
}
