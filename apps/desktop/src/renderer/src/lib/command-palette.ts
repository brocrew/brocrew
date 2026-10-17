import { providerName, type Provider, type ProviderCommandSet } from '../../../shared/runtime-ipc'
import type { WorkThatNamesIt } from '../../../shared/piece-called'
import { conversationTitle } from './conversation-list'

/**
 * **What ⌘K can actually do, and what it looked at to answer** (249).
 *
 * ## Why this is a rule module and not markup
 *
 * ⛔ **The control it replaces announced that it did nothing.** `RuntimeScreen.vue`'s ⌘K branch and
 * the rail's own button both said *"Command palette — not wired yet"*, which is `106` — a control
 * that cannot act — on the one gesture the Exploration Agent asked for by name in `220`:
 *
 * > *"one fast place to jump, compact, reopen, export, or change a conversation without hunting
 * > through surfaces."*
 *
 * ⚑ **Every row here is a verb some surface ALREADY has**, reached through the gesture that surface
 * already exposes. Nothing in this file invents a capability, and nothing in it re-derives a fact
 * another surface computes — see {@link buildCommands}, which takes the rail's own rows rather than
 * a second reading of the store (`099`: two derivations, one row, two pixels apart).
 *
 * ## ⛔ The honesty rule this file exists to hold
 *
 * ⚠️ **A palette that silently searches only what is loaded is `106` again**, and this app has two
 * sets of conversations:
 *
 *  1. **the rail's one list** (D-017b) — every conversation this app records, newest first, less
 *     the ones `154`'s ruling keeps off the rail;
 *  2. **every conversation on this machine** — `listLibrary`, searched MAIN-SIDE against a corpus of
 *     thousands and windowed to 200 rows (`main/library/session-library.ts:61`).
 *
 * ⛔ **This palette searches 1 and says so** ({@link searchedNote}), and its no-match state names 2
 * and offers the page that owns it ({@link NO_MATCH_BODY}). Filtering a fetched page of 3
 * in the renderer is the exact failure `SessionLibrary.vue`'s own comment forbids — *"Filtering the
 * page in hand would search the first 200 entries of two thousand"* — so it is not done here.
 */

/** Which band a row sits in. The order of this list is the order the palette draws them. */
export const PALETTE_GROUPS = ['this', 'conversations', 'go', 'agent'] as const

export type PaletteGroup = (typeof PALETTE_GROUPS)[number]

/**
 * The band headings, in the rail's own vocabulary (`154`: one noun per thing).
 *
 * ⚠️ **`agent`'s heading here is a FALLBACK and is not what the palette usually draws** — see
 * {@link groupLabel}. The band names the provider, and the provider is not known to this constant.
 */
export const GROUP_LABEL: Record<PaletteGroup, string> = {
  this: 'This conversation',
  conversations: 'Conversations',
  go: 'Go to',
  agent: "The agent's own commands",
}

/**
 * ⛔ **The heading as DRAWN — and the agent band names whose commands these are** (279 §2).
 *
 * ⚠️ **`279` §2 requires BroBot's commands and the agent's to be *"visibly distinguishable"*, and a
 * heading is the cheapest place to do it that cannot be mistaken for decoration**: *"Claude's own
 * commands"* over rows reading `/compact` says, in the two facts a person needs, that these belong
 * to something other than BroBot and are typed rather than pressed. A shared *"Commands"* heading
 * would teach the wrong model of the app — which is the failure the dispatch names by name.
 *
 * ⚑ **The provider's name comes from the session's own `meta`, never from a branch here.** `039`'s
 * rule is that the renderer must not decide anything from which provider a session runs; this
 * *prints* the name it was handed, which is the one thing that is not deciding.
 */
export function groupLabel(group: PaletteGroup, agent: PaletteAgent | null): string {
  if (group !== 'agent' || agent === null) return GROUP_LABEL[group]
  return `${providerName(agent.provider)}'s own commands`
}

/**
 * What running a row DOES — data, never a closure.
 *
 * ⚠️ **Split by who may perform it, because that split is the whole shape of this dispatch.**
 * `navigate` actions are the ones the left rail already emits and `RuntimeScreen` already handles;
 * `export` is the one verb reachable straight off `window.api`.
 */
