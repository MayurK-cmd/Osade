import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';

import type { TaskView } from '@osade/contract';

import { agentColor } from './agent-color.js';
import { CommandPalette } from './CommandPalette.js';
import { Detail, DraftPane, type Lane } from './Detail.js';
import { api } from './api.js';
import { chord } from './chords.js';
import { groupChats, laneDigest, primaryLane, withDigest, type ChatGroup } from './lanes.js';
import { composeLanePrompt, parseMentions } from './mentions.js';
import { RepoSettings, useAgentCatalog } from './RepoSettings.js';
import { GLYPH, STATUS, TONE_COLOUR, summarise } from './status.js';
import { useLedger } from './useLedger.js';
import { useRepo, type OpenRepo } from './useRepo.js';

const LANES: Lane[] = ['transcript', 'checks', 'diff', 'rules'];
const COLLAPSE_KEY = 'osade.repo-collapsed';
const NAMES_KEY = 'osade.repo-names';

type Tab =
  | {
      kind: 'draft';
      id: string;
      repoId: string | null;
      repoPath: string | null;
      defaultBranch: string | null;
      optimistic?: string;
      submitting?: boolean;
    }
  | { kind: 'chat'; id: string; focusId?: string; optimistic?: string };

export function App(): JSX.Element {
  const { tasks: allTasks, connection, error } = useLedger();
  const { repo, error: repoError } = useRepo();
  const catalog = useAgentCatalog();
  const [agentOverride, setAgentOverride] = useState<string | null>(null);
  const [repoPaths, setRepoPaths] = useState<Record<string, string>>({});
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lane, setLane] = useState<Lane>('transcript');
  const [palette, setPalette] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());
  const [aliases, setAliases] = useState<Record<string, string>>(() => loadAliases());
  const [renaming, setRenaming] = useState<string | null>(null);

  const defaultAgent = agentOverride ?? repo?.defaultAgent ?? null;
  const scoped = repo ? allTasks.filter((t) => t.task.repo_id === repo.repoId) : allTasks;
  const chats = scoped.filter((t) => t.status !== 'archived');
  const groups = useMemo(() => groupChats(chats), [chats]);
  const needsYou = groups.filter((g) => g.needsYou);
  const working = chats.filter((t) => t.status === 'implementing' || t.status === 'verifying');

  const byRepo = useMemo(() => groupByRepo(chats), [chats]);
  const flat = useMemo(() => byRepo.flatMap((g) => g.chats), [byRepo]);

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  const selectedChat =
    activeTab?.kind === 'chat' ? (groups.find((g) => g.chatId === activeTab.id) ?? null) : null;
  const selected =
    selectedChat == null || activeTab?.kind !== 'chat'
      ? null
      : (selectedChat.lanes.find((l) => l.task.id === activeTab.focusId) ??
        primaryLane(selectedChat));

  useEffect(() => {
    if (repo) {
      setRepoPaths((current) => ({ ...current, [repo.repoId]: repo.path }));
      setAgentOverride(null);
    }
  }, [repo]);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(NAMES_KEY, JSON.stringify(aliases));
  }, [aliases]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const modKey = event.metaKey || event.ctrlKey;
      const typing = isTyping(event.target);

      if (modKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
        return;
      }
      if (modKey && event.key.toLowerCase() === 't') {
        event.preventDefault();
        setPalette(false);
        void openDraftTab();
        return;
      }
      if (modKey && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        closeTab(activeId);
        return;
      }

      if (palette && event.key === 'Escape') {
        event.preventDefault();
        setPalette(false);
        return;
      }
      if (menu && event.key === 'Escape') {
        event.preventDefault();
        setMenu(null);
        return;
      }
      if (palette) return;

      if (modKey && event.key >= '1' && event.key <= '9') {
        event.preventDefault();
        const tab = tabs[Number(event.key) - 1];
        if (tab) {
          setActiveId(tab.id);
          setLane('transcript');
        }
        return;
      }

      if (modKey && event.key === 'Enter' && !typing) {
        event.preventDefault();
        void decideGate(selected, 'approve', setActionError);
        return;
      }
      if (modKey && event.key === 'Backspace' && !typing) {
        event.preventDefault();
        void decideGate(selected, 'deny', setActionError);
        return;
      }

      if (typing) return;

      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        const delta = event.key === 'j' ? 1 : -1;
        const index = selectedChat ? flat.findIndex((c) => c.chatId === selectedChat.chatId) : -1;
        const next =
          flat[clamp((index < 0 ? (delta > 0 ? -1 : 0) : index) + delta, 0, flat.length - 1)];
        if (next) openLane(primaryLane(next));
        return;
      }

      const digit = event.key === '1' || event.key === '2' || event.key === '3' || event.key === '4';
      if (digit && selected) {
        event.preventDefault();
        setLane(LANES[Number(event.key) - 1]!);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, defaultAgent, flat, menu, palette, repo, selected, selectedChat, tabs]);

  function openLane(task: TaskView): void {
    const chatId = task.chatId;
    setTabs((current) => {
      const existing = current.find((t) => t.kind === 'chat' && t.id === chatId);
      if (existing) {
        return current.map((t) =>
          t.kind === 'chat' && t.id === chatId ? { ...t, focusId: task.task.id } : t,
        );
      }
      return [...current, { kind: 'chat', id: chatId, focusId: task.task.id }];
    });
    setActiveId(chatId);
    setLane('transcript');
  }

  function openChat(taskId: string): void {
    const task = chats.find((t) => t.task.id === taskId);
    if (task) openLane(task);
    else {
      setTabs((current) =>
        current.some((t) => t.kind === 'chat' && t.id === taskId)
          ? current
          : [...current, { kind: 'chat', id: taskId, focusId: taskId }],
      );
      setActiveId(taskId);
      setLane('transcript');
    }
  }

  async function openDraftTab(from?: { repoId: string; path?: string; defaultBranch?: string }): Promise<void> {
    let repoId = from?.repoId ?? repo?.repoId ?? null;
    let repoPath = from?.path ?? repo?.path ?? null;
    let defaultBranch = from?.defaultBranch ?? repo?.defaultBranch ?? null;

    if (repoPath == null) {
      const picked = await pickRepo();
      if (!picked) return;
      repoId = picked.repoId;
      repoPath = picked.path;
      defaultBranch = picked.defaultBranch;
      setRepoPaths((current) => ({ ...current, [picked.repoId]: picked.path }));
    }

    const id = crypto.randomUUID();
    setTabs((current) => [
      ...current,
      { kind: 'draft', id, repoId, repoPath, defaultBranch },
    ]);
    setActiveId(id);
    setLane('transcript');
  }

  function closeTab(id: string | null): void {
    if (id == null) return;
    setTabs((current) => {
      const next = current.filter((t) => t.id !== id);
      setActiveId((active) => {
        if (active !== id) return active;
        return next[next.length - 1]?.id ?? null;
      });
      return next;
    });
  }

  async function submitDraft(tab: Extract<Tab, { kind: 'draft' }>, message: string): Promise<void> {
    if (tab.repoPath == null) throw new Error('Pick a repository first');
    setTabs((current) =>
      current.map((t) =>
        t.id === tab.id && t.kind === 'draft'
          ? { ...t, optimistic: message, submitting: true }
          : t,
      ),
    );
    try {
      const ids = catalog.map((a) => a.id);
      const parsed = parseMentions(message, ids);
      const targets =
        parsed.targets.length > 0
          ? parsed.targets
          : [{ agentId: defaultAgent ?? undefined, text: parsed.shared || message }];
      const first = targets[0]!;
      const created = await api.taskCreate({
        repoPath: tab.repoPath,
        title: titleFrom(message),
        intent: composeLanePrompt(parsed.shared, first.text) || message,
        ...(first.agentId ? { agentId: first.agentId } : {}),
        ...(tab.defaultBranch ? { baseRef: tab.defaultBranch } : {}),
      });
      setTabs((current) =>
        current.map((t) =>
          t.id === tab.id
            ? { kind: 'chat', id: created.taskId, focusId: created.taskId, optimistic: message }
            : t,
        ),
      );
      setActiveId(created.taskId);
      void launchAndSend(created.taskId, composeLanePrompt(parsed.shared, first.text) || message);
      for (const extra of targets.slice(1)) {
        if (!extra.agentId) continue;
        void (async () => {
          const lane = await api.taskCreate({
            repoPath: tab.repoPath!,
            title: titleFrom(message),
            intent: composeLanePrompt(parsed.shared, extra.text),
            chatId: created.taskId,
            agentId: extra.agentId,
            ...(tab.defaultBranch ? { baseRef: tab.defaultBranch } : {}),
          });
          await launchAndSend(lane.taskId, composeLanePrompt(parsed.shared, extra.text));
        })();
      }
    } catch (err) {
      setTabs((current) =>
        current.map((t) =>
          t.id === tab.id && t.kind === 'draft' ? { ...t, submitting: false } : t,
        ),
      );
      throw err;
    }
  }

  async function sendOnChat(chat: ChatGroup, message: string): Promise<void> {
    setTabs((current) =>
      current.map((t) => (t.kind === 'chat' && t.id === chat.chatId ? { ...t, optimistic: message } : t)),
    );
    const ids = catalog.map((a) => a.id);
    const parsed = parseMentions(message, ids);
    const primary = primaryLane(chat);
    const targets =
      parsed.targets.length > 0
        ? parsed.targets
        : [{ agentId: primary.agentId, text: parsed.shared || message }];
    const repoPath = repoPaths[chat.lanes[0]!.task.repo_id] ?? repo?.path ?? null;

    for (const target of targets) {
      void sendToLane(
        chat,
        target.agentId,
        composeLanePrompt(parsed.shared, target.text),
        repoPath,
      ).catch((err: Error) => setActionError(err.message));
    }
  }

  async function sendToLane(
    chat: ChatGroup,
    agentId: string,
    text: string,
    repoPath: string | null,
  ): Promise<void> {
    let lane = chat.lanes.find((l) => l.agentId === agentId);
    if (lane == null) {
      if (repoPath == null) throw new Error('Open this repository to add a lane');
      const created = await api.taskCreate({
        repoPath,
        title: chat.title,
        intent: text,
        chatId: chat.chatId,
        agentId,
        baseRef: chat.lanes[0]?.task.base_ref,
      });
      await launchAndSend(created.taskId, text);
      return;
    }
    const digest = laneDigest(lane, chat.lanes);
    await launchAndSend(lane.task.id, withDigest(text, digest));
  }

  async function launchAndSend(taskId: string, text: string): Promise<void> {
    const view = chats.find((t) => t.task.id === taskId);
    const live = view?.agent?.pane_alive === true && view.agent.terminated !== true;
    if (!live) await api.taskLaunch(taskId);
    await api.taskSend(taskId, text);
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)',
        height: '100%',
        background: 'var(--bg-0)',
      }}
    >
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRight: '0.5px solid var(--line)',
          background: 'var(--bg-1)',
        }}
      >
        <Header
          repo={repo}
          connection={connection}
          error={error ?? repoError ?? actionError}
          summary={summarise({
            needsYou: needsYou.length,
            working: working.length,
            total: groups.length,
          })}
          onNew={() => void openDraftTab()}
          settings={
            repo ? (
              <RepoSettings
                repoId={repo.repoId}
                defaultAgent={defaultAgent}
                catalog={catalog}
                onSaved={setAgentOverride}
              />
            ) : null
          }
        />

        <div style={{ flex: 1, overflow: 'auto' }}>
          {chats.length === 0 && tabs.length === 0 ? (
            <Empty connection={connection} repo={repo} onNew={() => void openDraftTab()} />
          ) : (
            <>
              {needsYou.length > 0 && (
                <section>
                  <h2 style={groupHeadStyle('var(--st-needs)')}>Needs you · {needsYou.length}</h2>
                  {needsYou.map((chat) => (
                    <ChatRow
                      key={`need-${chat.chatId}`}
                      chat={chat}
                      selected={selectedChat?.chatId === chat.chatId}
                      onSelect={() => openLane(primaryLane(chat))}
                      onMenu={(x, y) =>
                        setMenu({ id: primaryLane(chat).task.id, x, y })
                      }
                    />
                  ))}
                </section>
              )}

              {byRepo.map((group) => {
                const closed = collapsed.has(group.repoId);
                const sample = group.chats[0]?.lanes[0]?.task.worktree_path ?? null;
                const label = repoLabel(group.repoId, repo, sample, aliases);
                return (
                  <section key={group.repoId}>
                    <h2 style={groupHeadStyle('var(--ink-2)')}>
                      <button
                        onClick={() =>
                          setCollapsed((set) => {
                            const next = new Set(set);
                            if (next.has(group.repoId)) next.delete(group.repoId);
                            else next.add(group.repoId);
                            return next;
                          })
                        }
                        style={{
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          color: 'inherit',
                          font: 'inherit',
                        }}
                      >
                        {closed ? '▸' : '▾'}
                      </button>
                      {renaming === group.repoId ? (
                        <input
                          autoFocus
                          defaultValue={label}
                          aria-label="Repository name"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              const next = event.currentTarget.value.trim();
                              setAliases((current) => {
                                const copy = { ...current };
                                if (next.length === 0) delete copy[group.repoId];
                                else copy[group.repoId] = next;
                                return copy;
                              });
                              setRenaming(null);
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              setRenaming(null);
                            }
                          }}
                          onBlur={(event) => {
                            const next = event.currentTarget.value.trim();
                            setAliases((current) => {
                              const copy = { ...current };
                              if (next.length === 0) delete copy[group.repoId];
                              else copy[group.repoId] = next;
                              return copy;
                            });
                            setRenaming(null);
                          }}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            font: 'inherit',
                            fontWeight: 600,
                            padding: '2px 6px',
                          }}
                        />
                      ) : (
                        <span
                          title="Double-click or right-click to rename"
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setRenaming(group.repoId);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setRenaming(group.repoId);
                          }}
                          style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        >
                          {label}
                        </span>
                      )}
                      <button
                        title="New chat"
                        onClick={() =>
                          void openDraftTab({
                            repoId: group.repoId,
                            path: repo?.repoId === group.repoId ? repo.path : undefined,
                            defaultBranch:
                              repo?.repoId === group.repoId ? repo.defaultBranch : undefined,
                          })
                        }
                        style={{ marginLeft: 'auto', padding: '2px 8px' }}
                      >
                        +
                      </button>
                    </h2>
                    {!closed &&
                      group.chats.map((chat) => (
                        <div key={chat.chatId}>
                          <ChatRow
                            chat={chat}
                            selected={selectedChat?.chatId === chat.chatId}
                            onSelect={() => openLane(primaryLane(chat))}
                            onMenu={(x, y) =>
                              setMenu({ id: primaryLane(chat).task.id, x, y })
                            }
                          />
                          {chat.lanes.map((task) => (
                            <LaneRow
                              key={task.task.id}
                              task={task}
                              selected={selected?.task.id === task.task.id}
                              onSelect={() => openLane(task)}
                              onMenu={(x, y) => setMenu({ id: task.task.id, x, y })}
                            />
                          ))}
                        </div>
                      ))}
                  </section>
                );
              })}
            </>
          )}
        </div>

        <SidebarFoot
          working={working.length}
          total={groups.length}
          connected={connection === 'live'}
        />
      </main>

      <aside style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <TabStrip
          tabs={tabs}
          groups={groups}
          activeId={activeId}
          onSelect={(id) => {
            setActiveId(id);
            setLane('transcript');
          }}
          onClose={closeTab}
        />
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {activeTab?.kind === 'draft' ? (
            <DraftPane
              optimistic={activeTab.optimistic}
              submitting={Boolean(activeTab.submitting)}
              catalog={catalog}
              onSend={(text) => submitDraft(activeTab, text)}
            />
          ) : selectedChat && selected ? (
            <Detail
              chat={selectedChat}
              focusId={selected.task.id}
              onFocus={(id) => {
                const task = selectedChat.lanes.find((l) => l.task.id === id);
                if (task) openLane(task);
              }}
              lane={lane}
              onLane={setLane}
              catalog={catalog}
              optimistic={activeTab?.kind === 'chat' ? activeTab.optimistic : undefined}
              onSend={(text) => sendOnChat(selectedChat, text)}
            />
          ) : (
            <NothingSelected hasChats={groups.length > 0} />
          )}
        </div>
      </aside>

      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        selected={selected}
        repo={repo}
        onNewChat={() => {
          setPalette(false);
          void openDraftTab();
        }}
        onError={setActionError}
      />

      {menu && (
        <RowMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onDelete={() => {
            const id = menu.id;
            setMenu(null);
            const task = chats.find((t) => t.task.id === id);
            void api.taskArchive(id).then(
              () => {
                const chatId = task?.chatId;
                const leftover = chats.filter((t) => t.chatId === chatId && t.task.id !== id);
                if (chatId && leftover.length === 0) closeTab(chatId);
              },
              (err: Error) => setActionError(err.message),
            );
          }}
        />
      )}
    </div>
  );
}

