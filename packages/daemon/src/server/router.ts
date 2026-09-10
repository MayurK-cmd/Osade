import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  ConventionImpact,
  ConventionView,
  MineStatus,
  TaskId,
  TaskStatus,
  TaskView,
  isNeedsYou,
} from '@osade/contract';

import type { Db } from '../db/index.js';
import { getTask, getTaskFacts, listTaskFacts } from '../db/task-repo.js';
import { deriveStatus } from '../domain/derive-status.js';
import type { Gates } from '../domain/gates.js';
import type { LaunchTask } from '../domain/launch-task.js';
import { deriveVerifyPlan, type VerifyStep } from '../domain/verify-plan.js';
import type { Triage, TriageKind } from '../domain/triage.js';
import type { VerifyRunner } from '../domain/verify-run.js';
import type { Knowledge } from '../knowledge/service.js';
import type { ScmPoller } from '../scm/poller.js';
import type { ScmWrites } from '../scm/writes.js';

/**
 * The tRPC router — OSADE.md §5.5.
 *
 * Every procedure declares `.output()` with a contract schema, so the renderer's types are
 * derived rather than hand-written and nothing crosses the boundary untyped.
 */

export interface DaemonContext {
  db: Db;
  launcher: LaunchTask;
  gates: Gates;
  verifier: VerifyRunner;
  triage: Triage;
  scmWrites: ScmWrites;
  poller: ScmPoller;
  /** §13 — absent when no model is configured. Mining is optional; everything else is not. */
  knowledge?: Knowledge | null;
  now: () => number;
}

const t = initTRPC.context<DaemonContext>().create();

function viewFor(ctx: DaemonContext, taskId: string): TaskView | null {
  const facts = getTaskFacts(ctx.db, taskId);
  if (!facts) return null;
  // §6 — derived on every read. Never stored, never accepted from the client.
  const status = deriveStatus(facts, ctx.now());
  return {
    task: facts.task,
    status,
    agent: facts.agent,
    scm: facts.scm,
    openGates: facts.openGates,
    latestVerifyRuns: facts.verifyRuns,
    needsYou: isNeedsYou(status),
  };
}

/**
 * §19.3 — the ledger sorts needs-you first, then live, then everything else. Never by creation
 * time by default: with eight agents running, "who needs me?" is the only question.
 */
const SORT_RANK: Record<TaskStatus, number> = {
  awaiting_approval: 0,
  needs_input: 1,
  review_changes_requested: 2,
  awaiting_review: 3,
  implementing: 4,
  verifying: 5,
  verify_failed: 6,
  ci_failed: 7,
  pr_open: 8,
  queued: 9,
  idle: 10,
  stopped: 11,
  merged: 12,
  archived: 13,
};

