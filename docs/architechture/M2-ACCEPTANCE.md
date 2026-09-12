# M2 acceptance — running it live

> **What this is.** OSADE.md §21's M2 acceptance:
>
> > Import a real issue from a repo you maintain; land one PR through the gate; run one triage
> > task that produces a reproduction and no PR.
>
> Every step Osade owns is already proved against a recorded GitHub in
> `packages/daemon/test/integration/m2-acceptance.test.ts`, which runs in `pnpm check` with no
> credentials. What that test cannot prove is that GitHub behaves as recorded. This is the
> runbook for the half that needs a token and a repository you maintain — **yours, not the
> agent's.**

---

## Before you start

You need:

- a **GitHub personal access token** with `repo` scope, for an account you control;
- a **repository you maintain**, with at least one open issue. A scratch repo is ideal for the
  first run — the PR step opens a real pull request.

Two things worth being deliberate about:

- Osade never writes the token to disk (§2.1). It reads `OSADE_GITHUB_TOKEN` from its
  environment at spawn and keeps it in memory. Nothing in `~/.osade/` will contain it.
- Every write below stops at a gate. Nothing reaches GitHub until you approve it, and the
  approval is bound to the exact bytes you were shown (§11.2). If a payload changes between
  approval and execution, Osade refuses rather than sending the new one.

---

## 1. Start the daemon with a token

```bash
OSADE_GITHUB_TOKEN=ghp_… pnpm --filter @osade/daemon exec vite-node src/cli.ts -- start
```

The boot drift check runs first (§4.1.1); it will refuse to start against a substrate whose
protocol differs from `vendor/herdr/0.8.2-p20`.

## 2. Point Osade at the repository

```bash
osade task create /path/to/your/repo "scratch" "verifying the M2 loop"
```

The GitHub identity is read from the repo's `origin` remote automatically — HTTPS, SSH and
`git://` all work. A non-GitHub remote is left null rather than guessed at, and such a repo is
still a valid task target; it just cannot open pull requests.

To check what Osade read:

```sql
-- ~/.osade/osade.db
SELECT path, gh_owner, gh_name, fork_of FROM repo;
```

## 3. Import an issue

In the app, or over the API:

```bash
curl "http://127.0.0.1:$(cat ~/.osade/daemon.port)/issueList?input=$(printf '{"repoId":"r_xxxx"}' | jq -sRr @uri)"
```

Then import one. The task carries the issue URL in `origin_ref`, so a comment can be posted
back to the right place later.

**What to check:** the new row appears in the ledger as `queued`, and its title is
`#<n> <issue title>`.

## 4. Land a PR through the gate

Launch the task, let the agent work, run verification, then open the PR panel in the task
detail.

**What to check, in order:**

1. The panel shows where the PR would go *before* you ask for anything — `head → target: base`,
   and "(via your fork)" when §11.3 routes through a fork. If you have no push access and no
   fork, it says so instead of offering a button that would 403.
2. Pressing **Open pull request** does *not* open one. It requests a gate, and the row moves to
   `awaiting_approval` at the top of the ledger.
3. The gate card shows the exact title and body. Edit it if you like — editing re-hashes, so
   the edit is what gets bound (§14.2).
4. Approving opens the PR. `scm_fact` fills in and the row moves to `pr_open`.
5. Within 30 seconds the poller reads back checks and reviews. Request changes on the PR from
   another account (or ask someone to) and watch the row move to `review_changes_requested` —
   and the reviewer's own words arrive in the agent lane.

**What would be a bug:** a PR appearing without a gate; the row showing `pr_open` before
GitHub confirmed it; a transient GitHub error changing `pr_state`, `checks_state` or
`review_state` rather than only `fetch_failed_at` (§11.1).

## 5. Run a triage task that produces no PR

Import the same issue again, this time as a triage task of kind `reproduce`.

**What to check:**

- The intent the agent receives ends with *"Do not fix anything."* Every triage brief says
  some version of that; it is asserted in `triage.test.ts`.
- The task terminates in `~/.osade/runs/<task>/triage.md`, citing the issue.
- `scm_fact` stays empty. A triage task never opens a PR (§12).
- Posting the reproduction back is a `gate.issue_comment` like any other public write, and the
  comment carries the agent-authorship disclosure, composed into the body so edit-and-approve
  cannot quietly drop it (§23 q3).

---

## Cleaning up

```bash
osade task archive <task-id>
```

Close the PR and delete the branch on GitHub yourself. Osade will not — `gate.branch_delete`
exists, but nothing calls it automatically, and **Osade never merges** (§1 non-goal 3).

---

## If something fails

Compare against the recorded run first: `pnpm vitest run packages/daemon/test/integration/m2-acceptance.test.ts`.
If that passes and the live run does not, the difference is GitHub's behaviour rather than
Osade's logic, and the fixture in that file is what should change.