function TabStrip({
  tabs,
  groups,
  activeId,
  onSelect,
  onClose,
}: {
  tabs: Tab[];
  groups: ChatGroup[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}): JSX.Element | null {
  if (tabs.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        gap: 2,
        overflowX: 'auto',
        borderBottom: '0.5px solid var(--line)',
        background: 'var(--bg-1)',
        padding: '4px 6px 0',
      }}
    >
      {tabs.map((tab) => {
        const chat = tab.kind === 'chat' ? groups.find((g) => g.chatId === tab.id) : null;
        const title = tab.kind === 'draft' ? 'New chat' : (chat?.title ?? 'Chat');
        const branch = chat?.lanes.length === 1 ? chat.lanes[0]?.task.branch : `${chat?.lanes.length ?? 0} lanes`;
        const dirty = tab.kind === 'draft';
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 1,
              maxWidth: 180,
              background: active ? 'var(--bg-0)' : 'transparent',
              border: '0.5px solid',
              borderColor: active ? 'var(--line)' : 'transparent',
              borderBottom: active ? '0.5px solid var(--bg-0)' : '0.5px solid transparent',
              borderRadius: 'var(--radius) var(--radius) 0 0',
              marginBottom: -1,
              padding: '6px 10px',
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                fontSize: 'var(--t-s)',
              }}
            >
              {dirty && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--st-needs)',
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
              >
                {title}
              </span>
              <span
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
                style={{ marginLeft: 'auto', color: 'var(--ink-3)', fontSize: 'var(--t-xs)' }}
              >
                ×
              </span>
            </span>
            {branch && (
              <span className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-3)' }}>
                {branch}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ChatRow({
  chat,
  selected,
  onSelect,
  onMenu,
}: {
  chat: ChatGroup;
  selected: boolean;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}): JSX.Element {
  const copy = STATUS[chat.status];
  const colour = TONE_COLOUR[copy.tone];
  const primary = chat.lanes[0]!;

  return (
    <div
      data-task-id={primary.task.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className="ledger-row"
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: '2px 18px 1fr auto',
        alignItems: 'center',
        columnGap: 8,
        padding: '6px 16px 6px 0',
        borderBottom: '0.5px solid var(--line)',
        cursor: 'default',
      }}
    >
      <span style={{ background: colour, alignSelf: 'stretch', borderRadius: 1 }} aria-hidden="true" />
      <span className="mono" style={{ color: colour, fontSize: 'var(--t-s)' }} aria-hidden="true">
        {GLYPH[copy.tone]}
      </span>
      <div
        style={{
          fontSize: 'var(--t-m)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {chat.title}
      </div>
      {chat.lanes.length > 1 && (
        <span className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-3)' }}>
          {chat.lanes.length}
        </span>
      )}
    </div>
  );
}

function LaneRow({
  task,
  selected,
  onSelect,
  onMenu,
}: {
  task: TaskView;
  selected: boolean;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
}): JSX.Element {
  const copy = STATUS[task.status];
  const colour = TONE_COLOUR[copy.tone];
  return (
    <div
      data-task-id={task.task.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className="ledger-row"
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: '2px 18px 1fr minmax(4em, 50%)',
        alignItems: 'center',
        columnGap: 8,
        padding: '4px 16px 4px 18px',
        borderBottom: '0.5px solid var(--line)',
        cursor: 'default',
      }}
    >
      <span style={{ background: agentColor(task.agentId), alignSelf: 'stretch', borderRadius: 1 }} />
      <span className="mono" style={{ color: colour, fontSize: 'var(--t-s)' }}>
        {GLYPH[copy.tone]}
      </span>
      <span style={{ fontSize: 'var(--t-s)', color: agentColor(task.agentId) }}>{task.agentId}</span>
      <span className="branch-tail" title={task.task.branch}>
        {task.task.branch}
      </span>
    </div>
  );
}

function RowMenu({
  x,
  y,
  onClose,
  onDelete,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <div
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 30 }}
    >
      <div
        role="menu"
        onClick={(event) => event.stopPropagation()}
        style={{
          position: 'fixed',
          left: x,
          top: y,
          minWidth: 140,
          background: 'var(--bg-2)',
          border: '0.5px solid var(--line)',
          borderRadius: 'var(--radius)',
          padding: '4px 0',
        }}
      >
        <button
          role="menuitem"
          onClick={onDelete}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            borderRadius: 0,
            padding: '6px 12px',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function Header({
  repo,
  connection,
  error,
  summary,
  onNew,
  settings,
}: {
  repo: { name: string; slug: string | null } | null;
  connection: string;
  error: string | null;
  summary: string;
  onNew: () => void;
  settings: JSX.Element | null;
}): JSX.Element {
  const connected = connection === 'live';
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 16px',
        borderBottom: '0.5px solid var(--line)',
        background: 'var(--bg-1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
        <span
          style={{
            fontSize: 'var(--t-m)',
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={repo?.slug ?? undefined}
        >
          {repo ? repo.name : 'Osade'}
        </span>
        <span style={{ color: 'var(--ink-2)', fontSize: 'var(--t-xs)' }}>{summary}</span>
      </div>
      <span style={{ flex: 1 }} />
      {settings}
      <button data-new-task onClick={onNew}>
        New chat <kbd>{chord('t')}</kbd>
      </button>
      {(error || !connected) && (
        <span style={{ fontSize: 'var(--t-xs)', color: 'var(--st-fail)', whiteSpace: 'nowrap' }}>
          {error ?? 'Reconnecting'}
        </span>
      )}
    </header>
  );
}

function SidebarFoot({
  working,
  total,
  connected,
}: {
  working: number;
  total: number;
  connected: boolean;
}): JSX.Element {
  return (
    <div style={{ background: 'var(--bg-1)', borderTop: '0.5px solid var(--line)', padding: '6px 0' }}>
      <FootRow label="Agents" value={working === 0 ? 'Idle' : `${working} running`} />
      <FootRow label="Chats" value={String(total)} />
      <FootRow
        label="Daemon"
        value={connected ? 'Connected' : 'Reconnecting'}
        tone={connected ? undefined : 'var(--st-fail)'}
      />
    </div>
  );
}

function FootRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '2px 16px',
        fontSize: 'var(--t-xs)',
        color: 'var(--ink-2)',
      }}
    >
      <span>{label}</span>
      <span className="mono" style={{ color: tone ?? 'var(--ink)' }}>
        {value}
      </span>
    </div>
  );
}

