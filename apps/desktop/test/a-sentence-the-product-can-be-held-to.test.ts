import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readProviderConfig } from '../src/main/runtime/provider-config'
import { profileBundleSpans, type ProfileBundleContext } from '../src/main/runtime/factory-text'
import { WHOSE_WORDS } from '../src/shared/whose-text'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { BROBOTS_ADDITION } from './lib/the-core'

/**
 * 🔴 **The two sentences `382 §9.2` filed `unsourced`, now with a constant and a test each**
 * (384 §1.1, standing rule 5).
 *
 * `382` audited the twenty-one static sentences v2.3 draws and found two that are TRUE, that a
 * person needs, and that no constant carried — *"a sentence with no constant is a comment"*. This
 * file is the other half of closing that: not that the strings exist, but that **the load-bearing
 * clause of each one is asserted BY NAME**, the way `a-mode-that-says-what-it-does.test.ts` pins
 * *"Neither mode limits what it can read."*
 *
 * 🔴 **`733` · one of the two went false, and its constant went with it** — the credential promise.
 * Its block below says what is left of it. The other, what a profile is not, went with the
 * per-agent grants it described.
 *
 * ## ⛔ Why a clause check and a derivation check, and not either alone
 *
 * ⚠️ **A test that only compares a string to itself measures nothing** — it goes green on a
 * sentence edited to say the opposite, as long as both halves were edited. So each sentence here is
 * asked twice:
 *
 *  1. **the clause**, by name, so a quiet trim cannot remove the half that carries the promise; and
 *  2. **the fact**, from the code that makes the sentence true — `readProviderConfig` really
 *     handing back no content.
 *
 * 🔴 **The second is the one that matters**, because it is the half that can go false without
 * anybody touching the string.
 *
 * ⚠️ **Neither constant is rendered by anything.** `384 §0` fences this commit — *"every surface
 * keeps rendering exactly what it renders today"* — so the copy arrives before the surface that
 * will draw it, which is the order standing rule 5 asks for and the reverse of how the eight false
 * sentences in `370` arrived.
 */
/**
 * 🔴 **733 · the promise went; the LIST's half of it stays true, and is held here.**
 *
 * ⛔ **This block was *"nothing reads a credential file (CREDENTIAL_FILES_ARE_NOT_READ)"*** and its
 * first test pinned the constant's clauses — *"Nothing here reads"*, *"Reveal"*. ⚑ **Retired by the
 * PM's ruling on `731` F-2** (R92: *"not on what BroBot itself opens for a person"*): the Info
 * panel's Open reads any config file it lists, `auth.json` included, so the promise is false and the
 * constant went with it. ⚠️ **What is still true is narrower**: the config LIST that the panel draws
 * carries no content — a file's bytes cross only when a person presses its Open
 * (`the-last-credential-guards.test.ts`, and `dom/a-config-file-opens-like-any-other.dom.test.ts`).
 */
describe('the config LIST carries no content — a file is read only when its Open is pressed', () => {
  const made: string[] = []
  const home = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'b2-credential-words-'))
    made.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /**
   * 🔴 **The hazard is planted on the path the code walks** — a real `auth.json`, in a real provider
   * home, holding a string nothing else in the fixture contains, read by the real reader.
   *
   * ⛔ **Asserting the TYPE has no content field would be the weaker test**: a producer can put a
   * field a type does not declare onto an object, and `JSON.stringify` would carry it to the
   * renderer regardless. So this asks the produced VALUE, whole, and the control is that the same
   * walk really did find the file — otherwise "the token is not in there" is satisfied by an empty
   * home.
   */
  it('🔴 the list really does hand back no content, with the file right there', () => {
    const dir = home()
    const token = 'sk-planted-384-do-not-carry-me'
    writeFileSync(join(dir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: token }), 'utf8')

    const config = readProviderConfig('codex', dir)
    const auth = config.files.find((file) => file.name === 'auth.json')

    // The control: the walk found it. Without this the assertion below passes over an empty home.
    expect(auth, 'auth.json is one of the declared Codex files').toBeDefined()
    expect(auth?.exists, 'the planted file is on disk and the reader saw it').toBe(true)

    // …and having seen it, it carried nothing out of it.
    expect(JSON.stringify(config)).not.toContain(token)
    expect(Object.keys(auth ?? {}).sort()).toEqual(['exists', 'name', 'note', 'path'])
  })

  it('⚠️ …and the same walk says so about a file that is NOT there, without inventing one', () => {
    // The other arm, so `exists` is measured where the two readings diverge rather than only where
    // both say the same thing.
    const config = readProviderConfig('codex', home())
    expect(config.files.map((file) => file.exists)).toEqual(config.files.map(() => false))
    expect(
      config.files.length,
      'a walk that returned nothing would satisfy the line above',
    ).toBeGreaterThan(0)
  })
})