export type PaletteAction =
  /**
   * The rail's `select` — ⚑ **D-017b · for every conversation in the list**: it opens in its one full
   * view, whether or not anything runs it.
   */
  | { readonly kind: 'select'; readonly sessionId: string }
  /**
   * The rail's `go`. ⚑ `566` added `'tools'` and `570` `'team'`; the literal union is what makes
   * the four sites move together, and it must stay a SUBSET of `SideRail`'s own `go` emit —
   * `fromPalette` hands this value straight out.
   */
  | {
      readonly kind: 'go'
      readonly place:
        /** ⚑ **606 · `EXT-008` §3's two destinations**, and they are two rows here for the same
            reason they are two in the rail: one is COMPLETE and one is WINDOWED (`HO-025` §2). */
        'waiting' | 'away' | 'sessions' | 'tools' | 'team' | 'providers'
    }
  /** The rail's `newConversation`. */
  | { readonly kind: 'new' }
  /** `window.api.runtime.exportSession` — the only verb here that is not a rail emit. */
  | {
      readonly kind: 'export'
      readonly sessionId: string
      readonly exportKind: 'native' | 'bundle'
    }

/**
 * The actions the palette hands BACK to the rail, as opposed to performing itself.
 *
 * ⛔ **A type, not a comment, because the split is the constraint this dispatch was given.** The
 * palette may reach a store or the bridge directly; it may not write `place`/`activeId`, which live
 * on `RuntimeScreen`. Subtracting `export` here means a seventh action kind cannot be quietly
 * routed to the rail — it fails the exhaustive switch on the other side and has to be argued.
 */
export type PaletteNavigation = Exclude<PaletteAction, { kind: 'export' }>

/**
 * ⛔ **What the running agent will answer to, as this palette needs it** (279).
 *
 * ⚠️ **`set: null` and `set: {commands: []}` are different and are drawn differently** — see
 * {@link agentNote}. `null` is *"nobody has told us"* (a session that has not started, a read that
 * failed, a recording being read back); `[]` is the provider's own answer that it has none.
 */
export interface PaletteAgent {
  /**
   * Which provider this conversation runs — **read through {@link providerName}, never printed
   * raw** (`151`'s register, applied by `169` §2).
   *
   * ⚠️ **`Provider`, not `string`, and the narrowing is what buys the table.** `PaletteOpenRow`'s
   * own `meta.provider` is a bare `string` and this file prints it raw one band up, which is how
   * *"codex · idle"* reads on a row today. That is tolerable on a detail line and is not tolerable
   * in a HEADING and a sentence: `PROVIDER_NAME` exists precisely so a surface says *Claude* rather
   * than *claude*, and `reading-pane.render.test.ts` enforces that a label in running prose is not
   * something the renderer writes for itself.
   *
   * ⚑ **Printed, never compared.** `039`'s rule forbids branching on which provider a session runs;
   * looking a name up in a table is not branching, and adding a third provider makes the table fail
   * to compile rather than making this band say *"provider"*.
   */
  readonly provider: Provider
  /** What the provider last said, whole: the rows and the prefix a person types. `null` = untold. */
  readonly set: ProviderCommandSet | null
  /**
   * Rows the provider named that {@link set} does not carry — past the cap, or with no usable name.
   *
   * ⚠️ **Non-zero is SAID OUT LOUD** ({@link agentNote}), because `247` §3's rule holds here too: *"a
   * registry that quietly undercounts is worse than none."* A person hunting for a command that is
   * not in the band has to be able to tell "this agent does not have it" from "we could not list
   * everything".
   */
  readonly dropped: number
}

export interface PaletteCommand {
  /** Stable, and used as the `<li>`'s DOM id so `aria-activedescendant` can name it. */
  readonly id: string
  /** The line a person reads and types against. */
  readonly title: string
  /**
   * The second line: what this is, or which conversation it acts on. `null` renders nothing —
   * an absent line, never an empty one (`211` §3's rule for the rail's opening line).
   */
  readonly detail: string | null
  readonly group: PaletteGroup
  /**
   * Words a search should match that are NOT on screen — a session id, a provider name.
   *
   * ⚠️ **Matched but never displayed**, which is a claim this file has to keep: {@link matches}
   * searches these, so {@link searchedNote} says "titles, folders, ids and provider names" rather
   * than the shorter "titles" that would be a lie about the second half.
   */
  readonly keywords: readonly string[]
  /**
   * What Enter does — or **`null` for a row this palette can only SHOW** (279 §3).
   *
   * ⛔ **`279` §3 rules running a provider command out of scope and permits listing one anyway
   * *"as long as it says so"*.** This is how it says so, and it says it in the type rather than in
   * copy: a row with no action is not a cursor stop (see {@link runnable}), so Enter can never reach
   * one and there is no state in which the palette appears to offer something it will not do.
   *
   * ⚠️ **A `null` here is NOT `106`.** That rule is about a control that LOOKS like it acts and does
   * not. These rows never highlight, never take the cursor, and sit under a heading naming somebody
   * else's commands, above a sentence saying where to type them — which is `239`'s standard:
   * the way forward is stated in the thing that cannot do it for you.
   */
  readonly action: PaletteAction | null
}

