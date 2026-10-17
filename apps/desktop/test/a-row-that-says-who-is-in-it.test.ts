import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { conversationList } from '../src/renderer/src/lib/conversation-list'
import type { ConversationListInput } from '../src/renderer/src/lib/conversation-list'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  agentName,
  foldProfileName,
  profileLabel,
} from '../src/shared/runtime-ipc'
import type { AgentIdentity, ResumableSessionInfo } from '../src/shared/runtime-ipc'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'

/**
 * A conversation row identifies who is in it.
 *
 * > *"in the left conversation list panel, can we actually show the role? now it shows
 * > `brobot-workspace` and that is not a relevant information."*
 *
 * ⚑ **Three rows, all titled `brobot-workspace`** — the workspace folder `424` gave BroBot, which
 * every conversation started there shares — while the AGENTS section eight rows below listed
 * `default`, `project-manager` and `worker`. ⛔ **The fact was on the wire the whole time**:
 * `profileId` rides on `CreatedSession` and on both closed-list shapes, and `421` had already used
 * it.
 *
 * ## ⚠️ The trap, which is why this file is mostly about what did NOT change
 *
 * ⛔ **The folder is not useless; it is just not the identity.** `424` runs BroBot's own
 * conversation in `<userData>/brobot-workspace` and a placed one in the folder it was given, so two
 * rows with the same title may be in different places.
 * 🔴 **Dropping it for the identity would have rebuilt `210` finding 4 with the axes swapped** —
 * *"both rail rows read exactly `workspace-a / codex · idle`"* — so the folder moved onto the row's
 * own `<small>` rather than going away. `rail-identity.dom.test.ts` §A is where that is measured on
 * rendered rows; this file is about the derivation underneath it.
 *
 * ## ⛔ Which of three words, and the argument
 *
 * ⚠️ `role` is out by standing rule 10 — it *"selects text and drives display and gates nothing"*,
 * `377` writes exactly one of them, and every other identity answers *nobody has said*, so a rail
 * keyed on it would name one row and leave the rest blank. ⚑ **The display name when a person set
 * one, the slug when nobody did** — which is what `423`'s own creation form treats as the pair, and
 * what the AGENTS section was already drawing.
 */

const here = dirname(fileURLToPath(import.meta.url))
const RAIL = join(here, '../src/renderer/src/components/SideRail.vue')
const TEAM_FOLD = join(here, '../src/renderer/src/lib/team-roster.ts')
const TEAM_PAGE = join(here, '../src/renderer/src/components/TeamWorkspace.vue')

const identity = (slug: string, displayName: string | null): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName,
  createdAt: 0,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  capabilities: DEFAULT_CAPABILITIES,
  chosen: {} as AgentIdentity['chosen'],
  provider: null,
  // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
  externalMcpServerIds: [],
})

const ROSTER = [
  identity(DEFAULT_PROFILE_ID, null),
  identity('project-manager', 'Project manager'),
  identity('worker', null),
]

describe('§0 · 592 · the seeded slug IS the product’s own name', () => {
  /**
   * 🔴 **`HO-078` §2's rule, stated where a test can hold it** — and it is the sentence that makes
   * `167` §2's special case shrink instead of vanishing.
   *
   * > ⚑ **`default` is a slug that means nothing… Rename it and the special case retires rather
   * > than being maintained.**
   *
   * ## ⛔ Why this is a PROPERTY and not the spelling
   *
   * ⚠️ **`592` re-aimed every fixture in this repository off the literal and onto the constant**,
   * which is right — and it left almost nothing distinguishing one VALUE from another. ⛔ Measured
   * on the whole suite with the slug put back to `default`: **three assertions out of 11,735
   * noticed**, and two of them noticed by accident, because a proposal named *BroBot* happens to
   * fold to the seeded slug. 🔴 **A rename back would have been a green diff**, which is
   * `a-mutation-on-a-census-is-invisible-to-that-census` arriving through a constant.
   *
   * ⚑ **So the rule is asserted as a derivation**: the slug is the app's own name, folded. ⛔ That
   * is what `profileLabel` is allowed to lean on — it CAPITALISES rather than SUBSTITUTES — and
   * the day the two part, the label starts hiding a word again and this goes red.
   */
  it('🔴 the slug is {@link DEFAULT_PROFILE_LABEL} folded — so the label adds a capital and nothing else', () => {
    expect(foldProfileName(DEFAULT_PROFILE_LABEL)).toBe(DEFAULT_PROFILE_ID)
    // ⚠️ **The label is not the slug**, or *"it only capitalises"* would be a claim about a
    // function that does nothing (`a-positive-assertion-must-differ-from-the-default`).
    expect(DEFAULT_PROFILE_LABEL).not.toBe(DEFAULT_PROFILE_ID)
    // ⚑ **D-016 · the seeded PROJECT called `default` went with projects**, and with it the
    // assertion that the two seeded names had parted: there is one seeded name now.
  })

  /** ⚑ **The control, in one mount**: the special case answers for this slug and for nothing else. */
  it('⛔ …and it is a special case about ONE slug, which is the half that survived the rename', () => {
    expect(profileLabel(DEFAULT_PROFILE_ID)).toBe(DEFAULT_PROFILE_LABEL)
    expect(profileLabel('some-other-agent')).toBe('some-other-agent')
  })
})

