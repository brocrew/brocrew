import {
  type AConversation,
  type Exchange,
  type Received,
  type ReceivedInATurn,
  TURNS_BACK_DEFAULT,
  TURNS_BACK_MAX,
  type TranscriptTurn,
  WORDS_CAP,
  type WhoSentIt,
  type Words,
} from '../../../shared/last-exchange'
import {
  type AgentToolAnswer,
  type AgentToolDefinition,
  agentToolHandlerInput,
  toolArgumentsAtHandler,
} from '@brobot2/runtime'
import { type AgentToolHost } from './host'
import { type Caller } from '../conversation-caller'
import {
  FILES_FOUND_LISTED,
  MOST_FILES_SEARCHED,
  NOT_FOR_A_MODEL_ACT,
  OLDER_FILES_COUNTED,
} from '../../../shared/documents'
import { FIND_WHERE_INPUT, type ToolName } from './catalog'
import { type FoundFile } from '../kept-file-search'
import { MOST_WORDS_FOUND, type readerFields } from './reader-inputs'
import {
  PAST_WORK_SEARCH_DESCRIPTION,
  pastWorkSearchInWords,
  pastWorkSearchQuery,
  pastWorkSearchRefusal,
} from '../../../shared/past-work-search'
import { READ_ONE_WITH_READ_DOCUMENT, resourcesNamed } from '../reply-rails'
import { answer, refusalAnswer } from './answers'
import { clockTimeFrom } from '../../../shared/clock'
import { filesHoldingThoseWords, noFileHoldsThoseWords } from '../agent-tool-answer-words'
import { namedByItsWorkOnce } from './listings'
import { pieceLine } from '../../../shared/piece-called'
import { refuseTool } from './refusals'

/**
 * **D-012 · who sent a message, as `read_transcript` hands it over** — the kind, and the agent id
 * where there is one (the value `message_agent` and `ask_question` take).
 */
function senderPayload(from: WhoSentIt): Record<string, unknown> {
  switch (from.is) {
    case 'an-agent':
      return { kind: 'an-agent', agent: from.conversation }
    case 'this-app':
      return from.carrying === null
        ? { kind: 'this-app' }
        : { kind: 'this-app', carrying_words_of: from.carrying.conversation }
    default:
      return { kind: from.is }
  }
}

/** **D-012 · words as `read_transcript` hands them over** — the cut said, never hidden. */
export function wordsPayload(words: Words): Record<string, unknown> {
  return 'unreadable' in words
    ? { unreadable: true }
    : { text: words.text, ...(words.clipped ? { clipped: true } : {}) }
}

/**
 * **D-012 · a message received, as `read_transcript` hands it over** — **D-027 · with the
 * messages that came with it in one turn, oldest first** (`came_with`), only when there were several.
 */
export function receivedPayload(received: ReceivedInATurn): Record<string, unknown> {
  const one = (message: Received): Record<string, unknown> => ({
    from: senderPayload(message.from),
    ...wordsPayload(message.words),
  })
  return {
    ...one(received),
    ...(received.cameWith === undefined ? {} : { came_with: received.cameWith.map(one) }),
  }
}

/**
 * **D-027 · the messages one turn delivered, oldest first** — those that came with the last, then
 * the last.
 */
const oldestFirst = (received: ReceivedInATurn): readonly Received[] => [
  ...(received.cameWith ?? []),
  received,
]

/** **D-012 · who sent it, in a clause** — the agent by name and id, never the id alone. */
export function fromClause(from: WhoSentIt, named: (who: AConversation) => string): string {
  switch (from.is) {
    case 'a-person':
      return 'a person'
    case 'an-agent':
      return named(from)
    case 'this-app':
      return from.carrying === null
        ? 'this app'
        : `this app, carrying the words of ${named(from.carrying)}`
    case 'its-own-cli':
      return 'its own CLI, typed there'
    case 'unreadable':
      return 'a sender this app could not read'
  }
}

/** **F080** — how many of a wake's background endings a transcript turn quotes, newest last. */
const SUMMARIES_SHOWN = 5