/** The shape of one of `SideRail`'s own rows — see {@link buildCommands}. */
export interface PaletteOpenRow {
  readonly sessionId: string
  /** Which provider it runs on, as the rail row prints it — or `null` before the host has said. */
  readonly provider: string | null
  /**
   * 🔴 **WHO is in it since 449** — the rail's own `label`, which was the folder until then.
   *
   * ⛔ **This row is handed in for exactly that reason** and the header below says so: a palette
   * that re-labelled `store.open` would be *"a second derivation of a fact the rail computes
   * fourteen lines away"*. ⚠️ **So when the rail's label changed meaning, this one did too, and
   * nothing here had to decide anything** — which is the property being relied on, stated once
   * where a reader meets it.
   */
  readonly label: string
  /**
   * 🔴 **D-016 · commit 7 · R2 — the work that names it** — the rail's own `named`, off the host's
   * row, handed in for {@link label}'s reason: never re-derived here. ⚑ The row's title
   * ({@link conversationTitle}), with {@link label} beside it.
   */
  readonly named: WorkThatNamesIt | null
  /**
   * ⛔ **WHERE it is working, or `null`** (449) — the folder the label used to be.
   *
   * ⚠️ **It is on this shape because the TITLE stopped carrying it.** A person who knows a
   * conversation by its folder could search for it here while the folder WAS the title; dropping it
   * would have made a searchable fact unsearchable in the same commit that stopped displaying it.
   */
  readonly place: string | null
  /** The rail row's word — the SAME word the rail row shows (`203`). */
  readonly word: string
  /** `record.opening`, ≤120 chars, or `null` for a conversation whose beginning this window never saw. */
  readonly opening: string | null
}

export interface PaletteInput {
  /** `SideRail`'s `rows` — the one list, already labelled, already worded. Not the store. */
  readonly conversations: readonly PaletteOpenRow[]
  /** The conversation on screen, or `null`. Decides whether the `this` band exists at all. */
  readonly activeId: string | null
  /**
   * ⛔ **What the conversation on screen's own agent can do** (279), or `null` when there is no
   * conversation on screen at all.
   *
   * ⚠️ **Two nulls, one inside the other, and they mean different things.** This being `null` is
   * *"there is no agent to talk about"* — the launcher, the Team page, the library. `agent.set` being
   * `null` is *"there is an agent and nobody has told us what it can do"*. Collapsing them would
   * make the palette say the same sentence on a surface with no conversation and on a conversation
   * whose provider never answered, which are not the same news.
   */
  readonly agent: PaletteAgent | null
}

/**
 * Every row this palette can offer, in band order.
 *
 * ⛔ **A band with nothing in it is ABSENT, not empty** (`118`: an honest absence beats a control
 * that refuses). With no conversation on screen there is no *This conversation* band and no export
 * rows — not a greyed pair, because "when will this work" has an answer the palette cannot give
 * from here, and `106`/`030`'s fork says absent is the honest choice when it cannot.
 *
 * ⚠️ **The conversation rows are the RAIL's rows, handed in.** A palette that read the store and
 * re-labelled it would be a second derivation of a fact the rail computes fourteen lines away,
 * which is `099` exactly: the two would eventually describe one conversation differently.
 */
