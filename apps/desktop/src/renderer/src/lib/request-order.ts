import { PROVIDER_NAME } from '../../../shared/runtime-ipc'
import type { ProviderSnapshot, SnapshotPart } from '../../../shared/provider-snapshots'
import type {
  GivenFile,
  GivenSection,
  GivenSkill,
  GivenText,
  GivenTextIs,
  WhatThisAgentWasGiven,
} from '../../../shared/what-this-agent-was-given'
import { WHOSE_WORDS } from '../../../shared/whose-text'
import { savedMethodsNowSaid, savedMethodsUseSaid } from '../../../shared/saved-methods'
import { textPackRefusedSaid, textPackSourceSaid } from '../../../shared/text-pack'
import { AUTHOR, MADE_WORDS, type InputMessage } from './agent-inputs'
import { refusalWords } from './refusal-words'

/**
 * "What this agent receives" in request order: one tab per position in the request, and in each
 * tab its parts in the order the agent got them. The provider's stored copy gives the order for
 * this conversation's model and marks with `⟨BroBot’s part: …⟩` where this app's text goes, so
 * the real text is put in at that mark and never moved to another tab.
 */

/** Where a part's text came from. */
export const TRUST = {
  atLaunch: 'Recorded at launch',
  withMessage: 'Recorded with message',
  thisBuild: 'This build',
  readNow: 'Read now',
  notRecorded: 'Not recorded',
  notSent: 'Not sent',
} as const

export const providerCopy = (version: string): string => `Provider copy · ${version}`

/** Where a heading, a paragraph or a memory file came from, as the host says. */
export const TRUST_OF_KEPT: Readonly<Record<'as-launched' | 'composed-now' | 'read-now', string>> =
  {
    'as-launched': 'Recorded at launch',
    'composed-now': 'This build',
    'read-now': 'Read now',
  }

export const TRUST_OF_TEXT: Readonly<Record<GivenTextIs, string>> = {
  'as-launched': TRUST.atLaunch,
  'read-now': TRUST.readNow,
  'composed-now': TRUST.thisBuild,
  unreadable: TRUST.notRecorded,
}

/** One piece of a row's body, in the order it was sent. */
export type Piece =
  | { readonly kind: 'text'; readonly text: string }
  /** Where this app's text sits inside the provider's. */
  | { readonly kind: 'join'; readonly text: string }
  | { readonly kind: 'boundary'; readonly text: string }
  /** Who wrote the text that follows, and where it came from, when it differs from its row's. */
  | { readonly kind: 'label'; readonly author: string; readonly trust: string }
  | { readonly kind: 'missing'; readonly text: string }
  | { readonly kind: 'notice'; readonly text: string; readonly cy: string }
  | { readonly kind: 'tools'; readonly tools: readonly { name: string; text: string }[] }
  /** This app's tools, each with its arguments. */
  | { readonly kind: 'brobot-tools' }
  /** The tools' namespace line, as the provider was handed it. */
  | { readonly kind: 'namespace'; readonly text: string }
  /** What of a provider part differs from one agent to another. */
  | { readonly kind: 'varies'; readonly text: string }
  | { readonly kind: 'servers' }
  /** The skills the agent has, as its provider listed them. */
  | {
      readonly kind: 'skills'
      readonly heading?: string
      readonly author?: string
      readonly listedBy: string
      readonly skills: readonly GivenSkill[]
      /** How many the provider listed that are not shown. */
      readonly dropped: number
      /** Why there is no skill to show, where there is none. */
      readonly none: string | null
    }
  | {
      readonly kind: 'section'
      readonly heading: string
      readonly how: string
      readonly author: string | null
      readonly text: string
    }
  | { readonly kind: 'message'; readonly message: InputMessage }
  /** A whole text kept beside its pieces, folded. */
  | { readonly kind: 'whole'; readonly title: string; readonly text: string }

export interface ReaderRow {
  readonly kind: 'row'
  readonly key: string
  /** `1.4`, or `—` for a part that is not sent unless the agent asks for it. */
  readonly index: string
  readonly title: string
  readonly author: string | null
  readonly trust: string
  readonly pieces: readonly Piece[]
  readonly open: boolean
}

/** A line between rows: where this app's text joins, or where a part of the request ends. */
export interface ReaderMark {
  readonly kind: 'join' | 'boundary'
  readonly key: string
  readonly text: string
}

export type ReaderItem = ReaderRow | ReaderMark

export interface ReaderTab {
  readonly key: string
  readonly number: number
  readonly label: string
  readonly intro: string
  /** Whether the stored-copy notice belongs at its head. */
  readonly copyNotice: boolean
  readonly items: readonly ReaderItem[]
  readonly foot: readonly string[]
}

/**
 * The words of this view that name this app. Author labels are `AUTHOR` in `agent-inputs.ts`.
 * The markers below match stored copies, including copies made before the app was renamed.
 */
