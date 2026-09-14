# How the UI is built, and how it talks to the backend

This covers the desktop app in `apps/desktop/` and its connection to the backend: the Osade daemon
in `packages/daemon/` and the terminal runtime underneath it.

## The shape of it

```text
┌──────────────────────── Electron app (apps/desktop) ────────────────────────┐
│                                                                              │
│  main process (src/main)                 renderer (src/renderer, React)      │
│  ─────────────────────────               ─────────────────────────────────   │
│  • boots the backend processes           • draws the ledger and task detail  │
│  • creates the window                    • never computes status             │
│  • answers a few IPC calls  ◄── IPC ──►  • calls the daemon directly:        │
│    (port, folder picker, …)   preload      HTTP for actions, WebSocket for   │
│                              (src/preload)  live state                       │
└───────────────┬──────────────────────────────────────────┬───────────────────┘
                │ spawns / adopts                          │ http://127.0.0.1:<port>
                ▼                                          │ ws://127.0.0.1:<port>/ws
┌─────────────────────────────┐                ┌───────────▼───────────────────┐
│ terminal runtime            │  JSON API over │ Osade daemon (packages/daemon) │
│ vendor/runtime/…/           │◄───────────────│ • tRPC router  (server/router) │
│   osade-runtime.exe server  │  osade.sock    │ • CDC broadcaster (server/cdc) │
│ runs agents in panes        │                │ • SQLite ledger (~/.osade)     │
└─────────────────────────────┘                └────────────────────────────────┘
```

Three rules explain most of the design:

1. **The renderer is never the source of truth.** It renders what the daemon sends. Task status is
   derived in the daemon from stored facts, on every read, and is never computed in the UI.
2. **One event path.** Every change the UI should see goes through the database. Triggers write to
   `change_log`, the broadcaster tails it, and that is the only place a WebSocket message is sent.
3. **Loopback only.** The daemon binds `127.0.0.1`, and the renderer's Content-Security-Policy only
   allows connections to `127.0.0.1`.

## The three processes inside the app

Electron splits the app into three pieces with different permissions.

| Piece | Source | Built by | Runs as |
| --- | --- | --- | --- |
| Main process | `src/main/` | `tsc -p tsconfig.main.json` → `dist/main/` (CommonJS) | Node, full access |
| Preload | `src/preload/index.ts` | same `tsc` → `dist/preload/` | bridge, runs before the page |
| Renderer | `src/renderer/` | `vite build` → `dist/renderer/` | a web page, no Node, no filesystem |

The window is created with `contextIsolation: true` and `nodeIntegration: false`, so the renderer
can only reach the main process through what the preload explicitly exposes.

### Main process — `src/main/electron.ts`

On launch, in this order:

1. **Redirects Electron's data** to `~/.osade/electron` before anything touches disk, so everything
   Osade writes stays under `~/.osade` (or `OSADE_HOME`).
2. **Takes a single-instance lock.** A second launch — for example `osade .` in another repository
   — hands its arguments to the running window and exits. The window is then re-scoped to that repo
   through the `osade:repo-opened` IPC event.
3. **Starts or adopts the terminal runtime** (`supervisor/substrate.ts`). It pings
   `~/.osade/runtime/osade/osade.sock`; if nothing answers, it spawns
   `vendor/runtime/<pin>/<target>/osade-runtime.exe server` detached, passing the socket paths
   through the runtime's own environment variables. The variable names are built from the upstream
   project recorded in `vendor/runtime/<pin>/pin.json`.
4. **Starts or adopts the daemon** (`supervisor/daemon.ts`). If `~/.osade/daemon.port` points at a
   daemon that answers `GET /health`, it is reused. Otherwise the daemon is spawned detached — built
   `packages/daemon/dist/cli.js` if it exists, TypeScript source through the dev runner if not — and
   the supervisor waits for the port file plus a healthy `/health`, never a fixed sleep. Its output
   goes to `~/.osade/logs/daemon.log`.
5. **Creates the window** and loads `dist/renderer/index.html`, or `OSADE_RENDERER_URL` if set.

Both backend processes are detached on purpose: closing the window does not stop running agents.

The main process logs to `~/.osade/logs/app.log`, because a packaged Windows app has no console.

### Preload — `src/preload/index.ts`

The whole bridge. It exposes `window.osade`, and nothing else crosses from main to renderer:

| Method | IPC channel | What it does |
| --- | --- | --- |
| `daemonPort()` | `osade:daemon-port` | The port the daemon is listening on |
| `openedRepo()` | `osade:opened-repo` | The repository the window was opened on, or `null` |
| `onRepoOpened(handler)` | `osade:repo-opened` (event) | A later `osade .` re-scoped the window |
| `chooseRepository(defaultPath?)` | `osade:choose-repository` | The system folder picker; returns a path or `null` |
| `openInSubstrate()` | `osade:open-in-substrate` | The command to attach a terminal to the agent session |

Its TypeScript type lives in `src/renderer/useLedger.ts` (`declare global { interface Window … }`).
**Adding a method means three edits:** an `ipcMain.handle` in `electron.ts`, the method in the
preload, and the type in `useLedger.ts`. Channel names must match exactly; a mismatch fails
silently, with the button simply doing nothing.

