/**
 * Unit tests for agent mention validation — §OSADE Prompt 2 (agent availability).
 *
 * These tests exercise the pure functions in mentions.ts that check agent availability
 * BEFORE any task is created. They use no external dependencies.
 */
import { describe, expect, it } from 'vitest';

import {
  parseMentions,
  validateMentionedAgents,
  unavailableAgentMessage,
  lanePrompt,
  laneTarget,
} from '../src/renderer/mentions.js';

/** Minimal catalog shape matching the daemon's agentCatalogList response. */
function catalog(
  overrides: Partial<Record<string, boolean>> = {},
): { id: string; displayName: string; installed: boolean }[] {
  const defaults: Record<string, boolean> = {
    claude: true,
    codex: true,
    opencode: true,
    pi: true,
  };
  return Object.entries({ ...defaults, ...overrides }).map(([id, installed]) => ({
    id,
    displayName: id.charAt(0).toUpperCase() + id.slice(1),
    installed,
  }));
}

const IDS = ['claude', 'codex', 'opencode', 'pi'];

// ── §1: parseMentions correctness (existing behavior preserved) ──────────────

describe('parseMentions — preserves existing behavior', () => {
  it('bare text with no @-sign is shared, no targets', () => {
    const result = parseMentions('fix the login flow', IDS);
    expect(result.shared).toBe('fix the login flow');
    expect(result.targets).toHaveLength(0);
  });

  it('single known mention routes to one target', () => {
    const result = parseMentions('@claude implement X', IDS);
    expect(result.targets).toEqual([{ agentId: 'claude', text: 'implement X' }]);
    expect(result.shared).toBe('');
  });

  it('two known mentions on the same message', () => {
    const result = parseMentions('@claude do X @codex do Y', IDS);
    expect(result.targets).toHaveLength(2);
    expect(result.targets[0]).toEqual({ agentId: 'claude', text: 'do X' });
    expect(result.targets[1]).toEqual({ agentId: 'codex', text: 'do Y' });
    expect(result.shared).toBe('');
  });

  it('unknown @name is left in shared text, not a target', () => {
    const result = parseMentions('@ghost do something', IDS);
    expect(result.shared).toBe('@ghost do something');
    expect(result.targets).toHaveLength(0);
  });

  it('normal text containing @ symbol is not a mention', () => {
    const result = parseMentions('reply to user@example.com', IDS);
    expect(result.targets).toHaveLength(0);
    expect(result.shared).toBe('reply to user@example.com');
  });

  it('follow-up to existing lane (no mention) sends to shared', () => {
    const result = parseMentions('continue', IDS);
    expect(result.shared).toBe('continue');
    expect(result.targets).toHaveLength(0);
  });
});

// ── §2: validateMentionedAgents — availability check before task creation ───

describe('validateMentionedAgents', () => {
  it('passes when all mentioned agents are installed', () => {
    const parsed = parseMentions('@claude do X @codex do Y', IDS);
    const result = validateMentionedAgents(parsed, catalog());
    expect(result.ok).toBe(true);
    expect(result.unavailable).toHaveLength(0);
  });

  it('fails when the only mentioned agent is not installed', () => {
    const parsed = parseMentions('@codex fix this', IDS);
    const result = validateMentionedAgents(parsed, catalog({ codex: false }));
    expect(result.ok).toBe(false);
    expect(result.unavailable).toEqual([{ agentId: 'codex' }]);
  });

  it('partial failure: claude available, codex not — only codex is unavailable', () => {
    const parsed = parseMentions('@claude fix this @codex review this', IDS);
    const result = validateMentionedAgents(parsed, catalog({ codex: false }));
    expect(result.ok).toBe(false);
    expect(result.unavailable.map((u) => u.agentId)).toEqual(['codex']);
  });

  it('passes vacuously when there are no mentions (bare text)', () => {
    const parsed = parseMentions('refactor the auth module', IDS);
    // Even if both agents unavailable, no mentions means no block
    const result = validateMentionedAgents(parsed, catalog({ claude: false, codex: false }));
    expect(result.ok).toBe(true);
    expect(result.unavailable).toHaveLength(0);
  });

  it('unknown @name — parseMentions leaves it in shared, validate sees zero targets', () => {
    const parsed = parseMentions('@ghost do a thing', IDS);
    expect(parsed.targets).toHaveLength(0);
    const result = validateMentionedAgents(parsed, catalog());
    expect(result.ok).toBe(true);
  });

  it('passes when all four agents in a message are installed', () => {
    const parsed = parseMentions('@claude a @codex b @opencode c @pi d', IDS);
    expect(parsed.targets).toHaveLength(4);
    const result = validateMentionedAgents(parsed, catalog());
    expect(result.ok).toBe(true);
  });

  it('catches multiple unavailable agents in one message', () => {
    const parsed = parseMentions('@claude a @codex b @opencode c', IDS);
    const result = validateMentionedAgents(
      parsed,
      catalog({ codex: false, opencode: false }),
    );
    expect(result.ok).toBe(false);
    expect(result.unavailable.map((u) => u.agentId)).toEqual(['codex', 'opencode']);
  });

  it('installed agent that also appears in mention is not in unavailable list', () => {
    const parsed = parseMentions('@claude implement X', IDS);
    const result = validateMentionedAgents(parsed, catalog({ claude: true }));
    expect(result.ok).toBe(true);
    expect(result.unavailable).toHaveLength(0);
  });
});

