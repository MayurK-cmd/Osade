# todo

## M0 — complete
The three-process spine, verified end to end against real herdr.
See `docs/adr/0001-no-embedded-terminal-in-m0.md`.

## M1 — complete
Full `deriveStatus`, §20.1 lint boundaries (with a test proving each one fires), verification
derived from evidence and refusing to run unreviewed, the failure loop, gates with
payload-hash binding, turn checkpoints and undo, gate + plan-review UI, four tasks in
parallel.

**Acceptance met.** `implementing → verifying → verify_failed → implementing →
awaiting_review` against real herdr, unattended, commit blocked until approved.

## M2 — complete
- [x] SCM client: conditional requests with ETags, rate-limit headers read from every
      response, back off below 20% remaining (§11.1)
- [x] SCM poller writing `scm_fact`, with the invariant that **a failed fetch is a fact, not a
      state change** — only `fetch_failed_at` moves
- [x] Gated writes (§11.2): PR open, comments, push and fork all re-hash at execution
- [x] Fork awareness (§11.3): push access checked before the action is offered; a failed
      permission check never reads as permission; `gate.fork_create` is not policy-overridable
- [x] GitHub identity read from the `origin` remote (HTTPS, SSH, `git://`), left null rather
      than guessed for non-GitHub hosts
- [x] Issue import → task, keeping the issue URL for a later gated comment (§12)
- [x] Triage tasks: five kinds, every brief instructing report-not-fix, terminating in an
      artifact on disk with non-removable agent disclosure
- [x] `review_changes_requested` loops back into the agent lane, once on the transition
- [x] PR-open flow in the renderer, showing the fork plan before asking for anything
- [x] **M2 acceptance** against recorded GitHub: import → gate → PR → poll → review loop, plus
      a triage task that produces no PR

`pnpm check` — 183 tests. `pnpm test:e2e` — 12 tests.

## The one M2 step that needs you
- [ ] Run `docs/M2-ACCEPTANCE.md` against a real repo with your own GitHub token. Everything
      Osade owns is proved against a recorded GitHub; what that cannot prove is that GitHub
      behaves as recorded.

## Next — M3, repository skills (§13)
The actual novelty. Everything else is assembly.

- [ ] Miner: extract → cluster → verify, three bounded passes, each a separate model call
- [ ] Evidence enforcement — a convention with zero `convention_evidence` rows is rejected at
      write time (§13.1 INVARIANT)
- [ ] Weighted inputs (§13.2): closed-unmerged PRs and `changes_requested` threads rate
      highest, CI config is definitionally true
- [ ] `CONTEXT.md` injection per agent, capped at 40 rules and ~2000 tokens
- [ ] Incremental re-mine, 180-day decay from `active` back to `candidate`
- [ ] Parse workflow YAML properly — §13.2 rates CI the strongest evidence there is, and
      `deriveVerifyPlan` currently only notes that CI exists

**M3 acceptance (§13.6):** N ≥ 10 comparable tasks with and without injected conventions on
the same repo; report review rounds to merge and first-round acceptance. **If the number does
not move, the feature is wrong and should be redesigned, not shipped.**

## Carried debt
- [ ] Electron app builds, typechecks and lints; still not launched against a live daemon
- [ ] `osade` CLI has no tests
- [ ] `VerifyRunner` recovers exit codes by echoing a sentinel into the lane. Proved against
      real herdr in the M1 acceptance, but still the weakest seam. Revisit if herdr ever
      exposes a run-and-report method.
- [ ] The M1 acceptance's "agent fixes it" step depends on a real agent choosing to act, so it
      can fail for reasons outside Osade. Failures now report whether the prompt was
      *delivered* separately from what the agent did with it.
- [ ] `unresolved_threads` is derived from review state rather than counting real threads;
      good enough for §6 row 5, wrong if the UI ever shows the number

## Release blockers (THIRD-PARTY-NOTICES.md)
- [ ] fetch herdr's LICENSE + NOTICE from the pinned tag into vendor/herdr/0.8.2-p20/
- [ ] generate Rust crate attribution with cargo-about against the pinned Cargo.lock
- [ ] vendor the actual herdr binaries per platform + checksums

## Upstream to herdr
- [ ] `platform::interactive_shell_command` should use the call operator with arguments on
      Windows rather than `Start-Process`, which cannot execute npm shims (PRD-DELTA #13a.2)
- [ ] `events.subscribe` replays the ring buffer despite starting at `current_sequence()`
      (PRD-DELTA #5)
- [ ] `worktree.remove` closes the workspace before deleting the directory, so a failed delete
      leaves an unaddressable workspace and the retry reports `workspace_not_found` instead of
      the real error (PRD-DELTA #13a.3)

## Repo hygiene (PRD-DELTA #14)
- [ ] move herdr's AGENTS.md, .github/ and .agents/skills/herdr-* under backend/
- [ ] decide backend/: submodule, vendored at a pinned tag, or fetched by script
- [ ] add a security contact to docs/SECURITY.md, or enable private vulnerability reporting
