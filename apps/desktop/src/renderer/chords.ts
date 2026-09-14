export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
}

/** Visible chord labels. Unicode arrows vanish in Plex on Windows. */
export function chord(key: 'k' | 'n' | 'enter' | 'backspace'): string {
  if (isMac()) {
    if (key === 'k') return '⌘K';
    if (key === 'n') return '⌘N';
    if (key === 'enter') return '⌘↵';
    return '⌘⌫';
  }
  if (key === 'k') return 'Ctrl+K';
  if (key === 'n') return 'Ctrl+N';
  if (key === 'enter') return 'Ctrl+Enter';
  return 'Ctrl+Backspace';
}