export const SELF_WORDS = {
  joinsSystemPrompt: 'BroCrew’s text joins the system prompt here',
  joinsFirstMessage: 'BroCrew’s text joins the first message here',
  profileFileStarts: 'BroCrew’s profile file starts inside this message',
  toolsParagraph: 'BroCrew’s tools paragraph sits here',
  toolsParagraphTitle: 'BroCrew’s paragraph on its tools',
  toolNames: 'BroCrew’s deferred tool names',
  namespaceAndTools: 'BroCrew’s namespace and tools sit here',
  toolsToLoad: 'BroCrew tools available to load',
  tools: 'BroCrew’s tools',
  messageHandedTo: (name: string): string => `The message this app handed to ${name}`,
  systemPromptIntro: (name: string): string =>
    `${name}’s text comes first. BroCrew’s preamble, file headings, files and conversation details follow in the same reader.`,
  paragraphIsUnderFirstMessage:
    'BroCrew’s paragraph about its tools is under First message → Context after the message.',
  toolsInsideExec:
    'The stored request starts with tool declarations. BroCrew’s tools sit inside the provider’s exec tool.',
} as const

const JOIN_MARK = '⟨BroBot’s text joins the system prompt here⟩'
const BROBOT_TOOLS_MARK = '⟨BroBot’s part: its tools, declared here as code⟩'
const TOOLS_PARAGRAPH_MARK = '⟨BroBot’s part: its paragraph about its tools⟩'
const TOOL_NAMES_MARK = '⟨BroBot’s part: the names of BroBot’s tools⟩'
const MEMORY_INDEX_MARK = '⟨the agent’s memory index: its MEMORY.md⟩'
const MEMORY_SUMMARY_MARK = '⟨the agent’s memory summary: its memory_summary.md⟩'
const PROFILE_FILE_MARK = '⟨BroBot’s part: the AGENTS file it writes for this profile⟩'
const WORKSPACE_FILE_MARK = '⟨BroBot’s part: the workspace’s AGENTS.md⟩'

/** Match the marker without rewriting the stored text around it. */
function matchingMark(text: string, legacy: string): string {
  const current = legacy.replaceAll('BroBot', 'BroCrew')
  return text.includes(current) ? current : legacy
}

/** Above the files a stored copy's AGENTS wrapper did not hold. */
export const NOT_IN_THIS_COPY = 'Not in this copy’s instructions:'
/** The Files tab's intro, for a copy whose wrapper held the profile's file alone. */
export const FILES_INTRO_PROFILE_ONLY =
  'One user message wraps the instruction files this copy holds, followed by the environment.'

/** The parts of a request, numbered within their tab in the order they are added. */
class Stream {
  readonly items: ReaderItem[] = []
  private count = 0
  private readonly tab: number
  constructor(tab: number) {
    this.tab = tab
  }
  row(row: Omit<ReaderRow, 'kind' | 'index'>, sent = true): void {
    const index = sent ? `${String(this.tab)}.${String((this.count += 1))}` : '—'
    this.items.push({ kind: 'row', index, ...row })
  }
  mark(kind: 'join' | 'boundary', text: string): void {
    this.items.push({ kind, key: `${kind}:${String(this.items.length)}`, text })
  }
}

const nameOf = (path: string): string => path.split(/[\\/]/).pop() || path

const FILE_AUTHOR: Readonly<Record<GivenFile['origin'], string>> = {
  brobot: AUTHOR.brobot,
  'a-person': AUTHOR.person,
  'an-agent': AUTHOR.agent,
  'a-repository': AUTHOR.repository,
  'the-provider': AUTHOR.provider,
  unknown: AUTHOR.unknown,
}

const FILE_TITLE: Readonly<Partial<Record<GivenFile['kind'], string>>> = {
  'profile-instructions': 'Profile instructions',
  'workspace-instructions': 'Workspace instructions',
}

/** The folder of the text pack a launch read in place of the shipped texts, if it read one. */
function packOf(given: WhatThisAgentWasGiven): string | null {
  return given.textPack?.refused === null ? given.textPack.folder : null
}

/** The section a text pack replaces: the core for every agent, and BroBot's addition in it. */
const PACK_SECTION = 'How you work'

/**
 * A file's own sections, each with who wrote it, or its whole text where it has none. ⚑ The section
 * a text pack gave names the pack's folder rather than this build.
 */
function bodyOf(
  text: string,
  sections: readonly GivenSection[],
  when: (at: number) => string,
  pack: string | null = null,
): Piece[] {
  if (sections.length === 0) return [{ kind: 'text', text }]
  return sections.map((one) => ({
    kind: 'section',
    heading: one.heading ?? WHOSE_WORDS[one.whose].heading,
    how:
      pack !== null && one.whose === 'factory' && one.heading === PACK_SECTION
        ? textPackSourceSaid(pack)
        : MADE_WORDS[one.made],
    author: one.version
      ? `Version ${String(one.version.version)}: ${one.version.whoWroteItMeans}, ${when(one.version.writtenAt)}`
      : one.made === 'own-notes' && one.ownNotesVersion != null
        ? `Own notes version ${String(one.ownNotesVersion)}`
        : null,
    text: text.slice(one.start, one.end),
  }))
}

