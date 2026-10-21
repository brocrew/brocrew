import { describe, expect, it } from 'vitest'
import {
  modelField,
  type ModelFieldState,
  type ModelFieldWorld,
} from '../src/renderer/src/lib/model-field'
import type { CapabilityStatus, ModelChoice } from '../src/shared/runtime-ipc'

/**
 * 310 §2 · **One `null` that meant three things.**
 *
 * Starting a Codex conversation with `+ New profile…` must not collapse a seven-row model
 * catalogue into a “provider default” box and one reasoning entry.
 *
 * ⛔ **Nothing was broken. Four different situations rendered the same plain box**, and the field
 * said which one it was in for none of them:
 *
 *  1. we never asked, because the profile does not exist yet;
 *  2. we asked and were refused;
 *  3. we are still asking;
 *  4. there is a list and you have not opened it.
 *
 * ⚑ **A pure function for the reason `home-attention.ts` is one** (305): nothing mounts a component
 * here, so a rule left inside a `computed` is a rule this file could only reach through HTML — and
 * the point of the fix is that the rule is ONE rule, read by the launcher and by the drawer.
 *
 * ⚠️ **Every case asserts the state AND a positive about the words**, because the discriminant alone
 * would pass over a function that returned the right label with an empty sentence — and the sentence
 * is the whole feature.
 */