Notice what is *not* in the bridge: task data. The renderer gets that from the daemon directly.

## How the renderer talks to the daemon

The renderer asks the preload for the daemon's port once, then connects straight to
`127.0.0.1:<port>`. Two channels, with separate jobs:

### 1. Actions and on-demand reads — HTTP (`src/renderer/api.ts`)

The daemon's API is a [tRPC](https://trpc.io) router (`packages/daemon/src/server/router.ts`),
served over plain HTTP by `packages/daemon/src/server/index.ts`. The renderer does not use a tRPC
client library; `api.ts` has a small `call()` that speaks the wire format directly:

- **Query** → `GET http://127.0.0.1:<port>/<procedure>?input=<url-encoded JSON>`
- **Mutation** → `POST http://127.0.0.1:<port>/<procedure>` with a JSON body
- **Response** → `{ result: { data } }`, or `{ error: { message } }`, which `call()` throws

Every procedure the UI uses has a typed wrapper on the exported `api` object:

| Area | Procedures (in `api.ts`) | Used by |
| --- | --- | --- |
| Repositories | `repoOpen` | `useRepo`, `NewTask` (after the folder picker) |
| Tasks | `taskCreate`, `taskLaunch` | `NewTask`, `Detail` (start task) |
| Approval gates | `gateDecide`, `gateEditAndApprove` | `GateCard` |
| Verification | `verifyPlanGet`, `verifyPlanDerive`, `verifyPlanConfirm`, `verifyRun` | `VerifyPlanReview` |
| Pull requests | `prPlan`, `prOpenRequest` | `PrOpen` |
| Conventions | `mineStatus`, `mineRepo`, `conventionList`, `conventionConfirm`, `conventionReject`, `conventionImpact` | `Conventions` |

`api.ts` also wraps `taskTranscript`, `scmRefresh`, `issueList` and `issueImport`, but no component
calls them yet.

The router also has procedures the UI does not call, used by the CLI (`taskList`, `taskGet`,
`taskSend`, `taskArchive`, `health`).

**A mutation does not return the new state for the UI to apply.** It changes facts in the database,
and the updated task arrives on the WebSocket moments later. That is why, say, approving a gate
doesn't update anything locally: the card disappears because the next push no longer contains
the open gate.

### 2. Live state — WebSocket (`src/renderer/useLedger.ts`)

`useLedger()` opens `ws://127.0.0.1:<port>/ws` and keeps the task list in React state:

| Message from the daemon | What the hook does |
| --- | --- |
| `snapshot` (sent on connect) | Replaces the whole list — local state is discarded |
| `task.upserted` | Replaces that one task and re-sorts |
| `task.removed` | Drops that task |
| `stream.reset` | Sends `{ "type": "hello" }` to get a fresh snapshot |

If the socket closes, the hook reconnects every second and takes a new snapshot, never merging a
stale cache with a fresh stream. Its `connection` value (`connecting` / `live` / `offline`) drives
the "daemon" line in the sidebar footer.

The message shapes are Zod schemas in `packages/contract/src/ws.ts`. Each task arrives as a
**`TaskView`**:

```ts
{
  task: Task,               // the stored task row
  status: TaskStatus,       // derived by the daemon; never stored, never computed in the UI
  agent: AgentFact | null,  // what the runtime last reported about the agent
  scm: ScmFact | null,      // pull request / CI facts
  openGates: GateRequest[], // actions waiting for your approval
  latestVerifyRuns: VerifyRun[],
  needsYou: boolean,        // true when status is one that needs a person
}
```

### Where pushes come from — `packages/daemon/src/server/cdc-broadcaster.ts`

1. Every write to a fact table fires a SQLite trigger that appends a row to `change_log`.
2. The broadcaster polls `change_log` every 100 ms past its watermark.
3. It collapses the new rows to one per task, rebuilds that task's `TaskView` (deriving status), and
   sends `task.upserted`, or `task.removed` if the task no longer exists.

This is the only code that sends WebSocket messages. **If the UI doesn't update after a change, the
change didn't go through the database** — adding a manual push is not the fix.

## The renderer's code

React 19, plain function components, no router and no state library.

| File | What it is |
| --- | --- |
| `index.html` | The page shell and its Content-Security-Policy |
| `main.tsx` | Mounts `<App />` and loads `tokens.css` |
| `App.tsx` | The layout: header, sidebar ledger ("needs you", then everything else), footer, detail pane |
| `Detail.tsx` | One task: status and what it means, open approval gates, start button, checks, pull request, conventions, technical details |
| `NewTask.tsx` | The new-task form: repository (folder picker or pasted path) and instruction |
| `GateCard.tsx` | An approval request: the exact text or diff, approve / deny / edit-and-approve |
| `VerifyPlanReview.tsx` | The project's check commands, shown for review before they ever run |
| `PrOpen.tsx` | Requests a pull request — which creates an approval gate, never a direct write |
| `Conventions.tsx` | Rules mined from the repository, each with its evidence |
| `status.ts` | Status copy in plain words (`label`, `meaning`, `next`), glyphs and tone colours |
| `useLedger.ts` | The WebSocket hook, the ledger sort order, and the `window.osade` type |
| `useRepo.ts` | Which repository the window is scoped to (from `osade .` or a re-scope) |
| `api.ts` | The HTTP client for daemon procedures |
| `tokens.css` | Design tokens and base element styles |

