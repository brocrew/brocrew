import { CODEX_MEMORY_SETTINGS } from './codex-memory-settings'

export interface ProviderConfigLayout {
  readonly homeEnv: string
  readonly model: string
  readonly authNote: string | null
  readonly files: readonly { readonly name: string; readonly note: string }[]
}

/**
 * ⛔ **What the Claude adapter actually hands `query()`, and what it deliberately does not** (308).
 *
 * ⚑ **The sentence below is RENDERED from this table, and the table is checked against the adapter's
 * own source in both directions** — see `apps/desktop/test/disclosure-answers-to-the-code.test.ts`.
 * That is the whole point of it existing: until 308 this was one hand-written sentence, and it said
 * *"MCP servers, tools and prompt are passed as SDK query() options"* while `optionsFor` in
 * `claude-runtime.ts` had **no `mcpServers` member at all**. `307` found it from the wire while
 * proving the option would work — it had to inject `mcpServers` at the `QueryFactory` seam, because
 * the adapter's options object has nowhere to put one.
 *
 * ⚠️ **`absent` rows are load-bearing, not documentation.** `strictMcpConfig: true` excludes file and
 * project MCP config, so a Claude session here gets MCP servers from **nowhere** — and the one
 * sentence a user reads to find out where to add one used to tell them the app already handled it.
 * Acceptance #7 is *nothing unwired implies a working state*; naming the unwired thing as unwired is
 * how this surface satisfies it.
 *
 * 🔴 **And when Slice 3 does start passing them, this table is what goes red first.** An `absent` row
 * whose option the adapter has begun to pass fails the test, which is the prompt to flip the row —
 * and flipping it rewrites the sentence. Nobody edits a fixture to match.
 */
type OptionStance =
  /** The adapter sends this session's own content in it. */
  | 'passed'
  /** The adapter sends a fixed value whose purpose is to switch something OFF. */
  | 'pinned'
  /** The adapter never sets it. */
  | 'absent'

export interface SdkOptionClaim {
  /** The `Options` member, spelled exactly as `optionsFor` spells it. */
  readonly option: string
  /** How the rendered sentence names it to a person. */
  readonly label: string
  readonly stance: OptionStance
}

export const CLAUDE_SDK_OPTIONS: readonly SdkOptionClaim[] = [
  { option: 'tools', label: 'tools', stance: 'passed' },
  { option: 'systemPrompt', label: 'the prompt', stance: 'passed' },
  { option: 'settingSources', label: 'settingSources: []', stance: 'pinned' },
  { option: 'strictMcpConfig', label: 'strictMcpConfig: true', stance: 'pinned' },
  // 🔴 **`absent` until 347, and the flip is the whole reason this table was built as a table**
  // (308). The adapter now sets `mcpServers` — an in-process MCP server carrying this session's own
  // agent tools — and the census that reads `optionsFor`'s source went red on this row the moment it
  // did, which is what forced this line and the sentence rendered from it to move together.
  //
  // ⚠️ **`passed` and not a fourth stance, because the option carries THIS SESSION'S content.** A
  // session with no toolset gets no server, exactly as a session with no model override gets no
  // `model` — that is the option being unused, not the app declining to pass it.
  // ⚑ **516 · the LABEL moved and the stance did not.** ⛔ The option now carries two things — this
  // session's own tools as an in-process server, AND every external server a person registered and
  // granted to the identity this conversation is running as — so a sentence naming only the first
  // would answer *"where do this session's MCP servers come from?"* with half the truth. ⚠️ It is
  // standing rule 8's shape on the one surface that exists to say where config comes from: a
  // sentence that DESCRIBES the option drifts the moment the option grows a second source.
  {
    option: 'mcpServers',
    label: "this session's own tools and any external servers granted to it, as MCP servers",
    stance: 'passed',
  },
  // 🔴 **736 · R95 / 740 · R99 — the permission rules read out of two files**: this home's
  // `settings.json`, and — since `740` — the project's `.claude/settings.local.json`, where the CLI
  // keeps a rule a person chose to keep beyond one conversation (R99: *"kept where the CLI keeps
  // it"*); passed as flag settings at every launch (`persisted-rules.ts`). ⛔ Without this row the
  // sentence said every file setting here was ignored.
  {
    option: 'settings',
    label:
      "the permission rules kept in this home's settings.json and in the project's .claude/settings.local.json",
    stance: 'passed',
  },
]

