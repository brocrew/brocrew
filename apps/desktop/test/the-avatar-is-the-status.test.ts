import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sessionStatusSchema, type SessionStatus } from '@brobot2/shared'
import type { RuntimeEvent } from '@brobot2/runtime'
import {
  doingSays,
  doingTone,
  teamRoster,
  theirConversations,
  type TeamMemberView,
  type TeamRosterInput,
  type WhatTheyAreDoing,
} from '../src/renderer/src/lib/team-roster'
import {
  STANDING_LABEL,
  STANDING_TONE,
  activityLine,
  sessionFacets,
  standingOf,
  type SessionFacetInput,
} from '../src/renderer/src/lib/agent-state'
import type { ListedConversation } from '../src/renderer/src/lib/conversation-list'
import {
  NOTHING_HAS_ARRIVED,
  NOTHING_RIGHT_NOW,
  whatAPlateCanDraw,
  type ConversationAtWork,
  type WhatIsBeingDone,
} from '../src/shared/what-is-being-done'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import type { IdentityUse } from '../src/shared/agent-roster'
import type { AgentIdentities, AgentIdentity } from '../src/shared/runtime-ipc'
import { BeingDoneTracker } from '../src/main/runtime/being-done'

/**
 * The avatar visibly expresses the agent’s current state rather than showing undifferentiated
 * dotted lines.
 *
 * ## ⚑ What this file guards, and the claims are separable
 *
 * 1. **§1 · the SEVEN arms.** {@link WhatTheyAreDoing} is a discriminated union and not a word
 *    beside a reason, so every arm is reached through the fold and every arm's sentence is the
 *    one place it becomes English.
 * 2. **§2 · the plate is READ OFF the arm.** ⛔ `593`'s own line: *"the word is decided FIRST and
 *    the plate is read off it… so the face and the sentence beside it cannot disagree."*
 * 3. **§3 · ONE derivation.** The face, the word and the standing come from one
 *    {@link SessionFacetInput}, which is `089`/`099`'s repair applied to the third caller.
 * 4. **§4 · their conversations** are the one list's rows narrowed to the agent (D-016: the
 *    project room's fold they used to wrap is gone).
 * 5. **§6 · the wire's new field.** `BeingDoneTracker` kept the status privately since `575`; `593`
 *    publishes it and starts it at `idle`.
 *
 * ## ⛔ What it does NOT cover, said out loud
 *
 * - **The PAINT.** Every claim about weight, ink, fit and what a person can see belongs in
 *   `test/dom/**` — `brobot2-ssr-tests-pass-vacuously`, and this project has no layout at all.
 * - **The card's MARKUP.** Which element carries which fact is a render test's question; this file
 *   reads the fold, which is where `468`'s rule puts the derivation.
 * - **The tracker's whole event table.** `what-each-agent-is-doing.test.ts` §7 owns it; §6 below is
 *   scoped to the one field `593` added and to the turn boundary that field is built on.
 */

const AT = 1_700_000_000_000
const TEAM_FOLD = join(import.meta.dirname, '../src/renderer/src/lib/team-roster.ts')

/** ⛔ **Prose stripped, so a docblock quoting a shape is never mistaken for the shape.** */
const withoutProse = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

const identity = (over: Partial<AgentIdentity> & { slug: string }): AgentIdentity => ({
  id: `aid:${over.slug}`,
  displayName: null,
  createdAt: AT - 86_400_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  capabilities: DEFAULT_CAPABILITIES,
  chosen: {} as AgentIdentity['chosen'],
  provider: null,
  externalMcpServerIds: [],
  ...over,
})

const used = (over: Partial<IdentityUse> & { slug: string }): IdentityUse => ({
  conversations: 0,
  thisAppMintsIt: false,
  isLaunching: false,
  isStarting: false,
  runsOn: { provider: null, from: 'nothing-yet' },
  ...over,
})

/**
 * ⚑ **`status` defaults to `idle`, which is where `BeingDoneTracker` starts it** (593) — so a case
 * that is ABOUT the status overrides it and every other case measures what it was written to
 * measure (`a-positive-assertion-must-differ-from-the-default`).
 */
const atWork = (over: Partial<ConversationAtWork> & { conversation: string }): ConversationAtWork =>
  ({
    identity: 'ada',
    told: NOTHING_RIGHT_NOW,
    status: 'idle' as SessionStatus,
    streaming: false,
    since: AT - 30_000,
    context: null,
    ...over,
  }) satisfies ConversationAtWork

