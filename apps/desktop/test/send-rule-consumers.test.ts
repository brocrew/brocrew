import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * # ⛔ One rule, and every consumer that must ask it (223 §5)
 *
 * `hasSomethingToSend(text, attached)` is the whole of *"is there anything to send"*. It has had
 * three consumers since `221` — the composer's `canSend`, the renderer store's early-out, and all
 * three send commands on the wire — and the history of this predicate is the history of one of them
 * quietly not asking:
 *
 * | | |
 * |---|---|
 * | `216` | `canSend` required TEXT, so an attachment-only message lit nothing and did nothing |
 * | `221` | the WIRE held `text: z.string().min(1)` while every other layer accepted the send — the button was lit, the press was legal everywhere else, and the schema between them answered with raw zod |
 * | `223` | ⛔ **the BUTTON's `:disabled` never asked at all** — lit, full-accent and inert on an empty box, which is the state the app spends most of its life in |
 * | `234` §2 | ⛔ **the BUSY SELECTOR never asked either** — a staged file with no words, while a turn ran, offered neither Queue nor Interrupt-and-send |
 * | `234` §3 | ⛔ **the HOST never asked at all**, and the fourth wire verb (`endPlanMode`) held the `min(1)` 221 had already removed from the other three |
 *
 * ⚑ **So this is the same instrument `219` built for `SEND_REFUSALS` and `221` built for
 * `WIRE_REFUSALS`, one layer further out**: a census that fails when a consumer stops asking.
 * `221` proved the style works — its own `M6` row (the composer dropping the shared predicate) died
 * in `dom` and nowhere else.
 *
 * ⚠️ **A SOURCE census** (`206` H1). It proves the call is written, not that the value is right —
 * `nothing-to-send.dom.test.ts` is what presses the button, and `host-renderer-agreement.test.ts`
 * is what drives the wire. This is the drift guard the behavioural tests cannot be.
 */

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(join(here, '..', rel), 'utf8')

const COMPOSER = 'src/renderer/src/components/PromptComposer.vue'
const STORE = 'src/renderer/src/lib/session-store.ts'
const WIRE = 'src/main/runtime/ipc.ts'
const SHARED = 'src/shared/runtime-ipc.ts'
/** ⛔ The fifth consumer, added by 234 §3 from `228` L1 — the gate every turn passes. */
const HOST = 'src/main/runtime/runtime-host.ts'

/**
 * Line, block and HTML comments removed — the rule is a CALL, and a rule named in prose is not a
 * rule asked. Lifted from `composer-parity.test.ts`, which needs the same distinction (219 §3).
 */
function codeOf(source: string): string {
  let inBlock: '*/' | '-->' | null = null
  return source
    .split('\n')
    .map((raw) => {
      let code = ''
      for (let at = 0; at < raw.length; at += 1) {
        const rest = raw.slice(at)
        if (inBlock !== null) {
          if (!rest.startsWith(inBlock)) continue
          at += inBlock.length - 1
          inBlock = null
          continue
        }
        if (rest.startsWith('//')) break
        if (rest.startsWith('/*')) {
          inBlock = '*/'
          at += 1
          continue
        }
        if (rest.startsWith('<!--')) {
          inBlock = '-->'
          at += 3
          continue
        }
        code += raw[at]
      }
      return code
    })
    .join('\n')
}

