import { type Static, Type } from '@sinclair/typebox';

/**
 * `preview` tool (T3.4). Renders a workspace artifact and returns a
 * structured report. Splitting the preview pipeline out of `done` so
 * the agent can self-check intermediate states without ending the turn.
 *
 * Capability-driven output (T3.6 dispatches based on session model):
 *   - vision-capable model -> includes screenshot (data URL or path).
 *   - text-only model -> returns DOM outline + metrics + console errors.
 *
 * Execution lives in the renderer's sandbox iframe; this module owns
 * the wire schema + budget caps (asset errors ≤20, console ≤50).
 */

export const PreviewInput = Type.Object({
  path: Type.String({ description: 'Workspace-relative artifact path.' }),
  vision: Type.Optional(Type.Boolean()),
});
export type PreviewInput = Static<typeof PreviewInput>;

export const ConsoleEntry = Type.Object({
  level: Type.Union([
    Type.Literal('log'),
    Type.Literal('warn'),
    Type.Literal('error'),
    Type.Literal('info'),
  ]),
  message: Type.String(),
});

export const AssetError = Type.Object({
  url: Type.String(),
  status: Type.Number(),
  type: Type.Optional(Type.String()),
});

export const PreviewResult = Type.Object({
  ok: Type.Boolean(),
  /** Set only when capabilities.vision === true. */
  screenshot: Type.Optional(Type.String()),
  /** Tag tree at depth ≤4 — for text-only models. */
  domOutline: Type.Optional(Type.String()),
  consoleErrors: Type.Array(ConsoleEntry, { maxItems: 50 }),
  assetErrors: Type.Array(AssetError, { maxItems: 20 }),
  metrics: Type.Object({
    nodes: Type.Number(),
    height: Type.Number(),
    width: Type.Number(),
    loadMs: Type.Number(),
  }),
  reason: Type.Optional(Type.String()),
});
export type PreviewResult = Static<typeof PreviewResult>;

export const MAX_CONSOLE_ENTRIES = 50;
export const MAX_ASSET_ERRORS = 20;

export function trimPreviewResult(result: PreviewResult): PreviewResult {
  return {
    ...result,
    consoleErrors: result.consoleErrors.slice(0, MAX_CONSOLE_ENTRIES),
    assetErrors: result.assetErrors.slice(0, MAX_ASSET_ERRORS),
  };
}
