# todo

Only what is left. M0–M3 are built and green: `pnpm check` (334 passing), `pnpm test:e2e` against
real substrate, and `pnpm --filter @osade/desktop smoke` boots the app against a live daemon and
photographs the window.

## Needs you

- [ ] **Run `docs/architechture/M2-ACCEPTANCE.md`** against a real repo with your own GitHub token. Everything
      Osade owns is proved against a recorded GitHub; what that cannot prove is that GitHub
      behaves as recorded.
- [ ] **Run `docs/architechture/M3-ACCEPTANCE.md`** on a repo with a real review history, with your own GitHub
      and Anthropic keys. Also the first time mining runs against a live GitHub and a live model
      at all — every pass is currently proved against fixtures.
      **The criterion (§13.6):** N ≥ 10 comparable tasks with and without injected conventions on
      the same repo. **If the number does not move, the feature is wrong and should be redesigned,
      not shipped.** Nothing in the test suite can answer this one.

