import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { binaryOnPath } from '../../src/domain/agent-catalog.js';

describe('binaryOnPath', () => {
  it('finds a file on PATH without shelling out to which', () => {
    const dir = join(tmpdir(), `osade-path-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    const name = process.platform === 'win32' ? 'fakeagent.CMD' : 'fakeagent';
    writeFileSync(join(dir, name), process.platform === 'win32' ? '@echo off\n' : '#!/bin/sh\n');
    expect(
      binaryOnPath('fakeagent', {
        PATH: dir,
        Path: dir,
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      }),
    ).toBe(true);
    expect(binaryOnPath('missing-agent-xyz', { PATH: dir, Path: dir })).toBe(false);
  });
});
