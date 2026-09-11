# todo

Only what is left. M0–M3 are built and green: `pnpm check` (322 passing), `pnpm test:e2e` against
real herdr, and `pnpm --filter @osade/desktop smoke` boots the app against a live daemon and
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

## Release blockers

Packaging is done and verified by launching the packaged build: it boots, spawns its daemon on
the runtime it ships, renders, and passes its panel assertions. `pnpm package` builds an
installer; `pnpm package:dir` an unpacked app.

- [x] **Signing is configured and cannot be skipped by accident.** Windows signs with sha256 and
      an RFC 3161 timestamp; macOS has a hardened runtime, entitlements and notarisation that
      switch on when the credentials exist. `pnpm package` refuses to build a release without
      them — `OSADE_ALLOW_UNSIGNED=1` overrides, loudly. `pnpm package:dir` is ungated, because
      an unpacked build never leaves the machine.
      **What still needs you:** the certificates themselves. A Windows OV or EV certificate, and
      an Apple Developer ID plus notarisation credentials. Nothing else is missing.
## Carried debt

Each of these was chased to an answer. What is left is the answer, not the question.

- [x] **`backend/`'s provenance is known, and nothing in it was edited.** All 1766 tracked files
      are byte-identical to the substrate at `94f6d9c0` (2026-09-02) — recorded in
      `backend/OSADE-PIN.json`, and the fetch script now pins that commit rather than the older
      tag. The earlier suspicion of a local edit came from sampling four files and generalising;
      comparing the whole tree disproved it (ADR 0002). One genuinely foreign file did turn up —
      Osade's own `skills/opensource/SKILL.md` inside someone else's tree — now in `docs/skills/`.