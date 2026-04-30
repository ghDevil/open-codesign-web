import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  CodesignError,
  ERROR_CODES,
  OPEN_CODESIGN_ANIMATION_COMPOSITION_ID,
  extractAnimationSpecFromHtml,
} from '@open-codesign/shared';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

const require = createRequire(import.meta.url);

let animationBundlePromise: Promise<string> | null = null;

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

async function getAnimationBundle(): Promise<string> {
  if (!animationBundlePromise) {
    animationBundlePromise = bundle({
      entryPoint: require.resolve('@open-codesign/animation/root'),
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
