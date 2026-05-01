import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  CodesignError,
  ERROR_CODES,
  extractAnimationCodeFromHtml,
  extractAnimationComponentName,
  parseAnimationCodeMeta,
  OPEN_CODESIGN_ANIMATION_COMPOSITION_ID,
  extractAnimationSpecFromHtml,
} from '@open-codesign/shared';
import type { ExportProgressCallback } from './index';

const require = createRequire(import.meta.url);
const RUNTIME_NODE_MODULES_DIR = path.join(process.cwd(), 'runtime', 'node_modules');
const DYNAMIC_ANIMATION_COMPOSITION_ID = 'OpenCodesignDynamicAnimation';

type RemotionBundlerModule = typeof import('@remotion/bundler');
type RemotionRendererModule = typeof import('@remotion/renderer');

let animationBundlePromise: Promise<string> | null = null;
let remotionBundlerPromise: Promise<RemotionBundlerModule> | null = null;
let remotionRendererPromise: Promise<RemotionRendererModule> | null = null;

function findBrowserExecutable(): string | undefined {
  const candidates = [
    process.env['PUPPETEER_EXECUTABLE_PATH'],
    process.env['CHROME_BIN'],
    process.env['CHROMIUM_PATH'],
    process.platform === 'linux' ? '/usr/bin/chromium' : undefined,
    process.platform === 'linux' ? '/usr/bin/chromium-browser' : undefined,
    process.platform === 'win32'
      ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      : undefined,
    process.platform === 'win32'
      ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
      : undefined,
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined,
  ];
  return candidates.find((value) => typeof value === 'string' && value.length > 0);
}

async function importRuntimeModule<T>(
  moduleName: string,
  fallbackFile: string,
): Promise<T> {
  try {
    return (await import(moduleName)) as T;
  } catch (error) {
    const fallbackUrl = pathToFileURL(path.join(RUNTIME_NODE_MODULES_DIR, fallbackFile)).href;
    try {
      return (await import(fallbackUrl)) as T;
    } catch {
      throw error;
    }
  }
}

function resolveAnimationEntryPoint(): string {
  try {
    return require.resolve('@open-codesign/animation/root');
  } catch {
    return path.join(
      RUNTIME_NODE_MODULES_DIR,
      '@open-codesign',
      'animation',
      'src',
      'root.tsx',
    );
  }
}

async function getRemotionBundler(): Promise<RemotionBundlerModule> {
  if (!remotionBundlerPromise) {
    remotionBundlerPromise = importRuntimeModule<RemotionBundlerModule>(
      '@remotion/bundler',
      '@remotion/bundler/dist/index.js',
    );
  }
  return remotionBundlerPromise;
}

async function getRemotionRenderer(): Promise<RemotionRendererModule> {
  if (!remotionRendererPromise) {
    remotionRendererPromise = importRuntimeModule<RemotionRendererModule>(
      '@remotion/renderer',
      '@remotion/renderer/dist/esm/index.mjs',
    );
  }
  return remotionRendererPromise;
}

async function getAnimationBundle(): Promise<string> {
  if (!animationBundlePromise) {
    const { bundle } = await getRemotionBundler();
    animationBundlePromise = bundle({
      entryPoint: resolveAnimationEntryPoint(),
    });
  }
  return animationBundlePromise;
}