### Data flow through the components

```text
useLedger() ──tasks──► App ──filters to the open repo, splits needs-you / rest──► Row (sidebar)
                        │
useRepo() ───repo──────►│ selected task ──► Detail ──► GateCard / VerifyPlanReview / PrOpen / Conventions
                                                            │
                                                            └── api.*() mutations ──► daemon
                                                                     (result arrives via useLedger)
```

`App` owns only UI state: which task is selected, and whether the new-task form is open. Panels that
need extra data (the verification plan, conventions, the pull request plan) load it themselves
through `api.*` queries when shown.

### Styling

- Design tokens are CSS variables in `tokens.css`: grounds (`--paper`, `--surface`, `--field`),
  text (`--ink`, `--ink-soft`), the one accent (`--accent`, for selection and focus only), and
  state colours (`--st-needs`, `--st-live`, `--st-fail`, `--st-rest`) used only to show state.
- Components mostly use inline `style` objects that reference those variables. That is why the
  CSP allows inline styles, but not inline scripts.
- The look is a terminal: dark, monospaced, lowercase labels, square corners, no shadows.
- One `button.primary` per view — the action the person came to take.
- Status wording lives in `status.ts`, not in components. Every status answers what is happening,
  what it means, and what to do next.

## Common changes

**Show a new piece of task data.** Add it to the facts the daemon stores and to `TaskView` in
`packages/contract/src/ws.ts`, fill it in `CdcBroadcaster.#view` and the router's `viewFor`, then
read it from the `task` prop. It will stay live automatically, as long as writes go through the
database.

**Add a user action.**
1. Add a procedure to `packages/daemon/src/server/router.ts` with Zod `.input()` (and `.output()`
   where it returns data).
2. Add a typed wrapper to `api` in `src/renderer/api.ts`.
3. Call it from a component and show errors from the rejected promise. Don't update task state
   locally; the change arrives through `useLedger`.

**Add something only Electron can do** (a native dialog, opening a file). Add an `ipcMain.handle` in
`src/main/electron.ts`, expose it in `src/preload/index.ts`, and type it in `useLedger.ts`. Keep it
narrow: return values, never Node objects or filesystem handles.

## Running and checking it

From the repository root:

```powershell
pnpm install
node scripts/fetch-substrate-binaries.mjs   # the runtime, into vendor/runtime (checksum-verified)
pnpm build
pnpm --filter @osade/desktop start          # builds the app and opens the window
```

**Renderer with hot reload.** Serve Vite on `127.0.0.1`, not `localhost`: the page's CSP only
allows connections to `127.0.0.1`, and Vite's reload socket connects back to the host the page came
from.

```powershell
# terminal 1
pnpm --filter @osade/desktop exec vite --host 127.0.0.1 --port 5173

# terminal 2
pnpm --filter @osade/desktop build:main
$env:OSADE_RENDERER_URL = 'http://127.0.0.1:5173'
pnpm --filter @osade/desktop exec electron .
```

Changes under `src/renderer` reload. Changes under `src/main` or `src/preload` need `build:main`
and a restart.

**Automated smoke check.** `pnpm --filter @osade/desktop smoke:panels` builds the app, seeds a
fixture task into `apps/desktop/.smoke`, boots, clicks a task, checks that the expected panels are
laid out on screen, saves `smoke.png`, and exits non-zero if anything is missing. The same harness is
driven by environment variables:

| Variable | Effect |
| --- | --- |
| `OSADE_HOME` | Use a separate home instead of `~/.osade` (smoke runs use `.smoke`) |
| `OSADE_SMOKE_SHOT` | Take a screenshot to this path, then exit |
| `OSADE_SMOKE_CLICK` | CSS selector to click first (e.g. `[data-task-id]`, `[data-new-task]`) |
| `OSADE_SMOKE_EXPECT` | `\|`-separated text that must be visible on screen. Placeholders don't count |
| `OSADE_SMOKE_THEME` | Force `light` or `dark` |

A smoke run spawns its own runtime in its smoke home, and that runtime keeps running afterwards.

**Where to look when it doesn't start.**

- `~/.osade/logs/app.log` shows the boot steps, and why the window closed if it did.
- `~/.osade/logs/daemon.log` shows the daemon's startup, including whether the runtime matches
  the pinned API.
- A red "reconnecting" in the header means the WebSocket to the daemon is down.

## Known rough edges

- `createWindow` sets `backgroundColor: '#F6F7F4'` (a light colour, left from before the UI went
  dark), so the window can flash light before the page paints.
- `api.ts` casts responses to hand-written types rather than inferring them from the router. The
  procedures that declare `.output()` validate on the daemon side; the rest rely on the cast
  matching.
