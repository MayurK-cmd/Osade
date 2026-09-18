# todo

Only what is left. M0–M3 are built and green: `pnpm check` (334 passing), `pnpm test:e2e` against
real substrate, and `pnpm --filter @osade/desktop smoke` boots the app against a live daemon and
photographs the window.

## Needs you

- [x] **Run `docs/M2-ACCEPTANCE.md`** against a real repo with your own GitHub token. Everything
      Osade owns is proved against a recorded GitHub; what that cannot prove is that GitHub
      behaves as recorded.

      Live run 2026-09-18 against `rajarshidattapy/osade-m2-acceptance` (private scratch, issue #1,
      PR #2: https://github.com/rajarshidattapy/osade-m2-acceptance/pull/2). Token from `gh auth token`
      (`repo` scope), held in the daemon env only.

      What GitHub actually did:
      1. `issueList` returned the real open issue. Import produced `queued` with title `#1 Crash when the config file is empty` and `origin_ref` set.
      2. `prPlan` showed `osade/…/claude → rajarshidattapy/osade-m2-acceptance: main` (not via fork) before any write.
      3. `prOpenRequest` did **not** open a PR. Status moved to `awaiting_approval`. Approving `gate.pr_open` opened PR #2, wrote `scm_fact`, status `pr_open`.
      4. Poller read back `checks_state=neutral`, `review_state=none`, `mergeable=clean`. `pr_state` did not flap.
      5. Same-account `REQUEST_CHANGES` is a GitHub 422: *"Review Can not request changes on your own pull request."* Needs a second account; not done.
      6. Triage import of the same issue: intent ends with *"Do not fix anything."* `scm_fact` stayed empty. Comment posted through `gate.issue_comment` with the agent-authorship disclosure: https://github.com/rajarshidattapy/osade-m2-acceptance/issues/1#issuecomment-5723989040

      Bugs the live GitHub found (fixed in this working tree):
      - Approving a public-write gate recorded the decision and never executed it (`gateDecide` now calls `openPr` / `comment`).
      - A 304 on `GET /repos/{owner}/{repo}` was treated as "no push access", so the second `prPlan`/`prOpenRequest` 403'd after the first succeeded.

      Also seen, not blocking the GitHub loop: `worktree.create` failed on retry because the path already existed; two triage/fix tasks hashed to the same branch name.

- [x] **Run `docs/M3-ACCEPTANCE.md` §§1–3** on a repo with a real review history, with your own GitHub
      token. Mining is headless Claude Code now (no Anthropic key). First live mine: `jshttp/fresh`
      (52 closed PRs).

      - Button disabled with a reason while a run is in progress (`a mining run is already in progress.`).
      - Progress moved `fetching` → `extracting 35/50` → `verifying` in minutes, not stuck.
      - Run `mr_6ee18d4f`: 17 observations, 4 candidates, 2 CI rules auto-promoted to **active**. Citations are this repo's workflow files; three checked by hand (HTTP 200, excerpts present in `ci.yml`).
      - Launch wrote `<osade-home>/tasks/<id>/CONTEXT.md` with both active rules, citations, and the gate boundaries. Short. No verification block (no confirmed plan).
      - `conventionImpact`: **not enough data: 0 task(s) with conventions and 0 without.**

      Bugs the live mine found (fixed): Windows `spawn claude ENOENT` — npm's extensionless `claude` shim is not spawnable; resolve `claude.cmd` via PATHEXT.

- [ ] **§13.6 N ≥ 10 comparison** — not runnable in this session, and should not be faked.
      **The criterion:** N ≥ 10 comparable **merged** Osade tasks with and without injected conventions
      on the same repo. `conventionImpact` only counts `scm_fact.pr_state = 'merged'`. Osade never
      merges. Self-merging 20 scratch PRs would report "no movement" and wrongly condemn the feature.
      Needs ~20 real review cycles on one repo. Nothing in the test suite can answer this one.

      Close/delete the scratch repo yourself when done: `rajarshidattapy/osade-m2-acceptance`.
      Osade will not merge or delete the branch.