const reading = (rows: readonly ConversationAtWork[]): WhatIsBeingDone => ({
  readAt: AT,
  conversations: rows,
})

const source = (over: Partial<AgentIdentities> = {}): AgentIdentities => ({
  identities: [identity({ slug: 'ada', displayName: 'Ada' })],
  foldersWithoutARow: [],
  use: [used({ slug: 'ada' })],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
  ...over,
})

/**
 * ⚠️ **`beingDone` defaults to a COMPLETE and EMPTY reading rather than to `null`**, because `null`
 * is its own arm (`not-read`) and a fixture that defaulted to it would answer that arm for every
 * case that forgot to pass one.
 */
const team = (over: Partial<TeamRosterInput> = {}): TeamRosterInput => ({
  source: source(),
  query: '',
  filter: 'all',
  beingDone: reading([]),
  // ⚑ **593 · the LIVE instant is an ARGUMENT** — the fold read `Date.now()` itself until this
  // dispatch's own settle, which is why `asOf` could not be pinned. ⛔ A fixture instant far from
  // the wall clock is what makes the assertion about the fold rather than about the machine.
  now: AT,
  ...over,
})

const only = (over: Partial<TeamRosterInput> = {}): TeamMemberView => {
  const view = teamRoster(team(over))
  expect(view, 'the fold answered nothing at all').not.toBeNull()
  expect(view!.members, 'the fold answered no single member').toHaveLength(1)
  return view!.members[0]!
}

/** ⚑ **One agent, one live conversation, folded into one member.** */
const running = (one: Partial<ConversationAtWork> = {}): TeamMemberView =>
  only({
    source: source({ use: [used({ slug: 'ada', conversations: 4 })] }),
    beingDone: reading([atWork({ conversation: 'sess_a', ...one })]),
  })

/**
 * 🔴 **The ORACLE for §3, built through the two shared doors and never from a copy of `toldOf`.**
 *
 * ⛔ `whatAPlateCanDraw` is the only way out of `what-is-being-done.ts` and `sessionFacets` is the
 * one derivation — a test that re-spelled the private fold would measure its own copy.
 */
