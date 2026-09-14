# ADR 0002 — `backend/` stays committed, because we cannot reproduce it

**Status:** accepted, 2026-09-11
**Closes:** the open question in PRD-DELTA #1 and #14

## The question

the substrate's source sits at `backend/`: 29 MB, 1766 files, committed to Osade's history as a plain
copy with no upstream link. Submodule, vendored at a pinned tag, or fetched by script?

## What I expected to decide

Fetched by script. Nothing builds against `backend/` — every reference in Osade's code is a
citation inside a comment (`backend/src/api/server.rs:154-300`), the API contract comes from the
pinned `vendor/runtime/0.8.2-p20/api-schema.json`, and `pnpm check` passes with `backend/` absent.
Documentation that happens to be source code does not belong in Osade's history, and a copied
tree spreads: the substrate's `.github/` and `.agents/` sat at Osade's root until 2026-09-11, where its
CI and dependabot quietly competed with Osade's.

## What the evidence said instead

**The tree at `backend/` is not any the substrate release, and we cannot say what it is.**

Fetching the upstream repository at `v0.8.2` — the version `backend/Cargo.toml` declares, and the
version the pinned schema was captured from — produces a different tree:

```
src/api/server.rs   fetched v0.8.2: 1470 lines    local backend/: 1483 lines
```

Not line endings; genuinely different code. This is PRD-DELTA #1's finding from the other
direction: `backend/` is an unreleased tree *ahead of* the shipped binary, still declaring 0.8.2
because version bumps happen at release. There is no marker in the tree recording which commit it
came from.

So a fetch cannot reproduce it. Switching to one would silently replace the tree that Osade's
comments cite with an older one, moving every `file:line` reference by a few lines — the failure
mode being that each citation still *resolves*, to the wrong thing.

## The decision

**`backend/` stays committed, as it is.** It is the only copy of the thing Osade's comments point
at, and an unreproducible artifact that is not committed is an artifact that is one `rm -rf` from
being lost.

`scripts/fetch-substrate-source.mjs` is kept, pinned to `v0.8.2`'s commit
(`9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`), for two jobs it is genuinely good at: restoring
`backend/` if it is deleted, and establishing **known** provenance the next time the substrate pin
moves. It is not wired into any build.

## The provenance, established

Corrected 2026-09-11. An earlier pass sampled four files, found three matching `cc88b3b8`, and
concluded the tree was "mostly that commit with one unattributable file" — including a suspicion
that `src/platform/windows.rs` had been edited in place. **That was wrong, and wrong in the way
sampling usually is: four files is not a tree.** Comparing all of them said so immediately — 65
differed from `cc88b3b8`, not one.

Done properly, by comparing every tracked blob hash against upstream trees:

| commit | date | files matching (of 1766) |
| --- | --- | --- |
| master head `61ca85d5` | 2026-09-11 | 1055 |
| v0.8.2 `9eb52145` | — | 1462 |
| `cc88b3b8` | 2026-09-01 | 1686 |
| **`94f6d9c0`** | **2026-09-02** | **1766 — all of them** |

`backend/` is upstream commit `94f6d9c0d9bb`, "fix: reveal newly focused spaces in the sidebar".
Every tracked file is byte-identical. **Nothing in the read-only tree has been edited**, and the
worry that something had was an artefact of the sampling, not a finding.

Recorded in `backend/OSADE-PIN.json`, and `scripts/fetch-substrate-source.mjs` now pins that commit —
so restoring `backend/` reproduces the tree the `file:line` citations were written against,
rather than the older v0.8.2 it used to fetch.

The only files present that upstream does not have at that commit are the substrate's own repo
furniture (`.agents/**`, `.github/commit-msg`, `.github/pre-commit`), moved under `backend/` the
same day so it would stop competing with Osade's at the root. One genuinely foreign file turned
up in the sweep — `skills/opensource/SKILL.md`, Osade's own writing about contribution, sitting
inside someone else's tree. Moved to `docs/skills/`.

Source and binary stay pinned to different things, deliberately: `vendor/runtime/0.8.2-p20` pins
the release Osade actually runs, with a verified checksum, while this source is ahead of it and
explains its behaviour.

## Why not a submodule

It pins a commit, which is the right property — but there is no commit to pin. It would also put
29 MB into every clone by default, need `--recurse-submodules` to be right, fail quietly when
that is forgotten, and assert a git-level dependency Osade does not have: Osade consumes a
*binary* whose contract is the pinned schema.

## What stays true

`backend/` changes in exactly one way. `scripts/rebrand-source.mjs` renames the upstream project
name to Osade's throughout, deterministically and rerunnably, and `backend/OSADE-PIN.json` records
that it ran. Links to where the project lives point at Osade's repository; release, download and
history addresses are kept, because rewritten they would point at files and domains Osade does not
own, or credit other people's work to Osade. Nothing else is edited, and the
rename never adds or removes a line, so every `backend/…:line` citation still holds.

*Amended 2026-09-13. Before this, the rule was that `backend/` is never edited at all; renaming it
was a product decision.*
