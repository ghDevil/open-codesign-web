import {
  findArtifactSourceReference,
  resolveArtifactSourceReferencePath,
} from '@open-codesign/runtime';

export interface WorkspacePreviewReadResult {
  content: string;
  path: string;
}

export type WorkspacePreviewRead = (
  designId: string,
  path: string,
) => Promise<WorkspacePreviewReadResult>;

export function resolveReferencedWorkspacePreviewPath(source: string, path: string): string | null {
  const lower = path.toLowerCase();
  if (!lower.endsWith('.html') && !lower.endsWith('.htm')) return null;
  const reference = findArtifactSourceReference(source);
  return reference === null ? null : resolveArtifactSourceReferencePath(path, reference);
}

export async function readWorkspacePreviewSource(input: {
  designId: string;
  path: string;
  read: WorkspacePreviewRead;
}): Promise<WorkspacePreviewReadResult> {
  const result = await input.read(input.designId, input.path);
  return resolveWorkspacePreviewSource({
    designId: input.designId,
    source: result.content,
    path: result.path,
    read: input.read,
  });
}

export async function resolveWorkspacePreviewSource(input: {
  designId: string;
  source: string;
  path?: string | undefined;
  read?: WorkspacePreviewRead | undefined;
}): Promise<WorkspacePreviewReadResult> {
  const path = input.path ?? 'index.html';
  if (!input.read) return { content: input.source, path };
  const referencedPath = resolveReferencedWorkspacePreviewPath(input.source, path);
  if (referencedPath === null) return { content: input.source, path };
  const referenced = await input.read(input.designId, referencedPath);
  return { content: referenced.content, path: referenced.path };
}