function Empty({
  connection,
  repo,
  onNew,
}: {
  connection: string;
  repo: { name: string } | null;
  onNew: () => void;
}): JSX.Element {
  if (connection !== 'live') {
    return (
      <div style={{ padding: '34px 22px', maxWidth: 460 }}>
        <p style={{ marginTop: 0 }}>Connecting to the daemon…</p>
        <p style={{ color: 'var(--ink-2)', lineHeight: 1.45 }}>
          Agents keep running while this window is closed, so nothing has been lost. This should
          only take a moment.
        </p>
      </div>
    );
  }
  return (
    <div style={{ padding: '34px 22px', maxWidth: 490 }}>
      <p style={{ marginTop: 0 }}>{repo ? `No chats in ${repo.name} yet` : 'No chats yet'}</p>
      <p style={{ color: 'var(--ink-2)', lineHeight: 1.45 }}>
        A chat is one piece of work on one branch. Osade gives it its own git worktree, runs an
        agent inside it, and stops for you before anything is published.
      </p>
      <button className="primary" onClick={onNew} style={{ marginTop: 8 }}>
        New chat
      </button>
    </div>
  );
}

function NothingSelected({ hasChats }: { hasChats: boolean }): JSX.Element {
  return (
    <div style={{ padding: '34px 24px', color: 'var(--ink-2)', maxWidth: 380 }}>
      <p style={{ marginTop: 0, lineHeight: 1.45 }}>
        {hasChats
          ? 'Pick a chat to see what it has done, and what it needs from you.'
          : 'Nothing to show yet.'}
      </p>
    </div>
  );
}