function wordsBlock(words: Words): string {
  if ('unreadable' in words) return '(this app could not read these words from its record)'
  return words.clipped
    ? `${words.text}\n(cut at ${String(WORDS_CAP)} units — there was more)`
    : words.text
}

/**
 * **D-012 · the words a model reads back from `read_transcript`** — the last exchange first,
 * then the turns oldest first, each quotation a block of its own (`614`'s placement).
 */
export function transcriptText(
  name: string,
  last: Exchange,
  turns: readonly TranscriptTurn[],
  older: boolean,
  named: (who: AConversation) => string,
): string {
  const lines: string[] = []
  // **D-027 · each message a turn of several delivered, under its own sender.**
  const eachFrom = (came: readonly Received[]): string[] =>
    came.map((one) => `From ${fromClause(one.from, named)}:\n${wordsBlock(one.words)}`)
  if (last.received === null) {
    lines.push(`${name} has received no message this app can show.`)
  } else {
    const came = oldestFirst(last.received)
    if (came.length === 1) {
      lines.push(
        `The last message ${name} received came from ${fromClause(last.received.from, named)}:`,
      )
      lines.push(wordsBlock(last.received.words))
    } else {
      lines.push(
        `The last ${String(came.length)} messages ${name} received came together in one turn, oldest first:`,
        ...eachFrom(came),
      )
    }
    // **F080 — a turn its provider started after it answered no message**, so its words are
    // its latest, not its words back.
    if (last.sinceThenItsProviderStartedATurn === true) {
      lines.push(`Since then, ${name}'s provider started a turn by itself.`)
    }
    lines.push(
      last.answer === null
        ? `${name} has said nothing back to it yet.`
        : last.sinceThenItsProviderStartedATurn === true
          ? `${name}'s latest words:\n${wordsBlock(last.answer)}`
          : `${name}'s latest words back:\n${wordsBlock(last.answer)}`,
    )
  }
  if (turns.length === 0) return lines.join('\n\n')
  lines.push(
    `Its turns, oldest first${older ? ' (there are older ones: a larger turns_back, or a search, reads them)' : ''}:`,
  )
  turns.forEach((turn, index) => {
    // **F080 — a turn its provider started by itself is its own entry**, with what its provider
    // said ended just before it, in its own words, each on a line of its own.
    if ('startedByItsProvider' in turn) {
      const after = turn.startedByItsProvider.after
      if (after.length === 0) {
        lines.push(
          `Turn ${String(index + 1)}, which its provider started by itself; no message opened it.`,
        )
      } else {
        // The provider's own words, a block of their own (`614`'s placement), the newest few.
        const shown = after.slice(-SUMMARIES_SHOWN)
        lines.push(
          `Turn ${String(index + 1)}, which its provider started by itself after its background work ended${after.length > shown.length ? ` (the last ${String(shown.length)} of ${String(after.length)})` : ''}:`,
          shown.join('\n'),
        )
      }
      lines.push(
        turn.said === null
          ? `${name} said nothing in it.`
          : `${name} said:\n${wordsBlock(turn.said)}`,
      )
      return
    }
    const came = oldestFirst(turn.received)
    lines.push(
      came.length === 1
        ? `Turn ${String(index + 1)}, from ${fromClause(turn.received.from, named)}:\n${wordsBlock(turn.received.words)}`
        : [
            `Turn ${String(index + 1)}, ${String(came.length)} messages together, oldest first:`,
            ...eachFrom(came),
          ].join('\n\n'),
    )
    lines.push(
      turn.said === null ? `${name} said nothing back.` : `${name} said:\n${wordsBlock(turn.said)}`,
    )
  })
  return lines.join('\n\n')
}

/**
 * **D-037 · one file `find_files` names** — `list_tasks {made}`'s line: its id and name, its title
 * where the name does not already say it, its piece, who added it and when — and, for a find in its
 * text, the words around it on a line of its own.
 */
