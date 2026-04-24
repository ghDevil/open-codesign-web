// Workstream G — canvas tabs.
// 'files' is the pinned tab that hosts the file list + inline preview; 'file'
// tabs wrap a single file preview opened by double-clicking the list. Closing
// a 'file' tab is purely UI state — it does NOT delete anything.
export type CanvasTab = { kind: 'files' } | { kind: 'file'; path: string };

export const FILES_TAB: CanvasTab = { kind: 'files' };

// Pure reducers, exported for unit tests so we don't need RTL for slice logic.
export function openFileTab(tabs: CanvasTab[], path: string): { tabs: CanvasTab[]; index: number } {
  const existing = tabs.findIndex((t) => t.kind === 'file' && t.path === path);
  if (existing !== -1) return { tabs, index: existing };
  const next: CanvasTab[] = [...tabs, { kind: 'file', path }];
  return { tabs: next, index: next.length - 1 };
}

export function closeTabAt(
  tabs: CanvasTab[],
  activeIndex: number,
  target: number,
): { tabs: CanvasTab[]; activeIndex: number } {
  const tab = tabs[target];
  if (!tab) return { tabs, activeIndex };
  // The pinned 'files' tab cannot be closed — it always anchors index 0.
  if (tab.kind === 'files') return { tabs, activeIndex };
  const next = tabs.filter((_, i) => i !== target);
  let nextActive = activeIndex;
  if (activeIndex === target) {
    nextActive = Math.max(0, target - 1);
  } else if (activeIndex > target) {
    nextActive = activeIndex - 1;
  }
  return { tabs: next, activeIndex: nextActive };
}