/**
 * 🔴 **630 · the clause that went false without anybody touching the string** (`EXT-015` §2).
 *
 * ⛔ **`WHOSE_WORDS.factory.says` says how far the factory half is the same for every agent.** ⚠️ **It
 * is DRAWN** — `whose-groups.ts` maps a layer to `WHOSE_WORDS[whose].says` and
 * `SessionInstructions.vue` renders it beside the group — so the sentence is a claim about bytes.
 * The factory half reads nothing per agent: every agent reads the same text, except BroBot, whose
 * copy has a part of its own after it.
 *
 * ⚑ **This file's own standard is why the third test exists**: *“the fact, from the code that makes
 * the sentence true … the half that can go false without anybody touching the string.”*
 */
describe('630 · what the factory layer actually promises (WHOSE_WORDS.factory)', () => {
  /**
   * ⛔ The `factory` half of one profile's bundle, sliced out of the SAME walk the file is composed
   * by. The person's own text is left out: it is not this describe's subject.
   */
  const factoryHalf = (profileSlug: string | null): string => {
    const context: ProfileBundleContext = { profileSlug, configured: null }
    const { text, spans } = profileBundleSpans(context)
    return spans
      .filter((span) => span.whose === 'factory')
      .map((span) => text.slice(span.start, span.end))
      .join('')
  }

  it('⛔ keeps both clauses that are TRUE of it, by name', () => {
    // ⚑ Standing rule 5: the load-bearing half is asserted BY NAME so a quiet trim cannot take it.
    // ⛔ These two are what `HO-009` §2 actually rules — the layer is decided by WHO MAY WRITE.
    expect(WHOSE_WORDS.factory.says, 'where it comes from').toContain('Ships with the app')
    expect(WHOSE_WORDS.factory.says, 'what changes it').toContain('BroCrew updates')
    expect(WHOSE_WORDS.factory.says, 'who may write it').toContain('nobody here can edit it')
    // ⚠️ **The SHORT form never claimed sameness**, so it is untouched — asserted here so a later
    // edit cannot quietly put the withdrawn claim back through the other field.
    expect(WHOSE_WORDS.factory.short).toBe('Ships with the app. Nobody here can edit it.')
  })

  it('🔴 does NOT claim the factory half is the same for every agent, without its exception', () => {
    // ⛔ Sameness without the exception, asserted ABSENT — `498`'s rule that a rule is proven by
    // violating it, and the only assertion here that a re-introduction would break.
    expect(WHOSE_WORDS.factory.says).not.toMatch(/same for every agent\./)
    // ⚑ **And it says what DOES vary**, because a reader told only *nobody can edit this* assumes
    // sameness by default.
    expect(WHOSE_WORDS.factory.says, 'what varies').toContain(
      'It is the same for every agent, except that BroBot’s has a part of its own.',
    )
  })

  it('⛔ …and the FACT behind it: every profile but BroBot gets the same factory bytes, and BroBot more', () => {
    // 🔴 **The half that can go false without anybody touching the string** — this file's own
    // standard, applied to the sentence this describe is about.
    const one = factoryHalf('designer')
    const another = factoryHalf('reviewer')
    const brobots = factoryHalf(DEFAULT_PROFILE_ID)
    // ⚑ **THE POSITIVE CONTROL first**: real, non-trivial text, so the comparisons below are
    // measurements rather than empty strings agreeing about nothing.
    expect(one.length, 'the factory half is non-empty').toBeGreaterThan(200)
    expect(another).toBe(one)
    expect(factoryHalf(null)).toBe(one)
    // ⛔ **The exception the sentence names**: BroBot's is longer, and it is the same text with a
    // part of its own added, not a different text.
    expect(brobots).toBe(`${one.slice(0, -1)}\n\n${BROBOTS_ADDITION.join('\n\n')}\n`)
  })
})
