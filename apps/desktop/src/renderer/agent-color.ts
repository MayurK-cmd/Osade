const PALETTE = ['claude', 'codex', 'opencode', 'pi'] as const;

export function agentColor(agentId: string): string {
  if ((PALETTE as readonly string[]).includes(agentId)) return `var(--ag-${agentId})`;
  const pick = PALETTE[hash(agentId) % PALETTE.length]!;
  return `var(--ag-${pick})`;
}

function hash(value: string): number {
  let n = 0;
  for (let i = 0; i < value.length; i++) n = (n * 31 + value.charCodeAt(i)) >>> 0;
  return n;
}
