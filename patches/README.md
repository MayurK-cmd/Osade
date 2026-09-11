# patches/

Changes Osade wants in herdr.

`backend/` is read-only — Osade never edits it, because a local edit is a fork nobody agreed to
and drift that shows up months later as a mystery. Anything herdr needs to do differently is
written down here instead, with enough evidence that a herdr maintainer can judge it without
having Osade in front of them.

## What is here

| File | Kind | Subject |
| --- | --- | --- |
| `0001-windows-agent-launch-via-call-operator.patch` | patch | `Start-Process` cannot execute an npm shim, so agents fail to launch on Windows |
| `0002-events-subscribe-primes-with-a-past-transition.md` | report | a subscription's first event can describe a change that predates it |
| `0003-worktree-remove-hides-the-real-error.md` | report | a failed remove reports `workspace_not_found` instead of git's error |

## Patch or report

A **patch** when the change is small, self-contained, and readable to a certainty — 0001 removes
a branch and updates the one test that pinned it.

A **report** when the right fix is a judgement call. 0002 is an API decision (label the primed
event, or drop it), and 0003 is about which error a caller should see. Guessing at either and
shipping a diff would waste a maintainer's time arguing with a stranger's assumption instead of
reading a description of the problem.

## Patches target herdr's master, not `backend/`

`backend/`'s `src/platform/windows.rs` matches no commit in herdr's public history (ADR 0002), so
a diff generated against it does not apply upstream. That is not hypothetical: the first version
of 0001 was written from `backend/` and failed `git apply --check` against master. It was
regenerated against master and verified there.

Read `backend/` to understand the behaviour. Generate the diff against the file you are actually
asking someone to change:

```bash
curl -sSL https://raw.githubusercontent.com/herdrdev/herdr/master/src/platform/windows.rs -o /tmp/upstream.rs
# edit a copy, diff the two, then check it applies to a clean copy of the same file
```

## None of this is compiled

herdr requires **Zig 0.15.2** for `libghostty-vt`, which this machine does not have, so nothing
here has been through `cargo test`. 0001 was verified by reading and by `git apply --check`
against herdr's master; the test it updates should be run before the patch is taken:

```bash
cargo test -p herdr platform::windows
```

Treat these as well-evidenced proposals, not as verified changes.

## Each one has a workaround already

Osade does not wait on any of this. Every item names what Osade does in the meantime, which is
also the honest measure of how much the change is worth: 0001 costs Windows users their agent
mode flags, 0002 is fully absorbed by §5.4.1's monotonic gate, and 0003 costs a retry loop.