describe('223 §5 · every consumer of the send rule asks it', () => {
  it('⛔ the SHARED predicate is the only definition of "there is something to send"', () => {
    const shared = codeOf(read(SHARED))
    expect(shared).toContain('export function hasSomethingToSend(')
    // ⚠️ **The body, pinned.** `trim()` is the half `221` had to add — the wire's `min(1)` counted
    // characters, so a message of nothing but spaces started a turn. A future edit that dropped the
    // trim would put that back everywhere at once, which is the cost of having one definition.
    expect(shared).toMatch(
      /hasSomethingToSend\([^)]*\)[^{]*\{\s*return text\.trim\(\) !== '' \|\| attached > 0/,
    )
  })

  it('⛔ the BUTTON asks it — the consumer 223 added, through `canSend`', () => {
    const composer = codeOf(read(COMPOSER))

    // 1 · the button's `:disabled` is the computed, not a hand-rolled expression.
    const send = /<button\b[^>]*?data-cy="send-prompt"/s.test(composer)
      ? composer.slice(composer.indexOf('class="send-button"'))
      : ''
    expect(send, 'the send button is no longer recognisable in this file').not.toBe('')
    const tag = send.slice(0, send.indexOf('>'))
    expect(tag, 'the button stopped reading the shared predicate').toContain(
      ':disabled="!canSendNow"',
    )

    // 2 · …the computed calls `canSend`, with the real state and not a constant.
    // ⚠️ **`staged`, not `props.attachments`, since 236 §4.** The prop is a render behind whatever
    // this composer last decided, and a button that asked the stale list would be dark over an
    // attachment the composer had already accepted — 223's defect through a new door.
    expect(composer).toMatch(
      /const canSendNow = computed\(\(\) =>\s*canSend\(text\.value, props\.state, props\.blocked, staged\.value\.length\),?\s*\)/,
    )

    // 3 · …and `canSend` calls the shared predicate. Three links, because that is what the code is:
    //     a census that asserted only step 1 would pass over a `canSend` that had stopped asking.
    expect(composer).toMatch(
      /export function canSend\([\s\S]*?hasSomethingToSend\(text, attached\)/,
    )

    // ⛔ **And the tooltip is DERIVED from the same answer, not re-derived beside it.** The first
    // version of 223 wrote the reason as a second ternary in the tag, enumerating `blocked` and
    // `starting` and nothing else — so `ended` fell through to the content sentence and a dark
    // button told you to type into a locked box. `sendRefusal` asks `canSendNow` first, which is
    // what makes *"dark ⇔ a sentence"* hold by construction.
    expect(tag, 'the tooltip stopped being derived from the answer').toContain(
      ':title="sendRefusal ??',
    )
    expect(composer).toMatch(
      /const sendRefusal = computed<string \| null>\(\(\) => \{\s*if \(canSendNow\.value\) return null/,
    )
    // …and the content sentence is the SHARED one, not a local string (169's rule about words).
    expect(composer).toContain('return nothingToSendYet(props.canAttach)')
  })

  it('⛔ the BUSY SELECTOR asks it — the consumer 234 §2 found still spelling it out', () => {
    const composer = codeOf(read(COMPOSER))
    // ⛔ **`227` M4 / `228` M1.** While a turn was running, the Queue / Interrupt-and-send pair was
    // chosen by `state === 'busy' && text.trim() !== '' && blocked === null` — a fourth
    // transcription of the rule — so a staged file with an empty box offered NEITHER button and fell
    // through to the plain stop. ⌘↵ sent it perfectly well, which is what made it invisible.
    expect(composer).toMatch(
      /const busyChoices = computed\(\(\) => props\.state === 'busy' && canSendNow\.value\)/,
    )
    // …and the two places that used to spell it out both read the computed now: the selector, and
    // the hint under it. A selector fixed without its hint is 223's tooltip defect again.
    expect(composer).toContain('<template v-if="busyChoices">')
    expect(composer).toContain('<template v-else-if="busyChoices && props.hasQueued">')
    expect(composer).toContain('<template v-else-if="busyChoices">')
    // ⛑ **The teeth**: no branch in this file asks the rule by hand. ⚠️ **Both spellings**, because
    // a re-transcription inside `<script setup>` has to write `text.value.trim()` — the ref needs
    // `.value` outside the template — and a check pinned to one form would miss the likelier one
    // (found in review; the file already uses that shape at `props.cwd.trim()`).
    for (const spelling of ["text.trim() !== ''", "text.value.trim() !== ''"]) {
      expect(
        composer.includes(spelling),
        `a branch spells the send rule out (\`${spelling}\`) instead of asking \`canSend\``,
      ).toBe(false)
    }
  })

  it('⛔ the HOST asks it — the gate every turn passes (234 §3, from 228 L1)', () => {
    const host = codeOf(read(HOST))
    // ⚠️ **The public entry points trusted their callers.** `hasSomethingToSend` was held at the
    // wire and in the composer and NOWHERE in between, so a main-process caller — the endgame's MCP
    // spawn tools are the one being built — could queue a blank turn or interrupt a running one to
    // send spaces. One place, because 148 H2 is the dispatch about the door that forgets.
    expect(host).toMatch(
      /if \(!hasSomethingToSend\(content\.text, content\.attached\)\) throw new Error\(NOTHING_TO_SEND\)/,
    )
    // ⛑ …and every caller hands it a content OBJECT rather than taking a default. ⚠️ **What this
    // cannot see, said out loud** (review): a call site handing a CONSTANT satisfies it, and a
    // additional send path that never calls the gate at all leaves the count unchanged —
    // 148 H2's own shape. `send-refusals.test.ts` is what counts the throws in the chain; this
    // counts the callers. The six ordinary calls remain; a Move press adds one target admission.
    const calls = host.match(/this\.assertCanTakeTurn\(/g) ?? []
    expect(calls.length, 'a call site was added or removed — check it hands over its content').toBe(
      7,
    )
    expect(
      host.match(/this\.assertCanTakeTurn\(session, '(?:send|queue)', \{/g) ?? [],
      'a call site stopped handing over its content — the gate would be asking about a default',
    ).toHaveLength(calls.length - 1)
    expect(host.match(/this\.assertCanTakeTurn\(targetSession, 'queue', \{/g)).toHaveLength(1)
    expect(host).toMatch(
      /this\.assertCanTakeTurn\(targetSession, 'queue', \{\s*text: original\.event\.text,\s*attached: original\.event\.attachments\?\.length \?\? 0,\s*from: this\.originOf\(by\)/,
    )

    // ⛔ …and the flush's asks about what is GOING OUT rather than what was queued: the re-check
    // above it dedupes (221 §5), so `queued.attachments` is the wrong count to hold the rule to.
    // 🔴 **D-027 · what is going out is a TURN's worth now** — every held message the turn takes,
    // oldest first — so the gate is asked about all of their words and the sum of their re-checked
    // paths. ⚑ Still `handed.paths`, still what goes on the wire, never `queued.attachments`.
    expect(host).toMatch(
      /assertCanTakeTurn\(session, 'send', \{\s*text: going\.map\(\(\{ queued \}\) => queued\.text\)\.join\('\\n\\n'\),\s*attached: going\.reduce\(\(all, \{ handed \}\) => all \+ handed\.paths\.length, 0\),/,
    )
  })

  it('⛔ the renderer STORE asks it — the early-out that keeps a dead send off the wire', () => {
    // ⚠️ **The GUARD, not the token.** `toContain('hasSomethingToSend(')` was the first version and
    // it is satisfied by the IMPORT at the top of the file — so the early-out could be deleted
    // outright with this green. The shape of the call is what the census is actually about.
    expect(codeOf(read(STORE))).toMatch(
      /if \(!hasSomethingToSend\(text, attachments\.length\)\) return true/,
    )
  })

  it('⛔ the WIRE asks it — every send-shaped verb and the go-ahead (221 §1, 234 §3, 735)', () => {
    const wire = codeOf(read(WIRE))
    // The `.refine` itself, for the reason the store's assertion gives: an import is not a call.
    expect(wire).toMatch(/\.refine\(\(command\) => hasSomethingToSend\(command\.text,/)
    // ⚑ **Three verbs, not one.** `220` could only reach `send`; `sendInterrupting` and
    // `queueMessage` carried the identical line and were never measured until `221` shaped them
    // together. A census that counted only the call would pass a schema that had dropped two.
    // 🔴 **735 · and FOUR now**: `startAndSend`, a first message and the start it causes, is shaped
    // by the same factory — its launch key rides on top (`.safeExtend`).
    for (const verb of ['send', 'sendInterrupting', 'queueMessage', 'startAndSend']) {
      expect(wire, `${verb} left the shaped schema`).toContain(`sendShaped('${verb}')`)
    }
    // ⛔ **And the FOURTH verb** (234 §3, from `228` M3). `endPlanMode` reaches `handle.send` and
    // writes a `user_turn` like the others, and it kept `min(1)` — the rule 221 removed — because
    // the census above counted three and the UI only ever sends a constant.
    expect(wire).toMatch(/\.refine\(\(text\) => hasSomethingToSend\(text, 0\), NOTHING_TO_SEND\)/)
    expect(wire).toContain('text: goAheadText')
  })

  /**
   * ⛑ **The teeth.** Every assertion above is a `toContain` over a file, and a file that had been
   * renamed, emptied or moved would fail them all for the wrong reason — which reads as a real
   * finding and is not. This is what proves the census is looking at something.
   */
  it('⚑ …and the census is reading real files, not empty strings', () => {
    for (const rel of [COMPOSER, STORE, WIRE, SHARED, HOST]) {
      const code = codeOf(read(rel))
      expect(code.length, `${rel} came back empty`).toBeGreaterThan(2_000)
      // The comment stripper is doing something, or "the call is written" would be satisfiable by
      // the call being MENTIONED in a comment — which is precisely what this instrument must not do.
      expect(code.length, `${rel} — nothing was stripped`).toBeLessThan(read(rel).length)
    }
    // …and the stripper really removes a MENTION, in all three comment grammars this file meets.
    // ⚠️ **Synthetic fixtures rather than a slice of the real source**, so the check cannot go
    // stale when somebody rewords a doc block — the claim is about the STRIPPER, and that is what
    // is put in front of it.
    for (const mention of [
      '// hasSomethingToSend(text, 0)',
      '/** hasSomethingToSend(text, 0) */',
      '<!-- hasSomethingToSend(text, 0) -->',
    ]) {
      expect(codeOf(mention).trim(), `${mention} survived the stripper`).toBe('')
    }
    // ⛑ …and it leaves real code alone, or every assertion above would pass over an empty string.
    expect(codeOf('const x = hasSomethingToSend(a, b)')).toContain('hasSomethingToSend')
  })
})
