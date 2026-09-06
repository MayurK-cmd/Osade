# M3 acceptance — does the conventions miner actually help?

> **What this is.** OSADE.md §21's M3 acceptance:
>
> > Run N ≥ 10 comparable tasks with and without injected conventions on the same repo; report
> > review rounds to merge and first-round-acceptance rate for both. **If the number does not
> > move, the feature is wrong and should be redesigned, not shipped.**
>
> Every mechanism is proved in `pnpm check` against fixtures with no credentials: the evidence
> invariant, the pass thresholds, the held-out split, the decay, the injection budget, and the
> comparison arithmetic — including its ability to report that conventions made things *worse*.
> What no test can prove is whether mined conventions change how maintainers respond. That needs
> real pull requests on a real repository, and this is the runbook for it.

---

## Before you start

You need:

- a **repository with a real review history** — at least ~50 closed pull requests, some of them
  closed unmerged. A repo where every PR was merged by its own author has no conventions to mine,
  and mining it will correctly find nothing;
- a **GitHub token** with `repo` scope (`OSADE_GITHUB_TOKEN`);
- an **Anthropic API key** (`OSADE_ANTHROPIC_API_KEY`).

Neither key is written to disk. Both are read from the daemon's environment and held in memory
(§2.1, PRD-DELTA #17). Nothing in `~/.osade/` will contain either.

```bash
OSADE_GITHUB_TOKEN=ghp_… OSADE_ANTHROPIC_API_KEY=sk-ant-… \
  pnpm --filter @osade/daemon exec vite-node src/cli.ts -- start
```

**On cost.** A full mine of a 300-PR sample is roughly 300 extract calls (Haiku), one cluster
call and one verify call per candidate (Sonnet). Start with a smaller repo. Re-mines are
incremental and cost a fraction of the first run.

---

## 1. Mine the repository

Open any task on the repo and use **Mine this repository** in the conventions panel.

**What to check, in order:**

1. The button is disabled with a stated reason when it cannot work — no model key, no GitHub
   token, no GitHub remote, or a run already in progress. It should never fail *after* two
   minutes of work for a reason that was knowable before it started.
2. Every rule that appears has at least one citation, and **every citation is a link that
   resolves to a real page in this repository**. Click three at random. This is §13.1, and it is
   the single most important thing to verify by hand: the invariant is enforced at write time,
   but only a human can confirm the URL points at what the quote says it does.
3. Rules arrive as candidates. Nothing is active until you say so, however confident it is —
   except rules from CI config, which are mechanically enforced and can auto-promote.
4. Nothing being found is a **valid result**, not a failure. A rule needs three observations from
   two different PRs, or one from CI. A repo whose reviews are all "LGTM" genuinely has no mined
   conventions.

**What would be a bug:** a rule with no evidence; a citation URL that 404s or belongs to another
repository; a rule quoting text that does not appear at the URL it cites; a candidate promoted to
active without either a confidence ≥ 0.8 or your click.

## 2. Read the rules critically before turning any on

This is the step that is easy to skip and expensive to skip. For each candidate, read the rule
against its evidence and ask: *is this a rule of the project, or one maintainer's opinion on one
day?*

Turn on the ones that survive. Reject the rest — rejections are kept with their evidence, so a
re-mine does not propose them again blindly.

## 3. Check what the agent is actually told

Launch a task and read `<worktree>/.osade/CONTEXT.md`.

**What to check:**

- The active rules are there, each with its citations.
- It is **short**. Under ~2000 tokens, at most 40 rules. If your repo has more active rules than
  fit, the panel says how many were left out (§13.5).
- Verification appears only if you have confirmed a plan (§10.1).
- The gate boundaries are present regardless of what else was dropped.

## 4. Run the comparison

Run at least 10 tasks with conventions injected and 10 without, on the same repository, on
comparable work. Toggling every rule off between runs is the cleanest way to produce the control
arm — `task_injection` records what each launch actually injected, at launch, so the arms are
determined by the facts rather than by your memory.

Then press **Did this help?**, or:

```bash
curl "http://127.0.0.1:$(cat ~/.osade/daemon.port)/conventionImpact?input=$(printf '{"repoId":"r_xxxx"}' | jq -sRr @uri)"
```

You get mean and median review rounds to merge, first-round acceptance, and a verdict in plain
words for each arm.

---

## Reading the result honestly

The verdict is written to be able to disappoint, and there are only three real outcomes:

| Result | What it means |
| --- | --- |
| **Fewer than 10 tasks per arm** | No verdict. Not "promising early results" — no verdict. |
| **Review rounds drop by ≥ 0.5** | The claim holds for this repository. Say which repository; one repo is one data point. |
| **No movement, or worse** | §13.6 and §21 are explicit: *the feature is wrong and should be redesigned, not shipped.* |

If the third row is what comes back, the useful question is not "how do we improve the prompt".
It is which of these was false:

- that the rules are real (check them against a maintainer's own account);
- that the agent followed them (read `CONTEXT.md`, then the transcript);
- that following them is what review rounds respond to (read what reviewers actually asked for —
  if the rounds were about the code being wrong, conventions were never the lever).

The third of those is the one that would mean redesign rather than repair, and it is the reason
this milestone has an acceptance criterion at all.