// ── §3: unavailableAgentMessage — user-facing error text ────────────────────

describe('unavailableAgentMessage', () => {
  it('returns empty string for empty list', () => {
    expect(unavailableAgentMessage([])).toBe('');
  });

  it('names a single unavailable agent with PATH hint', () => {
    const msg = unavailableAgentMessage([{ agentId: 'codex' }]);
    expect(msg).toContain('@codex');
    expect(msg).toContain('not installed');
    expect(msg).toContain('PATH');
  });

  it('names multiple unavailable agents in one message', () => {
    const msg = unavailableAgentMessage([{ agentId: 'codex' }, { agentId: 'opencode' }]);
    expect(msg).toContain('@codex');
    expect(msg).toContain('@opencode');
    expect(msg).toContain('not installed');
  });

  it('uses singular "is" for one agent', () => {
    const msg = unavailableAgentMessage([{ agentId: 'codex' }]);
    expect(msg).toMatch(/\bis\b/);
  });

  it('uses plural "are" for multiple agents', () => {
    const msg = unavailableAgentMessage([{ agentId: 'codex' }, { agentId: 'opencode' }]);
    expect(msg).toMatch(/\bare\b/);
  });
});

// ── §4: lanePrompt — prompt construction ────────────────────────────────────

describe('lanePrompt', () => {
  it('@claude with body produces only the body text', () => {
    const parsed = parseMentions('@claude implement X', IDS);
    expect(lanePrompt(parsed, parsed.targets[0]!, '@claude implement X')).toBe('implement X');
  });

  it('shared prefix is prepended to per-agent text', () => {
    const parsed = parseMentions('look at auth\n@claude fix the token flow', IDS);
    expect(parsed.shared).toBe('look at auth');
    expect(lanePrompt(parsed, parsed.targets[0]!, '')).toBe(
      'look at auth\n\nfix the token flow',
    );
  });

  it('two-agent message produces independent prompts per lane', () => {
    const parsed = parseMentions('@claude implement X\n@codex write tests', IDS);
    const claudePrompt = lanePrompt(parsed, parsed.targets[0]!, '');
    const codexPrompt = lanePrompt(parsed, parsed.targets[1]!, '');
    expect(claudePrompt).toBe('implement X');
    expect(codexPrompt).toBe('write tests');
  });
});

// ── §5: laneTarget — routing to existing lanes ───────────────────────────────

describe('laneTarget', () => {
  it('returns null when no lanes exist', () => {
    expect(laneTarget([], 'claude')).toBeNull();
  });

  it('returns the matching lane by agentId', () => {
    const lane = { agentId: 'claude', task: { id: 't1' } };
    expect(laneTarget([lane], 'claude')).toBe(lane);
  });

  it('returns null when agentId does not match', () => {
    const lane = { agentId: 'claude', task: { id: 't1' } };
    expect(laneTarget([lane], 'codex')).toBeNull();
  });

  it('finds the correct lane in a two-lane chat (§4 agent follow-up)', () => {
    const claude = { agentId: 'claude', task: { id: 't1' } };
    const codex = { agentId: 'codex', task: { id: 't2' } };
    // @claude continue → must go to Claude's lane
    expect(laneTarget([claude, codex], 'claude')).toBe(claude);
    // @codex review this → must go to Codex's lane
    expect(laneTarget([claude, codex], 'codex')).toBe(codex);
  });

  it('no lane data is mixed between agents', () => {
    const claude = { agentId: 'claude', task: { id: 't1' } };
    const codex = { agentId: 'codex', task: { id: 't2' } };
    const found = laneTarget([claude, codex], 'codex');
    expect(found?.task.id).toBe('t2');
    expect(found?.task.id).not.toBe('t1');
  });
});
