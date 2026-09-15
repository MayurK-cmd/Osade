import { useEffect, useState, type JSX } from 'react';

import type { VerifyRun } from '@osade/contract';

import { agentColor } from './agent-color.js';
import { api } from './api.js';
import { BranchControl } from './BranchControl.js';
import { Changes } from './Changes.js';
import { Composer } from './Composer.js';
import { Conventions } from './Conventions.js';
import { Files } from './Files.js';
import { GateCard } from './GateCard.js';
import { chatLabel, type ChatGroup } from './lanes.js';
import type { CatalogAgent } from './RepoSettings.js';
import { GLYPH, STATUS, TONE_COLOUR, ago, statusCopyFor } from './status.js';
import { Transcript } from './Transcript.js';
import { VerifyPlanReview } from './VerifyPlanReview.js';

export type Lane = 'transcript' | 'files' | 'checks' | 'diff' | 'rules';

const PANES: { id: Lane; label: string; chord: string }[] = [
  { id: 'transcript', label: 'Chat', chord: '1' },
  { id: 'files', label: 'Files', chord: '2' },
  { id: 'checks', label: 'Checks', chord: '3' },
  { id: 'diff', label: 'Diff', chord: '4' },
  { id: 'rules', label: 'Rules', chord: '5' },
];

export function Detail({
  chat,
  focusId,
  onFocus,
  lane,
  onLane,
  catalog,
  optimistic,
  isolatedNotice,
  onSend,
  onNewIsolatedChat,
}: {
  chat: ChatGroup;
  focusId: string;
  onFocus: (taskId: string) => void;
  lane: Lane;
  onLane: (lane: Lane) => void;
  catalog: CatalogAgent[];
  optimistic?: string;
  isolatedNotice?: string;
  onSend: (text: string) => Promise<void>;
  onNewIsolatedChat: () => void;
}): JSX.Element {
  const [filter, setFilter] = useState<string | null>(null);
  const [modHeld, setModHeld] = useState(false);
  const [branchOfferDismissed, setBranchOfferDismissed] = useState(false);
  const focused = chat.lanes.find((t) => t.task.id === focusId) ?? chat.lanes[0]!;
  const copy = statusCopyFor(chat.status, focused.agent?.external_block);
  const colour = TONE_COLOUR[copy.tone];
  const openGates = chat.lanes.flatMap((t) =>
    t.openGates.filter((g) => g.decided_at == null).map((gate) => ({ gate, task: t })),
  );
  const failingChecks = focused.latestVerifyRuns.filter(
    (run) => run.finished_at != null && run.exit_code !== 0,
  ).length;
  const showBranchOffer =
    focused.attachment === 'repo' && focused.status === 'implementing' && !branchOfferDismissed;

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      setModHeld(event.metaKey || event.ctrlKey);
    }
    function onUp(event: KeyboardEvent): void {
      if (!event.metaKey && !event.ctrlKey) setModHeld(false);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', () => setModHeld(false));
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  async function handleSend(text: string): Promise<void> {
    const match = text.match(/^\/branch(?:\s+(.*))?$/iu);
    if (match) {
      const name = match[1]?.trim();
      await api.taskBranchOut({
        taskId: focused.task.id,
        branch: name || undefined,
        carryChanges: true,
      });
      return;
    }
    await onSend(text);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-0)',
      }}
    >
      <header style={{ padding: '14px 16px 12px', borderBottom: '0.5px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <h1
            style={{
              fontSize: 'var(--t-l)',
              fontWeight: 600,
              lineHeight: 1.3,
              margin: 0,
              flex: 1,
              minWidth: 0,
            }}
          >
            {chatLabel(chat)}
          </h1>
          <span
            style={{
              flexShrink: 0,
              fontSize: 'var(--t-xs)',
              color: colour,
              border: '0.5px solid var(--line)',
              background: 'var(--bg-2)',
              borderRadius: 'var(--radius)',
              padding: '2px 8px',
            }}
          >
            {copy.label}
          </span>
          <BranchControl task={focused} onNewIsolatedChat={onNewIsolatedChat} />
        </div>
        <LaneStrip chat={chat} focusId={focused.task.id} onFocus={onFocus} />
      </header>

      {openGates.length > 0 ? (
        <section
          style={{
            background: 'var(--bg-1)',
            borderBottom: '0.5px solid var(--line)',
            borderLeft: '2px solid var(--st-needs)',
            padding: '12px 16px',
          }}
        >
          {openGates.map(({ gate, task }) => (
            <div key={gate.id}>
              <p className="mono" style={{ margin: '0 0 6px', fontSize: 'var(--t-xs)', color: agentColor(task.agentId) }}>
                {task.agentId} · {task.task.branch}
              </p>
              <GateCard gate={gate} task={task} onDecided={() => {}} />
            </div>
          ))}
        </section>
      ) : (
        copy.next && (
          <section
            style={{
              padding: '10px 16px',
              borderBottom: '0.5px solid var(--line)',
              color: 'var(--ink-2)',
              fontSize: 'var(--t-s)',
            }}
          >
            {copy.next}
            {chat.status === 'blocked_external' && focused.agent?.external_block
              ? ` ${focused.agent.external_block}`
              : ''}
          </section>
        )
      )}

      {showBranchOffer && (
        <section
          style={{
            padding: '10px 16px',
            borderBottom: '0.5px solid var(--line)',
            background: 'var(--bg-1)',
            fontSize: 'var(--t-s)',
          }}
        >
          <p style={{ margin: '0 0 8px' }}>
            This chat is on your real checkout. Branch out before the agent writes, or it will
            edit files in place.
          </p>
          <button
            className="primary"
            onClick={() => {
              void api
                .taskBranchOut({ taskId: focused.task.id, carryChanges: true })
                .then(() => setBranchOfferDismissed(true))
                .catch(() => setBranchOfferDismissed(true));
            }}
          >
            Work on a branch
          </button>
          <button onClick={() => setBranchOfferDismissed(true)} style={{ marginLeft: 8 }}>
            Keep working here
          </button>
        </section>
      )}

      <nav
        style={{
          display: 'flex',
          gap: 2,
          padding: '8px 12px 0',
          borderBottom: '0.5px solid var(--line)',
        }}
      >
        {PANES.map((item) => {
          const selected = lane === item.id;
          const count =
            item.id === 'transcript'
              ? openGates.length
              : item.id === 'checks'
                ? failingChecks
                : 0;
          return (
            <button
              key={item.id}
              data-lane={item.id}
              onClick={() => onLane(item.id)}
              style={{
                background: selected ? 'var(--bg-2)' : 'transparent',
                border: '0.5px solid',
                borderColor: selected ? 'var(--line)' : 'transparent',
                borderBottom: selected ? '0.5px solid var(--bg-2)' : '0.5px solid transparent',
                borderRadius: 'var(--radius) var(--radius) 0 0',
                marginBottom: -1,
                color: selected ? 'var(--ink)' : 'var(--ink-2)',
              }}
            >
              {item.label}
              {count > 0 ? (
                <span style={{ marginLeft: 6, color: 'var(--st-fail)', fontSize: 'var(--t-xs)' }}>
                  {count}
                </span>
              ) : (
                modHeld && (
                  <kbd style={{ marginLeft: 6, border: 'none', padding: 0, color: 'var(--ink-3)' }}>
                    ⌘{item.chord}
                  </kbd>
                )
              )}
            </button>
          );
        })}
      </nav>

      <div
        data-chat-scroll={lane === 'transcript' ? '' : undefined}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: lane === 'files' || lane === 'diff' ? 'hidden' : 'auto',
          padding: lane === 'files' || lane === 'diff' ? 0 : '14px 16px',
        }}
      >
        {lane === 'transcript' && (
          <>
            {chat.lanes.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                <FilterChip label="All" active={filter == null} onClick={() => setFilter(null)} />
                {chat.lanes.map((task) => (
                  <FilterChip
                    key={task.task.id}
                    label={task.agentId}
                    color={agentColor(task.agentId)}
                    active={filter === task.agentId}
                    onClick={() => setFilter(task.agentId)}
                  />
                ))}
              </div>
            )}
            <Transcript
              tasks={filter ? chat.lanes.filter((t) => t.agentId === filter) : chat.lanes}
              extraUser={optimistic}
              followTaskId={focused.task.id}
              isolatedNotice={isolatedNotice}
            />
          </>
        )}
        {lane === 'files' && <Files key={focused.task.id} task={focused} />}
        {lane === 'checks' && (
          <>
            <VerifyPlanReview taskId={focused.task.id} />
            <VerifyRuns runs={focused.latestVerifyRuns} />
          </>
        )}
        {lane === 'diff' && <Changes key={focused.task.id} task={focused} lanes={chat.lanes} />}
        {lane === 'rules' && <Conventions repoId={focused.task.repo_id} />}
      </div>

      <Composer
        key={chat.chatId}
        autoFocus={lane === 'transcript'}
        catalog={catalog}
        held={
          focused.status === 'implementing' ||
          focused.status === 'verifying' ||
          focused.status === 'queued'
        }
        placeholder="Message. Enter to send, Shift+Enter for a new line. @name to pick a lane."
        onSend={handleSend}
      />
    </div>
  );
}

