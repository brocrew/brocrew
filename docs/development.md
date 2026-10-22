# Developing BroBot

## Contributing

BroCrew has only just been released as open source. Issues and pull requests are welcome. Since it's so new, please open an issue before a large pull request, so the approach can be discussed first. Working on BroCrew itself? See [docs/development.md](#requirements).

How BroBot is built, tested and run while working on it, and where the agents it runs can reach.

An Electron + Vue 3 desktop app over better-sqlite3 + Drizzle. It runs Claude Code and Codex
conversations, lets agents give each other work, and keeps every conversation in a local database.

## Requirements

- **Node** — use the version in [`.nvmrc`](../.nvmrc) (`nvm use`). It is pinned to the Node major
  bundled by the Electron release we build against; `better-sqlite3` also requires Node ≥ 22.
  **`pnpm run ci` refuses to start below it** (`engine:check`) — not for tidiness:
  `fs.rmSync` is the JS `rimraf` on Node 20 and 22 and a C++ binding on 24, the three `*:check`
  gates remove a live app's user-data directory through it, and on the older one a failed removal
  empties nothing. A gate on the wrong runtime is measuring a different function.
- **pnpm** — pinned via `packageManager` (`corepack enable` will provide it).
- **Claude Code**, for Claude conversations. A downloaded BroBot does not include it: it runs the
  Claude Code installed on the computer, so install that first
  (<https://code.claude.com/docs/en/setup>). Codex comes with BroBot. Run from source, BroBot runs
  the copy of Claude Code the Agent SDK carries in `node_modules`, unless the app is started with
  `--brobot-claude-code=installed` (look for the installed one, as a download does) or
  `--brobot-claude-code=<absolute path>`.

## Layout

```
apps/desktop            Electron main (long-lived runner) + preload + Vue 3 renderer
packages/shared         typed zod contracts shared across processes
packages/runtime        AgentRuntime interface + the Claude Code and Codex adapters
packages/orchestration  state machine · queues · leases · board (a stub for now)
docs/                   the guides (installing, API keys, Codex, the data folder)
```

## Scripts (run from the repo root)

| Command                                                     | What it does                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm install`                                              | Install deps (downloads the Electron binary and `better-sqlite3`'s N-API prebuild). |
| `pnpm start`                                                | Build the app and run it: how to run BroBot from source.                            |
| `pnpm dev`                                                  | Launch the shell (electron-vite dev) with renderer HMR, for working on BroBot.      |
| `pnpm run ci`                                               | The whole gate — every step listed under this table, in order.                      |
| `pnpm run engine:check`                                     | Refuse a `node` below `engines.node`, before anything measures the wrong function.  |
| `pnpm run leak:check`                                       | Refuse a new mention of a name the repo must not carry (see below).                 |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` | Individual gates.                                                                   |
| `pnpm run db:generate`                                      | Regenerate the committed Drizzle migration from `schema.ts`, stamped so it runs.    |
| `pnpm run smoke:ui`                                         | Launch its own hidden app and drive it against live providers (see below).          |

`pnpm run ci` runs, in this order, and stops at the first that fails: `engine:check` → `leak:check`
→ `typecheck` → `lint` → `format:check` → `db:check` → `mutations:check` → `gate-only:check` →
`test` → `build` → `window:check` → `quit:check` → `notices:check`.

`leak:check` fails on a tracked file that carries more mentions of a name this repo must not carry
than `scripts/leak-guard/baseline.txt` lists for it, and on one that carries fewer — then
`node scripts/leak-check.mjs --shrink` lowers the baseline. A deliberate exception goes in
`scripts/leak-guard/allowed.txt`, with its reason. Its patterns are never in the tree: it reads them
from `BROBOT_LEAK_PATTERNS`, or from the file `BROBOT_LEAK_PATTERNS_FILE` names, or from
`~/.config/brobot/leak-patterns`, and with none of them it says it skipped and passes.

`gate-only:check` runs the tests that start `scripts/clean-base.mjs` (`vitest.gate-only.config.ts`).
No other test run reaches them, and nobody runs them outside the whole gate.

> **`pnpm ci` (bare) does not work** — pnpm 10 reserves `ci` as a built-in (it errors
> `ERR_PNPM_CI_NOT_IMPLEMENTED`). Use **`pnpm run ci`** (or the bare-safe alias **`pnpm gate`**).

## Where an agent can reach

BroBot behaves like the CLIs it runs: it adds no file- or folder-access restriction of its own. What follows from that is written here, and tests hold the code to it.

**"Never merge" and "never mutate PROD" are not rules of this product.** They describe how one person runs one body of work, and BroBot is generic: it can run a coding workflow, and it can plan a vacation. A person who holds such a rule tells their agents, and the rule lives with that person's own instructions, on their work and nowhere else.

**Where an agent can be pointed stays written down, because it is a real fact.** `checkSessionCwd` admits any existing searchable directory, and a spawned session takes its parent's folder unless it names one — so a conversation can be pointed at a real repository today. Agents run as the OS user, with nobody necessarily watching and credentials at reachable paths. That is as true of a vacation-planning agent with a browser as of a coding one.

**The third mode is not a path to spawned autonomy.** A third approval mode — _no prompts, but it cannot write outside your folder or reach the network_ — is a coherent thing to offer between `ask` and yolo, for sessions a person chooses for themselves. It is **not** a way to let a spawned session run without prompts, and must never be reached for as one. The reasoning, so it survives the moment somebody is in a hurry: a spawned session inherits its parent's mode and may never be wider than it, and what the inherited mode buys is consent at the command level — the card — and nothing else; the third mode removes the card, which is its entire point; and reads are unconfined under every Codex sandbox profile, `read-only` included — a planted file outside the workspace was read under all three. So a third mode reached for to give a spawned session _more_ than its parent has could read any credential path on the machine, silently, with nobody told. **A spawned session runs as its parent does and never wider.**

**The posture today:** BroBot is a single-operator tool, run by the person whose machine it is, **with agent-created sessions running no wider than whoever started them**. A conversation an agent starts inherits that agent's approval mode, and one that would act past its folder with nobody asked, where that agent is still asked or sandboxed, is refused as it is started. It is compared on what each side keeps between a write or a command past its folder and that act running unasked, and neither on the mode's name nor on what each mode removed: `ask` keeps an OS sandbox on Codex that it never had on Claude, and `auto` keeps nothing on either, so a Claude `auto` parent's Codex `auto` child is no wider and is given. Reads are not compared, so the rule as built would give an `ask` parent a child in the third mode; the paragraph above is why that mode needs its own decision on this rule before it exists. A Claude `ask` parent's Codex `ask` child writes and runs commands in its folder, reads outside it and runs a server tool its server marks read-only, all unasked, and is given; whether that is wider is still open. It is the interim, and it is narrow: it buys that nobody's tree is quietly wider than its root. It buys nothing about what a session a person _did_ choose may reach.

## Live smokes

`smoke:claude` / `smoke:codex` exercise the adapters directly; `smoke:ui` exercises the whole
path — renderer → preload → IPC → main-process host → adapter → provider — by clicking an app it
launches itself, over the Chrome DevTools Protocol. All three talk to the live providers over the
network, so none is part of `pnpm run ci`.

```
pnpm run smoke:ui          # screenshots + a per-line log land in /tmp/brobot2-ui-smoke
```

`smoke:ui` needs no second terminal: it launches this tree's app on a free CDP port with its own
`--user-data-dir`, **hidden** (`--brobot-hidden` — never shown, titled `BroBot — test`, no Dock
icon), and stops its whole process group when it ends. It refuses `:9222`
(`scripts/lib/smoke-target.mjs`) and `:9444`, which is the person's own running BroBot.

A seat that needs a dev app of its own launches it the same way — every port free, its own
`--user-data-dir`, the switch after `--`, and `ELECTRON_RUN_AS_NODE` cleared (an agent's shell may
export it, and Electron then boots as plain Node):

```
env -u ELECTRON_RUN_AS_NODE BROBOT_RENDERER_PORT=<free> BROBOT_RENDERER_HMR_PORT=<free> \
  pnpm --filter @brobot2/desktop exec electron-vite dev --remoteDebuggingPort <free> \
  -- --user-data-dir=<a scratch directory> --brobot-hidden
```

Before driving it, confirm the debugging port is yours — `lsof -nP -t -iTCP:<port> -sTCP:LISTEN`
must name the Electron you launched — and stop the launch's whole process group the moment the step
ends (`scripts/lib/owned-process.mjs` is how the repo's own launchers do both).

`pnpm dev` alone is a person's launch: shown, on the default user data, on the fixed renderer ports.

## Native modules (better-sqlite3)

`better-sqlite3` is a native module, but v13 ships **ABI-stable Node-API (N-API) prebuilds**
(`prebuilds/<platform>.node`). The **same** binary loads under both the Node ABI (used by
`pnpm test` / `pnpm run ci`) and Electron 43's ABI (used by `pnpm dev`) — no per-runtime rebuild is
needed, so a single `pnpm install` suffices and running `dev` never breaks `test`.

The `rebuild:electron` / `rebuild:node` scripts are kept only as **fallbacks** for a platform with
no prebuild (they compile into `build/Release`). `build` bundles JS only — native modules are
externalized — so it is ABI-agnostic.

## Ports

The renderer dev server is pinned to **5290** (HMR **24679**) with `strictPort`, deliberately off
Vite's default 5173 (in use by other local dev on this machine). Change them in
`apps/desktop/electron.vite.config.ts`, or per launch with `BROBOT_RENDERER_PORT` and
`BROBOT_RENDERER_HMR_PORT` — how a second instance runs beside one already open.