export function buildCommands(input: PaletteInput): PaletteCommand[] {
  const commands: PaletteCommand[] = []

  const active = input.activeId
  if (active !== null) {
    const row = input.conversations.find((candidate) => candidate.sessionId === active)
    // ⚠️ **Absent rather than a guess**, and the reachable cause is not the one first written here.
    // The old comment said *"a conversation whose `meta` has not arrived"* — but `store.open`
    // already excludes `meta === null`, so that case never reaches this line (found in this
    // dispatch's own review). What DOES reach it is a conversation that has ENDED while still on
    // screen: `store.open` filters `phase !== 'ended'`, and `useSurface` deliberately keeps an
    // ended conversation selected rather than blanking it mid-sentence. ⛔ **So the export rows are
    // absent for exactly the conversation a person is most likely to want to export**, and 249's
    // response names that as a gap rather than pretending a label it does not have.
    if (row) {
      const called = conversationTitle(row.label, row.named)
      commands.push({
        id: 'this-export-native',
        title: 'Export this conversation — provider file',
        detail: `${called} · the provider's own file, byte for byte`,
        group: 'this',
        keywords: [active, row.provider ?? '', 'save', 'download', 'native'],
        action: { kind: 'export', sessionId: active, exportKind: 'native' },
      })
      commands.push({
        id: 'this-export-bundle',
        title: 'Export this conversation — bundle',
        detail: `${called} · the provider frames and our ledger in one file`,
        group: 'this',
        keywords: [active, row.provider ?? '', 'save', 'download', 'brobot-session'],
        action: { kind: 'export', sessionId: active, exportKind: 'bundle' },
      })
    }
  }

  // ⚑ **D-017b · every conversation in the rail's one list, one row each** — pressing any of them
  // opens it in its full view, whatever it is doing, so there is one band and one action.
  for (const row of input.conversations) {
    const id = row.sessionId
    // ⚑ **449 · the rail's own three facts, in the rail's own order**, when there is no opening
    // line to prefer — the row's `<small>` reads the same way.
    const facts =
      row.opening ??
      [row.provider ?? 'unknown', row.word, row.place]
        .filter((part) => part !== null && part !== '')
        .join(' · ')
    commands.push({
      id: `open-${id}`,
      // ⚑ **D-016 · commit 7 · R2 — the work that names it is the title**, and the agent's name
      // leads the line under it, as it leads the rail row's; a row that holds no piece is titled by
      // its agent's name, as before.
      title: conversationTitle(row.label, row.named),
      detail: row.named === null ? facts : `${row.label} · ${facts}`,
      group: 'conversations',
      keywords: [
        id,
        row.provider ?? '',
        row.word,
        // ⛔ **449 · the folder is still how a person finds it**, even though it is no longer the
        // title — see {@link PaletteOpenRow.place}.
        row.place ?? '',
        'jump',
        'switch',
        'go',
        'open',
      ],
      action: { kind: 'select', sessionId: id },
    })
  }

  commands.push({
    id: 'go-new',
    title: 'New conversation',
    detail: 'The surface a conversation starts on',
    group: 'go',
    keywords: ['start', 'launch', 'begin', 'cmd n'],
    action: { kind: 'new' },
  })
  commands.push({
    id: 'go-sessions',
    // ⛔ The rail's noun, not a second one (`154`): the page holds both kinds and is named for
    // neither. A palette that called it "Sessions" would reopen the vocabulary split `154` closed.
    title: 'All conversations',
    detail: "Conversations from here, and from Claude's and Codex's own folders",
    group: 'go',
    keywords: ['sessions', 'library', 'search', 'history', 'archive', 'find', 'export', 'import'],
    action: { kind: 'go', place: 'sessions' },
  })
  commands.push({
    id: 'go-waiting',
    // ⛔ The rail's noun (`154`), which is the one word the row, this title and the page's `h1`
    // all use.
    title: 'Waiting on you',
    // ⚑ **The sentence the rail row deliberately does not carry** (`EXT-008` §5), on the row that
    // is a search result and therefore has to say what it opens. ⚠️ **It names the BOUND**, which
    // is the one fact that distinguishes this destination from the one below it (`HO-025` §2).
    detail:
      'Everything still open, however old — permissions, questions and rules waiting for your approval',
    group: 'go',
    keywords: ['waiting', 'needs', 'attention', 'queue', 'permission', 'question', 'settle', 'owe'],
    action: { kind: 'go', place: 'waiting' },
  })
  commands.push({
    id: 'go-away',
    title: 'Recent activity',
    // ⚑ **The BOUND again, and it is the other one** — this list is windowed and the one above is
    // not. ⛔ Two destinations whose details did not say which would be two views of one thing to
    // anybody reading the palette.
    detail: 'What changed in the chosen window, read from the ledger',
    group: 'go',
    keywords: [
      'while you were away',
      'digest',
      'away',
      'changed',
      'overnight',
      'catch up',
      'catchup',
      'since',
      'window',
    ],
    action: { kind: 'go', place: 'away' },
  })
  commands.push({
    id: 'go-tools',
    // ⛔ The rail's noun (`154`), which is the one word both surfaces use — see `SideRail`'s row.
    title: 'Tools',
    // ⚑ **The palette's `detail` is the sentence the rail row does NOT carry.** `EXT-008` §5 keeps
    // explanatory prose out of the navigation column; a palette row is a search result and has to
    // say what it opens, which is the same argument `go-sessions` above already rests on.
    detail: 'The external MCP servers registered on this machine',
    group: 'go',
    keywords: ['mcp', 'server', 'servers', 'external', 'registry', 'register', 'add server'],
    action: { kind: 'go', place: 'tools' },
  })
  commands.push({
    id: 'go-team',
    // ⛔ The rail's noun (`154`), and the noun was DECIDED: `561` §1 put *Team versus Agents* to
    // the designer and refused to pick; v2.10's changelog §7 answered *"I kept Team… the
    // individual noun stays agent."* ⚑ So this title, the rail row and the page's `h1` are one
    // word, and every gesture inside the page still says *agent*.
    title: 'Team',
    // ⚑ The sentence the rail row deliberately does not carry (`EXT-008` §5), on the row that is
    // a search result and therefore has to say what it opens.
    detail: 'Every agent identity on this machine, run or not',
    group: 'go',
    keywords: ['agent', 'agents', 'identity', 'identities', 'roster', 'team', 'people', 'who'],
    action: { kind: 'go', place: 'team' },
  })
  commands.push({
    id: 'go-providers',
    title: 'Providers',
    detail: 'Whether each provider is ready, its login, API key, usage and models',
    group: 'go',
    keywords: [
      'provider',
      'login',
      'sign in',
      'api key',
      'key',
      'usage',
      'limit',
      'models',
      'version',
      'settings',
    ],
    action: { kind: 'go', place: 'providers' },
  })
  // ⛔ **LAST, and the order is a judgement rather than an accident** (279). The measured Claude
  // catalogue is **44 rows** — more than every other band put together on an ordinary install — so
  // building it second would push a person's own conversations below the fold on an EMPTY query,
  // which is the gesture `220` asked for this palette by name. Ranking rescues the search case
  // without costing the browse case: {@link bandedResults} sorts bands by their best row, so typing
  // `comp` lifts this band to the top the moment it is the best answer.
  for (const command of input.agent?.set?.commands ?? []) {
    const prefix = input.agent?.set?.prefix ?? ''
    commands.push({
      // ⚠️ Namespaced, because a provider names its own commands and one of them could collide with
      // a row id built above — `go-team` is a plausible skill name. The DOM id is what
      // `aria-activedescendant` points at, so a duplicate is not cosmetic.
      id: `agent-${command.name}`,
      // ⛔ **Written the way the provider writes it**, prefix and all: `/compact`, `$imagegen`. The
      // prefix is the SET's, measured per provider, so this line cannot tell a Codex user to type a
      // slash — see `provider-commands.ts` for where the two sigils were measured.
      title: `${prefix}${command.name}`,
      detail: commandDetail(command.description, command.argumentHint),
      group: 'agent',
      // ⚠️ The bare name is a keyword as well as part of the title, so typing `compact` without the
      // sigil finds it — which is what a person does. Aliases are matched and never drawn, exactly
      // as this interface's `keywords` doc promises: `/cost` finds `/usage`.
      keywords: [command.name, ...(command.aliases ?? []), 'command', 'skill', 'agent'],
      // ⛔ **Listed, never run** — see {@link PaletteCommand.action} and `279` §3.
      action: null,
    })
  }

  return commands
}

