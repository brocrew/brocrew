import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 🔴 **520 · the button between looking and killing it** — the half a browser cannot see.
 *
 * Every conversation opens in one full view and continues through a message. The window has
 * no End conversation press, confirmation, or associated wording (`ending-a-conversation.ts`
 * is absent). The remaining cases check properties that outlive that control:
 *
 *  - **§3** the WORD, as a census over the renderer's own source: `Close` means *dismiss this view*,
 *    and — now that nothing ends a conversation from the window — no control carries the stop;
 *  - **§4** the live smoke, which stops a conversation through the host's own door, and the one
 *    call site of `store.close` left in the screen.
 *
 * ⛔ **Every census below strips comments first.** `a-source-census-must-strip-prose-before-it-
 * asserts`: docblocks quote the words they retired, and a census that read them would report the
 * defect that had just been removed.
 */

const here = dirname(fileURLToPath(import.meta.url))
const renderer = join(here, '../src/renderer/src')
const components = join(renderer, 'components')

/**
 * ⚠️ **Prose out, code and copy in.** `//` is matched only where it is not preceded by `:`, so a
 * `https://` inside a string survives — a URL eaten here would take the rest of its line with it.
 */
function withoutComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const codeOf = (path: string): string => withoutComments(readFileSync(path, 'utf8'))

const everyComponent = (): { name: string; code: string }[] =>
  readdirSync(components)
    .filter((name) => name.endsWith('.vue'))
    .map((name) => ({ name, code: codeOf(join(components, name)) }))

/** The word as a person reads it — standalone, not `closeSession` and not `store.close`. */
const SAYS_CLOSE = /\bClose\b/

/* ------------------------------------------------------------------------------- §3 · the census */

describe('520 §3 · Close means dismiss this view, and now it means only that', () => {
  it('no control ends a conversation any more, and Close still means dismiss this view', () => {
    // 🔴 **520 asked this of the one component that rendered the press that ends a conversation**
    // (`data-cy="close-session"`, the header's *End conversation*), and the discriminator was the
    // hook. ⚑ **D-017b · no component renders it**: nothing in the window stops a conversation, so
    // the word cannot be carried by the stop because there is no stop to carry it.
    const renders = everyComponent().filter((c) => c.code.includes('data-cy="close-session"'))
    expect(renders.map((c) => c.name)).toEqual([])
    // ⛔ **And the press's words are spelled nowhere a person can read them.**
    for (const { name, code } of everyComponent()) {
      expect(code, `${name} still draws the End press`).not.toContain('End conversation')
    }
    // ⚑ **The search shape, proven on a plant** — a hook that is really there is found.
    expect(
      [{ code: '<button data-cy="close-session">x</button>' }].filter((c) =>
        c.code.includes('data-cy="close-session"'),
      ),
    ).toHaveLength(1)

    // ⚑ And the word is still everywhere else — a positive control, so an empty roster cannot pass.
    const says = everyComponent().filter((c) => SAYS_CLOSE.test(c.code))
    expect(says.length).toBeGreaterThan(5)
  })

  it('the one destructive Close names the window, and it is the confusion itself', () => {
    // ⛔ **The module's first draft said *"every other `Close` dismisses an overlay and destroys
    // nothing"*. That is FALSE and review proved it.** The title bar's `Close this window` destroys
    // plenty: `closeSessionsForOwner` RELEASES the slots born without a surface and CLOSES every
    // other one, so pressing it ends every conversation that window started.
    //
    // The remaining Close names the window and is the only window control that stops
    // anything. A window ends a conversation it started; the former “Hand it back” cost line
    // is absent. Measure the surviving claim rather than rely on ambiguous Close wording.
    const controls = codeOf(join(components, 'WindowControls.vue'))
    expect(controls).toContain('Close this window')
    // ⛔ It names the WINDOW rather than standing bare, which is the whole of why it may keep it.
    for (const line of controls.split('\n')) {
      if (!SAYS_CLOSE.test(line)) continue
      expect(line, `WindowControls says Close without naming the window: ${line.trim()}`).toMatch(
        /window/i,
      )
    }

    // ⚑ **The host half, so the claim is not a reading of a label.** This is the split the sentence
    // above rests on, quoted from the code that performs it.
    // ⚠️ Read as CODE, so a docblock quoting the split cannot satisfy the claim about it.
    const host = codeOf(join(here, '../src/main/runtime/runtime-host.ts'))
    expect(host).toContain('if (slot.bornWithoutASurface) this.release(slot)')
    expect(host).toContain(
      'await Promise.all(owned.map((slot) => this.close(slot.id, THE_APP_ITSELF)))',
    )
  })

  it('the one sentence that still says Close about a conversation names its own reopen', () => {
    // ⚠️ **`closeAndReopen` is a different act and keeps a different word** (470): it stops the
    // child and starts another on the same transcript in ONE gesture, so *"Close … and open it
    // again"* is its honest name. 🔴 The rule asserted here is the second half: a sentence that
    // says `Close this conversation` must say what it does next, or it is the bare word again.
    for (const { name, code } of everyComponent()) {
      for (const line of code.split('\n')) {
        if (!line.includes('Close this conversation')) continue
        expect(line, `${name} says "Close this conversation" and not what happens next`).toMatch(
          /open it again/,
        )
      }
    }
    // The positive control: the sentence is really there to be found.
    expect(codeOf(join(components, 'ConversationPane.vue'))).toContain('Close this conversation')
  })
})

