# herdr: `events.subscribe` delivers a status change that happened before you subscribed

PRD-DELTA #5. A report rather than a patch — the behaviour may well be intended, but it is
indistinguishable from a real transition at the wire, and that is the part worth fixing.

## What Osade sees

Subscribe to `PaneAgentStatusChanged` with `agent_status: working` for a pane that is *already*
`working`, and the first thing that arrives is a `PaneAgentStatusChanged` event carrying that
status — for a transition that happened before the subscription existed.

## Where it comes from

Not the ring buffer, despite how it looks. `EventHub` is consistent with itself:

- `push` increments `next_sequence` and assigns it to the event, so `next_sequence` is the
  sequence of the **most recent** event, not the next one (`src/api/event_hub.rs:19-21`).
- `events_after(seq)` filters strictly `> seq` (`src/api/event_hub.rs:33-36`).
- A stream starts at `event_hub.current_sequence()` (`src/api/server.rs:697`).

So no already-buffered event is replayed. The event comes from `initial_event`
(`src/api/subscriptions.rs:209-223`): at subscribe time the pane is probed, and if its current
status matches the filter, an event is manufactured and queued for delivery.

## Why it matters to a client

A client cannot tell the primed event from a fresh transition. Osade drives task state off these
events, so a subscription established while an agent happens to be working reads as "the agent
just started working" — and on reconnect, as it starting again.

Osade defends against this on its own side, so this is not blocking: §5.4.1 gates every state
change on a monotonic `state_change_seq`, and a fact whose sequence is not newer than the one
already recorded is discarded. That gate exists partly because of this.

## What would help

Label it. An `initial: true` (or a distinct `SubscriptionEventKind`) on the primed event lets a
client use it for priming — which is genuinely useful — without mistaking it for a transition.
Suppressing it would also work, but is a worse trade: the current-state probe saves every client
from doing its own.

## Not compiled here

herdr needs Zig 0.15.2 for `libghostty-vt` and this machine has none, so this is a source
reading plus observed behaviour, not a tested change. No diff is offered because the right shape
is an API decision, not a mechanical fix.
