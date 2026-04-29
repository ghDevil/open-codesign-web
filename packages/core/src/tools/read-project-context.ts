import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import type {
  AttachmentContext,
  ProjectInstructionsContext,
  ReferenceUrlContext,
  WorkspaceContext,
} from '../index.js';

const ReadProjectContextParams = Type.Object({
  section: Type.Optional(
    Type.Union([
      Type.Literal('overview'),
      Type.Literal('project_instructions'),
      Type.Literal('workspace'),
      Type.Literal('attachments'),
      Type.Literal('reference'),
    ]),
  ),
  path: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
});

export interface ReadProjectContextDetails {
  availableSections: string[];
  section: 'overview' | 'project_instructions' | 'workspace' | 'attachments' | 'reference';
}

interface ProjectContextInput {
  projectInstructions?: ProjectInstructionsContext | null | undefined;
  workspaceContext?: WorkspaceContext | null | undefined;
  attachments?: AttachmentContext[] | undefined;
  referenceUrl?: ReferenceUrlContext | null | undefined;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function availableSections(input: ProjectContextInput): string[] {
  const sections: string[] = [];
  if (input.projectInstructions?.instructions?.trim()) sections.push('project_instructions');
  if (input.workspaceContext) sections.push('workspace');
  if ((input.attachments ?? []).length > 0) sections.push('attachments');
  if (input.referenceUrl) sections.push('reference');
  if (sections.length > 1) sections.unshift('overview');
  return sections;
}

function ok(text: string, details: ReadProjectContextDetails): AgentToolResult<ReadProjectContextDetails> {
  return {
    content: [{ type: 'text', text }],
    details,
  };
}

export function makeReadProjectContextTool(
  getContext: () => ProjectContextInput,
): AgentTool<typeof ReadProjectContextParams, ReadProjectContextDetails> {
  return {
    name: 'read_project_context',
    label: 'Read project context',
    description:
      'Return the linked project brief, sampled workspace context, attached local references, or extracted reference URL notes on demand. Call this when the compact prompt summary is not enough.',
    parameters: ReadProjectContextParams,
    async execute(_toolCallId, params): Promise<AgentToolResult<ReadProjectContextDetails>> {
      const input = getContext();
      const sections = availableSections(input);
      const section = params.section ?? (sections.includes('overview') ? 'overview' : (sections[0] ?? 'overview'));

      if (sections.length === 0) {
        return ok('No additional project context is linked for this run.', {
          availableSections: [],
          section: 'overview',
        });
      }

      switch (section) {
        case 'project_instructions': {
          const instructions = input.projectInstructions?.instructions?.trim();
          if (!instructions) {
            return ok('No project instructions are linked for this run.', {
              availableSections: sections,
              section,
            });
          }
          return ok(`# Project instructions\n${truncate(instructions, 4_000)}`, {
            availableSections: sections,
            section,
          });
        }
        case 'workspace': {
          const workspace = input.workspaceContext;
          if (!workspace) {
            return ok('No workspace context is linked for this run.', {
              availableSections: sections,
              section,
            });
          }
          if (params.path) {
            const file = workspace.files.find((entry) => entry.path === params.path);
            if (!file) {
              return ok(
                `No sampled workspace file matched "${params.path}". Available files:\n${workspace.files.map((entry) => `- ${entry.path}`).join('\n')}`,
                {
                  availableSections: sections,
                  section,
                },
              );
            }
            const lines = [`# Workspace file`, `Path: ${file.path}`];
            if (file.note) lines.push(`Note: ${file.note}`);
            lines.push('', truncate(file.excerpt, 2_500));
            return ok(lines.join('\n'), {
              availableSections: sections,
              section,
            });
          }
          return ok(
            [
              '# Workspace context',
              `Root path: ${workspace.rootPath}`,
              `Summary: ${workspace.summary}`,
              '',
              'Sampled files:',
              ...workspace.files.map((file) => `- ${file.path}`),
              '',
              'Call again with section="workspace" and path="..." to inspect one sampled file excerpt.',
            ].join('\n'),
            {
              availableSections: sections,
              section,
            },
          );
        }
        case 'attachments': {
          const attachments = input.attachments ?? [];
          if (attachments.length === 0) {
            return ok('No local attachments are linked for this run.', {
              availableSections: sections,
              section,
            });
          }
          if (params.name) {
            const attachment = attachments.find((entry) => entry.name === params.name);
            if (!attachment) {
              return ok(
                `No attachment matched "${params.name}". Available attachments:\n${attachments.map((entry) => `- ${entry.name}`).join('\n')}`,
                {
                  availableSections: sections,
                  section,
                },
              );
            }
            const lines = [`# Attachment`, `Name: ${attachment.name}`, `Path: ${attachment.path}`];
            if (attachment.mediaType) lines.push(`Media type: ${attachment.mediaType}`);
            if (attachment.note) lines.push(`Note: ${attachment.note}`);
            if (attachment.excerpt) lines.push('', truncate(attachment.excerpt, 2_500));
            if (!attachment.excerpt && attachment.imageDataUrl) {
              lines.push('', 'This attachment is available to the model as an image input.');
            }
            return ok(lines.join('\n'), {
              availableSections: sections,
              section,
            });
          }
          return ok(
            [
              '# Local attachments',
              ...attachments.map((attachment) => {
                const parts = [`- ${attachment.name}`];
                if (attachment.mediaType) parts.push(`(${attachment.mediaType})`);
                else if (attachment.excerpt) parts.push('(text excerpt available)');
                if (attachment.note) parts.push(`- ${attachment.note}`);
                return parts.join(' ');
              }),
              '',
              'Call again with section="attachments" and name="..." to inspect one attachment in detail.',
            ].join('\n'),
            {
              availableSections: sections,
              section,
            },
          );
        }
        case 'reference': {
          const reference = input.referenceUrl;
          if (!reference) {
            return ok('No reference URL is linked for this run.', {
              availableSections: sections,
              section,
            });
          }
          const lines = ['# Reference URL', `URL: ${reference.url}`];
          if (reference.title) lines.push(`Title: ${reference.title}`);
          if (reference.description) lines.push(`Description: ${reference.description}`);
          if (reference.excerpt) lines.push('', truncate(reference.excerpt, 2_500));
          return ok(lines.join('\n'), {
            availableSections: sections,
            section,
          });
        }
        case 'overview':
        default: {
          const lines = ['# Project context overview'];
          if (input.projectInstructions?.instructions?.trim()) {
            lines.push('- Project instructions linked');
          }
          if (input.workspaceContext) {
            lines.push(
              `- Workspace context: ${input.workspaceContext.summary} (${input.workspaceContext.files.length} sampled files)`,
            );
          }
          if ((input.attachments ?? []).length > 0) {
            lines.push(`- Attachments: ${(input.attachments ?? []).map((entry) => entry.name).join(', ')}`);
          }
          if (input.referenceUrl) {
            lines.push(`- Reference URL: ${input.referenceUrl.title ?? input.referenceUrl.url}`);
          }
          lines.push('', `Available sections: ${sections.join(', ')}`);
          lines.push('Call this tool again with section="workspace", "attachments", "reference", or "project_instructions" when you need detail.');
          return ok(lines.join('\n'), {
            availableSections: sections,
            section: 'overview',
          });
        }
      }
    },
  };
}