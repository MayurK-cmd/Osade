Two changes. Composer context per lane, and route all model calls through the
user's own coding agent.

## 1. Composer stays live on every lane

Do not disable the composer anywhere. It sends to the focused lane from Chat,
Files, Diff, Checks and Rules alike. What changes is the context it attaches.

Add a context chip above the input, dismissible with ×, showing what will be
attached:

  Chat    — nothing
  Files   — open file path, plus line range when there is a selection
  Diff    — the hunk under the cursor (file + line range)
  Checks  — the focused verify step name and the last ~40 lines of its log
  Rules   — the focused rule id and its rule_text

Attach as a fenced block prepended to the message, before the shared preamble
in the existing parseMentions flow. Do not change the send path, lane routing,
or turn model. Dismissing the chip sends with no context.

The composer only disables when the chat has zero lanes and no draft — same as
today.

## 2. All generation runs on the user's agent

No new API keys. Every model call goes through an agent the user already has
installed, via a headless run.

Add `runHeadless({ repoId, agentId?, prompt, timeoutSec })` in the daemon:

- Picks the agent: explicit agentId, else repo default, else first catalog
  entry whose binary is on PATH.
- Runs in a temp empty workspace, NOT a task worktree, with tools and
  approvals denied — the agent must not touch the repo during generation.
- Uses the catalog's headless flags. Add a `headless-run` capability and gate
  on it; if no installed agent has it, return a typed error and let the caller
  decide, rather than silently skipping.
- Returns text. Callers that need JSON prompt for JSON only, strip fences, and
  parse defensively.

Route these through it:

- The conventions miner (mineRepo). Its three passes — extract, cluster,
  verify — become three runHeadless calls. Keep the passes separate; do not
  collapse into one prompt. Evidence enforcement stays: a rule with no
  convention_evidence row is still rejected at write time.
- Chat title derivation, once a lane has real activity.
- Branch name slugs.
- PR title and body in prPlan.

Do NOT route verifyPlanDerive through it. Reading package.json scripts, CI
workflows and justfiles is deterministic parsing and must stay that way. Only
fall back to runHeadless when derivation returns zero steps, and mark those
steps source: 'agent' so the user sees they were guessed.

## 3. Embeddings

OSADE.md §15 assumes a vector store for memory retrieval. Drop it for now —
it needs an embedding model, which means a key. Use SQLite FTS5 over
memory.text with the same scope filters, and leave the memory_vec table
unused. Revisit when a local ONNX model is worth the weight.

## 4. Checks lane UI

Wire what already exists: verifyPlanGet to show the plan, verifyPlanDerive as
"Detect checks", inline add/edit/remove rows, verifyPlanConfirm to save,
verifyRun to run. Show each step's `source` (ci / manifest / doc / user /
agent) next to it so a guessed step is visibly different from a parsed one.