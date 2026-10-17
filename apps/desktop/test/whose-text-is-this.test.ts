import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BY_ITS_SECTIONS,
  LAYER_STAYS_IN_THE_ACCOUNT,
  WHOSE_FILE,
  WHOSE_LAYER,
  WHOSE_TEXT,
  WHOSE_WORDS,
  type WhoseText,
} from '../src/shared/whose-text'
import { TOLD_LAYER_KINDS } from '../src/shared/told'
import { toldView } from '../src/renderer/src/lib/told'
import { whoseGroups } from '../src/renderer/src/lib/whose-groups'
import {
  composeProfileBundle,
  profileBundleSpans,
  thisConversationSpans,
} from '../src/main/runtime/factory-text'
import type { InstructionContext } from '../src/main/runtime/factory-text'
import { theConversationCalled } from '../src/shared/piece-called'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import type {
  InjectedInstruction,
  InjectedInstructionKind,
  SessionInstructions,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **The question a heading answers, and whether what is under it agrees** (583 §5.3,
 * `HO-073` §4).
 *
 * > ⚑ **The brief:** *"A test that fails if a group's heading and its contents disagree — the
 * > `577` shape: the durable half is the test, not the wording."*
 *
 * ## ⛔ `577`'s shape, and what it is
 *
 * `the-heading-and-what-it-counts.test.ts` did not assert the heading's WORDS. It took two
 * INDEPENDENT readings of one population — what the column actually counts, measured by planting
 * a card of each kind; and what the heading claims to count, measured by parsing the rendered
 * string against the app's own noun table — and asserted they are the same set. ⚠️ **Its own
 * docblock names the defect that shape replaces**: seventeen prior assertions were a sentence
 * agreeing with itself, all green through an edit that moved the heading and the count together.
 *
 * ⚑ **The same two readings, one axis over:**
 *
 *  - **PLACED** — plant one file of each {@link InjectedInstructionKind}, alone, and see which
 *    group {@link whoseGroups} really puts it in. That runs the whole path: `blocksOf`,
 *    `whoseOf`, the section split and the push.
 *  - **DECLARED** — {@link WHOSE_FILE}, the table the headings are built from.
 *
 * ⛔ **They are not the same code and a bug in either shows up as a disagreement**, which is what
 * §2's planted controls prove by making the comparison fail on purpose.
 *
 * ## ⚠️ What this file deliberately does NOT assert
 *
 * ⛔ **The wording.** `WHOSE_WORDS`' sentences are pinned as literals where a person reads
 * them — `169` §2's rule, and the reason `577` left its own copy to `idle-truth.test.ts`. ⚑ What
 * is here is the PROPERTY: every block has exactly one owner, the owner it has is the one the
 * table declares, no block is lost between the wire and a group, and the compiled bundle's
 * sections tile it with nothing in the gaps.
 */

/* ────────────────────────────────────────────────────────────── fixtures */

const CONTEXT: InstructionContext = {
  profileSlug: 'brobot',
  cwd: '/tmp/where',
  startedBy: null,
  depth: 0,
  capabilities: null,
  spawningEnabled: true,
  // ⚑ D-016 · a conversation a person started owns a root, unnumbered on its first launch.
  root: 'not-yet-numbered',
  configured: 'Never merge without asking me first.',
  // ⚑ D-024 · R1 · no other conversation of the profile — which renders no line at all.
  others: { shown: [], more: 0 },
}

const BUNDLE = profileBundleSpans(CONTEXT)

/**
 * ⚑ **D-024 · R1 — the dynamic layer left the profile's file**: what is true of this conversation
 * is its own composition, sent with its launch and carried on the wire as
 * `SessionInstructions.thisConversation`, spans and all.
 */
const CONVERSATION = thisConversationSpans(CONTEXT)

/** A file of one kind, with enough bytes to be a real row. */
function file(kind: InjectedInstructionKind, over: Partial<InjectedInstruction> = {}) {
  return {
    kind,
    path: `/tmp/where/${kind}.md`,
    text: `# ${kind}\n\nsomething this app read.\n`,
    bytes: 40,
    truncated: false,
    ...over,
  } satisfies InjectedInstruction
}

/** The bundle row, carrying the spans the composer published with it. */
const BUNDLE_ROW: InjectedInstruction = {
  kind: 'profile-instructions',
  path: '/tmp/home/brobot-instructions.md',
  text: BUNDLE.text,
  bytes: BUNDLE.text.length,
  truncated: false,
  sections: BUNDLE.spans,
}

const MEMORY_KINDS: readonly InjectedInstructionKind[] = [
  'agent-memory',
  'agent-memory-note',
  'agent-memory-topic',
]

function instructions(over: Partial<SessionInstructions> = {}): SessionInstructions {
  return {
    injected: [],
    agentMemory: [],
    provider: [],
    refused: [],
    note: '',
    recallsReported: false,
    writesReported: false,
    composed: null,
    ...over,
  }
}

/** The grouped view, fed the account's own layers exactly as the component feeds it. */
function grouped(said: SessionInstructions) {
  return whoseGroups(said, toldView(said, null, false).layers)
}

/** Which group one file of this kind really lands in — the PLACED reading. */
function placed(kind: InjectedInstructionKind): readonly WhoseText[] {
  const one = MEMORY_KINDS.includes(kind)
    ? instructions({ agentMemory: [file(kind)] })
    : instructions({ injected: [kind === 'profile-instructions' ? BUNDLE_ROW : file(kind)] })
  return grouped(one)
    .groups.filter((group) => group.blocks.length > 0)
    .map((group) => group.whose)
}

/**
 * Everything, at once — the shape a real Claude launch in a real repository produces. ⚑ D-024 · R1:
 * that shape carries this conversation's own text beside the files, so the dynamic layer is on the
 * wire here as it was when it was a section of the bundle.
 */
const EVERYTHING = instructions({
  injected: [
    BUNDLE_ROW,
    file('profile-memory'),
    file('project-memory'),
    file('repository-conventions'),
    file('workspace-instructions'),
  ],
  agentMemory: [
    file('agent-memory', { reach: 'prompt' }),
    file('agent-memory-note', { reach: 'on-request' }),
    file('agent-memory-topic', { reach: 'on-request' }),
  ],
  provider: [{ path: '/tmp/where/CLAUDE.md', scope: 'project' }],
  refused: [{ path: '/tmp/where/bad.md', reason: 'symlink' }],
  thisConversation: CONVERSATION,
  composed: BUNDLE.text,
})

/* ──────────────────────────────────────────────────────────────── §1 */

describe('§1 · the vocabulary has no escape hatch (583 §5.1)', () => {
  it('⛔ every owner has a name, a short line and a membership test, and no two share a name', () => {
    for (const whose of WHOSE_TEXT) {
      const words = WHOSE_WORDS[whose]
      expect(words.heading.trim(), `${whose} has no heading`).not.toBe('')
      expect(words.short.trim(), `${whose} has no short line`).not.toBe('')
      expect(words.says.trim(), `${whose} has no membership test`).not.toBe('')
    }
    const headings = WHOSE_TEXT.map((whose) => WHOSE_WORDS[whose].heading)
    expect(new Set(headings).size, 'two owners answer to one heading').toBe(WHOSE_TEXT.length)
  })

  /**
   * Assert the visible text bound on this surface.
   *
   * > ⛔ *"I don't know to read all that stuff in the UI just visuals and very light text."*
   *
   * ⚠️ **The first grouped version put {@link WhoseWords.says} under every heading** — six
   * paragraphs, which is `HO-073` §4's wall rearranged. ⚑ The short line is what a person reads
   * without asking, so it has a LENGTH, and the full sentence has to be strictly longer or the
   * press it hides behind is opening nothing.
   */
  it('⚑ the line a person reads unasked is short, and the one behind the press says more', () => {
    for (const whose of WHOSE_TEXT) {
      const { short, says } = WHOSE_WORDS[whose]
      expect(short.length, `${whose}'s short line is a paragraph: ${short}`).toBeLessThanOrEqual(70)
      expect(says.length, `${whose}'s "more" says no more than its short line`).toBeGreaterThan(
        short.length,
      )
    }
  })

  it('⛔ every file kind and every layer kind is claimed, and only by a member', () => {
    const owners: readonly string[] = [...WHOSE_TEXT, BY_ITS_SECTIONS]
    for (const [kind, whose] of Object.entries(WHOSE_FILE)) {
      expect(owners, `${kind} is filed under something that is not an owner`).toContain(whose)
    }
    for (const kind of TOLD_LAYER_KINDS) {
      const whose = WHOSE_LAYER[kind]
      if (whose !== null) expect(WHOSE_TEXT as readonly string[]).toContain(whose)
    }
    // ⚠️ **Both directions.** A table keyed by the type cannot go short — the compiler sees to
    // that — but it CAN go long, and a key nothing enumerates is a row nothing draws.
    expect(Object.keys(WHOSE_LAYER).sort()).toEqual([...TOLD_LAYER_KINDS].sort())
  })

  /**
   * ⛔ **The account keeps exactly the layers nobody owns**, and the list is derived rather than
   * typed — so a layer given an owner leaves it in the same edit.
   */
  it('⚑ the account keeps the layers with no owner, and it is not empty', () => {
    expect(LAYER_STAYS_IN_THE_ACCOUNT.length).toBeGreaterThan(0)
    for (const kind of LAYER_STAYS_IN_THE_ACCOUNT) expect(WHOSE_LAYER[kind]).toBeNull()
    const owned = TOLD_LAYER_KINDS.filter((kind) => WHOSE_LAYER[kind] !== null)
    expect(owned.length, 'no layer has an owner — the grouping draws nothing').toBeGreaterThan(0)
  })
})

/* ──────────────────────────────────────────────────────────────── §2 */

describe('§2 · a heading and what is under it (583 §5.3, the 577 shape)', () => {
  /**
   * 🔴 **The two readings, and they are taken by different code.**
   *
   * ⛔ **PLACED runs the whole path** — `blocksOf`, `whoseOf`, the section split, the push into a
   * group — for one file at a time, so a group that receives a file it does not own is visible
   * as a set difference rather than as a look.
   */
  it('⛔ every kind lands in the group its own table declares, and in no other', () => {
    for (const kind of Object.keys(WHOSE_FILE) as InjectedInstructionKind[]) {
      const declared = WHOSE_FILE[kind]
      const landed = placed(kind)
      if (declared === BY_ITS_SECTIONS) {
        // ⚑ The compiled bundle is the one file with more than one owner, and the spans decide.
        expect(new Set(landed), `${kind} did not split`).toEqual(
          new Set(BUNDLE.spans.map((span) => span.whose)),
        )
        continue
      }
      expect(landed, `${kind} is declared ${declared} and landed in ${landed.join(', ')}`).toEqual([
        declared,
      ])
    }
  })

  /**
   * ⚠️ **The control that proves the equality above can fail** — `577`'s two planted headings,
   * in the shape this axis takes. ⛔ Without it the assertion is a sentence agreeing with itself.
   */
  it('⚑ …and a table that files every kind one owner along disagrees with what really happens', () => {
    const shifted = (kind: InjectedInstructionKind): WhoseText => {
      const declared = WHOSE_FILE[kind]
      const at = WHOSE_TEXT.indexOf(declared === BY_ITS_SECTIONS ? 'factory' : declared)
      return WHOSE_TEXT[(at + 1) % WHOSE_TEXT.length] as WhoseText
    }
    const wrong = (Object.keys(WHOSE_FILE) as InjectedInstructionKind[]).filter(
      (kind) => !placed(kind).includes(shifted(kind)),
    )
    expect(
      wrong.length,
      'the shifted table agreed with reality — the comparison measures nothing',
    ).toBeGreaterThan(0)
  })

  /**
   * 🔴 **The conservation law: the grouping neither loses a block nor draws one twice.**
   *
   * ⛔ **This is what *the heading and its contents agree* means once every heading is right** —
   * a row that fell out of every group is a piece of the prompt the sheet stopped accounting for,
   * which is `442` §2.1's false claim arriving by omission instead of by wording.
   */
  it('⛔ every byte on the wire is under exactly one heading', () => {
    const view = grouped(EVERYTHING)
    const blocks = view.groups.flatMap((group) => group.blocks)
    expect(view.unsplit, 'the bundle came with spans and still did not split').toBeNull()

    const keys = blocks.map((block) => block.key)
    expect(new Set(keys).size, 'a block is drawn under two headings').toBe(keys.length)

    // ⚑ **Per file, the blocks of it reassemble it exactly** — the spans tile the text, so a
    // section quietly dropped or double-counted shows up as a string that is not the file.
    const rows = [...EVERYTHING.agentMemory, ...EVERYTHING.injected]
    for (const row of rows) {
      const mine = blocks.filter((block) => block.path === row.path)
      expect(mine.length, `${row.kind} is under no heading at all`).toBeGreaterThan(0)
      expect(mine.map((block) => block.text).join(''), `${row.kind} did not reassemble`).toBe(
        row.text,
      )
    }
    // 🔴 **D-024 · R1 — and this conversation's own text, which came from no file**, is under a
    // heading too, whole: its blocks are the ones with no path, and they reassemble it.
    const conversation = blocks.filter((block) => block.path === null)
    expect(conversation.length, 'this conversation’s own text is under no heading').toBe(
      CONVERSATION.spans.length,
    )
    expect(
      conversation.map((block) => block.text).join(''),
      'this conversation’s own text did not reassemble',
    ).toBe(CONVERSATION.text)
    expect(blocks.length, 'the fixture drew fewer rows than it has files').toBeGreaterThanOrEqual(
      rows.length,
    )
  })

  /**
   * ⛔ **`not-held` is the one heading no FILE may ever be under**, and that is its definition
   * rather than an accident of today's fixture: this app holds the bytes of everything it
   * appended, so a block under *not shown* would be the group contradicting its own name.
   */
  it('⛔ nothing this app holds the bytes of is filed under "not this app’s to show"', () => {
    const view = grouped(EVERYTHING)
    const notHeld = view.groups.find((group) => group.whose === 'not-held')
    expect(notHeld?.blocks ?? [], 'a file with bytes is under the group that holds none').toEqual(
      [],
    )
    expect(notHeld?.layers.length, 'the absences are not drawn at all').toBeGreaterThan(0)
    expect(notHeld?.bytes, 'the group that holds nothing has a size').toBe(0)
  })

  /**
   * 🔴 **The two groups that are drawn EMPTY, and why each is an exception** — `536`'s argument,
   * twice. ⛔ A person whose agent has no rules and no memory is exactly the person with no other
   * way to learn that either layer exists.
   */
  it('⚑ "yours" and "the agent’s own" are drawn on a conversation that has neither', () => {
    const bare = grouped(instructions())
    const drawn = bare.groups.filter((group) => group.drawn).map((group) => group.whose)
    expect(drawn, 'the layer a person writes vanished when they had written none').toContain(
      'configured',
    )
    expect(drawn, 'the memory sentence vanished with the group that carries it').toContain(
      'learned',
    )
    // ⚠️ **And the control**: the groups that really are empty are NOT drawn, so the exception is
    // an exception rather than *every heading always*.
    expect(drawn, 'an empty group with nothing to say was drawn anyway').not.toContain('the-place')
  })

  it('⛔ a group is drawn when it has anything, and every drawn group has a heading', () => {
    for (const group of grouped(EVERYTHING).groups) {
      if (group.layers.length > 0 || group.blocks.length > 0) expect(group.drawn).toBe(true)
      if (group.drawn) expect(group.heading).toBe(WHOSE_WORDS[group.whose].heading)
    }
  })
})

/* ──────────────────────────────────────────────────────────────── §3 */

describe('§3 · the compiled bundle splits where the composer says it does (583 §1)', () => {
  /**
   * 🔴 **The invariant the whole split rests on: the spans TILE the text.**
   *
   * ⛔ **Every character is inside exactly one span** — separators and the trailing newline
   * included — so a section nobody gave an owner to cannot hide in a gap between two that were
   * classified, and a renderer slicing them cannot show a byte twice.
   */
  it('⛔ the spans partition the compiled text with nothing in the gaps', () => {
    const { text, spans } = BUNDLE
    // The head, the core, and the person's own rules: three sections, each with something in it.
    expect(spans.map((span) => span.heading)).toEqual([
      null,
      'How you work',
      'Your own instructions',
    ])
    expect(spans.map((span) => text.slice(span.start, span.end)).join('')).toBe(text)
    let at = 0
    for (const span of spans) {
      expect(span.start, 'a span starts before the one before it ended').toBe(at)
      expect(span.end, 'a span ends before it starts').toBeGreaterThan(span.start)
      at = span.end
    }
    expect(at, 'the last span stops short of the end of the file').toBe(text.length)
  })

  /**
   * ⛔ **Every arm of the composer, not the one a fixture happens to take.**
   *
   * ⚠️ **The spans are JS STRING indices into a file read back off a disk in UTF-8**, so the two
   * places a partition could come apart are a section that renders EMPTY and text outside the Basic
   * Multilingual Plane, where a character is two code units and a byte count is not an index.
   * ⚑ A person's own rules are 16,000 characters of anything they like. ⚠️ D-016 · the project
   * section went from the composer (the factory text has no project lines), and with it the two
   * arms that were about it — an explicitly empty description and no project at all — and the
   * astral project title.
   */
  it('⛔ …on every arm the composer has, including an empty section and astral text', () => {
    const arms: [string, InstructionContext][] = [
      ['no configured rules', { ...CONTEXT, configured: null }],
      [
        'a parent, and spawning switched off',
        // ⚑ D-016 · a conversation another one started owns no root, and is told that one by the
        // piece it owns (commit 7).
        {
          ...CONTEXT,
          startedBy: theConversationCalled('Ada', { label: 'W1', title: null }),
          spawningEnabled: false,
          root: null,
        },
      ],
      ['rules that are only whitespace', { ...CONTEXT, configured: '   \n  ' }],
      [
        'astral text in the rules',
        {
          ...CONTEXT,
          configured: '\u{1D49C} rule with \u{1F512}',
        },
      ],
    ]
    // ⚑ **D-024 · R1 — two compositions now, one walk**: the profile's file, and this
    // conversation's own text — the arm with a parent and spawning off is an arm of the second.
    const compositions = [
      ['the profile’s file', profileBundleSpans],
      ['this conversation', thisConversationSpans],
    ] as const
    for (const [name, arm] of arms) {
      for (const [which, compose] of compositions) {
        const { text, spans } = compose(arm)
        const said = `${name} (${which})`
        expect(spans.map((span) => text.slice(span.start, span.end)).join(''), said).toBe(text)
        expect(spans.at(-1)?.end, `${said}: the last span stops short`).toBe(text.length)
        for (const span of spans) {
          expect(span.end, `${said}: an empty span`).toBeGreaterThan(span.start)
        }
      }
    }
    // ⚠️ **And the arms really differ**, or the loop above measured one shape four times — in
    // each composition.
    expect(
      new Set(arms.map(([, arm]) => profileBundleSpans(arm).spans.length)).size,
    ).toBeGreaterThan(1)
    expect(new Set(arms.map(([, arm]) => thisConversationSpans(arm).text)).size).toBeGreaterThan(1)
  })

  /** ⚑ **The text is unchanged by having a map of itself** — one walk, two projections. */
  it('⚑ composing and mapping are the same walk', () => {
    expect(composeProfileBundle(CONTEXT)).toBe(BUNDLE.text)
  })

  /**
   * ⛔ **Every layer `HO-009` §2 renders is really in there**, and the person's own text is under
   * the heading `bundleHeader` names — which is the pairing `YOUR_OWN_INSTRUCTIONS_HEADING`
   * exists to keep from drifting.
   *
   * 🔴 **D-024 · R1 — "in there" is two compositions now.** The profile's file carries `factory +
   * configured` and nothing of one conversation — a sibling's launch rewrites that file — and
   * `dynamic` is this conversation's own text, all of it and nothing else.
   */
  it('⛔ factory, configured and dynamic each carry at least one section', () => {
    const owners = new Set(BUNDLE.spans.map((span) => span.whose))
    expect([...owners].sort()).toEqual(['configured', 'factory'])
    const conversation = new Set(CONVERSATION.spans.map((span) => span.whose))
    expect([...conversation]).toEqual(['dynamic'])
    expect(CONVERSATION.spans.map((span) => span.heading)).toEqual([
      'This conversation',
      'What you may do',
    ])
    expect(BUNDLE.text, 'a fact of one conversation is in the profile’s file').not.toMatch(
      /## This conversation|## What you may do/,
    )
    const mine = BUNDLE.spans.find((span) => span.whose === 'configured')
    expect(mine?.heading).toBe('Your own instructions')
    expect(BUNDLE.text.slice(mine?.start ?? 0, mine?.end ?? 0)).toContain(
      'Never merge without asking me first.',
    )
  })

  /**
   * 🔴 **An identity with no rules gets no `configured` section at all**, which is
   * `composeProfileBundle`'s own ruling — an empty heading is worse than no heading — and the
   * reason `bundleHeader` has two arms.
   */
  it('⚑ …and an identity nobody has written rules for has no configured section', () => {
    // ⚑ D-024 · R1 · `dynamic` left the file for this conversation's own text, which has no
    // `configured` section either.
    const bare = profileBundleSpans({ configured: null })
    expect(new Set(bare.spans.map((span) => span.whose))).toEqual(new Set(['factory']))
    const itsOwn = thisConversationSpans({ ...CONTEXT, configured: null })
    expect(new Set(itsOwn.spans.map((span) => span.whose))).toEqual(new Set(['dynamic']))
    expect(bare.text).not.toMatch(/## Your own instructions/)
    // ⛔ **And the header says so** — the clause that named a section below it was false on every
    // fresh install until 583 rendered it from whether the section is there.
    expect(bare.text).toContain('as soon as there are any')
    expect(BUNDLE.text).toContain('has written into the "Your own instructions" section below')
  })

  /**
   * 🔴 **The fail-closed arm: a file that is not the file we composed gets NO map** (`438`).
   *
   * ⛔ **Both arms, against a real publish and a real read-back**, because the whole claim is
   * about bytes surviving a round trip through a disk this app does not own.
   */
  it('⛔ the spans ride the bundle through publish and read-back — and stop if the bytes moved', () => {
    const root = mkdtempSync(join(tmpdir(), 'whose-'))
    const home = join(root, 'home')
    const cwd = join(root, 'cwd')
    mkdirSync(home, { recursive: true })
    mkdirSync(cwd, { recursive: true })
    // ⚑ D-024 · R1 · the file no longer names the folder — that is this conversation's own text —
    // so it is composed from the profile alone.
    const composed = profileBundleSpans(CONTEXT)
    const bundle = publishProfileBundle('claude', home, composed.text)
    expect(bundle.ok).toBe(true)

    const read = readSessionInstructions({
      provider: 'claude',
      cwd,
      providerHome: home,
      home: root,
      bundle,
      bundleComposed: composed,
    })
    const row = read.instructions.injected.find((one) => one.kind === 'profile-instructions')
    expect(row?.sections, 'the map did not survive the round trip').toHaveLength(
      composed.spans.length,
    )
    expect(
      (row?.sections ?? []).map((span) => (row?.text ?? '').slice(span.start, span.end)).join(''),
      'the map does not fit the bytes it came back with',
    ).toBe(row?.text)

    // ⚠️ **Somebody edited the leaf between the publish and the read.** The publisher would not
    // overwrite a file it did not write, so this is the shape a HOST one build behind produces —
    // and a span list slid by one edit would file a person's own rules under this app's name.
    writeFileSync(join(home, 'brobot-instructions.md'), `${composed.text}\nand a line of theirs\n`)
    const moved = readSessionInstructions({
      provider: 'claude',
      cwd,
      providerHome: home,
      home: root,
      bundle,
      bundleComposed: composed,
    })
    const after = moved.instructions.injected.find((one) => one.kind === 'profile-instructions')
    expect(after?.text, 'the fixture did not actually change the file').not.toBe(composed.text)
    expect(
      after?.sections,
      'a stale map was attached to bytes it does not describe',
    ).toBeUndefined()
  })

  /**
   * ⛔ **And the renderer says so rather than guessing** — the unsplit row is its own thing, in no
   * group, which is `438`'s fail-closed rule completed on the surface.
   */
  it('⛔ a bundle with no map is drawn whole and filed under nobody', () => {
    const noMap: InjectedInstruction = { ...BUNDLE_ROW }
    delete (noMap as { sections?: unknown }).sections
    const view = grouped(instructions({ injected: [noMap], composed: BUNDLE.text }))
    expect(view.unsplit?.block.path).toBe(BUNDLE_ROW.path)
    expect(view.unsplit?.block.text).toBe(BUNDLE.text)
    expect(
      view.groups.flatMap((group) => group.blocks),
      'it was filed anyway',
    ).toEqual([])
    // ⚠️ **Not the reassuring answer.** `factory` is where a guess would land it, and three
    // authors' text under BroBot's name is the claim this arm exists to refuse.
    expect(view.groups.find((group) => group.whose === 'factory')?.blocks).toEqual([])
  })
})

/* ──────────────────────────────────────────────────────────────── §4 */

describe('§4 · the size bar is a share of something it names (583 relay 2)', () => {
  it('⛔ the whole is the sum of the groups, and a group that holds nothing is zero', () => {
    const view = grouped(EVERYTHING)
    expect(view.held).toBe(view.groups.reduce((sum, group) => sum + group.bytes, 0))
    expect(view.held, 'the fixture appended nothing').toBeGreaterThan(0)
    for (const group of view.groups) {
      if (group.blocks.length === 0) expect(group.bytes, `${group.whose} has phantom bytes`).toBe(0)
    }
  })

  /**
   * ⚠️ **The bytes are the ENCODED length, not the string length** — `layerBytes`' own encoder.
   * ⛔ A share printed beside a size computed a different way is two arithmetics for one number.
   */
  it('⚑ a group made only of one file weighs exactly that file', () => {
    const one = instructions({ injected: [file('repository-conventions')] })
    const view = grouped(one)
    const place = view.groups.find((group) => group.whose === 'the-place')
    expect(place?.bytes).toBe(new TextEncoder().encode(file('repository-conventions').text).length)
    expect(view.held).toBe(place?.bytes)
  })
})
