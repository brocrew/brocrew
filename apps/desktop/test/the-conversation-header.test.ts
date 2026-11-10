import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  sessionDoing,
  sessionFacets,
  standingOf,
  STANDINGS,
  STANDING_LABEL,
  STANDING_TONE,
  type AgentFacets,
  type Standing,
} from '../src/renderer/src/lib/agent-state'

/**
 * 🔴 **578 · the conversation header — what it says, and where each fact lives** (`EXT-010` §1).
 *
 * ## ⛔ What this file is for, and what `dom/the-conversation-header.dom.test.ts` is for
 *
 * ⚑ **This one asks *where a fact is stated*; that one asks *what a person can see*.** `EXT-010`
 * §1.1's complaint — *"A summary line sitting directly on top of the detail it summarises is not a
 * summary — pick one"* — is a claim about the TREE: one fact, one location. ⛔ A mount can show
 * that the bar does not draw the model; only a census over both components can say the bar cannot.
 *
 * ## ⚠️ Prose is stripped before anything is asserted
 *
 * ⛔ **Both components explain, in comments, exactly what they no longer draw** —
 * `SessionHeader.vue`'s own docblock says the model and the effort moved to the shelf, and names
 * them — so a raw-file census would report the bar as carrying the three facts its documentation
 * exists to say it does not (`a-source-census-must-strip-prose-before-it-asserts`).
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const COMPONENTS = `${HERE}../src/renderer/src/components`

const read = (name: string): string => readFileSync(`${COMPONENTS}/${name}`, 'utf8')

function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const HEADER_RAW = read('SessionHeader.vue')
const HEADER = code(HEADER_RAW)

/* ------------------------------------------------------------- §3 · the vocabulary (§2.2) */

/**
 * 🔴 **`Idle` is a member of a closed set, and this section is the brief's §2.2 answered.**
 *
 * ⛔ **The question was whether a state exists that renders as NONE of them** — which is
 * `an-unenumerated-state-counts-as-success`: *done* becoming the absence of the states somebody
 * enumerated. ⚑ **It does not, and the reason is a specific line rather than a general claim:**
 * `sessionDoing` answers `unknown` — never `idle` — when the host has said nothing
 * (*"No word from the host, so no claim"*), so the quiet word is only ever reached through a
 * POSITIVE answer: the session is over, or the host said `idle`.
 *
 * ⚠️ **One place draws no word at all, and it is deliberate**: the launcher, where `101 §9` removed
 * the third of three sayings of *not started*. ⛔ That is a decision about a surface, not a hole in
 * the vocabulary. ⚑ **D-017b** — the standing `unstarted` itself went with `ended` and `errored`
 * (whether a process runs, `05` rule 5); the launcher's plate is faceless.
 */
