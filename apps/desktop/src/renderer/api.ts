/**
 * The renderer's tRPC calls.
 *
 * OSADE.md §18.1 — INVARIANT: the renderer is never the source of truth. Everything here is a
 * *mutation* or an on-demand read; live state arrives on the websocket (`useLedger`), and the
 * renderer never computes status.
 */

import type { ConventionImpact, ConventionView, MineStatus } from '@osade/contract';

let cachedBase: string | null = null;

async function base(): Promise<string> {
  if (cachedBase) return cachedBase;
  const port = await window.osade?.daemonPort();
  if (port == null) throw new Error('the osade daemon is not running');
  // §2.1 — loopback only.
  cachedBase = `http://127.0.0.1:${port}`;
  return cachedBase;
}

async function call(kind: 'query' | 'mutation', path: string, input?: unknown): Promise<unknown> {
  const root = await base();
  const url =
    kind === 'query'
      ? `${root}/${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`
      : `${root}/${path}`;

  const response = await fetch(url, {
    method: kind === 'query' ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(kind === 'mutation' ? { body: JSON.stringify(input ?? {}) } : {}),
  });

  const body = (await response.json()) as {
    result?: { data?: unknown };
    error?: { message?: string; json?: { message?: string } };
  };
  if (body.error) throw new Error(body.error.json?.message ?? body.error.message ?? 'daemon error');
  return body.result?.data;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
}

/** §12 — a triage task terminates in an artifact rather than a pull request. */
export type TriageKind =
  | 'reproduce'
  | 'bisect'
  | 'failing-test'
  | 'duplicate-check'
  | 'verify-pr-claim';

export interface PlanStep {
  name: string;
  cmd: string;
  cwd: string;
  timeoutSec: number;
  required: boolean;
  source: 'ci' | 'manifest' | 'doc' | 'user';
  evidence: string;
}

export const api = {
  /** §8.2 — creating a task prepares a worktree. It does not start an agent. */
  taskCreate: (input: { repoPath: string; title: string; intent: string }) =>
    call('mutation', 'taskCreate', input) as Promise<{ taskId: string }>,

  /** §8.2 — the launch sequence. Long-running: worktree, lane, agent start. */
  taskLaunch: (taskId: string) =>
    call('mutation', 'taskLaunch', { taskId }) as Promise<{
      taskId: string;
      paneId: string;
      workspaceId: string;
    }>,

  mineStatus: (repoId: string) =>
    call('query', 'mineStatus', { repoId }) as Promise<MineStatus>,

  /** Starts a background run and returns at once; poll `mineStatus` for progress. */
  mineRepo: (repoId: string, full?: boolean) =>
    call('mutation', 'mineRepo', { repoId, full }) as Promise<{ runId: string }>,

  conventionList: (repoId: string) =>
    call('query', 'conventionList', { repoId }) as Promise<ConventionView[]>,

  conventionConfirm: (id: string) =>
    call('mutation', 'conventionConfirm', { id }) as Promise<{ confirmed: boolean }>,

  conventionReject: (id: string, reason: string) =>
    call('mutation', 'conventionReject', { id, reason }) as Promise<{ ok: true }>,

  conventionImpact: (repoId: string) =>
    call('query', 'conventionImpact', { repoId }) as Promise<ConventionImpact>,

  gateDecide: (gateId: string, decision: 'approve' | 'deny') =>
    call('mutation', 'gateDecide', { gateId, decision }) as Promise<{ ok: true }>,

  gateEditAndApprove: (gateId: string, payload: unknown) =>
    call('mutation', 'gateEditAndApprove', { gateId, payload }) as Promise<{ ok: true }>,

  verifyPlanGet: (taskId: string) =>
    call('query', 'verifyPlanGet', { taskId }) as Promise<{
      steps: PlanStep[];
      needsReview: boolean;
    } | null>,

  verifyPlanDerive: (taskId: string) =>
    call('mutation', 'verifyPlanDerive', { taskId }) as Promise<{
      steps: PlanStep[];
      needsReview: boolean;
    }>,

  verifyPlanConfirm: (taskId: string, steps?: PlanStep[]) =>
    call('mutation', 'verifyPlanConfirm', { taskId, steps }) as Promise<{ ok: true }>,

  verifyRun: (taskId: string) =>
    call('mutation', 'verifyRun', { taskId }) as Promise<{ passed: boolean; headSha: string }>,

  issueList: (repoId: string) => call('query', 'issueList', { repoId }) as Promise<Issue[]>,

  issueImport: (repoPath: string, issue: Issue, triage?: TriageKind) =>
    call('mutation', 'issueImport', { repoPath, issue, triage }) as Promise<{ taskId: string }>,

  prPlan: (taskId: string) =>
    call('query', 'prPlan', { taskId }) as Promise<{
      viaFork: boolean;
      head: string;
      target: string;
      base: string;
    }>,

  prOpenRequest: (taskId: string, title: string, body: string, draft?: boolean) =>
    call('mutation', 'prOpenRequest', { taskId, title, body, draft }) as Promise<{
      gateId: string;
    }>,

  scmRefresh: (taskId: string) =>
    call('mutation', 'scmRefresh', { taskId }) as Promise<{ refreshed: boolean }>,

  taskTranscript: (taskId: string, lines = 200) =>
    call('query', 'taskTranscript', { taskId, lines }) as Promise<{
      text: string;
      revision: number;
      truncated: boolean;
    }>,
};