/**
 * A command's second line: what it does, and what it takes after it.
 *
 * ⛔ **Whitespace is COLLAPSED, and that is measured rather than defensive** (279). One of the 44
 * live Claude descriptions contains newlines — `/claude-api`'s, which is a multi-line TRIGGER block
 * written for the model rather than for a reader — and `.palette-row small` is a single clipped
 * line. Left alone it renders as one run-on with the line breaks eaten by the browser anyway; the
 * difference is that a collapsed string is also what a `title` hover shows, and what `score`
 * searches.
 *
 * ⚠️ **The argument hint is appended rather than dropped.** 17 of the 44 rows carry one, and it is
 * the difference between knowing a command exists and knowing how to use it — `/code-review` taking
 * `[low|medium|high|xhigh|max|ultra] [--fix]` is most of what a person needs from this band.
 * `null` when the provider gave neither, so the row draws no second line at all rather than a blank
 * one (`211` §3).
 */
export function commandDetail(description?: string, argumentHint?: string): string | null {
  const said = (description ?? '').replace(/\s+/g, ' ').trim()
  const takes = (argumentHint ?? '').replace(/\s+/g, ' ').trim()
  const line = [said, takes && `takes ${takes}`].filter(Boolean).join(' · ')
  return line === '' ? null : line
}

