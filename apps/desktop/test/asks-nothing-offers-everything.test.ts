import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { providerForALaunch } from '../src/renderer/src/lib/agent-store'
import { NO_LAUNCH_CHOICES } from '../src/renderer/src/lib/launch-choices'
import { theDraftEffort, theFormSends } from '../src/renderer/src/lib/model-lists'
import { providerIsFixed } from '../src/renderer/src/lib/front-door-words'
import {
  DEFAULT_PROFILE_ID,
  type AgentIdentities,
  type ModelChoice,
  type ModelList,
} from '../src/shared/runtime-ipc'

/**
 * 435 · **A front door that asks nothing and offers everything** (HO-025 §4/§5).
 *
 * > ⛔ *"HO-023 §3 deleted seven controls. What `asks nothing` meant was: do not make configuring a
 * > session the price of starting a conversation. It did not mean the choices should be
 * > unavailable, and a person who has to open a settings surface to pick a provider — or cannot,
 * > because the column has one writer — is worse off than before."*
 *
 * ⛔ **This is not a revert of `417`.** That dispatch deleted a 2,998-line screen which made a
 * person answer four questions before typing a word, and the PO reaffirmed the judgement in the
 * same ruling that corrected it. ⚑ **What comes back is the CHOOSING, not the ASKING** — which is a
 * distinction that has to be checkable, and §1 is where it is made checkable.
 *
 * ⚠️ **The node half.** The four properties `435 §2` names are about a screen and live in
 * `dom/a-front-door-that-offers-everything.dom.test.ts`; what is here is the arithmetic underneath
 * them — the payload's shape, the one effort derivation, and the one provider resolution.
 */

const SRC = join(import.meta.dirname, '../src')