/** The `Contents of …` line the model read above a file, without the preamble the first one carries. */
function headingLine(heading: string | undefined): string | null {
  if (heading === undefined) return null
  const at = heading.lastIndexOf('\n\n')
  return at === -1 ? heading : heading.slice(at + 2)
}

function preambleOf(heading: string | undefined): string | null {
  if (heading === undefined) return null
  const at = heading.lastIndexOf('\n\n')
  return at === -1 ? null : heading.slice(0, at)
}

/**
 * The line the model read above a text. Where its provenance differs from the text's, it carries
 * its own label, and the text below carries the row's again.
 */
function headed(
  line: string | null,
  headingIs: 'as-launched' | 'composed-now' | undefined,
  row: { readonly author: string; readonly trust: string },
): Piece[] {
  if (line === null) return []
  // The heading is always this app's line, whoever wrote the text under it.
  const own = headingIs === undefined ? row.trust : TRUST_OF_KEPT[headingIs]
  if (own === row.trust && row.author === AUTHOR.brobot) return [{ kind: 'text', text: line }]
  return [
    { kind: 'label', author: AUTHOR.brobot, trust: own },
    { kind: 'text', text: line },
    { kind: 'label', author: row.author, trust: row.trust },
  ]
}

function fileRow(
  stream: Stream,
  file: GivenFile,
  when: (at: number) => string,
  pack: string | null,
): void {
  const line = headingLine(file.heading)
  const pieces: Piece[] = []
  if (file.refused)
    pieces.push({
      kind: 'notice',
      cy: 'input-file-refused',
      text: `Not sent: ${refusalWords(file.refused)}. It is not counted in the sizes.`,
    })
  if (file.changedSinceLaunch)
    pieces.push({
      kind: 'notice',
      cy: 'input-file-changed',
      text: 'This file has changed since the agent got it: this is how it reads now.',
    })
  if (file.truncated)
    pieces.push({
      kind: 'notice',
      cy: 'input-file-cut',
      text: 'This file was cut where the reader stops: the rest was not sent.',
    })
  const trust = file.refused ? TRUST.notSent : TRUST_OF_TEXT[file.textIs]
  pieces.push(...headed(line, file.headingIs, { author: FILE_AUTHOR[file.origin], trust }))
  if (file.text === null) pieces.push({ kind: 'missing', text: 'This file can’t be read now.' })
  else pieces.push(...bodyOf(file.text, file.sections, when, pack))
  stream.row({
    key: `file:${file.path}`,
    title: FILE_TITLE[file.kind] ?? nameOf(file.path),
    author: FILE_AUTHOR[file.origin],
    trust,
    pieces,
    open: false,
  })
}

/**
 * What a launch was given from its profile's saved methods, under the text it rode in: the count
 * and size or why none was sent, then the index as the folder holds it now, since no record keeps
 * its lines. The same pieces under this conversation's text and under a Codex lead.
 */
function savedMethodsPieces(given: WhatThisAgentWasGiven, when: (at: number) => string): Piece[] {
  if (given.savedMethods === undefined) return []
  const now = given.savedMethodsNow
  return [
    ...savedMethodsUseSaid(given.savedMethods, when).map((said): Piece => ({
      kind: 'notice',
      cy: 'input-saved-methods',
      text: said,
    })),
    ...(now === undefined
      ? []
      : [
          {
            kind: 'notice',
            cy: 'input-saved-methods-now',
            text: savedMethodsNowSaid(now),
          } as const,
          ...((now.is === 'same' || now.is === 'changed') && now.index !== ''
            ? [
                { kind: 'label', author: AUTHOR.agent, trust: TRUST.readNow } as const,
                { kind: 'text', text: now.index } as const,
              ]
            : []),
        ]),
  ]
}

function conversationRow(
  stream: Stream,
  text: GivenText,
  when: (at: number) => string,
  savedMethods: readonly Piece[],
): void {
  const trust = TRUST_OF_TEXT[text.textIs]
  stream.row({
    key: 'this-conversation',
    title: 'This conversation',
    author: AUTHOR.brobot,
    trust,
    pieces: [
      ...headed(headingLine(text.heading), text.headingIs, { author: AUTHOR.brobot, trust }),
      ...bodyOf(text.text, text.sections, when),
      ...savedMethods,
    ],
    open: false,
  })
}

/** This app's files and its block for this conversation, in the order they were sent. */
function brobotText(
  stream: Stream,
  given: WhatThisAgentWasGiven,
  when: (at: number) => string,
): void {
  const preamble = preambleOf(given.files[0]?.heading)
  if (preamble !== null)
    stream.row({
      key: 'preamble',
      title: 'Preamble',
      author: AUTHOR.brobot,
      trust:
        given.files[0]!.headingIs === undefined
          ? TRUST_OF_TEXT[given.files[0]!.textIs]
          : TRUST_OF_KEPT[given.files[0]!.headingIs],
      pieces: [{ kind: 'text', text: preamble }],
      open: true,
    })
  for (const file of given.files) fileRow(stream, file, when, packOf(given))
  if (given.thisConversation)
    conversationRow(stream, given.thisConversation, when, savedMethodsPieces(given, when))
}