const ROWS: ModelChoice[] = [
  { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark' },
]

/** Codex's real shape: it can be signed into inside a profile, and copied into (098). */
const CODEX_SIGN_IN: CapabilityStatus = { state: 'available', note: 'its own account' }
const CODEX_COPY: CapabilityStatus = { state: 'available', note: 'shares one token' }

function world(over: Partial<ModelFieldWorld> = {}): ModelFieldWorld {
  return {
    catalogue: { ok: true, models: ROWS },
    profileExists: true,
    provider: 'codex',
    signIn: CODEX_SIGN_IN,
    reprovision: CODEX_COPY,
    ...over,
  }
}

/** Every sentence this function can produce, for the "no two states say the same thing" check. */
function sayingOf(over: Partial<ModelFieldWorld>): string {
  const field = modelField(world(over))
  return `${field.message ?? '(no message)'}|${field.remedy ?? '(no remedy)'}`
}

describe('310 §2 · the model field says WHICH silence it is in', () => {
  it('a provider that answered offers its rows, and says nothing else', () => {
    const field = modelField(world())
    expect(field.state).toBe('listed')
    expect(field.choices, 'the rows are handed through unchanged').toEqual(ROWS)
    // ⚠️ **The one `null` message, and it is a single meaning.** The menu IS the message here; a
    // sentence beside a working dropdown is noise. The paired positive is the line above.
    expect(field.message).toBeNull()
    expect(field.remedy).toBeNull()
    expect(field.tone).toBe('note')
  })

  it('a not-yet-created profile shows that its model list is coming', () => {
    // ⛔ The `+ New profile…` case. Nothing has been asked, because asking would create the home and
    // provision a credential into it (098, held by 257 §2) — so this is the deliberate path, and it
    // is the normal one for every first conversation in a new profile.
    const field = modelField(world({ catalogue: null, profileExists: false }))
    expect(field.state).toBe('no-profile')
    expect(field.choices).toBeNull()
    expect(field.message).toContain('arrives once this profile exists')
    expect(field.message).toContain('when the conversation starts')
    // ⛔ **It must not read as an error**, which is the half that decides whether a person reports
    // a healthy provider as broken.
    expect(field.tone, 'this is the normal path, not a fault').toBe('note')
    expect(
      field.remedy,
      'there is nothing to fix — starting the conversation is the fix',
    ).toBeNull()
  })

  it('⛔ the HOST’s own no-profile answer lands in the same state, by the same words', () => {
    // Two ways in and one fact: the launcher never asks about a name being typed, and the host
    // refuses to probe a profile it has no home for. A race between the profile list and a probe
    // takes the second path, and a person must not be able to tell — see `comingWithTheProfile`.
    const fromHost = modelField(world({ catalogue: { ok: false, reason: 'no-profile' } }))
    const fromLauncher = modelField(world({ catalogue: null, profileExists: false }))
    expect(fromHost.state).toBe('no-profile')
    expect(fromHost.message).toBe(fromLauncher.message)
    expect(fromHost.message, 'and it is a real sentence, not two empty strings').toContain(
      'arrives once this profile exists',
    )
  })

  it('a probe still out says so, and does not read as an absent list', () => {
    const field = modelField(world({ catalogue: null, profileExists: true }))
    expect(field.state).toBe('asking')
    expect(field.choices).toBeNull()
    expect(field.message).toContain('Asking codex')
    expect(field.tone).toBe('note')
    expect(field.remedy).toBeNull()
  })

  it('gives a setup instruction while keeping the diagnostic out of visible text', () => {
    const field = modelField(
      world({
        catalogue: {
          ok: false,
          reason: 'refused',
          detail: 'not logged in at /fictional/auth.json',
        },
      }),
    )
    expect(field.state).toBe('refused')
    expect(field.choices).toBeNull()
    expect(field.message).toBe("codex isn't set up. Set it up in Settings → Providers.")
    expect(field.detail).toBe('not logged in at /fictional/auth.json')
    expect(field.notSetUp).toBe(true)
    expect(field.retry).toBe(false)
  })

  it('offers a plain retry for failures that do not prove missing setup', () => {
    const field = modelField(
      world({
        catalogue: { ok: false, reason: 'refused', detail: 'network failed at /fictional/socket' },
      }),
    )
    expect(field.state).toBe('refused')
    expect(field.message).toBe("codex didn't answer. Try again.")
    expect(field.detail).toBe('network failed at /fictional/socket')
    expect(field.retry).toBe(true)
    expect(field.remedy).toBeNull()
  })

  it('⛔ an EMPTY list is the provider answering, never "we could not ask" (058 review’s rule)', () => {
    const field = modelField(world({ catalogue: { ok: true, models: [] } }))
    expect(field.state).toBe('empty')
    // The instruction is the same as a refusal's — no `datalist`, because an empty one is a
    // dropdown arrow onto nothing — and it is made in ONE place.
    expect(field.choices, 'no menu, which is what 058’s review established').toBeNull()
    // ⛔ …and the SENTENCE is not the same. This is the trap 310 §4 names: a reason that turned
    // "it said none" into "we could not ask" would assert an event that did not happen.
    expect(field.message).toContain('listed no models')
    expect(field.message).not.toContain('could not be asked')
    expect(field.tone).toBe('note')
    expect(field.remedy).toBeNull()
  })

  it('a quit says it was US, and does not blame the provider for it', () => {
    // 070/068 finding 7: a probe the registry refused never started. Reporting it as a provider
    // failure would put "unavailable" against the one cause that has nothing to do with a provider.
    const field = modelField(world({ catalogue: { ok: false, reason: 'closing' } }))
    expect(field.state).toBe('closing')
    expect(field.message).toContain('BroCrew is closing')
    expect(field.message).not.toContain('could not be asked')
    expect(field.tone).toBe('note')
    expect(field.remedy).toBeNull()
  })

  it('🔴 no two of the six states say the same thing — which is the whole ticket', () => {
    // ⛔ **The defect as one assertion.** Before 310 four of these produced an identical screen, so
    // the set below would have had one entry where it now has six. A future change that collapses
    // any two sentences fails here rather than in a bug report.
    const cases: Record<ModelFieldState, Partial<ModelFieldWorld>> = {
      listed: {},
      empty: { catalogue: { ok: true, models: [] } },
      asking: { catalogue: null, profileExists: true },
      'no-profile': { catalogue: null, profileExists: false },
      closing: { catalogue: { ok: false, reason: 'closing' } },
      refused: { catalogue: { ok: false, reason: 'refused', detail: 'not logged in' } },
    }
    const said = Object.values(cases).map(sayingOf)
    expect(new Set(said).size, `six states, six sentences — got ${said.join(' // ')}`).toBe(6)
    // The paired positive: every state really produced the state it is filed under.
    for (const [state, over] of Object.entries(cases)) {
      expect(modelField(world(over)).state, state).toBe(state)
    }
  })

  it('🔴 a profile that does not exist OUT-VOTES a catalogue still being held — 256 H1’s shape', () => {
    // ⛔ **Found by the DOM test for this dispatch, not reasoned out in advance.** The first version
    // of this function read the catalogue first and only asked about the profile when nothing was
    // held — so a launcher that still had the previous profile's answer on the page went on
    // offering it under the new name. That is `256` H1 exactly: *"a second profile's launcher
    // quietly presenting the default profile's catalogue."*
    //
    // ⚠️ A catalogue cannot be ABOUT a profile that does not exist, and `profileExists` is `true`
    // while the profile list is still out — so `false` really does mean "the list came back and
    // this name was not in it", which no real answer can coexist with.
    const stale = modelField(world({ catalogue: { ok: true, models: ROWS }, profileExists: false }))
    expect(stale.state).toBe('no-profile')
    expect(stale.choices, 'the other profile’s rows are not offered under this name').toBeNull()
    // The paired positive: the very same catalogue IS offered when the profile does exist.
    expect(modelField(world({ catalogue: { ok: true, models: ROWS } })).choices).toEqual(ROWS)

    // …and a refusal cannot out-rank it either, in the other direction: a name nobody has a home
    // for was never asked, so it must not inherit the last profile's login failure.
    const wrongBlame = modelField(
      world({
        catalogue: { ok: false, reason: 'refused', detail: 'not logged in' },
        profileExists: false,
      }),
    )
    expect(wrongBlame.state).toBe('no-profile')
    expect(wrongBlame.message).not.toContain('not logged in')
  })

  it('⛔ never names a provider it was not handed (039)', () => {
    // The renderer is forbidden from writing a provider's name down; `provider-neutrality.test.ts`
    // is the gate on the components, and this is the same rule on the function they read.
    for (const over of [
      {},
      { catalogue: null, profileExists: false },
      { catalogue: null, profileExists: true },
      { catalogue: { ok: true as const, models: [] } },
      { catalogue: { ok: false as const, reason: 'closing' as const } },
      { catalogue: { ok: false as const, reason: 'refused' as const, detail: 'x' } },
    ]) {
      const field = modelField(world({ ...over, provider: 'a-provider-we-invented' }))
      const words = `${field.message ?? ''} ${field.remedy ?? ''}`
      expect(words, 'no hard-coded provider id').not.toMatch(/\bcodex\b/i)
      // ⚠️ `claude` appears in Claude's own capability reason, which arrives as data — so the
      // negative is scoped to the world this case built, where neither name was supplied.
      expect(words).not.toMatch(/\bclaude\b/i)
    }
    // The paired positive: the id it WAS handed does come through, in the states that name one.
    expect(modelField(world({ catalogue: null, provider: 'zzz' })).message).toContain('zzz')
  })
})
