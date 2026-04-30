import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  CodesignError,
  ERROR_CODES,
  OPEN_CODESIGN_ANIMATION_COMPOSITION_ID,
  extractAnimationSpecFromHtml,
} from '@open-codesign/shared';

const require = createRequire(import.meta.url);
const RUNTIME_NODE_MODULES_DIR = path.join(process.cwd(), 'runtime', 'node_modules');

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

export async function exportMp4(htmlContent: string, destinationPath: string): Promise<{
  bytes: number;
  path: string;
}> {
  const spec = extractAnimationSpecFromHtml(htmlContent);
  if (!spec) {
    throw new CodesignError(
      'MP4 export requires a valid embedded animation spec.',
      ERROR_CODES.EXPORTER_MP4_FAILED,
    );
  }

  try {
    const serveUrl = await getAnimationBundle();
    const { renderMedia, selectComposition } = await getRemotionRenderer();
    const browserExecutable = findBrowserExecutable();
    const inputProps = { spec };
    const composition = await selectComposition({
      serveUrl,
      id: OPEN_CODESIGN_ANIMATION_COMPOSITION_ID,
      inputProps,
      ...(browserExecutable ? { browserExecutable } : {}),
      logLevel: 'error',
    });
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: destinationPath,
      inputProps,
      imageFormat: 'jpeg',
      ...(browserExecutable ? { browserExecutable } : {}),
      logLevel: 'error',
    });
    const details = await stat(destinationPath);
    return { bytes: details.size, path: destinationPath };
  } catch (error) {
    if (error instanceof CodesignError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new CodesignError(message, ERROR_CODES.EXPORTER_MP4_FAILED, { cause: error });
  }
}
