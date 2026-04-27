import { CodesignError } from '@open-codesign/shared';

const TIMEOUT_SIGNAL_KEY = Symbol('generationTimeoutError');

export function armGenerationTimeout(
  id: string,
  controller: AbortController,
  getTimeoutSec: () => Promise<number>,
  logger: Pick<Console, 'warn'>,
): Promise<() => void> {
  return getTimeoutSec().then((sec) => {
    if (!sec || sec <= 0) return () => {};
    const handle = setTimeout(() => {
      const err = new CodesignError(
        `Generation timed out after ${sec}s. You can increase the timeout in Settings → Advanced.`,
        'GENERATION_TIMEOUT',
      );
      (controller.signal as unknown as Record<symbol, unknown>)[TIMEOUT_SIGNAL_KEY] = err;
      controller.abort(err);
      logger.warn(`[generation] timeout id=${id} sec=${sec}`);
    }, sec * 1000);
    return () => clearTimeout(handle);
  });
}

export function cancelGenerationRequest(
  generationId: string,
  inFlight: Map<string, AbortController>,
  logger: Pick<Console, 'warn'>,
): void {
  const controller = inFlight.get(generationId);
  if (!controller) {
    logger.warn(`[generation] cancel: no in-flight request for ${generationId}`);
    return;
  }
  controller.abort(new CodesignError('Generation cancelled by user', 'GENERATION_CANCELLED'));
  inFlight.delete(generationId);
}

export function extractGenerationTimeoutError(signal: AbortSignal): CodesignError | undefined {
  const err = (signal as unknown as Record<symbol, unknown>)[TIMEOUT_SIGNAL_KEY];
  return err instanceof CodesignError ? err : undefined;
}
