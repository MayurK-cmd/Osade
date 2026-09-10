import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type { ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * OSADE.md §2.2 — INVARIANT: state containment.
 *
 * `app.setPath('userData', ...)` runs **before anything else touches disk** and before
 * `app.whenReady()`. No `~/Library/Application Support`, no `%APPDATA%`, ever: the whole
 * system must be resettable with `rm -rf ~/.osade`.
 *
 * This is the first executable statement in the app for that reason. Do not move it.
 */
// `resolve`, not the raw value: Electron's setPath rejects a relative path with a bare
// "Path must be absolute" thrown before any of this file's logging exists, which is a hard
// thing to diagnose from the outside. A relative OSADE_HOME is a reasonable thing to type.
const OSADE_ROOT = resolve(process.env.OSADE_HOME ?? join(homedir(), '.osade'));
app.setPath('userData', join(OSADE_ROOT, 'electron'));
app.setPath('sessionData', join(OSADE_ROOT, 'electron', 'session'));

import { adoptOrSpawnDaemon } from './supervisor/daemon.js';
import { adoptOrSpawnHerdr } from './supervisor/herdr.js';

const isDev = !app.isPackaged;

let window: BrowserWindow | null = null;
let daemonPort: number | null = null;
/** Non-null only when *this* process started the daemon. §18.1 — an adopted one is not ours. */
let spawnedDaemon: ChildProcess | null = null;

/**
 * Startup order, and it matters (§18.1):
 *   1. userData redirect (above, before this runs)
 *   2. boot drift check — owned by the daemon, which refuses to start on a mismatch
 *   3. adopt-or-spawn herdr on the `osade` session; wait for ping
 *   4. spawn the daemon; wait for its ready handshake, never a fixed sleep
 *   5. create the window
 *
 * There is no surface port in M0: the embedded terminal is deferred (§4.4, ADR 0001).
 */
async function boot(): Promise<void> {
  await adoptOrSpawnHerdr({ onInfo: (m) => console.log(`[herdr] ${m}`) });

  const daemonEntry = join(__dirname, '../../../..', 'packages/daemon/src/cli.ts');
  const daemon = await adoptOrSpawnDaemon({
    entry: process.env.OSADE_DAEMON_ENTRY ?? daemonEntry,
    onInfo: (m) => console.log(`[daemon] ${m}`),
  });
  daemonPort = daemon.port;
  spawnedDaemon = daemon.child;

  createWindow();
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    // §19.2 — light-first, --paper. Set here too so the frame does not flash white-then-dark.
    backgroundColor: '#F6F7F4',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // External links open in the user's browser, never inside the app frame.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const rendererUrl = process.env.OSADE_RENDERER_URL;
  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  if (isDev && !smokeShotPath()) window.webContents.openDevTools({ mode: 'detach' });
  window.on('closed', () => {
    window = null;
  });

  void runSmokeShot(window);
}

/** Where a smoke run should write its screenshot, if this is one. */
function smokeShotPath(): string | undefined {
  return process.env.OSADE_SMOKE_SHOT;
}

/**
 * Boot, photograph the window, quit.
 *
 * The renderer is the one part of Osade a test suite cannot see: everything else is asserted by
 * `pnpm check`, while the window is only ever verified by a human looking at it. This makes
 * "does it actually render against a live daemon" a command that leaves evidence behind, which
 * is the difference between the app being checked occasionally and being checked at all.
 *
 * Off unless `OSADE_SMOKE_SHOT` names a file. It is a capture, not a mode — nothing about the
 * boot sequence changes, so what it photographs is the real thing.
 */
async function runSmokeShot(target: BrowserWindow): Promise<void> {
  const path = smokeShotPath();
  if (!path) return;

  const failures: string[] = [];
  target.webContents.on('console-message', (_event, level, message) => {
    // Errors only. A renderer that logged a warning still rendered.
    if (level >= 2) failures.push(message);
  });
  target.webContents.on('render-process-gone', (_event, details) =>
    failures.push(`render process gone: ${details.reason}`),
  );

  try {
    await new Promise<void>((resolve, reject) => {
      target.webContents.once('did-finish-load', () => resolve());
      target.webContents.once('did-fail-load', (_event, code, description) =>
        reject(new Error(`the renderer failed to load: ${description} (${code})`)),
      );
    });

    // A moment past load, so React has mounted rather than being caught mid-paint.
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    // An occluded or unpainted window captures as an *empty* image rather than failing, so a
    // zero-byte PNG would otherwise be written and reported as a pass. Bring the window forward,
    // stop Chromium throttling it, and retry until there are actual pixels.
    target.webContents.setBackgroundThrottling(false);
    target.show();
    target.focus();

    let png = new Uint8Array(0);
    for (let attempt = 0; attempt < 10 && png.length === 0; attempt += 1) {
      png = new Uint8Array((await target.webContents.capturePage()).toPNG());
      if (png.length === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (png.length === 0) throw new Error('captured an empty image: the window never painted');

    writeFileSync(path, png);
    console.log(`[smoke] wrote ${path} (${png.length} bytes)`);

    for (const failure of failures) console.error(`[smoke] renderer error: ${failure}`);
    if (failures.length > 0) process.exitCode = 1;
  } catch (err) {
    console.error(`[smoke] ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    // §18.1 says shutdown detaches and the daemon outlives the window — which is right for a
    // person, and wrong for a harness that would otherwise leave a daemon behind on every run.
    // Only ever the one this process started; an adopted daemon belongs to someone else.
    if (spawnedDaemon?.pid) {
      try {
        process.kill(spawnedDaemon.pid);
        console.log('[smoke] stopped the daemon this run started');
      } catch {
        // Already gone. Nothing to do, and nothing worth saying.
      }
    }
    app.quit();
  }
}

ipcMain.handle('osade:daemon-port', () => daemonPort);

/**
 * §4.4 — "Open in herdr" replaces the embedded terminal in M0. A real herdr client, full
 * fidelity, real input, and no bincode decoder to maintain.
 *
 * Note the consequence recorded in §4.4: attaching a client marks panes seen, so herdr flips
 * `done` to `idle` for that tab. That is safe only because `idle` is inert in the event
 * mapping (§6.1) — the task keeps its `awaiting_review`.
 */
ipcMain.handle('osade:open-in-herdr', async () => {
  const command =
    process.platform === 'win32'
      ? 'start'
      : process.platform === 'darwin'
        ? 'open'
        : 'x-terminal-emulator';
  // Best effort: we cannot know which terminal the user prefers, so hand them the command.
  return { command, hint: 'herdr session attach osade' };
});

app.whenReady().then(
  () => {
    void boot().catch((err: Error) => {
      console.error(`osade failed to start: ${err.message}`);
      app.quit();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && daemonPort != null) createWindow();
    });
  },
  (err: Error) => {
    console.error(`electron failed to become ready: ${err.message}`);
  },
);

/**
 * §18.1 — **shutdown detaches. It does not stop herdr and does not stop the daemon.**
 * Agents keep running. "Stop everything" is an explicit menu item, not a side effect of
 * closing a window.
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
