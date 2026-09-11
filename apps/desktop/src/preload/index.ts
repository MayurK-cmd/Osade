import { contextBridge, ipcRenderer } from 'electron';

/**
 * The contextBridge surface — OSADE.md §18.1.
 *
 * Deliberately tiny. The renderer talks to the daemon over tRPC + websocket on loopback; the
 * only things it needs from main are where the daemon is listening and the "open in herdr"
 * hint. Nothing here exposes Node, the filesystem, or herdr's sockets.
 */
contextBridge.exposeInMainWorld('osade', {
  daemonPort: (): Promise<number | null> => ipcRenderer.invoke('osade:daemon-port'),
  openInHerdr: (): Promise<{ command: string; hint: string }> =>
    ipcRenderer.invoke('osade:open-in-herdr'),

  /** The repository `osade .` opened on, or null when the window was opened on its own. */
  openedRepo: (): Promise<string | null> => ipcRenderer.invoke('osade:opened-repo'),

  /**
   * A second `osade .` in another repository re-scopes this window rather than opening another.
   * Returns an unsubscribe, because a renderer that leaks listeners across reloads leaks them
   * forever.
   */
  onRepoOpened: (handler: (path: string) => void): (() => void) => {
    const listener = (_event: unknown, path: string): void => handler(path);
    ipcRenderer.on('osade:repo-opened', listener);
    return () => ipcRenderer.removeListener('osade:repo-opened', listener);
  },
});
