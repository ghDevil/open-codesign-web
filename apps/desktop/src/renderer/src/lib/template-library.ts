const TEMPLATE_LIBRARY_KEY = 'open-codesign.template-library.v1';

type TemplateMap = Record<string, true>;

function readTemplateMap(): TemplateMap {
  try {
    const raw = window.localStorage.getItem(TEMPLATE_LIBRARY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => typeof key === 'string' && value === true,
      ),
    );
  } catch {
    return {};
  }
}

function writeTemplateMap(map: TemplateMap): void {
  try {
    if (Object.keys(map).length === 0) {
      window.localStorage.removeItem(TEMPLATE_LIBRARY_KEY);
      return;
    }
    window.localStorage.setItem(TEMPLATE_LIBRARY_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage failures.
  }
}

export function readTemplateDesignIds(): string[] {
  return Object.keys(readTemplateMap());
}

export function isTemplateDesign(designId: string): boolean {
  return readTemplateMap()[designId] === true;
}

export function writeTemplateDesignFlag(designId: string, isTemplate: boolean): void {
  const map = readTemplateMap();
  if (isTemplate) {
    map[designId] = true;
  } else {
    delete map[designId];
  }
  writeTemplateMap(map);
}