export const appRouter = t.router({
  health: t.procedure
    .output(z.object({ ok: z.literal(true), tasks: z.number().int() }))
    .query(({ ctx }) => ({
      ok: true as const,
      tasks: listTaskFacts(ctx.db).length,
    })),

  taskList: t.procedure.output(z.array(TaskView)).query(({ ctx }) => {
    const views = listTaskFacts(ctx.db)
      .map((f) => viewFor(ctx, f.task.id))
      .filter((v): v is TaskView => v != null);

    return views.sort((a, b) => {
      const rank = SORT_RANK[a.status] - SORT_RANK[b.status];
      if (rank !== 0) return rank;
      return b.task.created_at - a.task.created_at;
    });
  }),

  taskGet: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(TaskView.nullable())
    .query(({ ctx, input }) => viewFor(ctx, input.taskId)),

  taskCreate: t.procedure
    .input(
      z.object({
        repoPath: z.string().min(1),
        title: z.string().min(1),
        intent: z.string().min(1),
        agentId: z.string().optional(),
        baseRef: z.string().optional(),
      }),
    )
    .output(z.object({ taskId: TaskId }))
    .mutation(async ({ ctx, input }) => {
      const taskId = await ctx.launcher.createTask(input);
      return { taskId };
    }),

  /** Runs the §8.2 launch sequence. Long-running: worktree, lane, agent start. */
  taskLaunch: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(z.object({ taskId: TaskId, paneId: z.string(), workspaceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.launcher.launch(input.taskId);
      return { taskId: input.taskId, paneId: result.paneId, workspaceId: result.workspaceId };
    }),

  /** Sends a prompt into the task's agent lane. */
  taskSend: t.procedure
    .input(z.object({ taskId: TaskId, text: z.string().min(1), wait: z.boolean().optional() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.launcher.prompt(input.taskId, input.text, input.wait ?? false);
      return { ok: true as const };
    }),

  /** Reads the agent pane transcript — §4.4.1. On demand, never a render loop. */
  taskTranscript: t.procedure
    .input(z.object({ taskId: TaskId, lines: z.number().int().min(1).max(1000).optional() }))
    .output(z.object({ text: z.string(), revision: z.number(), truncated: z.boolean() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.launcher.readTranscript(input.taskId, input.lines ?? 200);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'task has no live pane' });
      return result;
    }),

  taskArchive: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      ctx.db.prepare('UPDATE task SET archived_at = ? WHERE id = ?').run(ctx.now(), input.taskId);
      return { ok: true as const };
    }),

  // ── verification (§10) ───────────────────────────────────────────────────

  /** Derives a plan and stores it. §10.1 — shown to the user before first use. */
  verifyPlanDerive: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(
      z.object({
        steps: z.array(
          z.object({
            name: z.string(),
            cmd: z.string(),
            cwd: z.string(),
            timeoutSec: z.number(),
            required: z.boolean(),
            source: z.enum(['ci', 'manifest', 'doc', 'user']),
            evidence: z.string(),
          }),
        ),
        needsReview: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = getTask(ctx.db, input.taskId);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });
      const repo = ctx.db.prepare('SELECT path FROM repo WHERE id = ?').get(task.repo_id) as {
        path: string;
      };

      const plan = await deriveVerifyPlan(repo.path);
      ctx.db
        .prepare(
          `INSERT INTO verify_plan (repo_id, steps_json, needs_review, derived_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(repo_id) DO UPDATE SET steps_json = excluded.steps_json,
                                              needs_review = excluded.needs_review,
                                              derived_at = excluded.derived_at`,
        )
        .run(task.repo_id, JSON.stringify(plan.steps), plan.needsReview ? 1 : 0, ctx.now());
      return plan;
    }),

  /** §10.1 — the user confirms (or edits) the plan. Only then may it run. */
  verifyPlanConfirm: t.procedure
    .input(z.object({ taskId: TaskId, steps: z.array(z.unknown()).optional() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      const task = getTask(ctx.db, input.taskId);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });
      if (input.steps) {
        ctx.db
          .prepare('UPDATE verify_plan SET steps_json = ? WHERE repo_id = ?')
          .run(JSON.stringify(input.steps), task.repo_id);
      }
      ctx.db
        .prepare('UPDATE verify_plan SET needs_review = 0, confirmed_at = ? WHERE repo_id = ?')
        .run(ctx.now(), task.repo_id);
      return { ok: true as const };
    }),

  /**
   * The plan this repo already has, if any — §10.1.
   *
   * Read-only, and the reason it exists: without it the renderer cannot tell a repo with a
   * confirmed plan from one with none, so it offered "Derive a verification plan" either way and
   * deriving resets `needs_review` to 1 — silently discarding the confirmation §10.1 exists to
   * collect. Found by looking at the panel for the first time.
   */
  verifyPlanGet: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(
      z
        .object({
          steps: z.array(
            z.object({
              name: z.string(),
              cmd: z.string(),
              cwd: z.string(),
              timeoutSec: z.number(),
              required: z.boolean(),
              source: z.enum(['ci', 'manifest', 'doc', 'user']),
              evidence: z.string(),
            }),
          ),
          needsReview: z.boolean(),
        })
        .nullable(),
    )
    .query(({ ctx, input }) => {
      const task = getTask(ctx.db, input.taskId);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });

      const stored = ctx.db
        .prepare('SELECT steps_json, needs_review FROM verify_plan WHERE repo_id = ?')
        .get(task.repo_id) as { steps_json: string; needs_review: number } | undefined;
      if (!stored) return null;

      return {
        steps: JSON.parse(stored.steps_json) as VerifyStep[],
        needsReview: stored.needs_review === 1,
      };
    }),

  verifyRun: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(z.object({ passed: z.boolean(), headSha: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = getTask(ctx.db, input.taskId);
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'unknown task' });

      const stored = ctx.db
        .prepare('SELECT steps_json, needs_review FROM verify_plan WHERE repo_id = ?')
        .get(task.repo_id) as { steps_json: string; needs_review: number } | undefined;
      if (!stored) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'no verification plan yet' });
      }

      const plan = {
        steps: JSON.parse(stored.steps_json) as VerifyStep[],
        needsReview: stored.needs_review === 1,
      };
      const facts = getTaskFacts(ctx.db, input.taskId)!;
      const head = facts.scm?.pr_head_sha ?? task.base_sha;

      const report = await ctx.verifier.run(input.taskId, plan, head);
      return { passed: report.passed, headSha: report.headSha };
    }),

  // ── gates (§14) ──────────────────────────────────────────────────────────

  gateDecide: t.procedure
    .input(z.object({ gateId: z.string(), decision: z.enum(['approve', 'deny']) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      try {
        ctx.gates.decide(input.gateId, input.decision);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
      return { ok: true as const };
    }),

  /** §14.2 — editing rewrites the payload and re-hashes, so the edit is what is bound. */
  gateEditAndApprove: t.procedure
    .input(z.object({ gateId: z.string(), payload: z.unknown() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      try {
        ctx.gates.editAndApprove(input.gateId, input.payload);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
      }
      return { ok: true as const };
    }),

  // ── GitHub (§11) and triage (§12) ────────────────────────────────────────

  /** §11.1 — the issue list for a watched repo. Candidates, not tasks. */
  issueList: t.procedure
    .input(z.object({ repoId: z.string() }))
    .output(
      z.array(
        z.object({
          number: z.number().int(),
          title: z.string(),
          body: z.string(),
          url: z.string(),
        }),
      ),
    )
    .query(({ ctx, input }) => ctx.poller.pollIssues(input.repoId)),

  /**
   * §12 — import an issue as a task.
   *
   * `triage` makes it a task that terminates in an artifact rather than a PR. That path is the
   * wedge, so it is a first-class option here rather than a mode discovered later.
   */
  issueImport: t.procedure
    .input(
      z.object({
        repoPath: z.string().min(1),
        issue: z.object({
          number: z.number().int(),
          title: z.string(),
          body: z.string(),
          url: z.string(),
        }),
        triage: z
          .enum(['reproduce', 'bisect', 'failing-test', 'duplicate-check', 'verify-pr-claim'])
          .optional(),
      }),
    )
    .output(z.object({ taskId: TaskId }))
    .mutation(async ({ ctx, input }) => {
      const taskId = await ctx.triage.importIssue(input.repoPath, input.issue, {
        triage: input.triage as TriageKind | undefined,
      });
      return { taskId };
    }),

  /** Forces a PR refresh without waiting out the 30s interval. */
  scmRefresh: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(z.object({ refreshed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const facts = getTaskFacts(ctx.db, input.taskId);
      const prNumber = facts?.scm?.pr_number;
      if (prNumber == null) return { refreshed: false };
      return { refreshed: await ctx.poller.refreshPr(input.taskId, prNumber) };
    }),

  /**
   * §11.3 — what would happen if this task opened a PR.
   *
   * Shown *before* asking for approval: §11.3 says check permissions before offering the
   * action, not after.
   */
  prPlan: t.procedure
    .input(z.object({ taskId: TaskId }))
    .output(
      z.object({ viaFork: z.boolean(), head: z.string(), target: z.string(), base: z.string() }),
    )
    .query(async ({ ctx, input }) => {
      try {
        const plan = await ctx.scmWrites.planFork(input.taskId);
        return {
          viaFork: plan.viaFork,
          head: plan.head,
          target: `${plan.prOwner}/${plan.prRepo}`,
          base: plan.prBase,
        };
      } catch (err) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: (err as Error).message });
      }
    }),

  /** §11.2 — requests a gate for opening a PR. Nothing is written until it is approved. */
  prOpenRequest: t.procedure
    .input(
      z.object({
        taskId: TaskId,
        title: z.string().min(1),
        body: z.string(),
        draft: z.boolean().optional(),
      }),
    )
    .output(z.object({ gateId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const plan = await ctx.scmWrites.planFork(input.taskId);
      const payload = {
        title: input.title,
        body: input.body,
        head: plan.head,
        base: plan.prBase,
        draft: input.draft ?? false,
      };
      return { gateId: ctx.scmWrites.requestGate(input.taskId, 'gate.pr_open', payload) };
    }),

  // ── §13 repository conventions ─────────────────────────────────────────────

  /** What is known about this repo, and whether more can be learned right now. */
  mineStatus: t.procedure
    .input(z.object({ repoId: z.string() }))
    .output(MineStatus)
    .query(({ ctx, input }) => {
      const knowledge = requireKnowledge(ctx);
      const availability = knowledge.availability(input.repoId);
      const rules = knowledge.list(input.repoId);
      return {
        available: availability.available,
        reason: availability.reason,
        running: knowledge.isRunning(input.repoId),
        lastRun: knowledge.lastRun(input.repoId),
        activeRules: rules.filter((r) => r.lifecycle === 'active').length,
        candidateRules: rules.filter((r) => r.lifecycle === 'candidate').length,
        dueForRemine: knowledge.dueForRemine(input.repoId),
      };
    }),

  /**
   * §13.4 — mining is always explicit. It spends GitHub quota and model tokens, so nothing
   * starts it on its own and no task launch waits on it.
   *
   * Returns as soon as the run is *started*, not when it finishes: a first mine of a large
   * repository is minutes of model calls, and holding an HTTP request open for that is the wrong
   * shape — a client that times out would learn nothing about a run still spending money. Poll
   * `mineStatus` for progress.
   */
  mineRepo: t.procedure
    .input(z.object({ repoId: z.string(), full: z.boolean().optional() }))
    .output(z.object({ runId: z.string() }))
    .mutation(({ ctx, input }) => {
      try {
        return requireKnowledge(ctx).startMine(input.repoId, { full: input.full });
      } catch (err) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: (err as Error).message });
      }
    }),

  /** §13.6 — the measurable claim. Reports what it measured, including bad news. */
  conventionImpact: t.procedure
    .input(z.object({ repoId: z.string() }))
    .output(ConventionImpact)
    .query(async ({ ctx, input }) => {
      try {
        return await requireKnowledge(ctx).measure(input.repoId);
      } catch (err) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: (err as Error).message });
      }
    }),

  conventionList: t.procedure
    .input(z.object({ repoId: z.string() }))
    .output(z.array(ConventionView))
    .query(({ ctx, input }) => requireKnowledge(ctx).list(input.repoId)),

  /** §13.4 — one-click confirmation. The renderer shows the evidence beside the toggle. */
  conventionConfirm: t.procedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ confirmed: z.boolean() }))
    .mutation(({ ctx, input }) => ({
      confirmed: requireKnowledge(ctx).confirm(input.id),
    })),

  conventionReject: t.procedure
    .input(z.object({ id: z.string(), reason: z.string().min(1) }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(({ ctx, input }) => {
      requireKnowledge(ctx).reject(input.id, input.reason);
      return { ok: true as const };
    }),
});

/**
 * Mining is optional: a daemon with no model or no token configured serves every other procedure
 * normally. Saying so plainly beats a null dereference three frames down.
 */
function requireKnowledge(ctx: DaemonContext): Knowledge {
  if (!ctx.knowledge) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'this daemon has no knowledge service configured',
    });
  }
  return ctx.knowledge;
}

export type AppRouter = typeof appRouter;