/** The memory file a provider puts in front of the model, read now: the one its copy marks. */
function memoryIndex(given: WhatThisAgentWasGiven): Piece[] {
  const index = given.memory.stores
    .find((store) => store.provider === given.provider)
    ?.entries.find((one) => one.kind === 'agent-memory')
  if (index === undefined)
    return [{ kind: 'missing', text: `${AUTHOR.memory} · ${TRUST.notRecorded}` }]
  return [
    {
      kind: 'label',
      author: AUTHOR.memory,
      trust: index.textIs === undefined ? TRUST.readNow : TRUST_OF_KEPT[index.textIs],
    },
    { kind: 'text', text: index.text },
  ]
}

/** The text of a part, with what this app or the agent's memory puts at each of its marks. */
function spliced(
  text: string,
  marks: readonly { mark: string; pieces: () => Piece[] }[],
): { pieces: Piece[]; found: boolean } {
  let pieces: Piece[] = [{ kind: 'text', text }]
  let found = false
  for (const { mark: originalMark, pieces: fill } of marks) {
    pieces = pieces.flatMap((one) => {
      if (one.kind !== 'text') return [one]
      const mark = matchingMark(one.text, originalMark)
      if (!one.text.includes(mark)) return [one]
      found = true
      const [before, ...after] = one.text.split(mark)
      return [
        ...(before?.trim() ? [{ kind: 'text', text: before } as const] : []),
        ...fill(),
        ...(after.join(mark).trim() ? [{ kind: 'text', text: after.join(mark) } as const] : []),
      ]
    })
  }
  return { pieces, found }
}

interface Context {
  /** What of this app's own text has been put in at a mark of the provider's copy. */
  readonly placed: Set<'tools-paragraph' | 'skills'>
  readonly given: WhatThisAgentWasGiven
  /** Whether this window's transcript holds the conversation's start. */
  readonly startLoaded: boolean
  readonly snapshot: ProviderSnapshot | null
  readonly copy: string
  readonly when: (at: number) => string
}

function partsAt(ctx: Context, ...where: SnapshotPart['where'][]): SnapshotPart[] {
  return (ctx.snapshot?.parts ?? []).filter((one) => where.includes(one.where))
}

function toolWasSent(ctx: Context, name: string): boolean {
  const settings = ctx.given.launchSettings
  if (settings?.recorded !== true) return true
  const off = settings.settings.find((one) => one.key === 'tools-off')?.atLaunch
  if (!Array.isArray(off)) return true
  // A declaration may name its tool `functions.<name>` where the launch recorded the bare name.
  return !off.some((one) => one === name || name === `functions.${one}`)
}

/** Where the tools paragraph came from: the launch's own, or this build's in its place. */
function paragraphTrust(ctx: Context): string {
  const textIs = ctx.given.tools.instructions.textIs
  return textIs === undefined ? TRUST.thisBuild : TRUST_OF_KEPT[textIs]
}

function toolsParagraph(ctx: Context): Piece[] {
  ctx.placed.add('tools-paragraph')
  return [
    { kind: 'join', text: SELF_WORDS.toolsParagraph },
    { kind: 'label', author: AUTHOR.brobot, trust: paragraphTrust(ctx) },
    { kind: 'text', text: ctx.given.tools.instructions.text },
  ]
}

/** BroBot's tool names as the provider last listed them, or this build's where it has not. */
function toolNames(ctx: Context): Piece[] {
  const { server, list, listedByTheProvider: listed } = ctx.given.tools
  return [
    { kind: 'join', text: SELF_WORDS.toolNames },
    listed
      ? { kind: 'label', author: AUTHOR.brobot, trust: TRUST.withMessage }
      : { kind: 'label', author: AUTHOR.brobot, trust: TRUST.thisBuild },
    {
      kind: 'text',
      text: listed
        ? listed.names.join('\n')
        : list.map((one) => `mcp__${server}__${one.name}`).join('\n'),
    },
  ]
}

/** A provider part as a row, with this app's and the memory's text at its marks. */
function providerRow(
  stream: Stream,
  ctx: Context,
  part: SnapshotPart,
  open = false,
  extra: readonly Piece[] = [],
): void {
  const sentTools = part.tools?.filter((tool) => toolWasSent(ctx, tool.name))
  const sentText =
    sentTools !== undefined && sentTools.length !== part.tools?.length
      ? sentTools.map((tool) => tool.text).join('\n')
      : part.text
  const { pieces, found } = spliced(part.text, [
    { mark: TOOLS_PARAGRAPH_MARK, pieces: () => toolsParagraph(ctx) },
    { mark: TOOL_NAMES_MARK, pieces: () => toolNames(ctx) },
    { mark: MEMORY_INDEX_MARK, pieces: () => memoryIndex(ctx.given) },
    {
      mark: MEMORY_SUMMARY_MARK,
      pieces: () => [
        { kind: 'join', text: 'The agent’s memory summary sits here' },
        ...memoryIndex(ctx.given),
      ],
    },
  ])
  const memory = part.text.includes(MEMORY_INDEX_MARK) || part.text.includes(MEMORY_SUMMARY_MARK)
  stream.row(
    {
      key: `part:${part.id}`,
      title: part.title,
      author: found
        ? memory
          ? AUTHOR.providerAndMemory
          : AUTHOR.providerAndBrobot
        : AUTHOR.provider,
      trust: ctx.copy,
      pieces: [
        ...(part.varies ? [{ kind: 'varies', text: part.varies } as const] : []),
        ...(part.tools?.length
          ? [
              { kind: 'tools', tools: sentTools ?? [] } as const,
              { kind: 'whole', title: 'The whole part, as sent', text: sentText } as const,
            ]
          : pieces),
        ...extra,
      ],
      open: open || found,
    },
    part.when !== 'when-loaded',
  )
}