/**
 * ⛔ **Whether Enter may reach this row** — false for the agent's own commands (279 §3).
 *
 * ⚑ **One predicate, and the cursor, the keyboard and the click all ask it**, which is `169` §1's
 * rule: a row that is not a cursor stop but is still clickable would be the split gesture that
 * dispatch spent itself on, upside down.
 *
 * ⛔ **A TYPE GUARD rather than a `boolean`, and the compiler is what makes that load-bearing.** It
 * returned a plain boolean first, and `run()` then failed to build: nothing narrowed
 * {@link PaletteCommand.action} for the switch below it, so §3's rule was enforced only by a guard
 * clause somebody could delete. Narrowing here means a build that tried to route a listed row
 * through the navigation path does not compile — the rule is in the type, which is what
 * {@link PaletteCommand.action}'s own doc claims for it.
 */
export function runnable(
  command: PaletteCommand,
): command is PaletteCommand & { readonly action: PaletteAction } {
  return command.action !== null
}

/**
 * How well one row answers what was typed — higher is better, `0` is "not a match".
 *
 * ⚠️ **Ranked rather than merely filtered, because Enter runs the FIRST row.** An unranked list
 * would put whichever command happened to be built first under a person's finger; with a rank, a
 * row whose title starts with what was typed wins over one that merely mentions it somewhere.
 *
 * ⛔ **A keyword match scores lowest on purpose.** Keywords are matched and never drawn, so a row
 * that surfaced only because of one has nothing on screen explaining why it is there — it may be
 * found, but it may not outrank a row the reader can see the reason for.
 *
 * ⚠️ **The first version SAID that and did not do it** — a detail match and a keyword match both
 * returned `1`, so the tie fell to band order and `this` is built first (found in this dispatch's
 * own review). Concretely: a conversation whose opening line is *"download the artifacts"*, with
 * the query `download`. The conversation matched on the line a person can SEE; the two export rows
 * matched on an invisible keyword — and the export rows won, so Enter wrote a file. The docblock
 * was the specification and the code was a rank short of it.
 */
export function score(command: PaletteCommand, needle: string): number {
  const query = needle.trim().toLowerCase()
  if (query === '') return 1
  const title = command.title.toLowerCase()
  if (title === query) return 5
  if (title.startsWith(query)) return 4
  if (title.includes(query)) return 3
  if ((command.detail ?? '').toLowerCase().includes(query)) return 2
  if (command.keywords.some((word) => word.toLowerCase().includes(query))) return 1
  return 0
}

/** Whether this row answers what was typed at all. */
export function matches(command: PaletteCommand, needle: string): boolean {
  return score(command, needle) > 0
}

/**
 * The rows to draw, best first, ties in build order.
 *
 * ⚠️ **A stable sort is load-bearing**, not a detail: within one rank the build order is band order,
 * so an empty query draws *This conversation* → *Conversations* → *Closed* → *Go to* exactly as
 * {@link buildCommands} laid them out. `Array.prototype.sort` has been required to be stable since
 * ES2019, so this is a guarantee rather than an observation.
 */
export function filterCommands(
  commands: readonly PaletteCommand[],
  needle: string,
): PaletteCommand[] {
  return commands
    .map((command, at) => ({ command, at, rank: score(command, needle) }))
    .filter((row) => row.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.at - b.at)
    .map((row) => row.command)
}

/** The rows of one band, in order — `[]` when the band has none, so the band is not drawn. */
export function inGroup(
  commands: readonly PaletteCommand[],
  group: PaletteGroup,
): PaletteCommand[] {
  return commands.filter((command) => command.group === group)
}

export interface PaletteBand {
  readonly group: PaletteGroup
  readonly rows: readonly PaletteCommand[]
}

