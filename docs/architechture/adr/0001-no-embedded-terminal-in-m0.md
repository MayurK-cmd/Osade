# ADR 0001: No embedded terminal in M0

- Status: accepted
- Date: 2026-09-04
- Spec: [`docs/architechture/OSADE.md`](../OSADE.md) §4.4

## Context

Osade drives a headless terminal substrate over a JSON API. An earlier draft of the spec
had Osade render live terminal cells inside the Electron window so operators could watch
agent panes without leaving the ledger.

That plan assumed cell grids arrived as JSON, one stream per pane, with an ANSI fallback
if canvas rendering proved slow. None of those hold against the pinned substrate: surfaces
are a composited tab grid over bincode, each live view needs its own connection, and
`TerminalAnsi` is not offered to endpoint clients.

## Decision

M0 ships **no embedded terminal**. Osade renders the ledger, task detail, diffs,
verification output, and gates. Watching a live terminal is "Open in the substrate":
attach a real substrate client to the `osade` session in the user's own terminal.

On-demand transcript via `pane.read` is allowed as a static panel, never a render loop.

## Consequences

- No utility process, `MessageChannelMain`, or cell renderer in M0.
- Attaching a client can flip substrate `agent_status` from `done` to `idle` (seen vs
  unseen). Osade must not treat `idle` as a transition, and must not call `pane.focus` /
  `agent.focus` on a task lane.
- Reintroducing an embedded terminal is a later milestone and a new ADR; it is not a
  drive-by in an M0–M3 PR.
