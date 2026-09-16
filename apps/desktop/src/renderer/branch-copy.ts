export function heldReason(
  branch: string,
  holder: { title: string } | null | undefined,
): string | undefined {
  if (!holder) return undefined;
  return `${branch} is already checked out by “${holder.title}”`;
}

export function isolatedWorktreeHint(): string {
  return 'Isolated worktrees are disposable — close the lane and open one on the target branch.';
}