/* ---------------------------------------------------------------------------------- §4 · the hop */

describe('520 §4 · a stop reaches the host through one door, and no press is it', () => {
  it('the live smoke presses no End button, and stops through the host’s own door', () => {
    // 🔴 **A live-only instrument, pinned from a cheap gate** (`pin-a-live-only-instrument-from-a-
    // cheap-gate`). ⛔ `scripts/ui-live-smoke.mjs` pressed `close-session` and then `ending-end` in
    // `endTheConversation`; ⚑ **D-017b · neither button exists**, so a step that still pressed
    // either would wait out its whole budget for a hook that never renders — and `smoke:ui` is not
    // in `ci`, so nothing in a gate would say so. ⚠️ This is the assertion that says so in seconds.
    const smoke = withoutComments(
      readFileSync(join(here, '../../../scripts/ui-live-smoke.mjs'), 'utf8'),
    )

    expect(smoke).toMatch(/async function endTheConversation\(cdp\)/)
    // ⚑ **The helper stops the conversation on screen through `RuntimeBridge.close`** — the host's
    // door, which a person no longer has a press for.
    const helper = smoke.slice(smoke.indexOf('async function endTheConversation(cdp)'))
    expect(helper.slice(0, 600)).toContain('window.api.runtime.close({ sessionId:')
    // ⛔ **And nothing presses the two buttons that went**, anywhere in the smoke.
    for (const gone of ['close-session', 'ending-end']) {
      expect(smoke, `the smoke still presses ${gone}`).not.toContain(`'${gone}'`)
    }
    // ⚑ The search shape, proven on a plant.
    expect(`${smoke}\nawait clickWhenReady(cdp, 'close-session')`).toContain("'close-session'")
    // The positive half: the helper really is what the steps call, at every one of them.
    expect((smoke.match(/await endTheConversation\(cdp\)/g) ?? []).length).toBeGreaterThan(5)
  })

  it('names every call site of the verb, and the one left is the reopen', () => {
    // ⚑ **`a-payload-census-must-read-call-sites-not-types`, one door over: who CALLS it.** ⚠️ The
    // call site left is `closeAndReopen`, which does not END a conversation — it starts another on
    // the same transcript in the same gesture. ⚑ **D-017b** — `store.close(activeId)`, the End
    // press's, went with the press. 🔴 A second call site is a press this census has not seen, and
    // it turns this red.
    const screen = codeOf(join(components, 'RuntimeScreen.vue'))
    const calls = screen.match(/store\.close\([^)]*\)/g) ?? []
    expect(calls.sort()).toEqual(['store.close(sessionId)'])
    expect(screen).toMatch(/async function closeAndReopen[\s\S]{0,200}store\.close\(sessionId\)/)
  })
})
