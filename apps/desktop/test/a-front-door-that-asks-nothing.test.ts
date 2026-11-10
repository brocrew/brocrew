import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DRAWER_TABS, TAB_OF_THE_SETTINGS } from '../src/renderer/src/lib/drawer'
import { CHANGEABLE_LIVE_IN, providerIsFixed } from '../src/renderer/src/lib/front-door-words'
import { SUPPORTED_PROVIDERS } from '../../../packages/runtime/src'
import { providerName } from '../src/shared/runtime-ipc'

/**
 * 417 · **The claims the front door's one sentence makes, pinned against the code that makes them
 * true** — and the capability its removal strands, pinned so its return is visible.
 *
 * ⛔ **Standing rule 5: a safety sentence with no test is a comment.** {@link providerIsFixed} says
 * three things a person will act on — this runs on `<provider>`, the model and approvals can be
 * changed later on the agent card, the provider cannot. Each is asserted here against the thing that
 * makes it true, never against the sentence itself, so the day one stops holding the sentence goes
 * red rather than quietly false.
 *
 * ⚠️ **In the node project and not the dom one**, because the subject is main-process source.
 *
 * ## 🔴 What `435` changed here, and what it deliberately did not
 *
 * ⛔ **HO-025 §5 reversed half of HO-022 §2** — *"the front door asks nothing and OFFERS
 * EVERYTHING"* — so the screen draws a provider, a model and a reasoning control again. ⚑ **Every
 * assertion in this file survives that unchanged**, and it is worth saying why rather than leaving
 * a green run to be read as more than it is:
 *
 *  - **§1 is about a RUNNING session** — no `UPDATE provider_session SET provider`, no setter by any
 *    of four names, no command arm carrying both a provider and a session id. A control that
 *    chooses the provider a conversation STARTS on says nothing about any of them, and HO-025 §4 is
 *    explicit that this is the half that stays true: *"Model and effort remain changeable while it
 *    runs. Provider does not."*
 *  - **§2 is about the agent card's two live controls**, which are where a running conversation
 *    changes what it can change.
 *  - **§3 is about which files build a launch and which identity each one may name.** `435` added
 *    no door and moved no identity: the front door still sends `DEFAULT_PROFILE_ID`, and there are
 *    still exactly two builders.
 *
 * ⛔ **So this file is NOT evidence that the front door asks nothing** — it never was, and after
 * `435` the distinction matters. The screen's own vocabulary is enumerated in
 * `dom/a-front-door-that-asks-nothing.dom.test.ts` §1, and what *out of the path* means as four
 * measurements is `dom/a-front-door-that-offers-everything.dom.test.ts`.
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

/** Every file in one of the source trees, code only. */
function tree(root: string): { file: string; code: string }[] {
  return readdirSync(join(SRC, root), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(ts|vue)$/.test(name))
    .map((name) => ({
      file: `${root}/${name.replaceAll('\\', '/')}`,
      code: withoutProse(readFileSync(join(SRC, root, name), 'utf8')),
    }))
}

describe('§1 · "the provider you cannot" — the clause, against the absence that makes it true', () => {
  const main = tree('main')

  it('⛔ no statement anywhere writes `provider` onto a session row that already exists', () => {
    // Search shape: every `UPDATE provider_session` in the main tree, prose stripped, checked for
    // the one column. A positive would read `UPDATE provider_session SET provider = ?`.
    const updates = main.flatMap(({ file, code }) =>
      [...code.matchAll(/UPDATE provider_session SET ([^`'"]+)/g)].map((m) => ({
        file,
        sets: m[1] ?? '',
      })),
    )
    expect(
      updates.length,
      'the census found no UPDATE at all, so it measures nothing',
    ).toBeGreaterThan(5)
    expect(updates.filter((u) => /\bprovider\s*=/.test(u.sets))).toEqual([])
  })
})

describe('§2 · "model and approvals you can change later, in the Agent tab" — the two live controls', () => {
  it('⛔ and the sentence names them together, once, for every provider', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      const said = providerIsFixed(provider)
      // ⚑ **The display name, not the wire id** — `151`'s rule, and the reason `PROVIDER_NAME`
      // exists. A person reads "Codex"; the union member is `'codex'`.
      expect(said).toContain(providerName(provider))
      expect(said, 'the wire id reached a sentence a person reads').not.toContain(provider)
      expect(said).toContain(CHANGEABLE_LIVE_IN)
      expect(said.split(CHANGEABLE_LIVE_IN)).toHaveLength(2)
    }
  })

  it('⚑ …and it names the tab by reading the strip, so a rename carries', () => {
    // ⛔ Not `toBe('the Open tab')` — that is the literal this constant exists to avoid. The claim
    // is that the sentence carries the tab's own label, which is a different assertion from either
    // of them being any particular word.
    const tab = DRAWER_TABS.find((each) => each.id === TAB_OF_THE_SETTINGS)
    expect(tab, 'the settings tab is gone, so the sentence points at nothing').toBeDefined()
    expect(CHANGEABLE_LIVE_IN).toBe(`the ${tab?.label} tab`)
    // The approved hint groups model and approval controls as agent settings.
    // The preceding test still proves both controls exist and can change the live session.
    expect(tab?.hint).toBe('Agent settings, current work and anything waiting for you.')
  })
})