describe('§3 · the standing vocabulary, and whether anything falls outside it (EXT-010 §2.2)', () => {
  it('🔴 TEN standings, ten words, ten tones — and no member without one', () => {
    // ⚑ **636 · the tenth, and the title moved with it.** `a-title-that-names-a-count-the-
    // assertion-never-checks` cuts the other way here: this assertion DOES check the count, so
    // the number in the title is the one thing that can go stale silently.
    // ⚑ **D-017b · twelve became nine**: `unstarted`, `ended` and `errored` said whether a process
    // runs (`05` rule 5), and a conversation nothing is doing anything in reads by the one state.
    expect([...STANDINGS]).toEqual([
      'unknown',
      'idle',
      'background',
      // ⛔ **F036 · another agent waits on an answer from this one** — the same family, true WHILE
      // idle, drawn as a word.
      'owes',
      'scheduled',
      // ⛔ **636 · `621` §5.2's word, chosen** — not driving a turn, and the next move belongs to
      // another agent. ⚠️ It sits beside `background` and `scheduled` because it is the third
      // member of that family: a fact that is true WHILE the conversation is idle, drawn as a
      // word and never as a badge.
      'elsewhere',
      // ⛔ **D-006 · F018 — the eleventh and twelfth**: idle, and the work it holds is not being
      // worked on, or was answered. The same family, true WHILE idle, drawn as a word.
      'stalled',
      'answered',
      'working',
      'waiting',
    ])
    for (const standing of STANDINGS) {
      expect(STANDING_LABEL[standing], `${standing} has no word`).toBeTruthy()
      expect(STANDING_TONE[standing], `${standing} has no tone entry`).toBeDefined()
    }
    // ⛔ **Ten distinct words** (F036 added `owes`): a vocabulary that says one thing two ways is a vocabulary a
    // person cannot read the difference in.
    expect(new Set(STANDINGS.map((s) => STANDING_LABEL[s])).size).toBe(STANDINGS.length)
  })

  it('⛔ every FACET combination lands on a member — the set has no escape', () => {
    // ⚑ **Driven rather than argued.** Every value of every facet, crossed — 8 × 8 × 5 × 2 × 2 —
    // and every answer is in the set. A `standingOf` that could return something else would have
    // to invent it here.
    const doings = [
      undefined,
      'idle',
      'working',
      'thinking',
      'tool',
      'compacting',
      'replying',
      'unknown',
    ] as const
    const beings = [
      undefined,
      'unstarted',
      'starting',
      'live',
      'silent',
      'closing',
      'ended',
      'errored',
    ] as const
    const needings = [undefined, 'permission', 'question', 'proposal', 'plan'] as const
    // ⛔ **636 · the SIXTH axis, and it is spelled out here on purpose.** ⚠️ This file is one of
    // the ORACLES `446` kept a hand copy in — *"a test that asked the function under test would
    // measure nothing"* — so the three waits are written rather than imported from
    // `TASK_WAITS`. ⚑ The derived roster is swept in `agent-state.test.ts`, whose own copy is the
    // other half of that pair.
    const waits = [
      undefined,
      'waiting-on-an-answer',
      'waiting-on-a-person',
      'waiting-on-a-worker',
    ] as const
    // ⛔ **D-006 · the SEVENTH axis, spelled out for the same reason**: where the work it holds
    // stands — stalled, answered, or absent.
    const works = [undefined, { state: 'stalled' }, { state: 'answered', outcome: 'done' }] as const
    const seen = new Set<Standing>()
    for (const doing of doings)
      for (const being of beings)
        for (const needing of needings)
          for (const detached of [false, true])
            for (const scheduled of [false, true])
              for (const waiting of waits)
                for (const work of works)
                  // ⚑ **F036 · the eighth axis** — `owes` is reached only through it.
                  for (const owes of [
                    undefined,
                    ['Ada (the owner of W1.2 · The pages)'],
                  ] as const) {
                    const facets = {
                      doing,
                      being,
                      needing,
                      detached,
                      scheduled,
                      waiting,
                      work,
                      ...(owes ? { owes } : {}),
                    } as AgentFacets
                    const standing = standingOf(facets)
                    expect(STANDINGS, `standingOf invented ${standing}`).toContain(standing)
                    expect(STANDING_LABEL[standing]).toBeTruthy()
                    seen.add(standing)
                  }
    // ⛔ **And the set is REACHED, not merely respected.** Nine of the ten are produced by the
    // sweep above; `scheduled` needs `doing: 'idle'` with nothing detached, which the cross does
    // produce — so all ten are live words rather than entries nothing can make
    // (`222` §4: do not keep a word nothing can produce). ⚑ **636 · the tenth is reached only
    // because the sixth axis joined**, which is why it joined — and D-006's two only because the
    // seventh did.
    expect([...seen].sort()).toEqual([...STANDINGS].sort())
  })

  it('🔴 the quiet word is never the absence of an answer — `unknown` is', () => {
    // ⛔ **This is the §2.2 hazard, measured.** A host that has said nothing must not produce
    // `Idle`, because *the turn has finished* and *we have not been told* are different facts and
    // the first one is the fact `EXT-010` §1.4 calls the most consequential on the screen.
    // ⚑ D-017b — `started` left the input; a host that has said nothing is the whole absence.
    expect(sessionDoing({ status: undefined } as never)).toBe('unknown')
    expect(sessionDoing({ status: null } as never)).toBe('unknown')
    expect(standingOf({ doing: undefined, being: 'live' })).toBe('unknown')
    expect(STANDING_LABEL.unknown).toBe('Unknown')
    // ⚑ **The paired positive**: a host that DID say idle produces the quiet word, so the negative
    // above is about the absence of an answer and not about the function being unable to say it.
    expect(sessionDoing({ status: 'idle' } as never)).toBe('idle')
    expect(standingOf({ doing: 'idle', being: 'live' })).toBe('idle')
    expect(STANDING_LABEL.idle).toBe('Idle')
  })

  it('⚠️ the ONE place this bar draws no word is the launcher, and its plate is faceless', () => {
    // ⛔ `101 §9`: *"the fix de-dupes the WORD, keeps the plate."* The pill is `v-if="!unstarted"`
    // — `unstarted` is the header's own `session === null`, the launcher — and
    // `dom/launcher-layout.dom.test.ts` is where the pairing is measured.
    expect(HEADER).toContain('v-if="!unstarted"')
    // ⚑ **D-017b** — the plate carried *not started* as a BEING, and that was a process word; the
    // launcher's facets (`NewConversation.LAUNCHER_FACETS`, the same input) are now faceless, a
    // plate that claims nothing about a conversation that does not exist.
    expect(
      sessionFacets({
        phase: null,
        status: null,
        activity: null,
        streaming: false,
        liveness: null,
      }),
    ).toEqual({ doing: 'unknown' })
    // ⚑ …and every OTHER member is drawable here, because the element's own condition is the only
    // thing between a standing and its word.
    expect(HEADER).toContain('{{ statusLabel }}')
    expect(HEADER).toContain('STANDING_LABEL')
  })
})