/** One provider tool declaration, with this app's namespace and tools where its copy marks them. */
function toolRow(stream: Stream, ctx: Context, tool: { name: string; text: string }): boolean {
  let description: string | null = null
  try {
    const parsed = JSON.parse(tool.text) as { description?: unknown }
    if (typeof parsed.description === 'string') description = parsed.description
  } catch {
    description = tool.text
  }
  const mark = matchingMark(description ?? '', BROBOT_TOOLS_MARK)
  if (description === null || !description.includes(mark)) {
    stream.row({
      key: `tool:${tool.name}`,
      title: tool.name,
      author: AUTHOR.provider,
      trust: ctx.copy,
      pieces: [{ kind: 'text', text: tool.text }],
      open: false,
    })
    return false
  }
  const [before, ...after] = description.split(mark)
  stream.row({
    key: `tool:${tool.name}`,
    title: `${tool.name} · tools declared inside it`,
    author: AUTHOR.providerAndBrobot,
    trust: ctx.copy,
    pieces: [
      { kind: 'text', text: before ?? '' },
      { kind: 'join', text: SELF_WORDS.namespaceAndTools },
      ...namespaceLine(ctx),
      { kind: 'label', author: AUTHOR.brobot, trust: TRUST.thisBuild },
      { kind: 'brobot-tools' },
      { kind: 'boundary', text: 'The provider’s declaration continues' },
      { kind: 'text', text: after.join(mark) },
      { kind: 'whole', title: 'Original stored declaration', text: tool.text },
    ],
    open: true,
  })
  return true
}

/** The line the provider was handed as the tools' own description, where it was handed one. */
function namespaceLine(ctx: Context): Piece[] {
  const namespace = ctx.given.tools.namespace
  if (namespace === undefined) return []
  return [
    { kind: 'label', author: AUTHOR.brobot, trust: TRUST_OF_TEXT[namespace.textIs] },
    { kind: 'namespace', text: namespace.text },
  ]
}

function brobotToolsRow(stream: Stream, ctx: Context): void {
  const deferred = ctx.given.tools.deferral.kind !== 'in-every-request'
  stream.row(
    {
      key: 'brobot-tools',
      title: deferred ? SELF_WORDS.toolsToLoad : SELF_WORDS.tools,
      author: AUTHOR.brobot,
      trust: TRUST.thisBuild,
      pieces: [...namespaceLine(ctx), { kind: 'brobot-tools' }],
      open: false,
    },
    !deferred,
  )
}

function serversRow(stream: Stream, ctx: Context): void {
  if (ctx.given.externalServers.length === 0) return
  stream.row(
    {
      key: 'servers',
      title: 'Other servers it is handed',
      author: null,
      trust: ctx.given.tools.deferral.says,
      pieces: [{ kind: 'servers' }],
      open: false,
    },
    false,
  )
}

function messageRows(stream: Stream, messages: readonly InputMessage[]): void {
  for (const one of messages)
    stream.row({
      key: `message:${one.itemId}`,
      title: one.from,
      author: one.author,
      trust: one.sent === undefined ? TRUST.notRecorded : TRUST.withMessage,
      pieces: [{ kind: 'message', message: one }],
      open: false,
    })
}

/** The first message and any handed over with it in one turn, which share its ledger ordinal. */
function firstTurnOf(messages: readonly InputMessage[]): InputMessage[] {
  const [opening] = messages
  if (opening === undefined) return []
  if (opening.ordinal === undefined) return [opening]
  let end = 1
  while (messages[end]?.ordinal === opening.ordinal) end += 1
  return messages.slice(0, end)
}

/** Where the first message would sit, when this window has not loaded the conversation's start. */
export const FIRST_MESSAGE_NOT_LOADED = 'First message not loaded.'

const MESSAGES_INTRO =
  'Every sent message belongs here in delivery order, including app notices, reports and answers. Open a row to read the whole received text.'

