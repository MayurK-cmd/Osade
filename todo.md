# todo

## M0 — complete
The three-process spine, verified end to end against real herdr. See git history and
`docs/adr/0001-no-embedded-terminal-in-m0.md`.

## M1 — in progress (§21)
- [x] Full `deriveStatus` table, rows 1–14, with row-by-row and property tests
- [x] §20.1 lint boundaries wired, and `test/unit/lint-rules.test.ts` proves each one fires
      (flat config *replaces* rule options, so a duplicated rule name silently drops
      selectors — that failure is invisible without the test)
- [x] Verify plan derived from evidence: package.json scripts + lockfile, Cargo, pyproject,
      go.mod, with CI as corroboration and `needsReview` until a human confirms (§10.1)
- [x] Verify runner: `verify` lane, one `verify_run` row per step written *before* the command
      so §6 row 8 reads `verifying`, head+tail log capping, failure-loop prompt (§10.2)
- [x] Gates: the §14.1 list, payload hashing bound at request **and** re-checked at execution,
      edit-and-approve re-hashing, 24h expiry that is not a denial, policy downgrades recorded
      as `policy:<name>`
- [x] Migration 2: `verify_plan`, `task_lane`, repo verification policy, mirror paths
- [x] Failure loop wired end to end: first required failure stops the run and the tail goes
      back into the agent lane
- [x] Turn checkpoints + undo — scratch-index capture that leaves HEAD and the index untouched,
      stash-and-label undo, gate over 20 files (12 tests against real git)
- [x] Gate card at the top of the ledger: approve / deny / edit-and-approve, public writes
      called out, verification state shown
- [x] Verify plan review UI — steps with source and evidence, required toggles, and `Run`
      disabled until the plan is confirmed (§10.1)
- [x] 4 tasks in parallel on one repo, no cross-talk (found and fixed a repo-registration race)
- [ ] M1 acceptance run: drive the full implementing → verifying → verify_failed → implementing
      → awaiting_review loop against real herdr

**M1 acceptance (§21):** a task runs `implementing → verifying → verify_failed → implementing
→ awaiting_review` without a human touching it, and the commit is blocked until approved.

## Carried debt
- [ ] Electron app builds and typechecks; not yet launched end to end against a live daemon
- [ ] `osade` CLI has no tests
- [ ] `VerifyRunner` recovers exit codes by echoing a sentinel into the lane — works, but it is
      the weakest seam in M1. Revisit if herdr ever exposes a run-and-report method.

## Release blockers (THIRD-PARTY-NOTICES.md)
- [ ] fetch herdr's LICENSE + NOTICE from the pinned tag into vendor/herdr/0.8.2-p20/
- [ ] generate Rust crate attribution with cargo-about against the pinned Cargo.lock
- [ ] vendor the actual herdr binaries per platform + checksums

## Upstream to herdr
- [ ] `platform::interactive_shell_command` should use the call operator with arguments on
      Windows rather than `Start-Process`, which cannot execute npm shims (PRD-DELTA #13a.2)
- [ ] `events.subscribe` replays the ring buffer despite starting at `current_sequence()`
      (PRD-DELTA #5)

## Repo hygiene (PRD-DELTA #14)
- [ ] move herdr's AGENTS.md, .github/ and .agents/skills/herdr-* under backend/
- [ ] decide backend/: submodule, vendored at a pinned tag, or fetched by script
- [ ] add a security contact to docs/SECURITY.md, or enable private vulnerability reporting

## Final check (don't touch this, let this be like this)
- [ ] inside .agents/ write for every coding agent possible - .codex, .claude, .agy, .kiro, .opencode - already .pi/ and .zed/ is there
- [ ] app works end to end
- [ ] remove name herdr to osade-backend