/**
 * ⛔ **The rows AS DRAWN — bands kept, and ordered so that the best match is still the first thing
 * on screen.**
 *
 * ⚠️ **This exists because the first version had two orders and only one cursor.** Rows were ranked
 * into one list, the panel drew them grouped by band, and the two disagreed the moment a match was
 * better than the band above it: typing a folder name put the highlight on the third visible row
 * while the reader's eye — and every palette they have ever used — was on the first. Enter still ran
 * the highlighted row, so nothing lied; it was simply a surface whose two answers to *"which one is
 * this about"* were different, which is `099`'s shape even when both halves are honest.
 *
 * ⚑ **So there is ONE order.** A band is ranked by its best row, rows are ranked within it, and the
 * flattening of this is what the cursor walks — see the panel's `shown`. Ties keep declaration
 * order, so an empty query draws exactly what {@link buildCommands} built.
 *
 * ⚠️ **The bands are kept rather than flattened away while searching**, which is the other thing a
 * palette usually does: a conversation, a destination and one of the agent's own commands are
 * different things to press. ⚑ **D-017b · one band holds every conversation**, and pressing any of
 * them opens it — whatever it is doing.
 */
export function bandedResults(commands: readonly PaletteCommand[], needle: string): PaletteBand[] {
  return PALETTE_GROUPS.map((group) => ({
    group,
    rows: filterCommands(inGroup(commands, group), needle),
  }))
    .filter((band) => band.rows.length > 0)
    .sort((a, b) => score(b.rows[0]!, needle) - score(a.rows[0]!, needle))
}

/**
 * ⛔ **What this palette actually looked at** — the sentence `249` §2 requires and `106` is about.
 *
 * ⚠️ **Three states, not two, and the third is the one that matters.** Before the list's reads
 * answer, the palette has searched only the conversations this window holds, and a count there would
 * be `119`'s wrong number wearing a real number's clothes; a read that FAILED is its own state, and
 * says so rather than promising an answer that is not coming. ⚑ **D-017b** — one list, so one count.
 */
export function searchedNote(counts: {
  /** How many conversations were searched. */
  conversations: number
  /** Whether the list's reads have answered. */
  looked: boolean
  /** What the list's read said when it failed, or `null`. */
  failed?: string | null
}): string {
  const searched = `${counts.conversations} ${counts.conversations === 1 ? 'conversation' : 'conversations'}`
  const where = "this window's destinations — titles, folders, ids and provider names"
  if (counts.failed && !counts.looked) {
    return `Searched ${searched} and ${where}. The list of conversations could not be read, so only the ones on screen here were searched.`
  }
  if (!counts.looked) {
    return `Searched ${searched} and ${where}. The list of conversations has not answered yet.`
  }
  return `Searched ${searched} and ${where}.`
}

/**
 * ⛔ **What the agent on screen can do, and what this palette will not do with it** (279 §2, §3).
 *
 * ⚠️ **Four states, and the dispatch asks for three of them by name.** §2: *"A session that has not
 * started has no provider commands. Say so; do not show an empty section as though the agent had
 * none."* §3: *"a palette that lists a command it cannot run is honest as long as it says so."*
 *
 * | state | what it means | what is drawn |
 * |---|---|---|
 * | `agent === null` | no conversation on screen | ⛔ **nothing** — see below |
 * | `set === null` | there is an agent and nobody has told us | a sentence, no band |
 * | `set.commands === []` | the provider answered: it has none | a sentence, no band |
 * | rows | the provider answered with commands | the band, and this sentence under it |
 *
 * ⛔ **`null` for the no-conversation case rather than a sentence, deliberately.** With nothing on
 * screen there is no agent to describe, and *"open a conversation to see what its agent can do"* is
 * noise in a palette whose whole purpose at that moment is to open one. The absence is the honest
 * rendering (`118`), and the foot sentence still says what WAS searched.
 *
 * ⚠️ **The last row's sentence carries §3's disclosure and is the reason this is drawn even when the
 * band is full.** The band shows 44 rows that look exactly like the pressable rows above them; what
 * makes that honest is one line saying they are typed into the conversation and that BroBot will not
 * run them from here. Without it the band would be `106` with a heading.
 *
 * ⚑ **`dropped` is folded into the same sentence rather than given its own**, because a person
 * reading *"44 commands"* and a person reading *"we could not list them all"* are the same person at
 * the same moment, and two lines would let one be missed (`092`'s rule, `247`'s wording).
 */