function systemPromptTabs(ctx: Context, messages: readonly InputMessage[]): ReaderTab[] {
  const name = PROVIDER_NAME[ctx.given.provider]
  const system = new Stream(1)
  const inSystem = ctx.given.placement === 'system-prompt'
  let joined = false
  for (const part of partsAt(ctx, 'system-prompt')) {
    // ⚑ A copy captured since the join was recorded marks where this app's text joined; the text
    // after the mark is the provider's again, and stays after it.
    const mark = matchingMark(part.text, JOIN_MARK)
    const at = part.text.indexOf(mark)
    if (at === -1) {
      providerRow(system, ctx, part)
      continue
    }
    const before = part.text.slice(0, at)
    const after = part.text.slice(at + mark.length)
    if (before.trim()) providerRow(system, ctx, { ...part, text: before })
    if (inSystem && !joined) {
      system.mark('join', SELF_WORDS.joinsSystemPrompt)
      brobotText(system, ctx.given, ctx.when)
      joined = true
    }
    if (after.trim()) providerRow(system, ctx, { ...part, id: `${part.id}:after`, text: after })
  }
  // Until then, the join is drawn after the last part of the provider's system prompt.
  if (inSystem && !joined) {
    system.mark('join', SELF_WORDS.joinsSystemPrompt)
    brobotText(system, ctx.given, ctx.when)
  }

  const tools = new Stream(2)
  const now = partsAt(ctx, 'tools').filter((one) => one.when !== 'when-loaded')
  const later = partsAt(ctx, 'tools').filter((one) => one.when === 'when-loaded')
  for (const part of now) providerRow(tools, ctx, part, true)
  if (ctx.given.tools.deferral.kind === 'in-every-request') brobotToolsRow(tools, ctx)
  tools.mark('boundary', 'More definitions arrive only when the agent asks for them')
  for (const part of later) providerRow(tools, ctx, part)
  if (ctx.given.tools.deferral.kind !== 'in-every-request') brobotToolsRow(tools, ctx)
  serversRow(tools, ctx)

  const first = new Stream(3)
  for (const part of partsAt(ctx, 'first-message')) providerRow(first, ctx, part)
  if (!inSystem) {
    first.mark('join', SELF_WORDS.joinsFirstMessage)
    brobotText(first, ctx.given, ctx.when)
  }
  // ⚠️ Only a window holding the conversation's start has its first message; otherwise every
  // loaded message is a later one.
  const firstTurn = ctx.startLoaded ? firstTurnOf(messages) : []
  const rest = messages.slice(firstTurn.length)
  if (firstTurn.length > 0) {
    first.mark('boundary', SELF_WORDS.messageHandedTo(name))
    messageRows(first, firstTurn)
  } else if (!ctx.startLoaded) first.mark('boundary', FIRST_MESSAGE_NOT_LOADED)
  const context = partsAt(ctx, 'context-message')
  if (context.length > 0) {
    first.mark(
      'boundary',
      'Context after the first message · Provider system message in this capture',
    )
    for (const part of context) providerRow(first, ctx, part)
  }
  // ⚠️ With no copy, or a copy with no mark for it, the paragraph is still known: it stays in the
  // first message, as its own part, rather than disappearing.
  if (!ctx.placed.has('tools-paragraph')) {
    first.row({
      key: 'tools-paragraph',
      title: SELF_WORDS.toolsParagraphTitle,
      author: AUTHOR.brobot,
      trust: paragraphTrust(ctx),
      pieces: [{ kind: 'text', text: ctx.given.tools.instructions.text }],
      open: false,
    })
  }

  builtInSkillsRow(system, ctx)

  builtInReminderRow(first, ctx)

  const later2 = new Stream(4)
  builtInReminderRow(later2, ctx)
  messageRows(later2, rest)

  return [
    {
      key: 'system-prompt',
      number: 1,
      label: 'System prompt',
      intro: SELF_WORDS.systemPromptIntro(name),
      copyNotice: true,
      items: system.items,
      foot: [],
    },
    {
      key: 'tools',
      number: 2,
      label: 'Tools',
      intro:
        'Only definitions sent at this position belong here. Deferred names appear with the first message’s context.',
      copyNotice: true,
      items: tools.items,
      foot: context.length > 0 ? [SELF_WORDS.paragraphIsUnderFirstMessage] : [],
    },
    {
      key: 'first-message',
      number: 3,
      label: 'First message',
      intro:
        context.length > 0
          ? 'First the memory and attribution reminders, then the framed message. In this capture, the provider’s context comes after it.'
          : 'First the memory and attribution reminders, then the framed message.',
      copyNotice: true,
      items: first.items,
      foot: [],
    },
    {
      key: 'later-messages',
      number: 4,
      label: 'Later messages',
      intro: MESSAGES_INTRO,
      copyNotice: false,
      items: later2.items,
      foot: [
        `Tool answers remain in the conversation. ${name} may add mid-turn nudges, “Tool loaded.”, memory-age reminders and account-specific text that this stored copy does not keep.`,
      ],
    },
  ]
}

/** What a launch's text pack says beside its skills: the folder they came from, or why it was not used. */
function packNotice(given: WhatThisAgentWasGiven): Piece[] {
  const pack = given.textPack
  if (pack === undefined) return []
  return [
    {
      kind: 'notice',
      cy: 'input-text-pack',
      text: pack.refused === null ? textPackSourceSaid(pack.folder) : textPackRefusedSaid(pack),
    },
  ]
}

