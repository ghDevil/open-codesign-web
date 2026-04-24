/**
 * Quick sanity gate for artifact content before we overwrite the design's
 * latest snapshot. Catches the dominant failure mode: an agent run that was
 * interrupted mid-edit (context blowup, provider 400, autopolish crash, user
 * cancel) leaves a truncated JSX file in the virtual FS — its tail is missing
 * the `ReactDOM.createRoot(...).render(<App/>)` line and braces are wildly
 * unbalanced. Persisting that as the new snapshot would blank the hub
 * thumbnail and lose the previous good state. The check is intentionally
 * tolerant (±2 on bracket count) so whitespace quirks in valid artifacts pass.
 */
export function looksRunnableArtifact(src: string): boolean {
  const trimmed = src.trim();
  if (trimmed.length === 0) return false;
  if (/<html[\s>]/i.test(trimmed) || /<body[\s>]/i.test(trimmed)) return true;
  if (!/ReactDOM\.createRoot\s*\([\s\S]*?\)\s*\.render\s*\(/.test(trimmed)) return false;
  const opens = (trimmed.match(/\{/g) ?? []).length;
  const closes = (trimmed.match(/\}/g) ?? []).length;
  if (Math.abs(opens - closes) > 2) return false;
  const popens = (trimmed.match(/\(/g) ?? []).length;
  const pcloses = (trimmed.match(/\)/g) ?? []).length;
  if (Math.abs(popens - pcloses) > 2) return false;
  return true;
}