function foundFileLine(found: FoundFile, readAt: number): string {
  const { file } = found
  // An agent by its name and the profile a give names it by, as a sender is named.
  const by =
    file.addedBy === null
      ? 'a person'
      : file.addedBy.identity === null || file.addedBy.identity === file.addedBy.name
        ? file.addedBy.name
        : `${file.addedBy.name} (${file.addedBy.identity})`
  const line = `  ${resourcesNamed([{ resource: file.resourceId, name: file.name }])}${
    file.title === file.name ? '' : ` · ${file.title}`
  } — ${file.role === 'input' ? 'an input' : 'kept'} on ${pieceLine(file.label, file.pieceTitle)}, by ${by}, ${clockTimeFrom(file.keptAt, readAt)}`
  return found.excerpt === null ? line : `${line}\n      “${found.excerpt}”`
}

export function createReadDocumentTool(
  host: Pick<AgentToolHost, 'readResource'>,
  readerInputs: ReturnType<typeof readerFields>['readerInputs'],
  readerFieldRefusal: ReturnType<typeof readerFields>['readerFieldRefusal'],
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'read_document',
    handlerOwnsMissingInput: true,
    /**
     * Reads a kept resource by id, returning its current local bytes.
     */
    description:
      'Read a resource this app keeps for a piece of work — an input its giver handed over, or a file the agent holding it kept or handed back with its reply. A report comes back as Markdown and a page as its source; an image or a PDF comes back saying so.',
    /**
     * **486 · the rails are the whole gate** (HO-031 §2.4).
     *
     * **A read of a resource this app kept**, under the app's own root, gated by `RESOURCE_RAILS`.
     * `resourceBytes` places the row's file inside the resources tree before it reads anything,
     * so this tool and the person's window narrow through one rule — `169` §1.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: Object.fromEntries(
      Object.entries(readerInputs.read_document).map(([field, schema]) => [
        field,
        agentToolHandlerInput(schema),
      ]),
    ),
    call: (args) =>
      guarded(async () => {
        args = toolArgumentsAtHandler(args)
        const { resource } = args
        if (typeof resource !== 'string' || resource.length === 0) {
          return readerFieldRefusal('read_document', args, ['resource is required'])!
        }
        const fieldRefusal = readerFieldRefusal('read_document', args)
        if (fieldRefusal !== null) return fieldRefusal
        // **Nothing here asks who may read what** — the module note's rule. What arrives is a
        // `RESOURCE_RAILS` refusal already in `341`'s shape, so it is carried rather than
        // translated: the store's absence, an id that names nothing, and the byte rails.
        const read = host.readResource(resource)
        if (!read.ok) {
          return answer(
            { ...read.refusal },
            `refused (${read.refusal.rail}): ${read.refusal.reason}`,
          )
        }
        // **635 · the payload branches on the CONTENT, and the *not this* arm is a member**
        // (`HO-097` §1.2: *"where a type cannot be handed to a model, the tool says so plainly
        // rather than returning something useless"*).
        const said =
          read.content.as === 'not-for-a-model'
            ? `That resource is of a form this app does not hand to a model (${read.content.because}). ${NOT_FOR_A_MODEL_ACT}`
            : read.content.text
        return answer(
          {
            outcome: 'ok',
            resource: read.resource.resource,
            piece: read.resource.piece,
            name: read.resource.name,
            role: read.resource.role,
            sha256: read.resource.sha256,
            // **The form is on the payload as well as in `content.as`**, because they answer
            // different questions: `form` is *what the file is* and `as` is *what you were
            // handed*. A page is a `page` handed over `as: 'source'`.
            form: read.form,
            // **675 · the text is the answer's PROSE, and it is not said twice** — twice is
            // twice the context. `as` stays, so a model reads WHICH it got; the refusal-shaped
            // arm keeps its `because`.
            content:
              read.content.as === 'not-for-a-model' ? { ...read.content } : { as: read.content.as },
          },
          said,
        )
      }),
  }
}

export function createReadTranscriptTool(
  host: Pick<AgentToolHost, 'nameByItsWorkUnder' | 'readTranscript' | 'theConversationAddressed'>,
  by: Caller,
  me: string,
  readerInputs: ReturnType<typeof readerFields>['readerInputs'],
  readerFieldRefusal: ReturnType<typeof readerFields>['readerFieldRefusal'],
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    /**
     * **D-012 · a giver looks closer, only when it needs to** (proposal §6.5).
     *
     * **The stall notice quoted up to 4 KB of the child's last message** because a giver could
     * not read its child. Now the notice previews the last exchange and names this door, and
     * the giver reads the rest here: the last exchange whole, then the turns — a few back, or the
     * ones a search finds (*"When the person just answered 'yes', only the turns before it say
     * what was agreed"*).
     *
     * **Reach is the chain** `interrupt_agent` walks — a conversation below the caller —
     * **and, since D-024 · R2, the caller's own profile's other conversations** — and never a
     * shared service ({@link AgentToolHost.readTranscript}). A READER: nothing is sent.
     */
    name: 'read_transcript',
    handlerOwnsMissingInput: true,
    description:
      'Read a conversation below you — one you started, or one started under it — or another conversation of your own profile: the last message it received (and who sent it) with its latest words back, then its last turns, or the turns whose words contain a search. Use it when a notice about work you gave out is not enough; name it by a piece it owns (W1.2) — list_tasks names the pieces you gave — or by its id.',
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: Object.fromEntries(
      Object.entries(readerInputs.read_transcript).map(([field, schema]) => [
        field,
        agentToolHandlerInput(schema),
      ]),
    ),
    call: (args) =>
      guarded(async () => {
        args = toolArgumentsAtHandler(args)
        const problems: string[] = []
        const agent = args.agent
        if (typeof agent !== 'string' || agent.length === 0) problems.push('agent is required')
        const turnsBack = args.turns_back ?? TURNS_BACK_DEFAULT
        if (
          typeof turnsBack !== 'number' ||
          !Number.isInteger(turnsBack) ||
          turnsBack < 1 ||
          turnsBack > TURNS_BACK_MAX
        ) {
          problems.push(`turns_back must be a whole number from 1 to ${String(TURNS_BACK_MAX)}`)
        }
        const search = args.search
        if (search !== undefined && (typeof search !== 'string' || search.trim() === '')) {
          problems.push('search, when given, must be some words')
        }
        if (problems.length > 0 || typeof agent !== 'string' || typeof turnsBack !== 'number') {
          return readerFieldRefusal('read_transcript', args, problems)!
        }
        const fieldRefusal = readerFieldRefusal('read_transcript', args)
        if (fieldRefusal !== null) return fieldRefusal
        // **D-016 · commit 7 · R1 — a label names its piece's owner** when this caller may reach
        // it or read it — the chain below it, or (D-024 · R2) a conversation of its own profile, as
        // an id is read; one that names nothing it may read is out of that reach, as an unknown id
        // is.
        const addressed = host.theConversationAddressed(agent, by, me, 'reading')
        const read = host.readTranscript(addressed, me, {
          back: turnsBack,
          search: typeof search === 'string' ? search.trim() : null,
        })
        if (!read.ok) return refusalAnswer(refuseTool(read.refusal, { agent: addressed }))
        // **D-016 · commit 7 · R3 — each sender by the piece it owns**, never by its id; the
        // subject keeps its agent's name — the caller just named it, and the words say *its*.
        const called = namedByItsWorkOnce(host)
        const named = (who: AConversation): string => called(who.conversation, who.about ?? null)
        return answer(
          {
            outcome: 'ok',
            agent: addressed,
            name: read.name,
            last_exchange: {
              received:
                read.lastExchange.received === null
                  ? null
                  : receivedPayload(read.lastExchange.received),
              answer:
                read.lastExchange.answer === null ? null : wordsPayload(read.lastExchange.answer),
              ...(read.lastExchange.sinceThenItsProviderStartedATurn === true
                ? { since_then_its_provider_started_a_turn: true }
                : {}),
            },
            turns: read.turns.map((turn) => ({
              // **F080** — a turn its provider started names no message, and says so.
              ...('startedByItsProvider' in turn
                ? { started_by_its_provider: { after: turn.startedByItsProvider.after } }
                : { received: receivedPayload(turn.received) }),
              said: turn.said === null ? null : wordsPayload(turn.said),
            })),
            older: read.older,
          },
          transcriptText(read.name, read.lastExchange, read.turns, read.older, named),
        )
      }),
  }
}

