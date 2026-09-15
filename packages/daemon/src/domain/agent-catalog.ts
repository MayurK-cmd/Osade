import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * The agent catalog — OSADE.md §8.1.
 *
 * INVARIANT: capabilities, not identity checks. Branch on
 * `entry.capabilities.includes('plan-mode')`, never on `id === 'claude'`.
 *
 * `binary` is **advisory**. the substrate resolves the executable itself from `kind`
 * (`backend/src/detect/mod.rs:149-181`), so this field exists only to probe whether the agent
 * is installed and to produce a useful error. It is never sent to the substrate.
 */

export type AgentCapability =
  | 'plan-mode'
  | 'resume'
  | 'system-prompt-injection'
  | 'hook-reporting'
  | 'structured-review-output'
  | 'headless-run';

export interface AgentCatalogEntry {
  /** The `kind` substrate accepts on `agent.start`, verbatim from the pinned set. */
  readonly id: string;
  /** Advisory: what to probe on PATH. substrate picks the real executable. */
  readonly binary: string;
  readonly autonomousArgs: readonly string[];
  readonly planArgs: readonly string[];
  readonly resumeArgs: readonly string[];
  /** How conventions get injected (§13.5). Null when the agent has no flag for it. */
  readonly systemPromptFlag: string | null;
  readonly capabilities: readonly AgentCapability[];
}

/**
 * `hook-reporting` is set only where the substrate's bundled asset actually calls `pane.report_agent`
 * (§7.1). For claude and codex the hook posts a session id and nothing else, so their status
 * comes entirely from the substrate's screen-detection manifests — which carries the full lifecycle
 * correctly, verified live. What they lose is `tool_name` and `final_message`, not status.
 */
export const AGENT_CATALOG: readonly AgentCatalogEntry[] = [
  {
    id: 'claude',
    binary: 'claude',
    autonomousArgs: ['--permission-mode', 'acceptEdits'],
    planArgs: ['--permission-mode', 'plan'],
    resumeArgs: ['--continue'],
    systemPromptFlag: '--append-system-prompt',
    capabilities: ['plan-mode', 'resume', 'system-prompt-injection', 'headless-run'],
  },
  {
    id: 'codex',
    binary: 'codex',
    autonomousArgs: [],
    planArgs: [],
    resumeArgs: ['resume', '--last'],
    systemPromptFlag: null,
    capabilities: ['resume', 'headless-run'],
  },
  {
    id: 'opencode',
    binary: 'opencode',
    autonomousArgs: [],
    planArgs: [],
    resumeArgs: [],
    systemPromptFlag: null,
    capabilities: ['hook-reporting'],
  },
  {
    id: 'pi',
    binary: 'pi',
    autonomousArgs: [],
    planArgs: [],
    resumeArgs: [],
    systemPromptFlag: null,
    capabilities: ['hook-reporting'],
  },
];

export function agentEntry(id: string): AgentCatalogEntry | null {
  return AGENT_CATALOG.find((e) => e.id === id) ?? null;
}

export function hasCapability(entry: AgentCatalogEntry, capability: AgentCapability): boolean {
  return entry.capabilities.includes(capability);
}

export const DAEMON_DEFAULT_AGENT = 'claude';

const DISPLAY_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  pi: 'Pi',
};

export function agentDisplayName(id: string): string {
  return DISPLAY_NAMES[id] ?? id;
}

export class UnknownAgentError extends Error {
  readonly agentId: string;
  constructor(agentId: string) {
    super(`unknown agent ${agentId}`);
    this.name = 'UnknownAgentError';
    this.agentId = agentId;
  }
}

export function requireAgent(id: string): AgentCatalogEntry {
  const entry = agentEntry(id);
  if (!entry) throw new UnknownAgentError(id);
  return entry;
}

/**
 * Direct PATH lookup — OSADE.md §8.1. Never `which`/`where` and never a login shell.
 */
export function binaryOnPath(
  binary: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (binary.includes('/') || binary.includes('\\')) return existsSync(binary);
  const pathVar = env.PATH ?? env.Path ?? '';
  const dirs = pathVar.split(delimiter).filter(Boolean);
  const extensions =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];
  for (const dir of dirs) {
    if (existsSync(join(dir, binary))) return true;
    for (const ext of extensions) {
      const suffix = ext.startsWith('.') ? ext : `.${ext}`;
      if (existsSync(join(dir, binary + suffix))) return true;
      if (existsSync(join(dir, binary + suffix.toLowerCase()))) return true;
    }
  }
  return false;
}
