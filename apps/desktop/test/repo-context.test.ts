import { describe, expect, it } from 'vitest';

import { visibleUserText } from '../src/renderer/chat.js';
import type { TaskView } from '@osade/contract';

import {
  contextReposForChat,
  formatReadOnlyContextBlock,
  stripContextBlock,
  withReadOnlyContext,
} from '../src/renderer/repo-context.js';

describe('formatReadOnlyContextBlock', () => {
  it('lists context paths and marks the primary worktree as the only editable tree', () => {
    const block = formatReadOnlyContextBlock({
      primaryWorktree: '/wt/main',
      contextRepos: [{ path: '/repos/docs', name: 'docs' }],
    });
    expect(block).toContain('<osade_context>');
    expect(block).toContain('/repos/docs');
    expect(block).toContain('primary worktree: /wt/main');
    expect(block).toMatch(/read-only/i);
  });

  it('is empty when there are no context repos', () => {
    expect(formatReadOnlyContextBlock({ primaryWorktree: '/wt', contextRepos: [] })).toBe('');
  });
});

describe('withReadOnlyContext', () => {
  it('prepends the block before the user message', () => {
    const block = formatReadOnlyContextBlock({
      primaryWorktree: '/wt',
      contextRepos: [{ path: '/other', name: 'other' }],
    });
    const combined = withReadOnlyContext('fix the bug', block);
    expect(combined.startsWith('<osade_context>')).toBe(true);
    expect(combined.endsWith('fix the bug')).toBe(true);
  });
});

describe('contextReposForChat', () => {
  it('reconstructs attached repos from the chat snapshot', () => {
    const tasks = [
      {
        chatId: 'c1',
        task: { chat_id: 'c1' },
        contextRepos: [
          {
            repoId: 'r-backend',
            path: '/repos/backend',
            name: 'backend',
            remote: 'acme/backend',
            branch: 'main',
            access: 'read',
          },
        ],
      },
      {
        chatId: 'c2',
        task: { chat_id: 'c2' },
        contextRepos: [],
      },
    ] as unknown as TaskView[];
    expect(contextReposForChat(tasks, 'c1')).toEqual([
      { repoId: 'r-backend', path: '/repos/backend', name: 'backend' },
    ]);
    expect(contextReposForChat(tasks, 'c2')).toEqual([]);
    expect(contextReposForChat(tasks, 'missing')).toEqual([]);
  });
});

describe('stripContextBlock', () => {
  it('is removed from visible chat text like lane digests', () => {
    const block = formatReadOnlyContextBlock({
      primaryWorktree: '/wt',
      contextRepos: [{ path: '/ctx', name: 'ctx' }],
    });
    expect(stripContextBlock(`${block}\n\nhello`)).toBe('hello');
    expect(visibleUserText(`${block}\n\nhello`)).toBe('hello');
  });
});
