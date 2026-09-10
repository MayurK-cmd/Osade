# todo

Only what is left. M0–M3 are built and green: `pnpm check` (322 passing), `pnpm test:e2e` against
real herdr, and `pnpm --filter @osade/desktop smoke` boots the app against a live daemon and
photographs the window.

## Needs you

- [ ] **Run `docs/M2-ACCEPTANCE.md`** against a real repo with your own GitHub token. Everything
      Osade owns is proved against a recorded GitHub; what that cannot prove is that GitHub
      behaves as recorded.
- [ ] **Run `docs/M3-ACCEPTANCE.md`** on a repo with a real review history, with your own GitHub
      and Anthropic keys. Also the first time mining runs against a live GitHub and a live model
      at all — every pass is currently proved against fixtures.
      **The criterion (§13.6):** N ≥ 10 comparable tasks with and without injected conventions on
      the same repo. **If the number does not move, the feature is wrong and should be redesigned,
      not shipped.** Nothing in the test suite can answer this one.

## Release blockers

- [ ] **A packaged app has no Node to run the daemon on.** It cannot use Electron's —
      `better-sqlite3` is compiled for Node's ABI and the daemon also runs standalone under the
      CLI and the tests. Ship a Node runtime, or ship two ABI-matched builds of every native
      module. `OSADE_NODE_BIN` is the seam; the constraint is written up in OSADE.md §18.1.
- [ ] **No installer.** `pnpm -r build` produces runnable output for every package, but nothing
      assembles it into something a user can install — no electron-builder config, no code
      signing, no auto-update.

## Carried debt

- [ ] **`backend/`'s provenance is unknown.** It is an unreleased herdr, ahead of v0.8.2, with
      nothing recording which commit (ADR 0002). The next herdr bump should land it at a known
      commit — `scripts/fetch-herdr-source.mjs` does that and writes `OSADE-PIN.json` beside it.
- [ ] **`VerifyRunner` recovers exit codes by echoing a sentinel into the lane.** Checked
      2026-09-11: herdr 0.8.2-p20 has no run-and-report method. `pane.process_info` returns
      running processes (pid, argv, cwd) and no exit status; the only `exit_code` in the whole
      schema belongs to plugin commands. The sentinel stays until herdr grows something better.
- [ ] **Near-duplicate rule matching is content-word overlap** within a category. Deliberately
      dumb — a fourth model call would have no way to check its work — but it will miss a
      paraphrase that shares few words with the original.
- [ ] The M1 acceptance's "agent fixes it" step depends on a real agent choosing to act, so it
      can fail for reasons outside Osade. Failures report whether the prompt was *delivered*
      separately from what the agent did with it.
- [ ] The smoke screenshot is read by a human. It catches a blank window and a renderer error,
      not a layout that has quietly gone wrong.

## Upstream to herdr

Written up in `patches/` — one patch, two reports. Nothing here blocks Osade; each item names
what Osade does instead.

- [ ] Offer `patches/0001-windows-agent-launch-via-call-operator.patch` upstream. Not compiled
      here: herdr needs Zig 0.15.2 and this machine has none.
- [ ] Decide with a maintainer what `events.subscribe` should do about its primed event (0002),
      and whether a failed `worktree.remove` can surface git's error (0003).