function stripCodeFence(code: string): string {
  const trimmed = code.trim();
  const match = trimmed.match(/^```(?:tsx|jsx|ts|js)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function ensureNamedExport(code: string, componentName: string): string {
  if (
    new RegExp(`export\\s+(?:const|function|class)\\s+${componentName}\\b`).test(code) ||
    new RegExp(`export\\s+default\\s+function\\s+${componentName}\\b`).test(code) ||
    new RegExp(`export\\s+default\\s+${componentName}\\b`).test(code)
  ) {
    return code;
  }
  if (new RegExp(`\\b(?:const|function|class)\\s+${componentName}\\b`).test(code)) {
    return `${code}\n\nexport { ${componentName} };`;
  }
  return code;
}

async function renderFromBundle(params: {
  serveUrl: string;
  compositionId: string;
  destinationPath: string;
  inputProps?: Record<string, unknown>;
  onProgress?: ExportProgressCallback;
}): Promise<{ bytes: number; path: string }> {
  const { renderMedia, selectComposition } = await getRemotionRenderer();
  const browserExecutable = findBrowserExecutable();
  params.onProgress?.({
    phase: 'preparing',
    progress: 0.12,
    message: 'Loading composition metadata',
  });
  const composition = await selectComposition({
    serveUrl: params.serveUrl,
    id: params.compositionId,
    ...(params.inputProps ? { inputProps: params.inputProps } : {}),
    ...(browserExecutable ? { browserExecutable } : {}),
    logLevel: 'error',
  });
  params.onProgress?.({
    phase: 'preparing',
    progress: 0.18,
    message: 'Composition ready',
    totalFrames: composition.durationInFrames,
  });
  await renderMedia({
    composition,
    serveUrl: params.serveUrl,
    codec: 'h264',
    outputLocation: params.destinationPath,
    ...(params.inputProps ? { inputProps: params.inputProps } : {}),
    imageFormat: 'jpeg',
    ...(browserExecutable ? { browserExecutable } : {}),
    logLevel: 'error',
    onProgress: (progress) => {
      const phase = progress.stitchStage === 'muxing' ? 'finalizing' : 'rendering';
      const clamped = Math.min(0.97, 0.18 + progress.progress * 0.77);
      params.onProgress?.({
        phase,
        progress: clamped,
        message:
          phase === 'finalizing'
            ? 'Encoding and muxing video'
            : `Rendering frames ${progress.renderedFrames}/${composition.durationInFrames}`,
        renderedFrames: progress.renderedFrames,
        encodedFrames: progress.encodedFrames,
        totalFrames: composition.durationInFrames,
      });
    },
  });
  const details = await stat(params.destinationPath);
  return { bytes: details.size, path: params.destinationPath };
}

async function renderDynamicAnimationCode(
  code: string,
  destinationPath: string,
  onProgress?: ExportProgressCallback,
): Promise<{ bytes: number; path: string }> {
  const componentName = extractAnimationComponentName(code);
  if (!componentName) {
    throw new CodesignError(
      'MP4 export requires an exported Remotion component in the animation code.',
      ERROR_CODES.EXPORTER_MP4_FAILED,
    );
  }

  const meta = parseAnimationCodeMeta(code);
  const normalizedCode = ensureNamedExport(stripCodeFence(code), componentName);
  const runtimeRoot = path.join(process.cwd(), 'runtime');
  const buildRoot = path.join(runtimeRoot, 'generated');
  await mkdir(buildRoot, { recursive: true });
  const tempDir = await mkdtemp(path.join(buildRoot, 'animation-'));
  onProgress?.({
    phase: 'preparing',
    progress: 0.04,
    message: 'Preparing Remotion export runtime',
    totalFrames: meta.durationInFrames,
  });

  try {
    const compositionPath = path.join(tempDir, 'composition.tsx');
    const rootPath = path.join(tempDir, 'root.tsx');
    await writeFile(compositionPath, normalizedCode, 'utf8');
    await writeFile(
      rootPath,
      [
        "import React from 'react';",
        "import { Composition, registerRoot } from 'remotion';",
        `import { ${componentName} } from './composition';`,
        '',
        'const Root = () => (',
        `  <Composition id="${DYNAMIC_ANIMATION_COMPOSITION_ID}" component={${componentName}} durationInFrames={${meta.durationInFrames}} fps={${meta.fps}} width={${meta.width}} height={${meta.height}} />`,
        ');',
        '',
        'registerRoot(Root);',
        '',
      ].join('\n'),
      'utf8',
    );

    const { bundle } = await getRemotionBundler();
    onProgress?.({
      phase: 'preparing',
      progress: 0.08,
      message: 'Bundling Remotion composition',
      totalFrames: meta.durationInFrames,
    });
    const serveUrl = await bundle({ entryPoint: rootPath });
    return await renderFromBundle({
      serveUrl,
      compositionId: DYNAMIC_ANIMATION_COMPOSITION_ID,
      destinationPath,
      ...(onProgress ? { onProgress } : {}),
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function exportMp4(
  htmlContent: string,
  destinationPath: string,
  onProgress?: ExportProgressCallback,
): Promise<{
  bytes: number;
  path: string;
}> {
  const animationCode = extractAnimationCodeFromHtml(htmlContent);
  const spec = extractAnimationSpecFromHtml(htmlContent);
  if (!spec && !animationCode) {
    throw new CodesignError(
      'MP4 export requires embedded animation code or a valid animation spec.',
      ERROR_CODES.EXPORTER_MP4_FAILED,
    );
  }

  try {
    if (animationCode) {
      return await renderDynamicAnimationCode(animationCode, destinationPath, onProgress);
    }

    const serveUrl = await getAnimationBundle();
    onProgress?.({
      phase: 'preparing',
      progress: 0.08,
      message: 'Loading default animation bundle',
    });
    return await renderFromBundle({
      serveUrl,
      compositionId: OPEN_CODESIGN_ANIMATION_COMPOSITION_ID,
      inputProps: { spec },
      destinationPath,
      ...(onProgress ? { onProgress } : {}),
    });
  } catch (error) {
    if (error instanceof CodesignError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new CodesignError(message, ERROR_CODES.EXPORTER_MP4_FAILED, { cause: error });
  }
}