function LaneStrip({
  chat,
  focusId,
  onFocus,
}: {
  chat: ChatGroup;
  focusId: string;
  onFocus: (id: string) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
      {chat.lanes.map((task) => {
        const copy = STATUS[task.status];
        const selected = task.task.id === focusId;
        const colour = agentColor(task.agentId);
        return (
          <button
            key={task.task.id}
            onClick={() => onFocus(task.task.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 8px',
              border: '0.5px solid',
              borderColor: selected ? colour : 'var(--line)',
              background: selected ? 'var(--bg-2)' : 'var(--bg-1)',
              color: colour,
              fontSize: 'var(--t-xs)',
            }}
          >
            <span style={{ color: TONE_COLOUR[copy.tone] }}>{GLYPH[copy.tone]}</span>
            <span>{task.agentId}</span>
            <span className="mono" style={{ color: 'var(--ink-3)' }}>
              {task.task.branch}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FilterChip({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '2px 8px',
        fontSize: 'var(--t-xs)',
        border: '0.5px solid',
        borderColor: active ? (color ?? 'var(--line)') : 'var(--line)',
        color: color ?? 'var(--ink-2)',
        background: active ? 'var(--bg-2)' : 'transparent',
      }}
    >
      {label}
    </button>
  );
}

export function DraftPane({
  optimistic,
  submitting,
  catalog,
  onSend,
}: {
  optimistic?: string;
  submitting: boolean;
  catalog: CatalogAgent[];
  onSend: (text: string) => Promise<void>;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--bg-0)',
      }}
    >
      <header style={{ padding: '14px 16px 12px', borderBottom: '0.5px solid var(--line)' }}>
        <h1 style={{ fontSize: 'var(--t-l)', fontWeight: 600, margin: 0 }}>New chat</h1>
        <p style={{ margin: '6px 0 0', color: 'var(--ink-2)', fontSize: 'var(--t-s)' }}>
          A new chat uses this checkout. Branch out when you want a worktree. @mention an agent
          on its own line to pick a lane.
        </p>
      </header>
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
        <Transcript tasks={[]} extraUser={optimistic} />
      </div>
      <Composer
        autoFocus
        disabled={submitting}
        catalog={catalog}
        placeholder="What are we working on?"
        onSend={onSend}
      />
    </div>
  );
}

function VerifyRuns({ runs }: { runs: VerifyRun[] }): JSX.Element | null {
  if (runs.length === 0) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 'var(--t-s)', fontWeight: 600 }}>Latest runs</h2>
      {runs.map((run) => (
        <div
          key={run.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 8,
            padding: '6px 0',
            borderBottom: '0.5px solid var(--line)',
            fontSize: 'var(--t-s)',
          }}
        >
          <code className="mono" style={{ fontSize: 'var(--t-xs)' }}>
            {run.cmd}
          </code>
          <span className="mono" style={{ color: 'var(--ink-2)', fontSize: 'var(--t-xs)' }}>
            {run.exit_code == null
              ? 'Running'
              : run.exit_code === 0
                ? 'Passed'
                : `Exit ${run.exit_code}`}
            {run.finished_at ? ` · ${ago(run.finished_at)}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}