export function createFindFilesTool(
  host: Pick<AgentToolHost, 'findKeptFiles'>,
  me: string,
  readerInputs: ReturnType<typeof readerFields>['readerInputs'],
  readerFieldRefusal: ReturnType<typeof readerFields>['readerFieldRefusal'],
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'find_files',
    handlerOwnsMissingInput: true,
    /**
     * **D-037 · the files this app keeps, found** — a list, or a search by words, on the
     * caller's tree or everywhere; each readable by its id with `read_document`.
     *
     * **It says what one call covers**: a search looks through a bounded number of files, newest
     * first, and the answer names the file to go on from — so a model that wants older ones asks
     * again rather than reading an empty answer as *there is none*.
     */
    description: `Find the files this app keeps for pieces of work — the inputs givers handed over and the files agents made or kept — so you can build on what is already written. where says where to look: your tree, the default, or everywhere. Newest first. Without words it lists them; with words it finds only the files where every word appears in the file’s title, its name, its maker’s name or profile, its piece’s label or title, or — for a report, or a page’s source — its text, and a find in the text comes with the words around it. One call names at most ${String(FILES_FOUND_LISTED)} files and searches through at most ${MOST_FILES_SEARCHED.toLocaleString('en-US')}; when older files are left, the answer gives the id to pass as older_than to go on. Read a file with read_document.`,
    /**
     * **A read of what this app keeps** (HO-031 §2.4): rows from its own database and kept files
     * from under its own root, through `read_document`'s reader — the rails are the whole gate,
     * and none asks who is calling.
     */
    beyondItsRails: 'nothing-its-rails-do-not-cover',
    input: Object.fromEntries(
      Object.entries(readerInputs.find_files).map(([field, schema]) => [
        field,
        agentToolHandlerInput(schema),
      ]),
    ),
    call: (args) =>
      guarded(async () => {
        args = toolArgumentsAtHandler(args)
        const problems: string[] = []
        const where = args.where ?? 'tree'
        if (where !== 'tree' && where !== 'everywhere') {
          problems.push(`where, when given, must be one of ${FIND_WHERE_INPUT.members.join(', ')}`)
        }
        const said = args.words
        const words =
          typeof said === 'string'
            ? [
                ...new Set(
                  said
                    .toLowerCase()
                    .split(/\s+/)
                    .filter((word) => word.length > 0),
                ),
              ]
            : []
        if (said !== undefined && (typeof said !== 'string' || words.length === 0)) {
          problems.push('words, when given, must hold at least one word')
        }
        if (words.length > MOST_WORDS_FOUND) {
          problems.push(`words holds at most ${String(MOST_WORDS_FOUND)} words`)
        }
        const olderThan = args.older_than
        if (olderThan !== undefined && (typeof olderThan !== 'string' || olderThan.length === 0)) {
          problems.push('older_than, when given, must be a file’s id (res_…)')
        }
        if (problems.length > 0) {
          return readerFieldRefusal('find_files', args, problems)!
        }
        const fieldRefusal = readerFieldRefusal('find_files', args)
        if (fieldRefusal !== null) return fieldRefusal
        const found = await host.findKeptFiles(me, {
          where: where === 'everywhere' ? 'everywhere' : 'tree',
          words,
          olderThan: typeof olderThan === 'string' ? olderThan : null,
        })
        if (!found.ok) {
          // **The argument is what is wrong, and the answer says how to mend it**: the id came
          // from an earlier answer of this tool, not from a reply or a piece record.
          return readerFieldRefusal('find_files', args, [
            `older_than names no file this app keeps: pass the id an earlier find_files answer gave, or leave it out to start from the newest`,
          ])!
        }
        const scope = where === 'everywhere' ? 'kept anywhere' : 'on your tree'
        const lines = found.files.map((one) => foundFileLine(one, found.readAt))
        // The searched words are not quoted back. The cursor is said only on an empty page, which
        // would otherwise claim that nothing is kept.
        const before = olderThan === undefined ? '' : ` before ${String(olderThan)}`
        const head =
          words.length > 0
            ? found.files.length === 0
              ? noFileHoldsThoseWords(`${scope}${before}`)
              : filesHoldingThoseWords(scope)
            : found.files.length === 0
              ? `No files are ${scope}${before}.`
              : `Files ${scope}, newest first:`
        const notes = [
          ...(found.textUnread === 0
            ? []
            : [
                `The text of ${found.textUnread === 1 ? '1 file' : `${String(found.textUnread)} files`} could not be read, so only ${found.textUnread === 1 ? 'its' : 'their'} names and pieces were searched.`,
              ]),
          ...(found.goOnFrom === null
            ? []
            : [
                `${
                  found.older >= OLDER_FILES_COUNTED
                    ? `${OLDER_FILES_COUNTED.toLocaleString('en-US')} or more older files were`
                    : found.older === 1
                      ? '1 older file was'
                      : `${found.older.toLocaleString('en-US')} older files were`
                } not ${words.length === 0 ? 'listed' : 'looked through'}: call find_files again with older_than: ${found.goOnFrom}${where === 'everywhere' ? ', where: everywhere' : ''}${words.length === 0 ? '' : ' and the same words'} to go on.`,
              ]),
        ]
        return answer(
          {
            outcome: 'ok',
            where,
            ...(words.length === 0 ? {} : { words }),
            files: found.files.map((one) => ({
              resource: one.file.resourceId,
              name: one.file.name,
              title: one.file.title,
              role: one.file.role,
              piece: one.file.piece,
              label: one.file.label,
              piece_title: one.file.pieceTitle,
              added_by:
                one.file.addedBy === null
                  ? null
                  : { name: one.file.addedBy.name, profile: one.file.addedBy.identity },
              kept_at: one.file.keptAt,
              ...(one.foundIn.length === 0 ? {} : { found_in: one.foundIn }),
              ...(one.excerpt === null ? {} : { excerpt: one.excerpt }),
            })),
            looked: found.looked,
            older: found.older,
            older_than: found.goOnFrom,
            ...(found.textUnread === 0 ? {} : { text_unread: found.textUnread }),
          },
          [
            [head, ...lines].join('\n'),
            ...notes,
            ...(found.files.length === 0 ? [] : [READ_ONE_WITH_READ_DOCUMENT]),
          ].join('\n\n'),
        )
      }),
  }
}

export function createSearchPastWorkTool(
  host: Pick<AgentToolHost, 'searchPastWork'>,
  me: string,
  guarded: (run: () => Promise<AgentToolAnswer>) => Promise<AgentToolAnswer>,
): AgentToolDefinition & { readonly name: ToolName } {
  return {
    name: 'search_past_work' as const,
    description: PAST_WORK_SEARCH_DESCRIPTION,
    beyondItsRails: 'nothing-its-rails-do-not-cover' as const,
    input: pastWorkSearchQuery.shape,
    call: (args: Record<string, unknown>) =>
      guarded(async () => {
        const input = pastWorkSearchQuery.safeParse(args)
        const found = input.success
          ? ((await host.searchPastWork?.(me, input.data.words)) ?? {
              ok: false as const,
              reason: 'unavailable' as const,
            })
          : { ok: false as const, reason: 'invalid' as const }
        if (!found.ok) {
          const refused = pastWorkSearchRefusal(found.reason)
          return answer(refused, `refused (${refused.rail}): ${refused.reason}`)
        }
        return answer({ outcome: 'ok', hits: found.hits }, pastWorkSearchInWords(found.hits))
      }),
  }
}
