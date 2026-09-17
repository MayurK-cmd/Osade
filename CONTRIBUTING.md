# Contributing to Osade

Thanks for helping build **Osade** — a local-first desktop workspace for running coding agents
as open-source contributors.

---

## Before you start

M0–M3 are built. What is left is on [`docs/todo.md`](docs/todo.md) — live GitHub/model
acceptance, plus a short list of product follow-ups. Spec work still matters, but
scaffolding the product does not.

Read, in this order:

1. [`README.md`](README.md) — what Osade is and why.
2. [`docs/architechture/OSADE.md`](docs/architechture/OSADE.md) — the product requirements and
   build spec. Long, and worth it. **Sections marked INVARIANT are load-bearing** and sections
   marked **DECISION** were settled deliberately. Implement them; do not relitigate them in a
   PR. If you think one is wrong, open an issue that says which one and what evidence changed.
3. [`SECURITY.md`](SECURITY.md) — what counts as a vulnerability here, and how to report one.

The substrate surface Osade codes against is the pinned schema under
`vendor/runtime/<version>-p<protocol>/api-schema.json` and the generated client in
`packages/daemon/src/substrate/generated/`. There is no separate `SUBSTRATE-CONTRACT.md` or
`PRD-DELTA.md` in this tree; corrections from that recon live in OSADE.md itself (look for
*"Corrected … per PRD-DELTA"* markers).

There is one branch, `main`. Work from it.

---

## Rules this project enforces

These will send a PR back regardless of how good the code is. Most are lint-enforced
(`docs/architechture/OSADE.md` §20.1) rather than review comments.

- **Never hand-edit anything under `backend/`.** It is the substrate source, kept as reference.
  Its one change is the rename applied by `scripts/rebrand-source.mjs`; re-run that script rather
  than editing a file.
- **`backend/` is never a codegen input.** substrate client is generated only from the pinned
  schema in `vendor/runtime/<version>-p<protocol>/api-schema.json` (§4.1). The substrate's version
  string is not a contract: two different builds both call themselves `0.8.2`.
- **No `status` column, in any table, ever.** Status is a pure function over durable facts,
  recomputed at read time (§6). This is the single most important rule in the project.
- **Only `packages/daemon/src/substrate/**` may talk to the substrate.** Only
  `packages/daemon/src/scm/**` may import an SCM SDK. One boundary each.
- **No second event path.** Every UI update originates from a database mutation flowing
  through `change_log`/CDC (§5.4). If the UI did not update, the mutation did not go through
  the database — that is the bug.
- **No agent-authored public write without a gate** (§14), and **no auto-merge, ever**.
- No `any`. No `console.*` or `process.exit` in `packages/daemon/src/**` outside `cli.ts`.

the substrate's own `AGENTS.md` governs `backend/` only. It does not govern Osade code.

---

## Development workflow

```bash
git clone <your-fork>
cd osade
git checkout -b feature/<short-description>
```

Laptop setup — clone, fetch the pinned runtime, run the Electron app — is in the README.

You do **not** need to build the substrate. Osade ships a prebuilt binary, deliberately: the substrate requires
Zig 0.15.2 to build its vendored `libghostty-vt`, which is not an acceptable contributor
prerequisite. If you want to run against a local the substrate, put it on `PATH` and expect the boot
drift check (§4.1.1) to complain when its protocol differs from the pinned one.

Commit with conventional-commit-style messages:

```text
feat: derive status for review_changes_requested
fix: drop replayed agent facts below the stored state_change_seq
docs: correct the event mapping table in OSADE.md §7
refactor: split substrate event subscriber connection manager
```

Then open a PR against `main`.

---

## Pull requests

- **One concern per PR.** `feat: add agent system + redesign sidebar + fix auth` will be asked
  to split. Unrelated changes belong in unrelated PRs.
- Explain what changed **and why**. If the why is in OSADE.md, cite the section.
- Include tests. `deriveStatus` and the agent reducer are pure functions with property tests
  (§20.2); changes there without a test will not merge.
- Screenshots or a short clip for meaningful UI changes.
- Rebase on the latest `main` when practical.

If a change contradicts something in OSADE.md, update OSADE.md **in the same PR** and say what
evidence justified it. A spec that drifts from the code is worse than no spec.

### Testing

```text
packages/daemon/test/unit/         pure reducers, derive-status, verify-plan. No I/O.
packages/daemon/test/integration/  real sqlite, fake substrate, recorded GitHub fixtures
apps/desktop/test/                 vitest + playwright on the renderer
packages/daemon/test/e2e/          real substrate binary, real git repo fixture, one full task
```

Pre-commit runs unit + integration. E2E runs in CI. If CI hangs after tests appear to finish,
suspect a live subprocess or a daemon a unit-style suite booted — not a slow test.

---

## Using agents on this repository

You are welcome to. Osade exists because agent-assisted contribution should be cheaper to
review, and this repository should hold itself to that standard.

- **Disclose it** in the PR description: which agent, and what you verified yourself.
- **You are the author.** Review the diff before opening the PR. "The agent wrote it" is not
  an explanation for a change you cannot defend in review.
- Volume is not the goal. A PR that costs a maintainer less than it saves is the goal — that
  is the product thesis (`README.md`).

---

## Reporting bugs

Include what you expected, what happened, steps to reproduce, relevant logs, and your OS. For
anything involving the substrate, add the output of `the substrate status` and `the substrate --version`.

Osade's logs live in `~/.osade/logs/<date>.log`. the substrate's are in its session data directory —
`the substrate status` prints the path.

**Security issues do not go in public issues.** See [`SECURITY.md`](SECURITY.md).

---

## Code of conduct

Be respectful and constructive. Osade is built by contributors from different backgrounds and
experience levels, and good contributions include both code and useful feedback.

---

## Licensing

Osade is Apache-2.0 (`LICENSE`). By contributing you agree your contributions are licensed
under it. If you add a dependency, update `THIRD-PARTY-NOTICES.md` in the same PR — and note
that `gate.dep_add` exists in the product for a reason: supply chain is a first-class concern
here, not an afterthought.

---

## If you are unsure

Open an issue or a discussion before spending significant time, especially for anything that
touches an INVARIANT. Those are cheap to discuss and expensive to unpick.
