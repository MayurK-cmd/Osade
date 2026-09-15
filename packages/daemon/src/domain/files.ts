import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { git } from './git.js';

/**
 * On-demand file tree for a chat's cwd — attached checkout or isolated worktree.
 *
 * The renderer has no filesystem access (§18.1). Paths are always relative to the task cwd
 * and rejected if they climb out of it.
 */

const SKIP = new Set(['.git', 'node_modules', 'dist', '.next', 'target', '__pycache__', '.osade']);
const MAX_READ = 256 * 1024;

export type FileFlag = 'M' | 'A' | 'D' | '?';

export interface FileChange {
  flag: FileFlag;
  insertions: number;
  deletions: number;
}

export interface FsEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  flag: FileFlag | null;
  insertions: number;
  deletions: number;
}

export function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

export function safeResolve(cwd: string, relativePath: string): string {
  const cleaned = toPosix(relativePath).replace(/^\/+/u, '');
  if (cleaned.split('/').includes('..')) {
    throw new Error('path escapes the chat folder');
  }
  const root = resolve(cwd);
  const resolved = cleaned.length === 0 ? root : resolve(root, cleaned.split('/').join(sep));
  const rel = toPosix(relative(root, resolved));
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path escapes the chat folder');
  }
  return resolved;
}

export function parsePorcelain(text: string): Map<string, FileFlag> {
  const out = new Map<string, FileFlag>();
  for (const line of text.split('\n')) {
    if (line.length < 4) continue;
    const xy = line.slice(0, 2);
    let rest = line.slice(3);
    if (xy.includes('R') || xy.includes('C')) {
      const sepAt = rest.lastIndexOf(' -> ');
      if (sepAt >= 0) rest = rest.slice(sepAt + 4);
    }
    if (rest.startsWith('"') && rest.endsWith('"')) {
      rest = rest.slice(1, -1).replace(/\\n/gu, '\n').replace(/\\"/gu, '"');
    }
    out.set(toPosix(rest), flagFromXy(xy));
  }
  return out;
}

export function parseNumstat(text: string): Map<string, { insertions: number; deletions: number }> {
  const out = new Map<string, { insertions: number; deletions: number }>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const insertions = parts[0] === '-' ? 0 : Number(parts[0]) || 0;
    const deletions = parts[1] === '-' ? 0 : Number(parts[1]) || 0;
    out.set(toPosix(parts.slice(2).join('\t')), { insertions, deletions });
  }
  return out;
}

export function mergeChanges(
  porcelain: Map<string, FileFlag>,
  numstat: Map<string, { insertions: number; deletions: number }>,
): Map<string, FileChange> {
  const out = new Map<string, FileChange>();
  const paths = new Set([...porcelain.keys(), ...numstat.keys()]);
  for (const path of paths) {
    const stats = numstat.get(path) ?? { insertions: 0, deletions: 0 };
    const flag = porcelain.get(path) ?? 'M';
    out.set(path, { flag, insertions: stats.insertions, deletions: stats.deletions });
  }
  return out;
}

export async function fileChanges(cwd: string, baseSha: string): Promise<Map<string, FileChange>> {
  const [porcelain, numstat] = await Promise.all([
    git(cwd, ['status', '--porcelain', '--untracked-files=all']).catch(() => ''),
    git(cwd, ['diff', '--numstat', baseSha]).catch(() => ''),
  ]);
  return mergeChanges(parsePorcelain(porcelain), parseNumstat(numstat));
}

export function listDir(cwd: string, dir: string, changes: Map<string, FileChange>): FsEntry[] {
  const abs = safeResolve(cwd, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  const prefix = dir.length === 0 ? '' : `${toPosix(dir).replace(/\/$/u, '')}/`;
  const names = readdirSync(abs, { withFileTypes: true }).filter((entry) => !SKIP.has(entry.name));
  const entries = names.map((entry): FsEntry => {
    const path = `${prefix}${entry.name}`;
    const kind = entry.isDirectory() ? 'dir' : 'file';
    const overlay = overlayFor(path, kind, changes);
    return { name: entry.name, path, kind, ...overlay };
  });
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

export function readFile(cwd: string, relativePath: string): {
  path: string;
  text: string | null;
  binary: boolean;
  truncated: boolean;
} {
  const abs = safeResolve(cwd, relativePath);
  const info = statSync(abs);
  if (info.isDirectory()) throw new Error('that path is a folder');
  const buf = readFileSync(abs);
  const truncated = buf.length > MAX_READ;
  const slice = truncated ? buf.subarray(0, MAX_READ) : buf;
  if (slice.includes(0)) {
    return { path: toPosix(relativePath), text: null, binary: true, truncated };
  }
  return {
    path: toPosix(relativePath),
    text: slice.toString('utf8'),
    binary: false,
    truncated,
  };
}

function overlayFor(
  path: string,
  kind: 'dir' | 'file',
  changes: Map<string, FileChange>,
): { flag: FileFlag | null; insertions: number; deletions: number } {
  if (kind === 'file') {
    const hit = changes.get(path);
    return hit
      ? { flag: hit.flag, insertions: hit.insertions, deletions: hit.deletions }
      : { flag: null, insertions: 0, deletions: 0 };
  }
  const prefix = `${path}/`;
  let insertions = 0;
  let deletions = 0;
  let flag: FileFlag | null = null;
  for (const [changed, hit] of changes) {
    if (changed !== path && !changed.startsWith(prefix)) continue;
    insertions += hit.insertions;
    deletions += hit.deletions;
    flag = strongerFlag(flag, hit.flag);
  }
  return { flag, insertions, deletions };
}

function flagFromXy(xy: string): FileFlag {
  if (xy === '??') return '?';
  if (xy.includes('D')) return 'D';
  if (xy.includes('A')) return 'A';
  return 'M';
}

function strongerFlag(current: FileFlag | null, next: FileFlag): FileFlag {
  if (current === 'D' || next === 'D') return 'D';
  if (current === 'A' || next === 'A' || current === '?' || next === '?') {
    return current === 'A' || next === 'A' ? 'A' : '?';
  }
  return 'M';
}
