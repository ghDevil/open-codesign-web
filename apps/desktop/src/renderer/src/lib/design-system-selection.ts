const DESIGN_SYSTEM_SELECTION_KEY = 'open-codesign.design-system-selection.v1';

type SelectionMap = Record<string, string>;

function readSelectionMap(): SelectionMap {
  try {
    const raw = window.localStorage.getItem(DESIGN_SYSTEM_SELECTION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => typeof key === 'string' && typeof value === 'string' && value.length > 0,
      ),
    );
  } catch {
    return {};
  }
}

function writeSelectionMap(map: SelectionMap): void {
  try {
    if (Object.keys(map).length === 0) {
      window.localStorage.removeItem(DESIGN_SYSTEM_SELECTION_KEY);
      return;
    }
    window.localStorage.setItem(DESIGN_SYSTEM_SELECTION_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage failures.
  }
}

export function readSelectedDesignSystemId(designId: string): string | null {
  return readSelectionMap()[designId] ?? null;
}

export function writeSelectedDesignSystemId(designId: string, designSystemId: string | null): void {
  const map = readSelectionMap();
  if (typeof designSystemId === 'string' && designSystemId.trim().length > 0) {
    map[designId] = designSystemId.trim();
  } else {
    delete map[designId];
  }
  writeSelectionMap(map);
}

export function copySelectedDesignSystemId(sourceDesignId: string, targetDesignId: string): void {
  writeSelectedDesignSystemId(targetDesignId, readSelectedDesignSystemId(sourceDesignId));
}

export function clearSelectedDesignSystemId(designId: string): void {
  writeSelectedDesignSystemId(designId, null);
}