/** `a`, `a and b`, `a, b and c` — the Oxford-free form the rest of these notes use. */
function humanList(items: readonly string[]): string {
  if (items.length === 0) return 'nothing'
  if (items.length === 1) return items[0]!
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`
}

const labelsFor = (stance: OptionStance): string[] =>
  CLAUDE_SDK_OPTIONS.filter((claim) => claim.stance === stance).map((claim) => claim.label)

/**
 * The Claude line, assembled so it cannot drift from the table above.
 *
 * ⚠️ **Deliberately still a sentence.** The alternative — printing the table — would be a screen the
 * user has to interpret; this surface exists to answer *"where is this session's config?"* in words.
 */
const CLAUDE_MODEL_NOTE =
  `programmatic — ${humanList(labelsFor('passed'))} are passed as SDK query() options; ` +
  `the adapter pins ${humanList(labelsFor('pinned'))}, so other file settings here are ignored by design.` +
  // ⛔ **The whole clause disappears when nothing is `absent`, rather than rendering `humanList`'s
  // empty answer** (347). `humanList([])` is the string `'nothing'`, so the old unconditional form
  // would have read *"nothing: NOT passed — this app configures none"* the moment the last absent
  // row flipped — a sentence that is grammatical, confident and says the opposite of the truth.
  // ⚠️ Found by flipping the row, not by a test: the fixture would have matched whatever it rendered.
  (labelsFor('absent').length === 0
    ? ''
    : ` ${humanList(labelsFor('absent'))}: NOT passed — this app configures none, and the pins above` +
      ` mean none are read from a file either`)

/**
 * ⛔ **What BroBot itself writes into the Codex `config.toml`, and the sentence rendered from it**
 * (314).
 *
 * ⚑ **The keys are not restated here.** They come from `CODEX_MEMORY_SETTINGS` — the same table the
 * merge reads and the same table the file's own comments are rendered from — so the one sentence a
 * user reads about this file cannot name a key the app does not write, or miss one it does. 306's
 * shape, and the reason the Claude half above is a table rather than a hand-written line.
 *
 * ⚠️ **"is where MCP servers … are declared" survives untouched and is still the binary's claim, not
 * ours.** This app does not write MCP servers into that file; Codex reads them from it. What changed
 * at 314 is that the app is now a WRITER of this file too, which is the half a person reading the
 * config block had no way to know — and the half `disclosure-answers-to-the-code.test.ts` now binds.
 */
const CODEX_MEMORY_KEYS = CODEX_MEMORY_SETTINGS.map((one) => `${one.table}.${one.key}`)

/**
 * ⛔ **What the Codex adapter puts on `thread/start` that a person would otherwise look for in a
 * file** (348), in the same shape {@link CLAUDE_SDK_OPTIONS} uses and for the same reason.
 *
 * ⚑ **Acceptance #9 has two directions and this is the second one.** *"Nothing unwired may imply a
 * working state — and nothing working may be dressed as a placeholder."* A Claude session's block
 * names `mcpServers` as passed; without this row a Codex session with exactly the same tools
 * would show a block whose only mention of tools is a sentence about a file they are not in, and a
 * user would go looking in `config.toml` and find nothing.
 *
 * ⚠️ **`348`'s brief expected the opposite hazard.** It warned that *"the moment you write that
 * table, that line stops being a description and becomes a promise"* — because it assumed this
 * dispatch would write `[mcp_servers]` into `config.toml`. Nothing is written there: the tools ride
 * `ThreadStartParams.dynamicTools`, so the file sentence stays the binary's claim, exactly as it
 * was, and the new fact gets its own clause instead of quietly changing the meaning of that one.
 */
export const CODEX_THREAD_START_CLAIMS: readonly SdkOptionClaim[] = [
  {
    option: 'dynamicTools',
    label: "this session's own tools",
    stance: 'passed',
  },
  // 🔴 **605 · `thread/start` grew a SECOND payload and this table did not, until reviewing that
  // dispatch's diff.** ⛔ The granted external MCP servers ride `ThreadStartParams.config` as a
  // per-thread overlay, and until this row the note sent a person to `config.toml` to find them
  // — which is verbatim the hazard `348` wrote this table for: *"a user would go looking in
  // `config.toml` and find nothing."*
  //
  // ⚠️ **And the census could not have caught it**: `disclosure-answers-to-the-code.test.ts`
  // walks the CLAIMS and checks the adapter sets each one, never the reverse, so a field the
  // adapter gained is invisible to it. ⚑ A census scoped to one direction is
  // `a-payload-census-must-read-call-sites-not-types` with the arrow drawn the other way.
  // ⚑ Provider follow-ups 1 · the same overlay now also switches Codex's planning tool on
  // (`CODEX_PLAN_TOOL_CONFIG`) on every thread — over a `false` a person might set in `config.toml`,
  // which is exactly why it is said here.
  {
    option: 'config',
    label:
      "the external MCP servers this identity was granted, and Codex's planning tool switched on",
    stance: 'passed',
  },
]

// 🔴 **605 · the trailing clause had to SPLIT, because the two wire payloads differ on exactly
// the fact it stated.** ⛔ `348` measured the app-server remembering `dynamicTools` in its own
// `thread_dynamic_tools` table across a cold resume by another process; a `config` overlay is
// NOT remembered, which is why `threadResumeParams` re-declares it from the store at every
// launch. ⚠️ One sentence claiming both would have been false of one of them.
const CODEX_MODEL_NOTE =
  'file-based — config.toml in this home is where Codex reads its own MCP servers and ' +
  `preferences, and where BroCrew switches this profile's memory on: ${humanList(CODEX_MEMORY_KEYS)} ` +
  'are merged into the tables already there on every launch, and nothing else in the file is ' +
  `touched — and ${humanList(CODEX_THREAD_START_CLAIMS.map((claim) => claim.label))} are not in ` +
  'that file at all: they are declared on the wire when the conversation starts. The tools the ' +
  'app-server remembers, so a resumed conversation comes back with the same ones; the servers and ' +
  'the planning switch it does not, so BroCrew sends them again every time it reopens the conversation'

export const CLAUDE_CONFIG_LAYOUT: ProviderConfigLayout = {
  homeEnv: 'CLAUDE_CONFIG_DIR',
  model: CLAUDE_MODEL_NOTE,
  authNote:
    'auth: Claude Code’s own login (the Keychain on a Mac, its own file on Windows) — the token is injected per launch, never written here',
  files: [
    { name: '.claude.json', note: "the SDK's own state — not a file you edit to add tools" },
    {
      name: 'settings.json',
      // 🔴 736 · R95 / 740 · R99 — its permission rules are read back at every launch; nothing
      // else in it is loaded (settingSources []). ⚑ Since `740` an *always* is not kept here but
      // where the CLI keeps it, the project's `.claude/settings.local.json` (R99).
      note: "this identity's own settings — its permission rules are read at every launch, and nothing else in it is loaded; a rule chosen to outlive one conversation is kept in the project's .claude/settings.local.json, where the CLI keeps it",
    },
  ],
}

export const CODEX_CONFIG_LAYOUT: ProviderConfigLayout = {
  homeEnv: 'CODEX_HOME',
  model: CODEX_MODEL_NOTE,
  authNote: null,
  files: [
    // ⚠️ **Not "the machine credential, copied in once at 0600", which is what this said until
    // 308.** That is the PROVISIONING rule (`provisionCodexAuth`: once, atomic, never overwritten)
    // and `SignInPanel.vue` ships two buttons that write this file afterwards. *"Copy my machine
    // sign-in"* replaces it from `~/.codex` (`reprovisionCodexAuth`), and *"Sign in to this
    // profile"* has the app-server mint a brand-new OAuth credential into this home
    // (`startCodexLogin`) — after which the file is this profile's own login and not the
    // machine's at all, which is the entire point of that button. A user reading "the machine
    // credential" had the relationship backwards for exactly the profile where it matters most.
    //
    // ⚑ `0600` survives the correction and is the app's own rule rather than a description of one
    // writer: both writers `chmod` it, and `codexAuthHealth` reports any other mode as unhealthy
    // no matter who wrote it.
    {
      name: 'auth.json',
      note: 'the credential this profile runs on, at 0600 — copied from ~/.codex, or minted here by "Sign in for this agent"',
    },
    // ⚠️ **Not "absent means built-in defaults", which is what this said until 314.** The app now
    // creates this file when a Codex home has none, so for any profile that has been opened the
    // sentence would have been describing a state that no longer occurs.
    {
      name: 'config.toml',
      note: 'MCP servers + preferences, and the memory keys above — Codex writes here too, so BroCrew merges and never rewrites it',
    },
    // 🔴 **736 · R95 — where a choice that outlives one conversation is kept**, one file per kind:
    // an MCP tool's *Always allow* in this app's own file (Codex keeps nothing of it on this path —
    // measured, `kept-tool-approvals.ts`), and Codex's own *don't ask again for commands that start
    // with …* rules, which Codex writes and reads itself (measured, its terminal).
    {
      name: 'brobot-kept-tool-approvals.json',
      note: 'MCP tools always allowed here — declared with their server at every launch, so Codex does not ask about them',
    },
    {
      name: 'rules/default.rules',
      note: 'Codex\'s own "don\'t ask again for commands that start with …" rules — Codex writes and reads them itself',
    },
  ],
}
