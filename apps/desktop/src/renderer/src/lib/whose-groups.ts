import type {
  InjectedInstruction,
  InjectedInstructionKind,
  SessionInstructions,
} from '../../../shared/runtime-ipc'
import type { ToldLayer } from '../../../shared/told'
import { pathTail } from '../../../shared/path-tail'
import {
  BY_ITS_SECTIONS,
  WHOSE_FILE,
  WHOSE_LAYER,
  WHOSE_TEXT,
  WHOSE_WORDS,
  type WhoseText,
} from '../../../shared/whose-text'

/**
 * 🔴 **One launch's prompt, grouped by WHOSE each block of it is** (583, `HO-073` §4).
 *
 * > ⚑ **`HO-073` §4: *"The sheet is organised by WHERE text came from. The question a person has
 * > is WHOSE it is."*** ⛔ *"All three currently read as one undifferentiated wall."*
 *
 * ## ⛔ What this is NOT
 *
 * ⚠️ **It is not a replacement for {@link toldView}.** `442`'s layer account answers *has this
 * surface accounted for the whole prompt*, including the parts this app cannot see — and
 * `HO-073` §4 is explicit that the account is right: *"It is honest and it is complete… That is
 * real and it is more than most products would show."* ⛔ **This is a second question over the
 * same material**, and the account keeps the one layer only it can answer for — the composition
 * as sent.
 *
 * ⚑ **And it removes nothing** (583 §6). Every row the sheet drew before is in exactly one group
 * here; the compiled bundle is the only thing that is drawn differently, and it is drawn as
 * MORE — its own sections, each under the owner that wrote it.
 *
 * ## 🔴 The one thing that makes this answerable at all
 *
 * ⛔ **`InjectedInstruction.sections`.** The bundle is `factory + configured` in one file, so
 * grouping its ROW is not possible: one row cannot be in two groups and filing it in either of them
 * is a false claim. ⚠️ **The composer publishes the spans with the text**, and this module slices
 * the row it was given — never parses headings out of it, which would be a second derivation of a
 * fact the main process already holds. ⚑ **D-024 · R1 — `SessionInstructions.thisConversation`
 * carries its spans the same way**: what is true of this conversation, composed for its launch and
 * appended with no file.
 */

/**
 * One openable block on the sheet: a whole file, one section of the compiled bundle, or one section
 * of this conversation's own text (D-024 · R1).
 */
export interface ToldBlock {
  /** Stable across re-derivations of the same launch — the key a list renders on, and the fold's. */
  readonly key: string
  /**
   * The file it was read from, absolute. Shared by every section of one file. ⚑ `null` for this
   * conversation's own text, which was composed for its launch and read from no file.
   */
  readonly path: string | null
  /**
   * ⚑ **The section's own name inside the file**, or `null` when the block IS the whole file.
   *
   * ⛔ **The word the file itself carries** — `## Your own instructions` without its hashes — so
   * a person reading the sheet and a model reading the prompt are looking at the same heading.
   */
  readonly heading: string | null
  /**
   * What kind of file this came from, or `this-conversation` — the row's label and its `data-cy`
   * are keyed on it.
   */
  readonly kind: InjectedInstructionKind | 'this-conversation'
  /** The bytes, as they were sent. */
  readonly text: string
  /** ⚠️ **True when the byte cap cut the FILE short** — a property of the file, not of a section. */
  readonly truncated: boolean
  /** Whether the provider put this in the prompt, or left it to be fetched (`317` §2.2). */
  readonly reach?: 'prompt' | 'on-request'
  /** Where the path really led, when it did not lead where this app derived (`170` §2). */
  readonly link?: string
  /**
   * 🔴 **Whose this block is — on the BLOCK, not read back off the tab it landed on.**
   *
   * ⛔ **Found reviewing this dispatch's own diff, and it had already gone wrong.** The component
   * stamped `:data-whose="showing.whose"` — the SELECTED TAB — so every assertion that read the
   * attribute as *which owner did this row land under* was a restatement of the press before it
   * and could not fail. ⚠️ **Eight of them, across five files, including the DOM test written for
   * exactly that invariant.** ⚑ The owner is decided in {@link whoseOf}; carrying it here is what
   * lets the screen be asked the question instead of answering it with the question.
   */
  readonly whose: WhoseText
  /**
   * ⚑ **What the row is CALLED at rest** — the section's own heading, or enough of the path to
   * tell it from its neighbours.
   *
   * ⛔ **Enough, not just the last segment** (found in review). The project walk takes `CLAUDE.md`
   * AND `.claude/CLAUDE.md` at every ancestor directory, and the convention walk takes
   * `AGENTS.md` at every one — so a real repository draws several rows whose last segment is the
   * same word. ⚠️ A list of four rows all reading `CLAUDE.md` is a list that names nothing; the
   * name grows leftwards until the rows in a group differ.
   */
  readonly name: string
}

