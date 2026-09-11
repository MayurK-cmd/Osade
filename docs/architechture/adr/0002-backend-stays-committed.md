# ADR 0002 — `backend/` stays committed, because we cannot reproduce it

**Status:** accepted, 2026-09-11
**Closes:** the open question in PRD-DELTA #1 and #14

## The question

herdr's source sits at `backend/`: 29 MB, 1766 files, committed to Osade's history as a plain
copy with no upstream link. Submodule, vendored at a pinned tag, or fetched by script?

## What I expected to decide

Fetched by script. Nothing builds against `backend/` — every reference in Osade's code is a
citation inside a comment (`backend/src/api/server.rs:154-300`), the API contract comes from the
pinned `vendor/herdr/0.8.2-p20/api-schema.json`, and `pnpm check` passes with `backend/` absent.
Documentation that happens to be source code does not belong in Osade's history, and a copied
tree spreads: herdr's `.github/` and `.agents/` sat at Osade's root until 2026-09-11, where its
CI and dependabot quietly competed with Osade's.

## What the evidence said instead

**The tree at `backend/` is not any herdr release, and we cannot say what it is.**

Fetching `herdrdev/herdr` at `v0.8.2` — the version `backend/Cargo.toml` declares, and the
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

`scripts/fetch-herdr-source.mjs` is kept, pinned to `v0.8.2`'s commit
(`9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`), for two jobs it is genuinely good at: restoring
`backend/` if it is deleted, and establishing **known** provenance the next time the herdr pin
moves. It is not wired into any build.

## How far the provenance could be narrowed

Chased on 2026-09-11 by comparing git blob hashes — content-addressed, so a match is proof
rather than a guess:

| file | result |
| --- | --- |
| `src/api/server.rs` | matches `cc88b3b8` (2026-09-01, "feat: add stable client endpoint compatibility #3509") |
| `src/app/agents.rs` | matches `cc88b3b8` |
| `src/api/subscriptions.rs` | matches `cc88b3b8` |
| `Cargo.lock` | matches `cc88b3b8` |
| `src/platform/windows.rs` | **matches nothing public** |

So the bulk of `backend/` is herdr at `cc88b3b8`. But `src/platform/windows.rs` matches neither
that commit, nor any master commit touching that path, nor the `windows` branch — and it is
unmodified relative to Osade's own git HEAD, so it was not changed in this session. Either it
came from an unpushed branch, or `backend/` was edited before the read-only rule was written
down.

**This is not academic.** The first version of `patches/0001` was generated against that file and
did **not** apply to herdr's master. It was regenerated against master and verified there. Anyone
writing a patch from `backend/` should assume the same and check.

## What this leaves open

The next herdr bump should land `backend/` at a known commit and write `OSADE-PIN.json` beside it
— the script already does that. Until then the citations are accurate and the provenance is not,
which is the honest state of it and is recorded in `todo.md` rather than pretended away.

## Why not a submodule

It pins a commit, which is the right property — but there is no commit to pin. It would also put
29 MB into every clone by default, need `--recurse-submodules` to be right, fail quietly when
that is forgotten, and assert a git-level dependency Osade does not have: Osade consumes a
*binary* whose contract is the pinned schema.

## What stays true

`backend/` is read-only. Osade never edits it — a local edit is a fork nobody agreed to. Changes
herdr needs are written to `patches/` with their evidence (see `patches/README.md`).