describe('§1 · one derivation, and it is the old one plus the roster', () => {
  /**
   * 🔴 **THE DEFECT THIS FILE EXISTS TO STOP COMING BACK: a second way to name an identity.**
   *
   * ⛔ **The app already had two and they disagreed.** `profileLabel` answers the app's own name
   * — *"BroBot (default)"* when this was written, and *"BroBot"* since `592` retired the
   * qualifier with the slug it qualified — or the bare slug, and `SessionInfo`, `ResumableSessions` and `SessionShelf` all drew it (until `714` named them through `agentName`); the
   * rail's AGENTS row drew `displayName ?? slug`. ⚑ So an identity a person had NAMED appeared
   * under its name in one list and under its slug in another.
   *
   * ⚠️ **This is not "they agree today"** — it is that one function is defined in terms of the
   * other, so a surface still drawing the older one is this one with an empty roster rather than a
   * second answer.
   */
  it('🔴 with nothing to add, it IS profileLabel — over every shape of input', () => {
    for (const id of [null, DEFAULT_PROFILE_ID, 'project-manager', 'worker', 'never-seen']) {
      for (const roster of [null, [], ROSTER.filter((one) => one.slug === 'nobody')]) {
        expect(agentName(id, roster), `${String(id)} with ${JSON.stringify(roster)}`).toBe(
          profileLabel(id),
        )
      }
    }
    // ⚑ **Non-vacuity**: the two answers `profileLabel` itself distinguishes are both reachable
    // here, so the equality above is not one constant compared with itself.
    expect(agentName(null, null)).toBe(DEFAULT_PROFILE_LABEL)
    expect(agentName('worker', null)).toBe('worker')
    expect(agentName(null, null)).not.toBe(agentName('worker', null))
  })

  /**
   * 🔴 **610 · the two sides of the lookup come from DIFFERENT COLUMNS, and one of them keeps
   * case.**
   *
   * ⛔ **Measured**: a conversation launched as profile `Dev` writes `agent_identity.slug = 'dev'`
   * with the minted display name `Ada`, and `provider_session.profile_id = 'Dev'` — the spelling
   * every caller of this function passes. ⚠️ **Before this the answer was `Dev`**, so the identity
   * a person had named went unnamed for one spelling, which is exactly what §1's own defect note
   * says this function exists to stop.
   *
   * 🔴 **671 · RE-AIMED — the fallback IS folded now** (`667` G5a, `671` §4). ⛔ This test pinned
   * *"an unnamed one keeps its spelling"* — `Dev` — and that is what made one card read *"dev to
   * Dev"* until `667` folded it at four renderer call sites. ⚑ **The promise it pins now is the
   * one the PM ruled: ONE spelling, whoever asks.** ⚠️ Stripped AND re-aimed (rule 26): the
   * named half is unchanged, and the unnamed half asserts the folded spelling rather than being
   * deleted.
   */
  it('🔴 a capitalised spelling finds the identity it IS, and an unnamed one reads its ONE spelling', () => {
    const named: readonly AgentIdentity[] = [identity('dev', 'Ada')]
    expect(agentName('Dev', named)).toBe('Ada')
    expect(agentName('dev', named)).toBe('Ada')
    // ⚠️ **The paired negative, one fact over** — no row for that identity, so the answer is the
    // SLUG, folded, whichever spelling the conversation ran under.
    expect(agentName('Dev', [])).toBe('dev')
    expect(agentName('Dev', null)).toBe('dev')
    expect(agentName('dev', null)).toBe(agentName('Dev', null))
    // ⚑ **A name a PERSON chose is never folded** — the control that the fold is on the fallback
    // alone: `Ada` comes back as typed.
    expect(agentName('Dev', [identity('dev', 'Ada Lovelace')])).toBe('Ada Lovelace')
  })

  /** ⛔ **And the roster is what it ADDS** — `423`'s field, on the identity a person named. */
  it('⛔ a display name a person set is what the row says, and only for that identity', () => {
    expect(agentName('project-manager', ROSTER)).toBe('Project manager')
    // ⚠️ **A row nobody has named falls through**, which is the `??` this function is built on —
    // `displayName` is nullable, and *no row* and *a row with no name* are one answer here.
    expect(agentName('worker', ROSTER)).toBe('worker')
    expect(agentName(DEFAULT_PROFILE_ID, ROSTER)).toBe(DEFAULT_PROFILE_LABEL)
  })

  /**
   * ⚠️ **`null` is the PRE-PROFILES row and it really did run in the default one** — the host
   * resolves it that way on every resume. ⛔ The OTHER null — a conversation swept out of the
   * user's own provider home — must never reach here, and `conversation-list.ts` drops it before
   * the fold with `154`'s reasoning (D-017b; it was `closed-threads.ts`). §2 asserts that premise rather than trusting it.
   */
  it('⚑ a row recorded before profiles could be chosen is named as the default, not as nothing', () => {
    expect(agentName(null, ROSTER)).toBe(DEFAULT_PROFILE_LABEL)
    expect(agentName(null, ROSTER)).toBe(agentName(DEFAULT_PROFILE_ID, ROSTER))
  })
})