/** ⚑ **A block read from a file** — every block but this conversation's own (D-024 · R1). */
export type FileBlock = ToldBlock & {
  readonly path: string
  readonly kind: InjectedInstructionKind
}

/** One group: a heading, the sentence that decides membership, and what is in it. */
export interface WhoseGroup {
  readonly whose: WhoseText
  readonly heading: string
  /** The one line a person reads without asking — see {@link WhoseWords.short}. */
  readonly short: string
  readonly says: string
  /**
   * 🔴 **How many bytes of the text ON THIS SHEET this group is** — the number the size bar draws.
   *
   * ⛔ **Not *what BroBot appended*, and the first version said that and was wrong in both
   * directions** (found reviewing this dispatch's own diff). ⚠️ `learned` is built from
   * `agentMemory`, which this app reads for DISPLAY and never appends — `told.ts` says so on the
   * layer itself: *"Written by the agent and loaded by the provider — BroBot appended none of
   * it."* ⛔ And the composed string's own preamble and per-file headers, which BroBot really did
   * append, are on no row at all.
   *
   * ⚑ **So the whole is what the sheet HOLDS**, which is exactly the sum these numbers make, and
   * the caption says that. 🔴 A bar is a picture and a picture that names the wrong whole is
   * `442` §2.1's false claim drawn rather than written.
   */
  readonly bytes: number
  /** The account layers whose owner this is — drawn here rather than in the account (`442`). */
  readonly layers: readonly ToldLayer[]
  /** Files and file sections. */
  readonly blocks: readonly ToldBlock[]
  /**
   * 🔴 **Whether this group is drawn at all.**
   *
   * ⛔ **Empty groups are not drawn** — rule 2 of this panel, *"nothing where nothing was
   * injected"*, and an empty heading is `086` in the other direction.
   *
   * ⚑ **Two exceptions, and `536` is the precedent for both rather than an indulgence.**
   *
   *  - Draw {@link 'configured'} even when empty so the person can see where their standing rules belong.
   *  - Draw {@link 'learned'} with `TOLD_REMEMBERS_NOTHING` when no memory files exist. Gating solely on rows would hide that source and its empty-state explanation.
   */
  readonly drawn: boolean
}

/**
 * ⛔ **The compiled bundle, whole, when this app could not tell which part of it is whose** —
 * `null` otherwise.
 *
 * ⚑ **A row of its own rather than a guess.** `438`'s fail-closed rule: the alternative is filing
 * three authors' text under one of them, and the one it would land in — `factory` — is the
 * reassuring answer. ⚠️ Reachable in production: a host one build behind sends no `sections`, and
 * the reader attaches none when the file on disk is not the file it composed.
 */
export interface UnsplitBundle {
  readonly block: FileBlock
  readonly says: string
}

/** What the sheet draws, once the account has had its say. */
export interface WhoseView {
  readonly groups: readonly WhoseGroup[]
  readonly unsplit: UnsplitBundle | null
  /**
   * ⚑ **Every byte of text this sheet holds** — what each group's share is a share OF.
   *
   * ⛔ **The unsplit bundle is in it** (found in review): it is text on this sheet, drawn with its
   * own size, and leaving it out made the shares add to more than the whole. ⚠️ It is in no
   * group, so on a conversation that has one the shares do not sum to 100 — which is the truth
   * about that conversation rather than an error in the arithmetic.
   */
  readonly held: number
}

/**
 * ⛔ **Name every row in one group so no two read alike** — see {@link ToldBlock.name}.
 *
 * ⚑ **Grown leftwards a segment at a time**, and only as far as it has to be: the common case is
 * one segment, and a row that needs three is a row whose neighbours really are three deep.
 */
function named(blocks: readonly ToldBlock[]): ToldBlock[] {
  // ⚑ A block with no path always carries a heading, so only files are named by one.
  const tail = (path: string | null, depth: number): string => pathTail(path ?? '', depth)
  const files = blocks.filter((block) => block.heading === null)
  let depth = 1
  while (depth < 6 && new Set(files.map((one) => tail(one.path, depth))).size < files.length) {
    depth += 1
  }
  return blocks.map((block) => ({
    ...block,
    name: block.heading ?? tail(block.path, depth),
  }))
}

