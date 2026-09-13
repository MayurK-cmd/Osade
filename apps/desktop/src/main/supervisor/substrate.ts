import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import * as net from 'node:net';

/**
 * Locate, adopt or spawn the substrate server — OSADE.md §18.1.
 *
 * Osade runs the substrate on its own named session (`osade`) so it never collides with the user's own
 * (§2.2). Verified live: two sessions run concurrently with separate sockets, separate
 * `session.json`, and no interference.
 */

export const OSADE_SESSION = 'osade';

/**
 * The runtime's sockets, named by Osade and living under `~/.osade` with everything else (§2.2).
 *
 * The substrate takes `HERDR_SOCKET_PATH` and `HERDR_CLIENT_SOCKET_PATH` as overrides, so the
 * supervisor decides where they go rather than discovering them in a config directory belonging
 * to another program. Kept in step with `packages/daemon/src/substrate/socket-path.ts` — the
 * daemon connects to the same two paths, and the two processes do not share a package.
 */
function osadeRoot(): string {
  return resolve(process.env.OSADE_HOME ?? join(homedir(), '.osade'));
}

function runtimeDir(session: string): string {
  return join(osadeRoot(), 'runtime', session);
}

export function substrateSocketPath(session = OSADE_SESSION): string {
  return process.env.OSADE_SUBSTRATE_SOCKET ?? join(runtimeDir(session), 'osade.sock');
}

function clientSocketPath(session: string): string {
  return (
    process.env.OSADE_SUBSTRATE_CLIENT_SOCKET ?? join(runtimeDir(session), 'osade-client.sock')
  );
}

/**
 * The environment that puts the runtime's sockets where Osade expects them.
 *
 * These two variable names are the substrate's input contract, so they are spelled its way;
 * everything they point at is spelled ours. Kept in step with the daemon's copy.
 */
export function runtimeEnv(session = OSADE_SESSION): Record<string, string> {
  return {
    HERDR_SESSION: session,
    HERDR_SOCKET_PATH: substrateSocketPath(session),
    HERDR_CLIENT_SOCKET_PATH: clientSocketPath(session),
  };
}

/**
 * Rust target triples by Node platform and arch — the directory names under `vendor/runtime/`.
 * Kept in step with `packages/daemon/src/substrate/runtime-binary.ts`.
 */
const RUNTIME_TARGETS: Readonly<Record<string, string>> = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
};

/**
 * The runtime executable Osade ships, or the one on PATH.
 *
 * Packaged first, because a packaged app must not depend on the user having installed anything:
 * electron-builder puts the vendored runtime in `resources/runtime/<target>/`. Then the same
 * layout inside a checkout. `OSADE_SUBSTRATE_BIN` overrides both.
 *
 * Last, the bare name, for an install that put `osade-runtime` on PATH itself.
 */
export function substrateBinary(): string {
  const explicit = process.env.OSADE_SUBSTRATE_BIN;
  if (explicit && existsSync(explicit)) return explicit;

  const exe = platform() === 'win32' ? 'osade-runtime.exe' : 'osade-runtime';
  const target = RUNTIME_TARGETS[`${process.platform}-${process.arch}`] ?? '';

  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    resources ? join(resources, 'runtime', target, exe) : undefined,
    resources ? join(resources, 'runtime', exe) : undefined,
    join(__dirname, '../../../../..', 'vendor', 'runtime', RUNTIME_PIN, target, exe),
  ].filter((path): path is string => path !== undefined);

  const found = candidates.find((path) => existsSync(path));
  return found ?? exe;
}

/** The vendored runtime directory, kept in step with `vendor/runtime/`. */
const RUNTIME_PIN = '0.8.2-p20';

function connectTarget(socketPath: string): string {
  return platform() === 'win32' ? `\\\\.\\pipe\\${socketPath}` : socketPath;
}

/**
 * A `ping` round trip.
 *
 * On Windows the `.sock` path exists on disk as a marker file even with no server listening,
 * so file existence proves nothing and this is the only real liveness check.
 */
export function ping(socketPath: string, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(connectTarget(socketPath));
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ id: 'osade:ping', method: 'ping', params: {} })}\n`),
    );
    socket.on('data', (chunk: Buffer) => finish(chunk.toString().includes('"pong"')));
    socket.on('error', () => finish(false));
    socket.on('end', () => finish(false));
  });
}

export interface SubstrateSupervisorOptions {
  binary?: string;
  session?: string;
  onInfo?: (message: string) => void;
}

/**
 * Adopts a running substrate server, or spawns one detached.
 *
 * The spawn copies the substrate's own recipe (`backend/src/server/autodetect.rs:188-233`): null
 * stdio, and detached from this process. Without that the server dies with the app, and
 * "agents survive the window closing" quietly stops being true.
 *
 * `HERDR_STARTUP_CWD` is removed deliberately: when it is set and the session has no
 * workspaces, the substrate creates one at that cwd on boot and Osade inherits a stray workspace it
 * never asked for.
 */
export async function adoptOrSpawnSubstrate(options: SubstrateSupervisorOptions = {}): Promise<{
  socketPath: string;
  spawned: boolean;
}> {
  const session = options.session ?? OSADE_SESSION;
  const socketPath = substrateSocketPath(session);
  const onInfo = options.onInfo ?? (() => {});

  if (await ping(socketPath)) {
    onInfo(`adopted the running substrate server on session "${session}"`);
    return { socketPath, spawned: false };
  }

  const env: NodeJS.ProcessEnv = { ...process.env, ...runtimeEnv(session) };
  delete env.HERDR_STARTUP_CWD;

  const child = spawn(options.binary ?? substrateBinary(), ['server'], {
    env,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  // Let it outlive us. Agents must survive the app quitting (§18.1).
  child.unref();

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await ping(socketPath, 1_000)) {
      onInfo(`spawned a detached substrate server on session "${session}"`);
      return { socketPath, spawned: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `the substrate did not start within 20s on session "${session}" (socket ${socketPath}).\n` +
      `Tried ${options.binary ?? substrateBinary()}.`,
  );
}
