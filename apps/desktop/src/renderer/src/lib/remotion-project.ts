import { parse } from '@babel/parser';
import {
  buildRemotionProjectFilesFromCode,
  extractAnimationCodeFromHtml,
  extractRegisteredCompositions,
  OPEN_CODESIGN_ANIMATION_CODE_SCRIPT_ID,
  type AnimationProjectFile,
  type RegisteredAnimationComposition,
} from '@open-codesign/shared';

interface LocalImportSpecifier {
  kind: 'default' | 'named' | 'namespace';
  localName: string;
  importedName?: string;
}

interface LocalImportBinding {
  filePath: string;
  specifiers: LocalImportSpecifier[];
}

interface ModuleAnalysis {
  localImports: LocalImportBinding[];
  namedExports: Map<string, string>;
  defaultExportLocalName: string | null;
}

function normalizeProjectFilePath(raw: string): string {
  return raw.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
}

function dirnamePosix(filePath: string): string {
  const normalized = normalizeProjectFilePath(filePath);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

function resolveRelativeImport(
  fromPath: string,
  source: string,
  fileMap: Map<string, AnimationProjectFile>,
): string | null {
  const parts = dirnamePosix(fromPath).split('/').filter(Boolean);
  for (const segment of source.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  const candidate = parts.join('/');
  const possibilities = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.js`,
    `${candidate}.jsx`,
    `${candidate}/index.ts`,
    `${candidate}/index.tsx`,
    `${candidate}/index.js`,
    `${candidate}/index.jsx`,
  ].map(normalizeProjectFilePath);
  for (const possibility of possibilities) {
    if (fileMap.has(possibility)) return possibility;
  }
  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function analyzeModule(filePath: string, code: string, fileMap: Map<string, AnimationProjectFile>): ModuleAnalysis {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: true,
  });
  const body = (toRecord(ast.program)?.['body'] as unknown[]) ?? [];
  const localImports: LocalImportBinding[] = [];
  const namedExports = new Map<string, string>();
  let defaultExportLocalName: string | null = null;

  for (const statement of body) {
    const record = toRecord(statement);
    if (!record || typeof record['type'] !== 'string') continue;

    if (record['type'] === 'ImportDeclaration') {
      const sourceRecord = toRecord(record['source']);
      const source =
        sourceRecord?.['type'] === 'StringLiteral' && typeof sourceRecord['value'] === 'string'
          ? sourceRecord['value']
          : null;
      if (!source || (!source.startsWith('./') && !source.startsWith('../'))) continue;
      const resolvedPath = resolveRelativeImport(filePath, source, fileMap);
      if (!resolvedPath) continue;
      const specifiers = ((record['specifiers'] as unknown[]) ?? [])
        .map((specifier): LocalImportSpecifier | null => {
          const spec = toRecord(specifier);
          const local = toRecord(spec?.['local']);
          if (local?.['type'] !== 'Identifier' || typeof local['name'] !== 'string') return null;
          if (spec?.['type'] === 'ImportDefaultSpecifier') {
            return { kind: 'default', localName: local['name'] };
          }
          if (spec?.['type'] === 'ImportNamespaceSpecifier') {
            return { kind: 'namespace', localName: local['name'] };
          }
          const imported = toRecord(spec?.['imported']);
          if (spec?.['type'] === 'ImportSpecifier' && imported?.['type'] === 'Identifier') {
            const importedName =
              typeof imported['name'] === 'string' ? (imported['name'] as string) : null;
            if (!importedName) return null;
            return {
              kind: 'named',
              localName: local['name'],
              importedName,
            };
          }
          return null;
        })
        .filter((item): item is LocalImportSpecifier => item !== null);
      localImports.push({ filePath: resolvedPath, specifiers });
      continue;
    }

    if (record['type'] === 'ExportNamedDeclaration') {
      const declaration = toRecord(record['declaration']);
      if (declaration?.['type'] === 'FunctionDeclaration' || declaration?.['type'] === 'ClassDeclaration') {
        const id = toRecord(declaration['id']);
        if (id?.['type'] === 'Identifier' && typeof id['name'] === 'string') {
          namedExports.set(id['name'], id['name']);
        }
      }
      if (declaration?.['type'] === 'VariableDeclaration') {
        for (const decl of ((declaration['declarations'] as unknown[]) ?? [])) {
          const declarator = toRecord(decl);
          const id = toRecord(declarator?.['id']);
          if (id?.['type'] === 'Identifier' && typeof id['name'] === 'string') {
            namedExports.set(id['name'], id['name']);
          }
        }
      }
      for (const specifier of ((record['specifiers'] as unknown[]) ?? [])) {
        const spec = toRecord(specifier);
        const local = toRecord(spec?.['local']);
        const exported = toRecord(spec?.['exported']);
        if (
          spec?.['type'] === 'ExportSpecifier' &&
          local?.['type'] === 'Identifier' &&
          exported?.['type'] === 'Identifier' &&
          typeof local['name'] === 'string' &&
          typeof exported['name'] === 'string'
        ) {
          namedExports.set(exported['name'], local['name']);
        }
      }
      continue;
    }

    if (record['type'] === 'ExportDefaultDeclaration') {
      const declaration = toRecord(record['declaration']);
      if (
        declaration?.['type'] === 'FunctionDeclaration' ||
        declaration?.['type'] === 'ClassDeclaration'
      ) {
        const id = toRecord(declaration['id']);
        if (id?.['type'] === 'Identifier' && typeof id['name'] === 'string') {
          defaultExportLocalName = id['name'];
        }
      }
      if (declaration?.['type'] === 'Identifier' && typeof declaration['name'] === 'string') {
        defaultExportLocalName = declaration['name'] as string;
      }
    }
  }

  return { localImports, namedExports, defaultExportLocalName };
}

function stripModuleExports(code: string): string {
  return code
    .replace(/^['"]use client['"]\s*;?\s*$/gm, '')
    .replace(/export\s+default\s+function/g, 'function')
    .replace(/export\s+default\s+class/g, 'class')
    .replace(/export\s+function/g, 'function')
    .replace(/export\s+class/g, 'class')
    .replace(/export\s+(const|let|var)\s+/g, '$1 ')
    .replace(/^\s*export\s*\{[\s\S]*?\}\s*;?\s*$/gm, '')
    .replace(/^\s*export\s+default\s+[A-Za-z_$][\w$]*\s*;?\s*$/gm, '')
    .trim();
}

function buildAliasPrelude(
  analysis: ModuleAnalysis,
  moduleAnalyses: Map<string, ModuleAnalysis>,
): string[] {
  const lines: string[] = [];
  for (const localImport of analysis.localImports) {
    const dependency = moduleAnalyses.get(localImport.filePath);
    if (!dependency) continue;
    for (const specifier of localImport.specifiers) {
      if (specifier.kind === 'default') {
        const target = dependency.defaultExportLocalName;
        if (target && target !== specifier.localName) {
          lines.push(`const ${specifier.localName} = ${target};`);
        }
        continue;
      }
      if (specifier.kind === 'namespace') {
        const pairs = [...dependency.namedExports.entries()].map(
          ([exportedName, localName]) =>
            exportedName === localName ? exportedName : `${exportedName}: ${localName}`,
        );
        if (dependency.defaultExportLocalName) {
          pairs.push(`default: ${dependency.defaultExportLocalName}`);
        }
        lines.push(`const ${specifier.localName} = { ${pairs.join(', ')} };`);
        continue;
      }
      const importedName = specifier.importedName ?? specifier.localName;
      const target = dependency.namedExports.get(importedName);
      if (target && target !== specifier.localName) {
        lines.push(`const ${specifier.localName} = ${target};`);
      }
    }
  }
  return lines;
}

export function assembleCompositionSource(
  files: AnimationProjectFile[],
  composition: RegisteredAnimationComposition,
): string | null {
  if (!composition.filePath) return null;
  const fileMap = new Map(
    files.map((file) => [normalizeProjectFilePath(file.path), { ...file, path: normalizeProjectFilePath(file.path) }]),
  );
  if (!fileMap.has(composition.filePath)) return null;

  const orderedPaths: string[] = [];
  const analyses = new Map<string, ModuleAnalysis>();
  const visited = new Set<string>();

  const visit = (filePath: string) => {
    if (visited.has(filePath)) return;
    visited.add(filePath);
    const file = fileMap.get(filePath);
    if (!file) return;
    const analysis = analyzeModule(filePath, file.content, fileMap);
    analyses.set(filePath, analysis);
    for (const localImport of analysis.localImports) {
      visit(localImport.filePath);
    }
    orderedPaths.push(filePath);
  };

  visit(composition.filePath);
  const selectedAnalysis = analyses.get(composition.filePath);
  if (!selectedAnalysis) return null;

  const selectedExportName =
    selectedAnalysis.namedExports.get(composition.componentName) ??
    selectedAnalysis.defaultExportLocalName ??
    composition.componentName;

  const chunks: string[] = [];
  for (const filePath of orderedPaths) {
    const file = fileMap.get(filePath);
    const analysis = analyses.get(filePath);
    if (!file || !analysis) continue;
    const aliasPrelude = buildAliasPrelude(analysis, analyses);
    chunks.push(`// ${filePath}`);
    if (aliasPrelude.length > 0) {
      chunks.push(aliasPrelude.join('\n'));
    }
    chunks.push(stripModuleExports(file.content));
  }
  chunks.push(
    `export const __OpenCodesignSelectedComposition = (props) => <${selectedExportName} {...props} />;`,
  );
  return chunks.join('\n\n');
}

export function buildAnimationProjectFilesFromHtml(html: string, fallbackCode: string): AnimationProjectFile[] {
  const code = extractAnimationCodeFromHtml(html) ?? fallbackCode;
  return buildRemotionProjectFilesFromCode(code);
}

export function buildAnimationProjectPlaceholderHtml(code: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <title>Remotion Project</title>',
    '  </head>',
    '  <body>',
    `    <script id="${OPEN_CODESIGN_ANIMATION_CODE_SCRIPT_ID}" type="text/plain">`,
    code,
    '    </script>',
    '  </body>',
    '</html>',
  ].join('\n');
}

export function listProjectEditorFiles(
  files: AnimationProjectFile[],
  selectedComposition: RegisteredAnimationComposition | null,
): string[] {
  const normalized = files.map((file) => normalizeProjectFilePath(file.path));
  const ordered = ['src/index.ts', 'src/Root.tsx'];
  if (selectedComposition?.filePath) ordered.push(selectedComposition.filePath);
  const extras = normalized
    .filter((path) => path.startsWith('src/') && !ordered.includes(path))
    .sort((a, b) => a.localeCompare(b));
  return [...ordered.filter((path) => normalized.includes(path)), ...extras];
}

export function extractProjectCompositions(files: AnimationProjectFile[]): RegisteredAnimationComposition[] {
  return extractRegisteredCompositions(files);
}