function groupByRepo(tasks: TaskView[]): { repoId: string; chats: ChatGroup[] }[] {
  const map = new Map<string, TaskView[]>();
  for (const task of tasks) {
    const list = map.get(task.task.repo_id) ?? [];
    list.push(task);
    map.set(task.task.repo_id, list);
  }
  return [...map.entries()].map(([repoId, list]) => ({
    repoId,
    chats: groupChats(list).sort((a, b) => chatActivity(b) - chatActivity(a)),
  }));
}

function chatActivity(chat: ChatGroup): number {
  return Math.max(...chat.lanes.map((t) => t.agent?.last_event_at ?? t.task.created_at));
}

function repoLabel(
  repoId: string,
  repo: OpenRepo | null,
  worktreePath: string | null,
  aliases: Record<string, string>,
): string {
  const alias = aliases[repoId]?.trim();
  if (alias) return alias;
  const folder = worktreePath ? folderFromWorktree(worktreePath) : null;
  if (folder) return folder;
  if (repo?.repoId === repoId) return repo.name || repo.slug || repoId;
  return repoId;
}

/** `~/.osade/worktrees/<folder>/<taskId>` — the folder is the repo's directory name. */
function folderFromWorktree(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1] ?? '';
  if (last.startsWith('t_')) return parts[parts.length - 2] ?? null;
  return last;
}