/**
 * ⚑ **D-017b · re-aimed from the rail's CLOSED rows to its ONE list** — `closed-threads.ts` went with
 * the open / closed split, and `conversation-list.ts` is the fold every row of the rail and the ⌘K
 * palette is now named by. ⛔ The facts pinned are unchanged: who, by the identity; where, by the
 * folder; two fields, never one.
 */
describe('§2 · the rail’s one list carries both facts, and the one that can be absent is the place', () => {
  const base: ResumableSessionInfo = {
    sessionId: 'sess_1',
    provider: 'claude',
    ref: { provider: 'claude', sessionId: 'th_1', cwd: '/w/one', rotation: 0 },
    cwd: '/w/one',
    status: 'ended',
    running: 'not-running',
    state: { is: 'idle' },
    approvalMode: 'ask',
    profileId: 'project-manager',
    reasoningEffort: null,
    model: null,
    planMode: null,
    adoptedAt: null,
    hasTranscript: true,
    lastEnding: 'completed',
    child: null,
    updatedAt: 0,
    resumeRefusal: null,
  } as ResumableSessionInfo

  const fold = (
    rows: ResumableSessionInfo[],
    identities: ConversationListInput['identities'] = ROSTER,
  ): ReturnType<typeof conversationList> =>
    conversationList({
      resumable: rows,
      unresumable: [],
      identities,
    })

  it('🔴 the row is named by the identity and placed by the folder — two fields, never one', () => {
    const [row] = fold([base])
    expect(row!.label).toBe('Project manager')
    expect(row!.place).toBe('one')
  })

  /**
   * ⛔ **The negative `210` finding 4 is about, with the axes swapped.** Two conversations of ONE
   * identity in TWO folders must not fold to one row shape — which is exactly what dropping the
   * folder for the identity would have done.
   */
  it('⛔ two conversations of one identity in two places do not fold to the same row', () => {
    const folded = fold([
      base,
      { ...base, sessionId: 'sess_2', cwd: '/w/two' } as ResumableSessionInfo,
    ])
    expect(folded).toHaveLength(2)
    expect(folded[0]!.label).toBe(folded[1]!.label)
    expect(folded[0]!.place).not.toBe(folded[1]!.place)
  })

  /** ⚠️ **A cold rail has no roster, and it must say LESS rather than something else.** */
  it('⚑ with no roster the row still says who, in the words the rest of the app uses', () => {
    const [row] = fold([base], null)
    expect(row!.label).toBe(profileLabel('project-manager'))
  })

  /** ⛔ **No folder is a real state**, and the row drops the fact rather than drawing a gap. */
  it('⛔ a row with no directory has no place at all — not an empty one', () => {
    const [row] = fold([{ ...base, cwd: '' } as ResumableSessionInfo])
    expect(row!.place).toBeNull()
    expect(row!.label).toBe('Project manager')
  })
})