export function agentNote(agent: PaletteAgent | null | undefined): string | null {
  // ⚠️ **Nullish rather than `=== null`**, and it matches {@link buildCommands}' own `input.agent?.`
  // one line for one line. The prop is REQUIRED, so an omitted `agent` is a caller bug — but the two
  // readers of it must agree about what a missing one means, and *"no agent to talk about"* is the
  // same answer for `undefined` as for `null`. The alternative is a palette that renders its band
  // and throws on its sentence, which is how 26 of `command-palette.dom.test.ts`'s tests went red on
  // a prop none of them was about.
  if (!agent) return null
  const named = providerName(agent.provider)
  if (agent.set === null) {
    return `BroCrew has not been told what ${named} can do here — it is told when this conversation takes its next message, unless its provider does not answer.`
  }
  const { commands, prefix } = agent.set
  if (commands.length === 0) {
    return `${named} reports no commands of its own for this conversation.`
  }
  const short = agent.dropped > 0 ? ` ${agent.dropped} more could not be listed.` : ''
  const many = commands.length === 1 ? '1 command' : `${commands.length} commands`
  return `${named} answers to ${many} of its own.${short} Type one with ${prefix} in the conversation — BroCrew lists them and does not run them.`
}

/**
 * ⛔ **The heading of a search miss** — the query, quoted back, in the app's curly quotes.
 *
 * ⚠️ **`104`/`105`'s rule, not `118`'s**: a search miss and an empty install are different
 * situations with different answers, and `105` shipped a defect for exactly this — a stale heading
 * *"quoting, in its own heading, a string nobody had searched"*. This palette cannot repeat that,
 * because it filters synchronously off state it already holds: there is no window in which the
 * heading names one query and the rows another.
 */
export function noMatchHeading(query: string): string {
  return `Nothing matches “${query.trim()}”`
}

/**
 * ⛔ **…and the way out of it, stated in the refusal itself** (`239`: *"the workaround is
 * discoverable because it is stated in the refusal"*).
 *
 * ⚠️ **It names the destinations too, and the first version did not** (found in this dispatch's own
 * review). *"the conversations this window has open and the closed ones you can pick up"* left out
 * the rows that are ALWAYS searched and are the only ones a fresh install has — so on a new machine
 * it described a palette that had searched nothing, two lines above a foot sentence that said it had
 * searched this window's destinations. Two adjacent sentences, disagreeing.
 *
 * ⚠️ **It does NOT promise to carry the query.** *All conversations* is a page with its own search
 * box, and this palette has no way to hand its text across — `RuntimeScreen`'s `@go` takes a place
 * and nothing else. A sentence reading *"search all conversations for X"* would land a person on an
 * empty box and be `104`'s control that describes a state it is not in.
 */
export const NO_MATCH_BODY =
  'This palette searches where you can go and the conversations in the list. Every conversation on this machine is on All conversations, which has its own search.'

/** The row that gets a person out of a miss — always offered, and it is a real destination. */
export const NO_MATCH_ESCAPE: PaletteNavigation = { kind: 'go', place: 'sessions' }

/**
 * # ⛔ Why a send chord does nothing while this palette is open (292 §4, from `288` M1)
 *
 * ## The defect
 *
 * The palette RETURNS for a modified Enter, and its comment says why: *"⌘↵ and ⇧⌘↵ are NOT this
 * panel's — they mean send/queue and interrupt-and-send in the composer"*. ⚠️ **The intent was that
 * the chord passes through, and it cannot.** The send handler is `@keydown.enter` on the composer's
 * textarea; an event dispatched at the palette's own input bubbles to its ancestors and to
 * `window`, and there is no path sideways into a sibling control. ⛔ So the chord did nothing at
 * all: no send, no queue, no interrupt, no refusal, and the palette stayed open — `106`'s *"the
 * gesture happened and quietly did nothing"*, on a chord the composer's own hint advertises.
 *
 * ## ⛔ Refused rather than wired, and the reason is what the destructive half would do
 *
 * The reviewer offered both. ⚠️ **Wiring it would mean a second send gate**: `canSend`, the queue
 * rule and `hasQueued` all live in the composer, and a window-level handler answering for them is
 * the two-readings-of-one-rule defect `219`/`221`/`223` each spent a dispatch closing. ⛔ **And
 * ⇧⌘↵ ASKS a running turn to stop** — which, honoured, throws away whatever thinking is in flight
 * (`739`: since R43 the provider may finish first) — which is not
 * something a modal somebody is typing a search into should be able to do on their behalf.
 *
 * ⚑ **So the palette says it, and names the one key that fixes it.** `239`'s rule: the way out is
 * stated in the refusal.
 */
export const SEND_CHORD_REFUSED =
  'Send shortcuts belong to the conversation, not to this palette — press Esc to close it, then send.'
