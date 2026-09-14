import { contextBridge, ipcRenderer } from 'electron';

/**
 * The contextBridge surface — OSADE.md §18.1.
 *
 * Deliberately tiny. The renderer talks to the daemon over tRPC + websocket on loopback; the
 * only things it needs from main are where the daemon is listening, the "open in the substrate"
 * hint, and the operating system's folder picker. Nothing here exposes Node, the filesystem, or
 * the substrate's sockets — the picker hands back a path the person chose, and nothing more.
 */
contextBridge.exposeInMainWorld('osade', {
  daemonPort: (): Promise<number | null> => ipcRenderer.invoke('osade:daemon-port'),
  openInSubstrate: (): Promise<{ command: string; hint: string }> =>
    ipcRenderer.invoke('osade:open-in-substrate'),

  /** The repository `osade .` opened on, or null when the window was opened on its own. */
  openedRepo: (): Promise<string | null> => ipcRenderer.invoke('osade:opened-repo'),

  /**
   * The operating system's folder picker, for choosing a repository. Resolves to the chosen
   * folder, or null when the picker was dismissed.
   */
  chooseRepository: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('osade:choose-repository', defaultPath),

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