function builtInSkillsRow(stream: Stream, ctx: Context): void {
  const offered = ctx.given.builtInSkills
  if (!offered) return
  stream.row(
    {
      key: 'built-in-skills',
      title: 'Built-in skills',
      author: AUTHOR.brobot,
      trust: TRUST.atLaunch,
      pieces: [
        ...packNotice(ctx.given),
        {
          kind: 'skills',
          heading: 'Built-in skills',
          author: AUTHOR.brobot,
          listedBy: TRUST.atLaunch,
          skills: offered.listed,
          dropped: 0,
          none: null,
        },
        { kind: 'text', text: offered.version },
      ],
      open: false,
    },
    false,
  )
}

function builtInReminderRow(stream: Stream, ctx: Context): void {
  const offered = ctx.given.builtInSkills
  if (!offered) return
  stream.row(
    {
      key: 'built-in-skill-reminder',
      title: 'Built-in skills',
      author: AUTHOR.brobot,
      trust: TRUST.atLaunch,
      pieces: [
        ...packNotice(ctx.given),
        { kind: 'text', text: `${offered.version}\n${offered.reminder}` },
      ],
      open: false,
    },
    false,
  )
}

/**
 * The conversation's lead: this app's block for this conversation and its paragraph on its tools,
 * which ride in front of a message rather than in the instructions. The messages' own records carry
 * the exact text each one went with.
 */
function leadRow(stream: Stream, ctx: Context): void {
  const conversation = ctx.given.thisConversation
  const line = headingLine(conversation?.heading)
  const leadTrust = conversation ? TRUST_OF_TEXT[conversation.textIs] : TRUST.thisBuild
  // Unnumbered: it is a reference for what a message carries when the lead is due, not a position.
  stream.row(
    {
      key: 'conversation-lead',
      title: 'Conversation lead, when due',
      author: AUTHOR.brobot,
      trust: leadTrust,
      pieces: [
        {
          kind: 'notice',
          cy: 'input-lead-note',
          text: 'Rides before the first worded message of a launch. After compaction or a failed turn, the whole lead can be owed again. A reopened thread may receive only changed sections.',
        },
        // Three texts from up to three sources: each says where it came from.
        ...(line === null
          ? []
          : [
              {
                kind: 'label',
                author: AUTHOR.brobot,
                trust:
                  conversation?.headingIs === undefined
                    ? leadTrust
                    : TRUST_OF_KEPT[conversation.headingIs],
              } as const,
              { kind: 'text', text: line } as const,
            ]),
        ...toolsParagraph(ctx),
        ...(conversation
          ? [
              { kind: 'label', author: AUTHOR.brobot, trust: leadTrust } as const,
              ...bodyOf(conversation.text, conversation.sections, ctx.when),
              ...savedMethodsPieces(ctx.given, ctx.when),
            ]
          : []),
      ],
      open: false,
    },
    false,
  )
}

/**
 * The skills the provider listed for this agent, after its copy's own skills text. ⚠️ A provider
 * that loads no skill file says so with `no-skill-files`, and nothing is added: its built-in skills
 * are already in its copy.
 */
function skillsOf(ctx: Context): Piece[] {
  const skills = ctx.given.skills
  if (skills === undefined || skills.why === 'no-skill-files') return []
  ctx.placed.add('skills')
  const listed = skills.listed ?? []
  return [
    {
      kind: 'skills',
      listedBy: `Listed by ${PROVIDER_NAME[ctx.given.provider]}`,
      skills: listed,
      dropped: skills.dropped ?? 0,
      none:
        skills.listed === null
          ? SKILLS_NOT_LISTED
          : listed.length === 0 && (skills.dropped ?? 0) === 0
            ? NO_SKILLS
            : null,
    },
  ]
}

export const SKILLS_NOT_LISTED = 'Not listed since launch.'
export const NO_SKILLS = 'No skills listed.'
export const SKILL_CUT = 'May be cut at 500 characters.'
export const skillsNotShown = (count: number): string => `${String(count)} more not shown.`