const asTheFoldSeesIt = (one: ConversationAtWork): SessionFacetInput => {
  const plate = whatAPlateCanDraw(one, one.status)
  return {
    phase: null,
    status: plate.status,
    activity: plate.activity,
    streaming: plate.streaming,
    liveness: null,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
   §1 · the seven arms — every KIND of answer, and the one place each becomes a sentence
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

describe('§1 · the seven arms of what they are doing', () => {
  /** ⚑ **One fixture per arm**, built from a real `AgentIdentities` and a real `WhatIsBeingDone`. */
  const CASES: readonly (readonly [WhatTheyAreDoing['it'], Partial<TeamRosterInput>])[] = [
    [
      'one-conversation',
      {
        source: source({ use: [used({ slug: 'ada', conversations: 2 })] }),
        beingDone: reading([
          atWork({
            conversation: 'sess_a',
            status: 'working',
            told: { said: 'an-activity', phase: 'tool', detail: 'Bash' },
          }),
        ]),
      },
    ],
    [
      // ⛔ **Running, and this app has NO word for it** — `nothing-has-arrived` withholds the
      // status, so `sessionDoing` answers `unknown` and the arm is the honest one.
      'in-a-conversation',
      {
        source: source({ use: [used({ slug: 'ada', conversations: 2 })] }),
        beingDone: reading([
          atWork({ conversation: 'sess_a', status: 'working', told: NOTHING_HAS_ARRIVED }),
        ]),
      },
    ],
    [
      'more-than-one',
      {
        source: source({ use: [used({ slug: 'ada', conversations: 9 })] }),
        beingDone: reading([
          atWork({ conversation: 'sess_a', status: 'working' }),
          atWork({ conversation: 'sess_b', status: 'working' }),
        ]),
      },
    ],
    [
      // ⚑ **A launch in flight outranks both counts below**, because it is the one state neither
      // of them can see: the rows do not exist yet and `conversations` is still zero.
      'starting',
      { source: source({ use: [used({ slug: 'ada', isLaunching: true })] }) },
    ],
    ['never-run', { source: source({ use: [used({ slug: 'ada', conversations: 0 })] }) }],
    ['not-right-now', { source: source({ use: [used({ slug: 'ada', conversations: 7 })] }) }],
    [
      'not-read',
      { source: source({ use: [used({ slug: 'ada', conversations: 7 })] }), beingDone: null },
    ],
  ]

  /**
   * 🔴 **Every arm, its sentence and its ink, in one table.**
   *
   * ⛔ **{@link doingSays} is the ONLY place these become English** — `485`'s rule and
   * `HOLDING_SAYS`' shape — so a card that spelled one of them its own way would be the fourth
   * vocabulary `EXT-012` §3.1 is complaining about.
   *
   * ⚠️ **`one-conversation` defers to {@link STANDING_LABEL} and is not a word of its own**: a
   * tenth word minted here would say *Working* twice in two spellings, six inches apart.
   */
  it('🔴 every arm is reachable, and each one says its own sentence', () => {
    const said = new Map<string, string>()
    for (const [arm, over] of CASES) {
      const member = only(over)
      expect(member.doing.it, `${arm} was not the arm this fixture reached`).toBe(arm)
      const sentence = doingSays(member.doing)
      expect(sentence, `${arm} said nothing`).toBeTruthy()
      said.set(arm, sentence)
    }
    // ⛔ **Seven distinct sentences** — a table that answered one string for two arms would tell a
    // person the same thing about two different facts.
    expect(new Set(said.values()).size).toBe(said.size)
    // ⚑ **The two sentences that are load-bearing, spelled out**: `EXT-012` §2.2's own words, and
    // the count that `byIdentity` refuses to reduce to one.
    expect(said.get('in-a-conversation')).toBe('In a conversation right now')
    expect(said.get('more-than-one')).toBe('In 2 conversations right now')
    expect(said.get('one-conversation')).toBe(STANDING_LABEL.working)
  })

  /**
   * ⛔ **The chip's ink comes from {@link STANDING_TONE} and from nowhere else**, and every other
   * arm is blank ON PURPOSE: a running conversation this app has no word for is not *work in
   * progress* — it may be sitting at a prompt nobody has answered — and the accent blue would
   * claim a working machine.
   */
  it('⛔ only the arm with a standing carries an ink, and the other six are blank', () => {
    const toned = new Map<string, string>()
    for (const [arm, over] of CASES) toned.set(arm, doingTone(only(over).doing))
    expect(toned.get('one-conversation')).toBe(STANDING_TONE.working)
    expect(toned.get('one-conversation')).not.toBe('')
    for (const [arm, tone] of toned) {
      if (arm === 'one-conversation') continue
      expect(tone, `${arm} painted a chip`).toBe('')
    }
  })

  /**
   * 🔴 **The control that makes the table above mean something** — the arms this file reaches are
   * EXACTLY the arms the union declares, derived from the module rather than typed here.
   *
   * ⛔ **Prose is stripped first** (`a-source-census-must-strip-prose-before-it-asserts`): this
   * module's docblocks quote arm names in sentences, and a census reading them would pass over an
   * eighth arm that had a comment and no fixture.
   *
   * ⚑ **And {@link doingSays} is asked for each one**, so an arm the switch has no case for is a
   * red here rather than an `undefined` interpolated into a card.
   */
  it('🔴 the arms reached are exactly the arms the union declares', () => {
    const declared = new Set(
      [...withoutProse(readFileSync(TEAM_FOLD, 'utf8')).matchAll(/\bit: '([a-z-]+)'/g)].map(
        (match) => match[1]!,
      ),
    )
    // ⛔ **A floor rather than a count**, so a regex that matched nothing cannot pass this silently.
    expect(declared.size).toBeGreaterThanOrEqual(7)
    expect([...declared].sort()).toEqual([...CASES.map(([arm]) => arm)].sort())
    for (const arm of declared) {
      const sentence = doingSays({ it: arm, standing: 'idle', count: 2 } as WhatTheyAreDoing)
      expect(sentence, `${arm} has no case in doingSays`).toBeTypeOf('string')
      expect(sentence, `${arm} said nothing`).not.toBe('')
    }
  })
})

/* ═══════════════════════════════════════════════════════════════════════════════════════════
   §2 · the plate is read off the arm — one arm, two marks, and no underline in any of them
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

describe('§2 · the plate is read off the arm', () => {
  /**
   * 🔴 **The drop's own defect, measured.** ⛔ Two marks were saying one nothing: a faceless dashed
   * ring UNDER a dotted `unstarted` underline, and the page read as broken rather than as quiet.
   *
   * ⚑ **`idle` is the true word for an identity nothing is running** — `042`'s *"idle means we are
   * no longer driving a turn"*, and with the reading COMPLETE that is a sound inference rather
   * than a guess ({@link WhatIsBeingDone.conversations}' own ruling).
   */
  it('🔴 an identity this app is running nothing as draws the idle face', () => {
    const quiet = only({ source: source({ use: [used({ slug: 'ada', conversations: 7 })] }) })
    expect(quiet.doing.it).toBe('not-right-now')
    expect(quiet.facets).toEqual({ doing: 'idle' })
  })

  /**
   * ⛔ **The three states that still draw NO face, each for its own reason** — nothing read yet (no
   * inference is available at all), never run (an idle face would show a bot resting from work it
   * never did) and two or more live ({@link byIdentity} refuses to pick).
   *
   * ⚠️ **Paired with the positive above**, so a fold that answered `unknown` for every arm would
   * fail the case before this one (`a-comparison-tested-where-both-sides-agree`).
   */
  it('⛔ never run, not read and more than one all draw the faceless ring', () => {
    const faceless: readonly (readonly [WhatTheyAreDoing['it'], Partial<TeamRosterInput>])[] = [
      ['never-run', { source: source({ use: [used({ slug: 'ada', conversations: 0 })] }) }],
      [
        'not-read',
        { source: source({ use: [used({ slug: 'ada', conversations: 7 })] }), beingDone: null },
      ],
      [
        'more-than-one',
        {
          source: source({ use: [used({ slug: 'ada', conversations: 9 })] }),
          beingDone: reading([
            atWork({ conversation: 'sess_a', status: 'working' }),
            atWork({ conversation: 'sess_b', status: 'working' }),
          ]),
        },
      ],
    ]
    for (const [arm, over] of faceless) {
      const member = only(over)
      expect(member.doing.it, arm).toBe(arm)
      expect(member.facets, `${arm} drew a face`).toEqual({ doing: 'unknown' })
    }
  })

  /**
   * 🔴 **Exactly one live conversation draws THAT conversation's own facets** — the plate is
   * `sessionFacets` of the one row and not a word invented for the card.
   */
  it('🔴 one live conversation lends the card its own face', () => {
    const one = atWork({
      conversation: 'sess_a',
      status: 'working',
      told: { said: 'an-activity', phase: 'thinking', detail: null },
    })
    const member = only({
      source: source({ use: [used({ slug: 'ada', conversations: 2 })] }),
      beingDone: reading([one]),
    })
    expect(member.facets.doing).toBe('thinking')
    expect(member.facets).toEqual(sessionFacets(asTheFoldSeesIt(one)))
  })

  /**
   * ⛔ **NO ARM DRAWS A `being`** — the underline is the PROVIDER's liveness and this page has no
   * read for one, so `plateFor` never asks for one.
   *
   * ⚑ **The paired positive is `sessionFacets` itself**: it still draws an underline for a provider
   * that has gone SILENT, which this fold never asks about (it hands `liveness: null`) — so the
   * negative below is a fact about this fold and not about a function that cannot draw an
   * underline at all. ⚑ **D-017b** — the positive was `unstarted`, the mark `593` removed from this
   * card; D-017b removed it from every plate (whether a session was started is a process fact).
   *
   * ⚠️ **And the boundary is measured rather than implied.** A stream whose last status was
   * TERMINAL used to draw `ended` here; ⚑ since D-017b a stop draws no underline either — it is
   * nothing doing anything here, and the plate says `idle`.
   */
  it('⛔ no arm draws the underline that made the page read as broken', () => {
    for (const [arm, over] of [
      ['not-right-now', { source: source({ use: [used({ slug: 'ada', conversations: 7 })] }) }],
      ['never-run', { source: source({ use: [used({ slug: 'ada', conversations: 0 })] }) }],
      ['starting', { source: source({ use: [used({ slug: 'ada', isLaunching: true })] }) }],
      [
        'not-read',
        { source: source({ use: [used({ slug: 'ada', conversations: 7 })] }), beingDone: null },
      ],
      [
        'one-conversation',
        {
          source: source({ use: [used({ slug: 'ada', conversations: 2 })] }),
          beingDone: reading([atWork({ conversation: 'sess_a', status: 'working' })]),
        },
      ],
      [
        'in-a-conversation',
        {
          source: source({ use: [used({ slug: 'ada', conversations: 2 })] }),
          beingDone: reading([atWork({ conversation: 'sess_a', told: NOTHING_HAS_ARRIVED })]),
        },
      ],
      [
        'more-than-one',
        {
          source: source({ use: [used({ slug: 'ada', conversations: 9 })] }),
          beingDone: reading([
            atWork({ conversation: 'sess_a', status: 'working' }),
            atWork({ conversation: 'sess_b', status: 'working' }),
          ]),
        },
      ],
    ] as const satisfies readonly (readonly [WhatTheyAreDoing['it'], Partial<TeamRosterInput>])[]) {
      const member = only(over)
      expect(member.doing.it, arm).toBe(arm)
      expect(member.facets.being, `${arm} drew an underline`).toBeUndefined()
    }
    // ⚑ **The positive**: the mark exists and this fold simply never asks for it.
    expect(
      sessionFacets({
        phase: null,
        status: 'working',
        activity: null,
        streaming: false,
        liveness: 'silent',
      }).being,
    ).toBe('silent')
    // ⚠️ **The boundary** — ⚑ D-017b: a terminal status on the stream draws no underline now, and
    // the face is the quiet one rather than none.
    const stopped = running({ status: 'ended' }).facets
    expect(stopped.being).toBeUndefined()
    expect(stopped.doing).toBe('idle')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════════════════════
   §3 · one derivation — the face, the word and the standing cannot disagree
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

describe('§3 · one derivation', () => {
  /**
   * ⚠️ **`streaming` OUTRANKS the phase, and `089` measured why**: after a tool returns, the last
   * activity still says `tool` while the model is already streaming its answer, and the pill read
   * *"running Bash"* into the middle of the reply.
   */
  it('⚠️ a streaming conversation says replying, whatever the last phase was', () => {
    const member = running({
      status: 'working',
      told: { said: 'an-activity', phase: 'tool', detail: 'Bash' },
      streaming: true,
    })
    expect(member.facets.doing).toBe('replying')
    expect(member.atWork).toHaveLength(1)
    expect(member.atWork[0]!.doing?.doing).toBe('replying')
    // 🔴 **And the DETAIL dies with the phase that produced it** — `activityLine`'s own rule,
    // *"appending it would put the lie back one word to the right — REPLYING BASH."*
    expect(member.atWork[0]!.doing?.detail).toBeUndefined()
    // ⛔ **The paired control**: the same row, not streaming, keeps the tool and its name — so the
    // assertion above measures the ORDER and not a row that never had a detail.
    const stopped = running({
      status: 'working',
      told: { said: 'an-activity', phase: 'tool', detail: 'Bash' },
    })
    expect(stopped.facets.doing).toBe('tool')
    expect(stopped.atWork[0]!.doing?.detail).toBe('Bash')
  })

  /**
   * 🔴 **A `tool` phase under a `working` status reaches the card as `tool`** — which is the whole
   * of `593` §3: without the status on the wire, `sessionDoing` answered `unknown` however much
   * the provider published, because `099` lets an activity REFINE a status and never PROMOTE one.
   *
   * ⛔ **The paired control is the same row with the status withheld**, one case below — so this
   * one measures the frame arriving rather than a fold that says `tool` for anything.
   */
  it('🔴 a tool phase under a working status reaches the card as tool', () => {
    const member = running({
      status: 'working',
      told: { said: 'an-activity', phase: 'tool', detail: 'Read' },
    })
    expect(member.facets.doing).toBe('tool')
    expect(member.doing).toEqual({ it: 'one-conversation', standing: 'working' })
    expect(doingSays(member.doing)).toBe(STANDING_LABEL.working)
    expect(member.atWork[0]!.doing?.detail).toBe('Read')
  })

  /**
   * ⛔ **`nothing-has-arrived` is WITHHELD, even though `status` is now non-null on the wire** —
   * `575`'s first honesty rule, untouched by `593`: a conversation this app has been told nothing
   * about draws `081`'s faceless ring rather than the `idle` it is recorded as, because `idle`
   * means *we are no longer driving a turn* about a conversation that has never had one.
   *
   * ⚑ **Paired with the ordinary quiet**, which is the same row one fact over and reads `idle` —
   * without it this case would pass over a fold that withheld the status from every row.
   */
  it('⛔ nothing has arrived is faceless, though the status is no longer null', () => {
    const silent = running({ status: 'idle', told: NOTHING_HAS_ARRIVED })
    expect(silent.facets.doing).toBe('unknown')
    expect(silent.doing.it).toBe('in-a-conversation')

    const quiet = running({ status: 'idle', told: NOTHING_RIGHT_NOW })
    expect(quiet.facets.doing).toBe('idle')
    expect(quiet.doing).toEqual({ it: 'one-conversation', standing: 'idle' })
    // 🔴 **And a working status with nothing said is NOT withheld** — only the first member of
    // `NOTHING_WAS_SAID` changes what the row may draw.
    expect(running({ status: 'working', told: NOTHING_RIGHT_NOW }).facets.doing).toBe('working')
  })

  /**
   * 🔴 **The plate, the row's standing and the card's sentence are THREE readings of ONE object.**
   *
   * ⛔ **The oracle is built through the shared doors** — `whatAPlateCanDraw` and `sessionFacets` —
   * so this measures that the fold used them, rather than re-spelling the private `toldOf` and
   * measuring its own copy.
   */
  it('🔴 the face, the word and the standing are three readings of one input', () => {
    const rows: readonly Partial<ConversationAtWork>[] = [
      { status: 'working', told: { said: 'an-activity', phase: 'thinking', detail: null } },
      { status: 'working', told: { said: 'an-activity', phase: 'tool', detail: 'Bash' } },
      { status: 'working', told: { said: 'an-activity', phase: 'waiting', detail: null } },
      { status: 'idle', told: NOTHING_RIGHT_NOW },
      { status: 'waiting_permission', told: NOTHING_RIGHT_NOW },
      { status: 'working', streaming: true, told: NOTHING_RIGHT_NOW },
      { status: 'idle', told: NOTHING_HAS_ARRIVED },
    ]
    for (const over of rows) {
      const one = atWork({ conversation: 'sess_a', ...over })
      const told = asTheFoldSeesIt(one)
      const member = running(over)
      expect(member.facets, JSON.stringify(over)).toEqual(sessionFacets(told))
      expect(member.atWork[0]!.standing, JSON.stringify(over)).toBe(standingOf(member.facets))
      expect(member.atWork[0]!.doing, JSON.stringify(over)).toEqual(activityLine(told))
      // ⚑ **And the card's own sentence is the row's standing, said once** — `one-conversation`
      // defers to `STANDING_LABEL` and never mints a word.
      if (member.doing.it === 'one-conversation') {
        expect(doingSays(member.doing)).toBe(STANDING_LABEL[member.atWork[0]!.standing])
      } else {
        expect(member.atWork[0]!.standing).toBe('unknown')
      }
    }
  })

  /**
   * ⚑ **The age is the EVENT's own stamp, measured against the READING's instant** — never a
   * second clock, so one page cannot show two ages from two moments.
   */
  it('⚑ the age dates the event and not the read', () => {
    const member = only({
      source: source({ use: [used({ slug: 'ada', conversations: 2 })] }),
      beingDone: reading([
        atWork({ conversation: 'sess_a', status: 'working', since: AT - 120_000 }),
      ]),
    })
    expect(member.atWork[0]!.since).toBe('2m ago')
  })

  /**
   * ⚑ **D-017b · every conversation it draws is pressed the same way, whichever window holds it.**
   *
   * ⛔ **This said *"a press exists only for a conversation this window holds"***: a row another
   * window held offered no press, because the screen could only open what this window held. ⚑ D-017b
   * opens every conversation in its one full view, so the fold no longer carries which window holds
   * a row (`AtWorkNow.canOpen` and `TeamRosterInput.held` are gone) and the card's one press —
   * *Open the conversation* — is drawn on every row. ⚠️ Asserted on both halves: the fold draws both
   * rows, and the button that opens them carries no condition.
   */
  it('⛔ a press exists for every conversation the card draws — no window gates it', () => {
    const view = teamRoster(
      team({
        source: source({ use: [used({ slug: 'ada', conversations: 4 })] }),
        beingDone: reading([
          atWork({ conversation: 'sess_here' }),
          atWork({ conversation: 'sess_there' }),
        ]),
      }),
    )
    const rows = view!.members[0]!.atWork
    expect(rows.map((row) => row.conversation)).toEqual(['sess_here', 'sess_there'])
    // ⛔ …and the press: the button whose hook names the row, read off the component with its prose
    // stripped, opens with no `v-if` between `<button` and its hook.
    const card = withoutProse(
      readFileSync(
        join(import.meta.dirname, '../src/renderer/src/components/TeamWorkspace.vue'),
        'utf8',
      ),
    )
    const hook = card.indexOf(':data-cy="`team-go-${one.conversation}`"')
    // The control: the press is still in the component, so the negative below reads a real button.
    expect(hook, 'the card no longer draws its press').toBeGreaterThan(-1)
    const button = card.slice(card.lastIndexOf('<button', hook), hook)
    expect(button).toContain('<button')
    expect(button, 'the press is gated again').not.toContain('v-if')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════════════════════
   §4 · theirConversations — the one list, narrowed to one agent
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

describe('§4 · their conversations, open and closed', () => {
  const listed = (
    over: Partial<ListedConversation> & { sessionId: string },
  ): ListedConversation => ({
    provider: 'claude',
    label: 'Ada',
    identity: 'ada',
    place: null,
    state: { is: 'idle' },
    // ⚑ D-016 · commit 7 · R2 — a conversation holding no piece; the narrowing reads identity.
    named: null,
    inAnotherWindow: false,
    updatedAt: AT - 60_000,
    ...over,
  })

  /**
   * ⛔ **Only their rows survive, and the rows are the one list's own** (D-016) — a second read of
   * the same conversations would be this shelf free to describe one conversation two ways
   * (`169` §1).
   */
  it('⛔ the narrowing keeps only the rows whose identity matches', () => {
    const shelf = theirConversations(
      [
        listed({ sessionId: 'sess_a', identity: 'ada' }),
        listed({ sessionId: 'sess_b', identity: 'ali' }),
        listed({ sessionId: 'sess_c', identity: 'ada' }),
      ],
      'ada',
      new Set<string>(),
    )
    expect(shelf).not.toBeNull()
    expect(shelf!.map((row) => row.conversation)).toEqual(['sess_a', 'sess_c'])
  })

  /**
   * ⚑ **A list that has not answered is not an empty one**, so the shelf answers nothing.
   *
   * ⛔ **The pair is an ANSWERED list holding none of theirs** — empty, or somebody else's only —
   * which is `[]` and never `null` (`086`: *not read* is not *none*). The shelf's two quiet
   * sentences turn on exactly this difference, so both readings are asserted side by side.
   */
  it('⚑ a list that has not answered answers nothing at all', () => {
    expect(theirConversations(null, 'ada', new Set<string>())).toBeNull()
    expect(theirConversations([], 'ada', new Set<string>())).toEqual([])
    expect(
      theirConversations(
        [listed({ sessionId: 'sess_b', identity: 'ali' })],
        'ada',
        new Set<string>(),
      ),
    ).toEqual([])
  })
})

/* ⚑ §5 was the role in words; agents have no role since D-014. */

/* ═══════════════════════════════════════════════════════════════════════════════════════════
   §6 · the wire's new field — the tracker reports the frame it was already keeping
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

describe('§6 · the status the tracker was already keeping', () => {
  const activity = (phase: 'thinking' | 'tool', detail?: string): RuntimeEvent =>
    ({ type: 'activity', phase, ...(detail === undefined ? {} : { detail }) }) as RuntimeEvent
  const status = (state: SessionStatus): RuntimeEvent => ({ type: 'status', state })

  /**
   * 🔴 **It starts at `idle`, which is where `createTranscript()` starts the same field.**
   *
   * ⛔ **It was `null`, and `null` was measured wrong on a running app**: `SessionMachine.sync`
   * publishes a status only when the derived one CHANGES, so a conversation that was already quiet
   * when this app registered it publishes none at all — and the Team card drew a faceless ring at
   * a live conversation the rail was calling `idle`.
   */
  it('🔴 the tracker reports a status from its first moment, and it is idle', () => {
    const tracker = new BeingDoneTracker(1_000)
    expect(tracker.current).toEqual({
      told: NOTHING_HAS_ARRIVED,
      streaming: false,
      since: 1_000,
      status: 'idle',
    })
    // ⛔ **And it does not make a silent conversation look alive** — `whatAPlateCanDraw` withholds
    // it while `NOTHING_HAS_ARRIVED` holds, which is `575`'s first honesty rule, untouched.
    expect(
      whatAPlateCanDraw(atWork({ conversation: 'sess_a', ...tracker.current }), 'idle').status,
    ).toBeNull()
  })

  /**
   * ⚑ **Every state the wire can carry replaces it** — driven from `sessionStatusSchema`'s own
   * options, so a sixth state added there is measured here rather than falling into whichever arm
   * happens to be last.
   */
  it('⚑ every status this wire can carry reaches the reading', () => {
    const states = sessionStatusSchema.options
    expect(states.length).toBeGreaterThanOrEqual(5)
    for (const state of states) {
      const tracker = new BeingDoneTracker(1_000)
      tracker.observe(status(state), 2_000)
      expect(tracker.current.status, state).toBe(state)
    }
    // ⛔ **And a second one replaces the first** — it is the LAST status this stream carried, not
    // the first one it saw.
    const tracker = new BeingDoneTracker(1_000)
    tracker.observe(status('working'), 2_000)
    tracker.observe(status('waiting_permission'), 3_000)
    expect(tracker.current.status).toBe('waiting_permission')
  })

  /**
   * ⛔ **The turn boundary this stream has** — a status that DIFFERS from the last clears the
   * phase, and a repeated one does not.
   *
   * ⚠️ **DIFFERS, not merely `working`, and that is the half that would be wrong the other way**:
   * `123` made `status: working` reachable from a burst the provider started by itself, so a rule
   * that cleared on every `working` would blank a live tool call in the middle of one.
   */
  it('⛔ a status that differs clears the phase, and a repeated one does not', () => {
    const tracker = new BeingDoneTracker(1_000)
    tracker.observe(activity('thinking'), 2_000)
    expect(tracker.current.told).toEqual({ said: 'an-activity', phase: 'thinking', detail: null })

    tracker.observe(status('working'), 3_000)
    expect(tracker.current.told).toEqual(NOTHING_RIGHT_NOW)
    expect(tracker.current.status).toBe('working')
    expect(tracker.current.since).toBe(3_000)

    // ⚑ **The repeat, on a phase that is live again** — the paired positive, so this measures the
    // TRANSITION and not a rule that never clears.
    tracker.observe(activity('tool', 'Bash'), 4_000)
    expect(tracker.current.told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })
    tracker.observe(status('working'), 5_000)
    expect(tracker.current.told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })
    expect(tracker.current.status).toBe('working')
    // ⛔ **And the stamp did not move**, because the answer did not: `since` is when this became
    // true and a repeated status may not restart it.
    expect(tracker.current.since).toBe(4_000)

    // 🔴 **The next DIFFERENT one clears it again** — so the repeat above is the exception and not
    // the rule this class keeps.
    tracker.observe(status('idle'), 6_000)
    expect(tracker.current.told).toEqual(NOTHING_RIGHT_NOW)
    expect(tracker.current.status).toBe('idle')
  })

  /**
   * 🔴 **What starting at `idle` COSTS, measured rather than argued** — the FIRST status a stream
   * carries is now compared against `idle` instead of against `null`, so a first `status: idle`
   * is a repeat and clears no phase, where before `593` it differed and cleared one.
   *
   * ⚠️ **Reported as a finding rather than repaired here.** It is narrow — it needs an `activity`
   * to arrive before this app has ever seen a `working` for that conversation — and the trade it
   * buys is the whole of `593`. ⛔ This case pins the behaviour that ships, so a repair moves it
   * deliberately.
   */
  it('🔴 a first idle status is a repeat of the frame the tracker opened with', () => {
    const tracker = new BeingDoneTracker(1_000)
    tracker.observe(activity('thinking'), 2_000)
    tracker.observe(status('idle'), 3_000)
    expect(tracker.current.told).toEqual({ said: 'an-activity', phase: 'thinking', detail: null })
    expect(tracker.current.status).toBe('idle')

    // ⛔ **The control**: the same first status, one word different, clears it.
    const other = new BeingDoneTracker(1_000)
    other.observe(activity('thinking'), 2_000)
    other.observe(status('working'), 3_000)
    expect(other.current.told).toEqual(NOTHING_RIGHT_NOW)
  })

  /**
   * ⚑ **The field reaches the plate through the fold** — the tracker's own reading, handed to the
   * Team card, draws the face the status frames.
   */
  it('⚑ the tracker’s own reading reaches the card as a face', () => {
    const tracker = new BeingDoneTracker(AT - 30_000)
    tracker.observe(status('working'), AT - 20_000)
    tracker.observe(activity('tool', 'Bash'), AT - 10_000)
    const member = only({
      source: source({ use: [used({ slug: 'ada', conversations: 3 })] }),
      beingDone: reading([
        {
          conversation: 'sess_a',
          identity: 'ada',
          ...tracker.current,
          context: null,
        } satisfies ConversationAtWork,
      ]),
    })
    expect(member.facets.doing).toBe('tool')
    expect(member.doing).toEqual({ it: 'one-conversation', standing: 'working' })
    expect(member.atWork[0]!.doing?.detail).toBe('Bash')
  })
})