/**
 * ⚑ **Bytes, the way this surface has always counted them** — `layerBytes`' own encoder, so a
 * share and the size printed beside it cannot come from two different arithmetics.
 */
function bytesOf(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * 🔴 **The sentence for a bundle this app could not split** (583) — named, so a test can hold it
 * (standing rule 5).
 */
export const COULD_NOT_TELL_WHICH_PART =
  'This app did not get a map of this file from the launch that wrote it, so it is shown whole. ' +
  'It carries both — BroCrew’s own rules and anything you wrote — and the headings inside it are ' +
  'what tells them apart.'

/**
 * 🔴 **What the *yours* group says when nobody has written any** (583, `HO-073` §2) — the state
 * every identity is in until somebody types something.
 *
 * ⛔ **It names the door, and the door exists** — `582` built it. ⚠️ **It names the ROUTE and not
 * a button on this sheet**, because there is no button on this sheet: a pointer clause is a
 * claim, and the claim this one makes is one a person can walk.
 */
/**
 * 🔴 **What the *yours* group says when this sheet cannot speak for it at all** (found reviewing
 * this dispatch's own diff).
 *
 * ⛔ **`readSessionInstructions` returns `injected: []` for every non-Claude provider** — that
 * engine reads the published leaf itself — so on Codex the `configured` group is empty whether or
 * not a person has written rules, and their rules ARE in that agent's prompt.
 * ⚠️ **{@link NOTHING_OF_YOURS_YET} said the opposite of the truth there**, which is the worst
 * thing this sheet can do: tell a person a standing rule is not reaching an agent that is
 * following it. ⚑ **D-024 · R1 — keyed on NO FILE sent, not on nothing appended**: that provider
 * is now sent this conversation's own text, and still reads the file itself.
 */
export const THIS_SHEET_CANNOT_SAY_WHAT_IS_YOURS =
  'This provider reads the file BroCrew wrote for it, itself, so this sheet cannot say what of ' +
  'yours reached it. Your standing rules for this agent are on its own sheet: Team, then the agent.'

export const NOTHING_OF_YOURS_YET =
  'Nothing of yours reaches this agent yet. You write standing rules for it on the agent’s own ' +
  'sheet — Team, then the agent — and they join its instructions at its next conversation.'

/**
 * ⚑ **The composed bundle's row, split into one block per section** — or one block for the whole
 * file when the launch published no map of it.
 *
 * ⛔ **`Array.isArray` rather than a truthiness check**, for `agentMemory`'s reason and found the
 * same way: a host that predates the field sends the key MISSING, and `undefined` is not `null`.
 */
function blocksOf(item: InjectedInstruction): FileBlock[] {
  const declared = WHOSE_FILE[item.kind]
  // ⛔ **Only the kind that DECLARES it splits** (found in review). `blocksOf` used to split any
  // row carrying a `sections` array while {@link whoseOf} honoured sections for
  // `profile-instructions` alone — two readings of one field, disagreeing about who it applies to,
  // and a host that put the key on another kind would have produced sections with the file's
  // owner stamped on all of them.
  const sections = declared === BY_ITS_SECTIONS && Array.isArray(item.sections) ? item.sections : []
  const reachAndLink = {
    ...(item.reach === undefined ? {} : { reach: item.reach }),
    ...(item.link === undefined ? {} : { link: item.link }),
  }
  if (sections.length === 0) {
    return [
      {
        key: item.path,
        path: item.path,
        heading: null,
        kind: item.kind,
        text: item.text,
        truncated: item.truncated,
        // ⚑ `whoseOf` decides; an unsplittable bundle is answered `null` there and never reaches
        // a group. The placeholder here is replaced in the same walk.
        whose: 'factory',
        name: item.path,
        ...reachAndLink,
      },
    ]
  }
  return sections.map((span, index) => ({
    // ⚠️ **The INDEX and not the heading**, because a heading is the composer's and two sections
    // could one day carry the same one; the position in the published map cannot collide.
    key: `${item.path}#${String(index)}`,
    path: item.path,
    heading: span.heading,
    kind: item.kind,
    text: item.text.slice(span.start, span.end),
    truncated: item.truncated,
    whose: span.whose,
    name: span.heading ?? item.path,
    // ⛔ **Forwarded here too** (found in review): the two arms took care of `reach` and `link`
    // differently, and a memory store that ever grew a section map would have lost both.
    ...reachAndLink,
  }))
}

/**
 * ⛔ **Whose one block is** — the file's own owner, or the section's, for the one kind that has
 * sections.
 *
 * 🔴 **`null` is *this app could not tell*, and it is NOT a group** — see {@link UnsplitBundle}.
 * ⚠️ **It also answers `null` for an owner this build does not know**, which is `438`'s
 * fail-closed rule rather than the silent drop that was here before: results are CAST on the way
 * back over the wire, so a host one build ahead can send a `whose` no member of
 * {@link WHOSE_TEXT} matches, and pushing it into a map keyed by the members made it vanish.
 */
function whoseOf(item: InjectedInstruction, block: ToldBlock): WhoseText | null {
  const declared = WHOSE_FILE[item.kind]
  const known = (whose: unknown): WhoseText | null =>
    (WHOSE_TEXT as readonly string[]).includes(whose as string) ? (whose as WhoseText) : null
  if (declared !== BY_ITS_SECTIONS) return known(declared)
  return block.heading === null && block.key === block.path ? null : known(block.whose)
}

/**
 * ⚑ **D-024 · R1 — this conversation's own text, one block per section** — or none when this launch
 * composed none.
 *
 * ⛔ **Normalised rather than trusted**, for `agentMemory`'s reason: a reading from before the field
 * has the key MISSING. ⚠️ **An owner this build does not know is filed as `dynamic`**, because the
 * composition is that layer by its definition (`thisConversationSections`) — so a section is never
 * lost from the sheet, and never filed under an owner that could not have written it. ⚑ D-039's
 * tools section, on Codex, says `factory` itself.
 */
function conversationBlocks(instructions: SessionInstructions): ToldBlock[] {
  const composed = instructions.thisConversation
  if (typeof composed !== 'object' || composed === null || !Array.isArray(composed.spans)) return []
  return composed.spans.map((span, index) => ({
    key: `this-conversation:${String(index)}`,
    path: null,
    heading: span.heading,
    kind: 'this-conversation',
    text: composed.text.slice(span.start, span.end),
    truncated: false,
    whose: (WHOSE_TEXT as readonly string[]).includes(span.whose) ? span.whose : 'dynamic',
    name: span.heading ?? 'this conversation',
  }))
}

/**
 * The whole grouped view for one live conversation.
 *
 * @param instructions what this session was launched with (`158`), as the host read it.
 * @param layers the account's drawable layers — {@link ToldView.layers}, already fail-closed.
 */
export function whoseGroups(
  instructions: SessionInstructions,
  layers: readonly ToldLayer[],
): WhoseView {
  const blocks = new Map<WhoseText, ToldBlock[]>()
  for (const whose of WHOSE_TEXT) blocks.set(whose, [])
  let unsplit: UnsplitBundle | null = null

  // ⚑ **The agent's store FIRST, because it reaches the model first** — the provider loads it
  // inside its own preset, and this panel's order has been the prompt's order since `165` §3.
  const memory = Array.isArray(instructions.agentMemory) ? instructions.agentMemory : []
  for (const item of [...memory, ...instructions.injected]) {
    blocksOf(item).forEach((block) => {
      const whose = whoseOf(item, block)
      if (whose === null) {
        unsplit = { block, says: COULD_NOT_TELL_WHICH_PART }
        return
      }
      blocks.get(whose)?.push({ ...block, whose })
    })
  }
  // 🔴 **D-024 · R1 — what is true of this conversation, one block per section**, after the files,
  // where the prompt has it.
  for (const block of conversationBlocks(instructions)) blocks.get(block.whose)?.push(block)

  const groups = WHOSE_TEXT.map((whose): WhoseGroup => {
    const mine = layers.filter((layer) => WHOSE_LAYER[layer.kind] === whose)
    const held = named(blocks.get(whose) ?? [])
    return {
      whose,
      heading: WHOSE_WORDS[whose].heading,
      short: WHOSE_WORDS[whose].short,
      says: WHOSE_WORDS[whose].says,
      layers: mine,
      blocks: held,
      bytes: held.reduce((sum, block) => sum + bytesOf(block.text), 0),
      // ⛔ **Two groups are drawn empty and no others are** — see {@link WhoseGroup.drawn}.
      drawn: whose === 'configured' || whose === 'learned' || mine.length > 0 || held.length > 0,
    }
  })

  const held =
    groups.reduce((sum, group) => sum + group.bytes, 0) +
    (unsplit === null ? 0 : bytesOf((unsplit as UnsplitBundle).block.text))
  return { groups, unsplit, held }
}
