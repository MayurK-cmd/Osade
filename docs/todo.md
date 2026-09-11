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

- [ ] **Signing.** Nothing is signed — certificates do not belong in a repo. electron-builder
      reads `CSC_LINK` / `CSC_KEY_PASSWORD` (and the macOS notarisation variables) from the
      environment. An unsigned build is fine to test and not fine to hand to a user: SmartScreen
      and Gatekeeper both refuse it.
- [x] **An icon.** `scripts/make-icon.mjs` draws it — four ledger rows, one flagged in the
      needs-you amber, in the palette from `tokens.css` so the mark and the interface cannot
      drift. Generated rather than committed as a blob, for the same reason as the rest.

## Carried debt

Each of these was chased to an answer. What is left is the answer, not the question.

- [ ] **`backend/` may contain an edit to a read-only tree.** Narrowed by blob hash (ADR 0002):
      the bulk is the substrate at `cc88b3b8`, but `src/platform/windows.rs` matches no public
      commit and no branch, while being unmodified relative to Osade's own HEAD. Resolvable only
      by landing `backend/` at a known commit at the next substrate bump —
      `scripts/fetch-herdr-source.mjs` does that and writes `OSADE-PIN.json` beside it.
- [x] **`smoke:panels` now checks layout, not just text.** Each expected phrase must be laid
      out, sized and inside the page, and the document must not scroll horizontally — `innerText`
      alone reports text that is hidden or collapsed to nothing. What it still cannot judge is
      whether a layout that passes all of that actually *looks* right; that needs eyes on
      `smoke.png`.
- [x] **`VerifyRunner`'s exit-code sentinel.** Checked against the pinned schema: there is no
      run-and-report method. `pane.process_info` returns running processes and no exit status;
      the only `exit_code` in the schema belongs to plugin commands. The sentinel stays because
      nothing better exists, not because nobody looked.
- [x] **Near-duplicate rule matching is content-word overlap.** Deliberate and staying so: a
      fourth model call would have no way to check its work, and being too strict (a duplicate a
      human can merge) is much cheaper than being too loose (a rule silently absorbed into an
      unrelated one).
- [x] **The M1 acceptance depends on a real agent choosing to act.** Inherent to testing against
      a real agent, and mitigated: failures report whether the prompt was *delivered* separately
      from what the agent did with it, so an Osade bug is distinguishable from an agent's
      judgement.