function titleFrom(message: string): string {
  const stripped = message.trim().replace(/[.,!?;:]+$/u, '');
  const words = stripped.split(/\s+/u).filter(Boolean).slice(0, 6);
  const joined = words.join(' ');
  if (joined.length === 0) return 'New chat';
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function loadAliases(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function loadCollapsed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? new Set(raw.filter((x) => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

async function pickRepo(): Promise<OpenRepo | null> {
  const folder = await window.osade?.chooseRepository();
  if (!folder) return null;
  return api.repoOpen(folder);
}

function decideGate(
  selected: TaskView | null,
  decision: 'approve' | 'deny',
  onError: (message: string) => void,
): Promise<void> {
  const gate = selected?.openGates.find((g) => g.decided_at == null);
  if (!gate) return Promise.resolve();
  return api.gateDecide(gate.id, decision).then(
    () => undefined,
    (err: Error) => onError(err.message),
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function clamp(n: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, n));
}

function groupHeadStyle(color: string): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    position: 'sticky',
    top: 0,
    zIndex: 1,
    margin: 0,
    padding: '8px 12px 8px 16px',
    fontSize: 'var(--t-xs)',
    fontWeight: 600,
    color,
    background: 'var(--bg-1)',
    borderBottom: '0.5px solid var(--line)',
  };
}
