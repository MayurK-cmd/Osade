# herdr: a failed `worktree.remove` reports `workspace_not_found`, not what went wrong

PRD-DELTA #13a.3. A report rather than a patch: the ordering is defensible, the error reporting
is not, and only one of those is safe to change from the outside.

## What Osade sees

Tearing a task down on Windows, `worktree.remove` fails because something still holds the
checkout directory. The useful error — `Permission denied` from git — never reaches the caller.
The retry answers `workspace_not_found`, which sends you looking for a missing workspace instead
of a locked file.

## The ordering

`start_api_worktree_remove` shuts the workspace's terminal runtimes down **before** it builds the
git command (`src/app/api/worktrees/deferred.rs:312-331`):

1. `shutdown_workspace_terminal_runtimes_for_worktree_remove(ws_idx)` — panes go first
2. `build_worktree_remove_command(...)` — then `git worktree remove` is attempted
3. on failure, `restore_shutdown_worktree_panes(...)` puts them back
   (`src/app/api/worktrees/deferred.rs:~567`), and the response is `worktree_remove_failed`

So there *is* a restore path, and the original PRD-DELTA phrasing — "closes the workspace before
deleting the directory" — is too strong: the workspace is only closed after a successful remove
(`close_removed_linked_worktree_workspace`, `:551`). Corrected here.

What remains true is the reporting. Between the shutdown and the restore the workspace is
briefly inconsistent, and a caller retrying in that window addresses something that does not
answer — which is where `workspace_not_found` comes from. The underlying git failure is dropped
on the way out.

## What would help

Surface the cause. `worktree_remove_failed` should carry git's stderr, and a retry that arrives
mid-restore should say the operation is in progress — `worktree_operation_in_progress` already
exists for exactly this and is returned earlier in the same function
(`src/app/api/worktrees/deferred.rs:305`).

## What Osade does meanwhile

Teardown closes every pane but one, `cd ~`s the survivor out of the checkout, waits on `pane.get`
to confirm the cwd moved, then retries `worktree.remove` with backoff and reaps whatever is left
behind. That is in `packages/daemon/src/domain/launch-task.ts` and it works, but it is a client
compensating for an error it cannot read.

## Not compiled here

herdr needs Zig 0.15.2 for `libghostty-vt` and this machine has none. Source reading plus an
observed failure, not a tested change.