/** ⛔ A census that reads prose reads code wrong — a docblock quoting a call is not a call. */
function withoutProse(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

const source = (path: string): string => withoutProse(readFileSync(join(SRC, path), 'utf8'))

const DOOR = 'renderer/src/components/NewConversation.vue'
const CARD = 'renderer/src/components/AgentCard.vue'

/** ⚑ UI-012 · a provider's list as D-042's door answers it — its own rows, no person's. */
const listOf = (...each: ModelChoice[]): ModelList => ({
  provider: 'claude',
  notAsked: null,
  standIn: null,
  models: each.map((row) => ({ ...row, addedBy: 'the-provider' as const })),
  lastPicked: null,
  startsOn: null,
})

const opus: ModelChoice = {
  id: 'opus',
  label: 'Opus',
  defaultEffort: 'high',
  efforts: [
    { id: 'low', label: 'low' },
    { id: 'high', label: 'high' },
  ],
}
const haiku: ModelChoice = { id: 'haiku', label: 'Haiku' }

describe('§1 · an untouched door sends what 417 sent, byte for byte', () => {
  it('⛔ nobody-asked is ONE shape, and it is what the screen starts holding', () => {
    expect(NO_LAUNCH_CHOICES).toEqual({ provider: null, model: '', reasoningEffort: '' })
    // ⚑ Frozen, because it is handed out as the initial value: a caller that mutated it would
    // change what *untouched* means for every later conversation in that run of the app.
    expect(Object.isFrozen(NO_LAUNCH_CHOICES)).toBe(true)
  })

  it('🔴 the two new fields are OMISSIONS, and the three old ones are not', () => {
    // ⛔ **Read off the payload the door builds**, not restated (standing rule 1). `model` and
    // `reasoningEffort` ride conditional spreads — which is what *we did not ask* means on this
    // wire — and the three `417` shipped are unconditional.
    const door = source(DOOR)
    const at = door.indexOf('const settings = computed<CreateSessionInput>')
    expect(at, 'the front door no longer builds its payload in one literal').toBeGreaterThan(-1)
    const literal = door.slice(at, door.indexOf('}))', at))
    const always = [...literal.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((m) => m[1])
    expect(always).toEqual(['provider', 'profileId', 'approvalMode'])
    const whenAsked = [...literal.matchAll(/^\s{2}\.\.\.\([^\n]*?\{\s*([a-zA-Z]+):/gm)].map(
      (m) => m[1],
    )
    expect(whenAsked).toEqual(['model', 'reasoningEffort'])
    // ⛔ **And the two that did NOT come back** (HO-025 §4 names three settings and these are not
    // among them): a folder and a project are placements, and the front door places nothing.
    expect(literal).not.toContain('cwd')
    expect(literal).not.toContain('projectSlug')
  })

  it('⚑ …and the sentence 417 shipped is unchanged, because it is still true', () => {
    // ⛔ **HO-025 §4 is explicit that the provider is the one that does NOT stay changeable** —
    // *"changing it means a new conversation, and the app should SAY that rather than offer a
    // control that silently relaunches."* ⚑ A control that chooses it BEFORE the conversation
    // starts is not that control, and the sentence beneath it is what says so.
    expect(providerIsFixed('codex')).toContain('it is fixed when the conversation starts')
    // ⚠️ Read off the component, so a surface that stopped rendering it goes red here too.
    expect(source(DOOR)).toContain('providerIsFixed(props.defaultProvider)')
  })
})

describe('§2 · ONE effort control, and both surfaces mount it', () => {
  it('🔴 …and NEITHER surface keeps its own copy of the fold', () => {
    // ⛔ **The drift `435` ended, measured.** The drawer's old settings recorded two surfaces
    // disagreeing on screen about one catalogue; `177` fixed it by COPYING the rule into the second
    // file. ⚑ **UI-012 · the effort is the model picker's now** — the picked model's own levels, in
    // the one component both surfaces mount — and this is the census that stops a copy being
    // written beside it.
    for (const file of [DOOR, CARD]) {
      const code = source(file)
      expect(code, `${file} does not mount the one picker`).toContain(
        "import ModelPicker from './ModelPicker.vue'",
      )
      expect(code).toContain('<ModelPicker')
      // ⚠️ **The FOLD, not the word.** A surface that built its own menu would have to write one.
      expect(code, `${file} folds a catalogue into a menu by hand`).not.toMatch(
        /for \(const row of scoped\)/,
      )
      expect(code).not.toContain('row.efforts ?? []')
    }
  })
})

describe('§3 · what the control shows is what the launch asks for (274 §2)', () => {
  it('🔴 a rung the model does not offer is not drafted', () => {
    // ⚑ UI-012 · the picker's draft follows the host's own rule (`theDraftEffort`).
    expect(theDraftEffort(listOf(opus, haiku), 'haiku', 'medium')).toBeNull()
  })

  it('⚑ …and a rung it CAN show is', () => {
    expect(theDraftEffort(listOf(opus), 'opus', 'high')).toBe('high')
  })

  it('⛔ silence narrows nothing: with no list a person’s pick is sent as it is held (179 §4)', () => {
    // ⚠️ **Reachable, and `435` nearly argued it away.** `RuntimeScreen` re-probes a profile
    // whenever a credential gesture settles (`257 §2`); a refused re-probe replaces a good
    // list with a silence under a rung a person already chose.
    expect(
      theFormSends({ provider: 'claude', model: 'opus', reasoningEffort: 'medium' }, null),
    ).toEqual({ model: 'opus', effort: 'medium' })
    // …the paired negative: nothing held, nothing to ask for.
    expect(theFormSends(NO_LAUNCH_CHOICES, null)).toBeNull()
  })

  it('⚑ …and with a list the provider is the authority again', () => {
    expect(theDraftEffort(listOf(opus, haiku), 'opus', 'medium')).toBe('high')
  })
})

describe('§4 · ONE provider resolution, with the asked term first', () => {
  const roster = (provider: 'claude' | 'codex' | null): AgentIdentities =>
    ({
      identities: [
        {
          id: 'aid:default',
          slug: DEFAULT_PROFILE_ID,
          displayName: null,
          role: null,
          provider,
        },
      ],
      use: [
        {
          slug: DEFAULT_PROFILE_ID,
          runsOn:
            provider === null
              ? { provider: null, from: 'nothing-yet' }
              : { provider, from: 'saved' },
        },
      ],
    }) as unknown as AgentIdentities

  it('🔴 what the person asked for beats what the identity says', () => {
    expect(providerForALaunch(roster('claude'), DEFAULT_PROFILE_ID, 'codex', 'codex')).toBe('codex')
  })

  it('⚑ …and an unanswered choice leaves 423’s resolution exactly as it was', () => {
    // ⛔ **The widening is opt-in at the call site.** A caller that passes nothing — the placed
    // door — resolves the way it did before this dispatch existed.
    expect(providerForALaunch(roster('claude'), DEFAULT_PROFILE_ID, 'codex')).toBe('claude')
    expect(providerForALaunch(roster('claude'), DEFAULT_PROFILE_ID, 'codex', null)).toBe('claude')
    expect(providerForALaunch(roster(null), DEFAULT_PROFILE_ID, 'codex')).toBe('codex')
    expect(providerForALaunch(null, DEFAULT_PROFILE_ID, 'codex')).toBe('codex')
  })

  it('⛔ the asked term beats the FALLBACK too, so it is a first term and not a second', () => {
    // ⚠️ **Tested where the two readings DIVERGE** (standing rule 3): an identity that has said
    // nothing would answer `codex`, and the person said `claude`.
    expect(providerForALaunch(roster(null), DEFAULT_PROFILE_ID, 'codex', 'claude')).toBe('claude')
  })

  it('🔴 …and there is no second spelling of the order anywhere in the renderer', () => {
    // ⛔ `435 §4`: *"A second spelling of `asked ?? identity ?? fallback` is the drift this repo
    // keeps paying for."* The front door reads ONE prop; the screen calls ONE function.
    const door = source(DOOR)
    expect(door).toContain('provider: props.defaultProvider,')
    expect(door, 'the door resolved a provider of its own').not.toContain(
      '?? props.defaultProvider',
    )
    const screen = source('renderer/src/components/RuntimeScreen.vue')
    expect([...screen.matchAll(/providerForALaunch\(/g)]).toHaveLength(2)
  })
})
