# todo

Only what is left. M0–M3 are built and green: `pnpm check` (322 passing), `pnpm test:e2e`
against real herdr, and the app boots and renders against a live daemon. What each milestone
covers is in `docs/OSADE.md` §21; how the pieces work is in the code, not here.

## Needs you

Nothing below can be finished without your credentials or your decision.

- [ ] **Run `docs/M2-ACCEPTANCE.md`** against a real repo with your own GitHub token. Everything
      Osade owns is proved against a recorded GitHub; what that cannot prove is that GitHub
      behaves as recorded.
- [ ] **Run `docs/M3-ACCEPTANCE.md`** on a repo with a real review history, with your own GitHub
      and Anthropic keys. This is also the first time mining runs against a live GitHub and a
      live model at all — every pass is currently proved against fixtures.
      **The criterion (§13.6):** N ≥ 10 comparable tasks with and without injected conventions on
      the same repo. **If the number does not move, the feature is wrong and should be redesigned,
      not shipped.** Nothing in the test suite can answer this one.
- [ ] **Decide what `backend/` is**: git submodule, vendored at a pinned tag, or fetched by a
      script. It is currently untracked and partially copied, which is the one option that
      guarantees drift (PRD-DELTA #1, #14).
- [ ] **A security contact** for `docs/SECURITY.md`, or enable GitHub private vulnerability
      reporting. Left blank rather than guessed at.

## Release blockers

- [ ] **Nothing is built to JavaScript.** `bin` fields point at `.ts`, and the Electron
      supervisor only runs the daemon because it shells out to vite-node. A packaged app needs
      real builds for `packages/daemon` and `packages/cli`.
- [ ] **A packaged app has no Node to run the daemon on.** It cannot use Electron's —
      `better-sqlite3` is compiled for Node's ABI and the daemon also runs standalone under the
      CLI and the tests. Either ship a Node runtime or ship two ABI-matched builds of every
      native module. `OSADE_NODE_BIN` is the seam.
- [ ] Vendor the herdr binaries per platform, with checksums.
- [ ] Fetch herdr's LICENSE + NOTICE from the pinned tag into `vendor/herdr/0.8.2-p20/`.
- [ ] Generate Rust crate attribution with `cargo-about` against the pinned `Cargo.lock`.

## Carried debt

- [ ] **The panels have only been seen as code.** `pnpm --filter @osade/desktop smoke` boots the
      app against a live daemon and screenshots the window, but only the empty ledger and a
      queued row have actually been looked at. Gate cards, plan review, the PR panel and the
      conventions panel are unexercised.
- [ ] **`VerifyRunner` recovers exit codes by echoing a sentinel into the lane.** Proved against
      real herdr in the M1 acceptance, but still the weakest seam. Revisit if herdr ever exposes
      a run-and-report method.
- [ ] **Near-duplicate rule matching is content-word overlap** within a category. Deliberately
      dumb — a fourth model call would have no way to check its work — but it will miss a
      paraphrase that shares few words with the original.
- [ ] The M1 acceptance's "agent fixes it" step depends on a real agent choosing to act, so it
      can fail for reasons outside Osade. Failures report whether the prompt was *delivered*
      separately from what the agent did with it.

## Upstream to herdr

- [ ] `platform::interactive_shell_command` should use the call operator with arguments on
      Windows rather than `Start-Process`, which cannot execute npm shims (PRD-DELTA #13a.2).
- [ ] `events.subscribe` replays the ring buffer despite starting at `current_sequence()`
      (PRD-DELTA #5).
- [ ] `worktree.remove` closes the workspace before deleting the directory, so a failed delete
      leaves an unaddressable workspace and the retry reports `workspace_not_found` instead of
      the real error (PRD-DELTA #13a.3).

## Repo hygiene

- [ ] Move herdr's `AGENTS.md`, `.github/` and `.agents/skills/herdr-*` under `backend/`, so
      herdr's instructions stop competing with Osade's (PRD-DELTA #14).