describe('§3 · one spelling in the rail, asserted over its source', () => {
  /**
   * 🔴 **The census that stops a third spelling arriving.**
   *
   * ⛔ **`SideRail.vue` drew an identity's name in TWO lists** — the conversation rows and the
   * AGENTS section — and before `449` each had its own expression. ⚑ Both called
   * {@link agentName}, and neither spelled the fallback itself.
   *
   * 🔴 **570 · the rail has ONE list now, and the number is re-aimed rather than relaxed**
   * (standing rule 26). `EXT-008` §4.4 took the AGENTS section out of the navigation column; the
   * roster it drew is `TeamWorkspace`'s, and the test below this one is where that reading went.
   * ⛔ **The rule did not move**: whatever list this file names must reach `agentName` and must
   * not spell the fallback. ⚠️ **`toBe` and not `toBeGreaterThanOrEqual`**, because the only
   * remaining caller is `who()` and a second one appearing here without a list to justify it is
   * exactly the drift this census exists for.
   *
   * ⚠️ **Prose-stripped, because the rail quotes the expression it retired** — a docblock naming
   * `displayName ?? identity.slug` would otherwise satisfy the very grep that exists to refuse it
   * (`a-source-census-must-strip-prose-before-it-asserts`).
   */
  it('⛔ the rail names an identity through ONE function, in the one list it has left', () => {
    const raw = readFileSync(RAIL, 'utf8')
    const code = withoutProse(raw)
    expect(code.match(/agentName\(/g)?.length ?? 0).toBe(1)
    // ⚑ **D-016 · the rail's project rows are gone**, and with them the `row.displayName ??` line
    // (a PROJECT's name) that made this census read `identity.` rather than a bare
    // `displayName ??`. ⛔ So it reads the bare shape: no line of the rail's code spells the
    // fallback, whoever it names.
    expect(code, 'a second spelling of the fallback is back in the rail').not.toContain(
      'displayName ??',
    )
    // ⚑ **The planted control** (standing rule 12): the rail's own prose still carries the retired
    // expression, so a stripper that did nothing would fail here rather than pass the assertion
    // above by accident. ⚠️ **It was TWO plants and is one** — the second lived in the AGENTS
    // section's own comment and left with it — so the count is pinned rather than dropped, and the
    // SECOND plant is now in the team fold's docblock, asserted by the next test.
    expect(raw, 'the stripper removed nothing').toContain('identity.displayName ??')
    expect(
      (raw.match(/identity\.displayName \?\?/g) ?? []).length,
      'the control lost its plant',
    ).toBe(1)
  })

  /**
   * 🔴 **570 · the FOURTH list, and it is the one the rail's eviction made the app's home for
   * identities.**
   *
   * ⛔ **`472` widened this census once, for exactly this reason** — *"a third list of identities
   * arrived and the census above could not see it: it is scoped to `SideRail.vue` by path"*. ⚠️
   * **`568` then wrote a fourth**, `lib/team-roster.ts`, scoped by neither of the two tests above,
   * and it spelled `identity.displayName ?? identity.slug` with a comment saying the literal
   * fallback was deliberate.
   *
   * 🔴 **The argument was right and the expression was not.** {@link agentName} IS
   * `displayName ?? profileLabel`, so it guesses no title for anybody; it differs on exactly one
   * slug, and that slug is `default`. ⛔ **`profileLabel('default')` is `BroBot (default)`, which
   * `167 §2` ruled a bare `default` must never be shown as** — so the fourth list drew this app's
   * own main agent as `default` on the one screen built to show a person their agents, one column
   * away from a rail that called the same identity `BroBot (default)`. ⚑ That is `449`'s defect
   * exactly, arriving on the surface that replaced the list `449` fixed.
   */
  it('⛔ the team roster names an identity through the same one function', () => {
    const raw = readFileSync(TEAM_FOLD, 'utf8')
    const fold = withoutProse(raw)
    expect(fold.match(/agentName\(/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
    expect(fold, 'a second spelling of the fallback is in the team fold').not.toContain(
      'displayName ??',
    )
    // ⚑ **The plant the rail lost** (standing rule 12): this fold's own docblock quotes the
    // expression it retired, so a stripper that did nothing fails here instead of passing the
    // negative above by accident.
    expect(raw, 'the stripper removed nothing').toContain('identity.displayName ??')
    // ⛔ **And the surface HANDS THE FOLD'S ANSWER OVER** rather than computing a name of its own
    // — the stronger half `472` states, asserted on the component this fold feeds.
    const page = withoutProse(readFileSync(TEAM_PAGE, 'utf8'))
    expect(page, 'the team page names an identity of its own').not.toContain('agentName(')
    expect(page, 'the team page stopped drawing the name the fold computed').toContain(
      '{{ member.heading }}',
    )
  })
})

/** Line and block comments removed — `send-refusals.test.ts`'s stripper, for its reason. */
function withoutProse(source: string): string {
  let inBlock = false
  return source
    .split('\n')
    .map((raw) => {
      let code = ''
      for (let at = 0; at < raw.length; at += 1) {
        const rest = raw.slice(at)
        if (inBlock) {
          if (!rest.startsWith('*/') && !rest.startsWith('-->')) continue
          at += rest.startsWith('-->') ? 2 : 1
          inBlock = false
          continue
        }
        if (rest.startsWith('//')) break
        if (rest.startsWith('/*') || rest.startsWith('<!--')) {
          inBlock = true
          at += rest.startsWith('<!--') ? 3 : 1
          continue
        }
        code += raw[at]
      }
      return code
    })
    .join('\n')
}