function instructionsTabs(ctx: Context, messages: readonly InputMessage[]): ReaderTab[] {
  const tools = new Stream(1)
  let inside = false
  for (const part of partsAt(ctx, 'tools')) {
    if (part.tools?.length) {
      for (const tool of part.tools)
        if (toolWasSent(ctx, tool.name)) inside = toolRow(tools, ctx, tool) || inside
    } else providerRow(tools, ctx, part)
  }
  if (!inside) brobotToolsRow(tools, ctx)
  serversRow(tools, ctx)

  const instructions = new Stream(2)
  for (const part of partsAt(ctx, 'instructions', 'developer-message'))
    providerRow(instructions, ctx, part, false, part.id.endsWith('.skills') ? skillsOf(ctx) : [])
  // ⚠️ With no copy, or a copy with no skills part, the skills are still known: they stay in this
  // tab as a reference, unnumbered, rather than disappearing.
  if (!ctx.placed.has('skills')) {
    const pieces = skillsOf(ctx)
    if (pieces.length > 0)
      instructions.row(
        {
          key: 'skills',
          title: 'Skills it has',
          author: AUTHOR.provider,
          trust: (pieces[0] as Extract<Piece, { kind: 'skills' }>).listedBy,
          pieces,
          open: false,
        },
        false,
      )
  }

  const files = new Stream(3)
  let remaining = [...ctx.given.files]
  // Whether the copy's wrapper held the profile's file alone: the other files are then not in it.
  let profileOnly = false
  for (const part of partsAt(ctx, 'user-message')) {
    const profileMark = matchingMark(part.text, PROFILE_FILE_MARK)
    if (!part.text.includes(profileMark)) {
      providerRow(files, ctx, part)
      continue
    }
    const [opening = '', afterProfile = ''] = part.text.split(profileMark)
    const workspaceMark = matchingMark(afterProfile, WORKSPACE_FILE_MARK)
    const wrapper = (key: string, title: string, text: string): void =>
      files.row({
        key: `part:${part.id}:${key}`,
        title,
        author: AUTHOR.provider,
        trust: ctx.copy,
        pieces: [{ kind: 'text', text }],
        open: true,
      })
    wrapper('opening', 'Opening of the AGENTS.md message', opening)
    files.mark('join', SELF_WORDS.profileFileStarts)
    for (const file of remaining.filter((one) => one.kind === 'profile-instructions'))
      fileRow(files, file, ctx.when, packOf(ctx.given))
    // ⚑ A copy whose wrapper holds the profile's file alone: the rest of it is its closing, and the
    // other files come after every part of the copy rather than stand in for one it did not hold.
    if (!afterProfile.includes(workspaceMark)) {
      wrapper('closing', 'Closing of the instruction wrapper', afterProfile)
      remaining = remaining.filter((one) => one.kind !== 'profile-instructions')
      profileOnly = true
      continue
    }
    const [between = '', closing = ''] = afterProfile.split(workspaceMark)
    wrapper('between', 'Between the files', between)
    for (const file of remaining.filter((one) => one.kind !== 'profile-instructions'))
      fileRow(files, file, ctx.when, packOf(ctx.given))
    remaining.length = 0
    wrapper('closing', 'Closing of the instruction wrapper', closing)
  }
  if (profileOnly && remaining.length > 0) files.mark('boundary', NOT_IN_THIS_COPY)
  for (const file of remaining) fileRow(files, file, ctx.when, packOf(ctx.given))

  builtInSkillsRow(instructions, ctx)

  const sent = new Stream(4)
  leadRow(sent, ctx)
  builtInReminderRow(sent, ctx)
  messageRows(sent, messages)

  return [
    {
      key: 'tools',
      number: 1,
      label: 'Tools',
      intro: inside
        ? SELF_WORDS.toolsInsideExec
        : 'The stored request starts with tool declarations.',
      copyNotice: true,
      items: tools.items,
      foot: [],
    },
    {
      key: 'provider-instructions',
      number: 2,
      label: 'Provider instructions',
      intro:
        'Developer messages, in the stored order. The memory summary stays inside the provider’s memory instructions.',
      copyNotice: true,
      items: instructions.items,
      foot: [],
    },
    {
      key: 'files-and-folder',
      number: 3,
      label: 'Files and folder',
      intro: profileOnly
        ? FILES_INTRO_PROFILE_ONLY
        : 'One user message wraps the instruction files. Each file stays inside that wrapper, followed by the environment.',
      copyNotice: true,
      items: files.items,
      foot: [],
    },
    {
      key: 'messages',
      number: 4,
      label: 'Messages',
      intro: MESSAGES_INTRO,
      copyNotice: false,
      items: sent.items,
      foot: ['Tool answers remain in the conversation.'],
    },
  ]
}

/**
 * How the provider's request is laid out, read off its stored copy: as messages behind a system
 * prompt, or as instructions and developer messages. ⚠️ With no copy for the model, BroBot's own
 * placement is the only fact left: text in the system prompt means a system prompt, and text in the
 * first message is the instructions layout's (the shared type's `placement`).
 */
export type RequestLayout = 'system-prompt' | 'instructions'

export function layoutOf(given: WhatThisAgentWasGiven): RequestLayout {
  const shape = given.providerParts.snapshot?.shape
  if (shape !== undefined) return shape === 'messages' ? 'system-prompt' : 'instructions'
  return given.placement === 'system-prompt' ? 'system-prompt' : 'instructions'
}

/** The tabs after Overview, in the order the provider's request carries them. */
export function requestTabs(
  given: WhatThisAgentWasGiven,
  messages: readonly InputMessage[],
  startLoaded: boolean,
  when: (at: number) => string,
): ReaderTab[] {
  const snapshot = given.providerParts.snapshot
  const ctx: Context = {
    placed: new Set(),
    given,
    startLoaded,
    snapshot,
    copy: providerCopy(snapshot?.version ?? given.providerParts.version ?? '—'),
    when,
  }
  return layoutOf(given) === 'system-prompt'
    ? systemPromptTabs(ctx, messages)
    : instructionsTabs(ctx, messages)
}
