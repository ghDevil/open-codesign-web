import * as Babel from '@babel/standalone';
import * as RemotionShapes from '@remotion/shapes';
import {
  TransitionSeries,
  linearTiming,
  springTiming,
} from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { flip } from '@remotion/transitions/flip';
import { clockWipe } from '@remotion/transitions/clock-wipe';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  Series,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

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

    const createComponent = new Function(
      'React',
      'useState',
      'useEffect',
      'useMemo',
      'useRef',
      // Remotion core
      'AbsoluteFill',
      'Sequence',
      'Series',
      'Img',
      'Easing',
      'interpolate',
      'spring',
      'random',
      'staticFile',
      'useCurrentFrame',
      'useVideoConfig',
      // Shapes
      'Rect',
      'Circle',
      'Triangle',
      'Star',
      'Polygon',
      'Ellipse',
      'Heart',
      'Pie',
      'makeRect',
      'makeCircle',
      'makeTriangle',
      'makeStar',
      'makePolygon',
      'makeEllipse',
      'makeHeart',
      'makePie',
      // Transitions
      'TransitionSeries',
      'linearTiming',
      'springTiming',
      'fade',
      'slide',
      'wipe',
      'flip',
      'clockWipe',
      wrappedCode,
    );

    const Component = createComponent(
      React,
      useState,
      useEffect,
      useMemo,
      useRef,
      // Remotion core
      AbsoluteFill,
      Sequence,
      Series,
      Img,
      Easing,
      interpolate,
      spring,
      random,
      resolveStaticFile ?? staticFile,
      useCurrentFrame,
      useVideoConfig,
      // Shapes
      RemotionShapes.Rect,
      RemotionShapes.Circle,
      RemotionShapes.Triangle,
      RemotionShapes.Star,
      RemotionShapes.Polygon,
      RemotionShapes.Ellipse,
      RemotionShapes.Heart,
      RemotionShapes.Pie,
      RemotionShapes.makeRect,
      RemotionShapes.makeCircle,
      RemotionShapes.makeTriangle,
      RemotionShapes.makeStar,
      RemotionShapes.makePolygon,
      RemotionShapes.makeEllipse,
      RemotionShapes.makeHeart,
      RemotionShapes.makePie,
      // Transitions
      TransitionSeries,
      linearTiming,
      springTiming,
      fade,
      slide,
      wipe,
      flip,
      clockWipe,
    ) as React.ComponentType | null;

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
