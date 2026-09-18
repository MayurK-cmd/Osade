import { useEffect, useRef, type JSX } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { api } from './api.js';

/** Interactive PowerShell (or $SHELL) PTY in this lane's checkout. */
export function LaneTerminal({ taskId }: { taskId: string }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: '"IBM Plex Mono", ui-monospace, "Cascadia Code", Consolas, monospace',
      fontSize: 12.5,
      theme: {
        background: '#0f1214',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#22272e',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const fitNow = (): void => {
      try {
        fit.fit();
      } catch {
        // host not measured yet
      }
    };
    fitNow();
    const size = {
      cols: Math.max(term.cols, 80),
      rows: Math.max(term.rows, 24),
    };

    let stop = false;
    let data: { dispose: () => void } | null = null;
    let resized: { dispose: () => void } | null = null;
    void api
      .taskShellOpen(taskId, size)
      .then(() => {
        if (stop) return;
        data = term.onData((chunk) => {
          void api.taskShellWrite(taskId, chunk).catch((err: Error) => {
            term.write(`\r\n\x1b[31m${err.message}\x1b[0m\r\n`);
          });
        });
        resized = term.onResize(({ cols, rows }) => {
          if (cols >= 2 && rows >= 2) void api.taskShellResize(taskId, cols, rows);
        });
      })
      .catch((err: Error) => {
        if (!stop) term.writeln(`\x1b[31m${err.message}\x1b[0m`);
      });

    const timer = window.setInterval(() => {
      void api.taskShellRead(taskId).then((chunk) => {
        if (chunk.text.length > 0) term.write(chunk.text);
      });
    }, 16);

    const ro = new ResizeObserver(() => {
      fitNow();
    });
    ro.observe(el);

    return () => {
      stop = true;
      data?.dispose();
      resized?.dispose();
      window.clearInterval(timer);
      ro.disconnect();
      term.dispose();
    };
  }, [taskId]);

  return (
    <div
      ref={host}
      style={{
        height: '100%',
        width: '100%',
        minHeight: 0,
        background: '#0f1214',
      }}
    />
  );
}
