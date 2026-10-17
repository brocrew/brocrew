import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * # ⛔ One composer, two mounts, and nothing that kept them comparable (219 §3)
 *
 * `217` §9 found `blocked` withheld by `ConversationPane` — the one send path left un-gated — by
 * READING the two mount sites side by side and asking what one had that the other did not. It found
 * a real defect that way, and `216` §9's gap #1 (`@update:attachments` missing from the launcher)
 * had been found the same way one dispatch earlier.
 *
 * ⚠️ **Nothing made them stay comparable.** `PromptComposer` has ten props and four events; both
 * mounts are ~15 lines of template in files of 900 and 2,300 lines, and a prop added to the component
 * reaches whichever mount its author was looking at. That is not a hypothetical failure mode — it is
 * the observed one, twice, and each time it took a human reading two files in one sitting.
 *
 * ## What this asserts
 *
 * Every prop and every event is supplied by BOTH mounts — **or the difference is named here, with
 * which mount withholds it and why.** ⛔ A named difference is checked as hard as an unnamed one: an
 * entry whose withholding mount is wrong, whose prop no longer exists, or which has quietly become
 * supplied by both, fails. An exemption that cannot go stale is the only kind worth having.
 *
 * ⚑ **Three of the named differences are `217` §9 (b)'s, reused rather than re-judged**, which is
 * what the dispatch asked for. ⚠️ **Two more arrived with `417`** (HO-022 §2): the launcher stopped
 * binding `blocked` and `cwd` when the controls whose refusals they carried were removed. They are
 * named here rather than deleted, because the PANE still supplies both and the exemption table is
 * checked as hard as the parity rule — see the two entries below.
 *
 * ⚠️ **A source census** (`206` H1). It proves the binding is written, not that the value is right —
 * `send-gate.dom.test.ts` is what presses the buttons. ⛔ `folder-gate.dom.test.ts` stood beside
 * it and `417` deleted it with the folder field (HO-022 §2).
 */

const here = dirname(fileURLToPath(import.meta.url))
const COMPOSER = join(here, '../src/renderer/src/components/PromptComposer.vue')
const MOUNTS = {
  pane: join(here, '../src/renderer/src/components/ConversationPane.vue'),
  launcher: join(here, '../src/renderer/src/components/NewConversation.vue'),
} as const

type Mount = keyof typeof MOUNTS

/** Line, block and HTML comments removed — a prop named in prose is not a prop supplied. */
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

/** The body of a `defineProps<{…}>` / `defineEmits<{…}>` type literal. */
function typeBlock(code: string, opener: string): string {
  const from = code.indexOf(opener)
  if (from === -1) return ''
  const to = code.indexOf('}>(', from)
  return to === -1 ? '' : code.slice(from + opener.length, to)
}

/** `can-attach` → `canAttach`, so a template attribute and a prop name are the same string. */
function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

/** Every key declared in a `defineProps`/`defineEmits` literal, at the given indent. */
function declared(block: string, indent: number): string[] {
  const at = new RegExp(`^ {${indent}}'?([\\w:]+)'?\\??:`, 'gm')
  return [...block.matchAll(at)].map((m) => m[1]!)
}

/**
 * What one mount hands the composer: the props it binds, and the events it listens for.
 *
 * ⚠️ **`key` is dropped**, because it is Vue's own and not a prop of this component — the pane sets
 * it so that switching conversations REBUILDS the field rather than re-pointing it.
 */
function handedBy(template: string): { props: Set<string>; emits: Set<string>; tag: string } {
  const from = template.indexOf('<PromptComposer')
  const tag = from === -1 ? '' : template.slice(from, template.indexOf('/>', from))
  const props = new Set<string>()
  const emits = new Set<string>()
  for (const [, sigil, name] of tag.matchAll(/\s([:@]?)([a-zA-Z][a-zA-Z0-9:-]*)=/g)) {
    if (sigil === '@') emits.add(name!)
    else if (name !== 'key') props.add(camel(name!))
  }
  return { props, emits, tag }
}

/**
 * ⚑ **217 §9 (b)'s list, reused rather than re-judged** — the differences that are deliberate, and
 * which mount is the one that withholds.
 *
 * ⚠️ **`blocked` and `cwd` are 417's, and they are the only two entries not from 217.** They are
 * here rather than deleted from the parity rule because a named difference is checked as hard as
 * an unnamed one: the loop below fails if either note names the wrong mount, and the staleness
 * rule at the foot fails the day the launcher binds one of them again.
 */
const DELIBERATE: Record<string, { withheldBy: Mount | 'both'; why: string }> = {
  placeholder: {
    withheldBy: 'pane',
    why:
      'The DEFAULT is the pane’s sentence — "Message this conversation…". Passing it would be the ' +
      'same string written twice, and the launcher is the mount that needs a different question.',
  },
  hasQueued: {
    withheldBy: 'launcher',
    why:
      'It is read only while `busy` (the foot and the Queue title), and the launcher never emits ' +
      '`busy` — it emits `starting` (103). The prop could only ever be inert there.',
  },
  stopUnanswered: {
    withheldBy: 'launcher',
    why:
      '⚑ 730 · R83 — it is drawn only while `busy`, about an ask to stop a running turn; the ' +
      'launcher never emits `busy` and has no turn to have asked about.',
  },
  interruptible: {
    withheldBy: 'launcher',
    why:
      '⛔ **It was a DEAD PROP from 102/103 until 234 §2** (217 §9 c): the launcher stopped ' +
      'passing it and nothing replaced it, so it was permanently `true`. The pane supplies it now ' +
      '— `record.phase !== "closing"`, from `228` M2 — and the LAUNCHER still cannot: it emits ' +
      '`starting`, never `busy` or `frozen`, so `canInterrupt` is false there whatever this says. ' +
      '⚑ **TWO of the three branches it gates came back; the third did not** (corrected in ' +
      'review): `canInterrupt` false now reaches the send button and the Escape guard, but the ' +
      'hint`s bare `state === "busy"` fallback is still unreachable, because `!interruptible` ' +
      'implies `closing` implies `blocked !== null`, and the `blocked` branch wins first.',
  },
  blocked: {
    withheldBy: 'launcher',
    why:
      '🔴 **417, HO-022 §2 — the launcher has nothing left to refuse a press over.** `219` was ' +
      'about the PANE withholding this (169 → 219) and that half is still asserted below, ' +
      'unexempted. The launcher’s half carried `launchBlocked`, which was the refusal of the ' +
      'profile name box and the folder field; both controls are gone with every other question ' +
      'the front door used to ask, so the value could only ever be `null` now. ⛔ **This ' +
      'exemption is not a licence for a NEW refusal to go unbound** — if the launcher ever grows ' +
      'a reason a send cannot happen, this entry has to go and the parity rule takes over again.',
  },
  cwd: {
    withheldBy: 'launcher',
    why:
      '🔴 **417, HO-022 §2 — the folder row is gone, so there is no folder to judge a path ' +
      'against.** An untouched launcher always handed the EMPTY STRING, which is this prop’s own ' +
      'default, so every chip on this mount was already marked `no-folder`; removing the binding ' +
      'changed nothing a person can see and made the always-true case honest. The PANE still ' +
      'supplies the conversation’s real `cwd`, which is the half that decides anything.',
  },
}

const composer = codeOf(readFileSync(COMPOSER, 'utf8'))
const PROPS = declared(typeBlock(composer, 'defineProps<{'), 4)
const EMITS = declared(typeBlock(composer, 'defineEmits<{'), 2)
const handed = Object.fromEntries(
  Object.entries(MOUNTS).map(([name, path]) => [
    name,
    handedBy(codeOf(readFileSync(path, 'utf8'))),
  ]),
) as Record<Mount, ReturnType<typeof handedBy>>

describe('the census can see both mounts', () => {
  it('⚑ the component really declares props and events, and both mounts really bind some', () => {
    // ⛔ Non-vacuity first, and it is not ceremony: every rule below is a loop over `PROPS`, and an
    // empty `PROPS` makes all of them pass over nothing. This suite has shipped that mistake before.
    expect(PROPS.length, 'defineProps was not found or was not parsed').toBeGreaterThanOrEqual(8)
    expect(PROPS).toContain('state')
    expect(PROPS).toContain('draft')
    expect(PROPS).toContain('blocked')
    // ⛔ **Three since 292 §2**, and the one that left is the point: `update:attachments` was the
    // channel a staged path travelled up on, and Vue drops emissions from an unmounted component —
    // so a paste answered after a conversation switch had nowhere to go (`288` H2). The paths ride
    // a `handing` PROP now, which the parity rules below check like any other prop.
    expect(EMITS).toEqual(['send', 'interrupt', 'update:draft'])
    for (const mount of Object.keys(MOUNTS) as Mount[]) {
      expect(handed[mount].props.size, `${mount} binds nothing`).toBeGreaterThan(5)
      expect(handed[mount].props, `${mount} does not bind :state`).toContain('state')
      // ⛔ **The slice runs to the first `/>`, and that is only safe while the tag SELF-CLOSES**
      // (found reviewing this file's own diff). A mount converted to `<PromptComposer …>…
      // </PromptComposer>` would make the slice run to some LATER element's `/>` and swallow its
      // attributes — reporting props as supplied that nothing supplies, which is the false-green
      // direction and the one worth guarding. A nested `<` is the tell.
      expect(
        handed[mount].tag.indexOf('<', 1),
        `${mount}'s composer tag swallowed another element — the extractor is reading someone ` +
          'else’s attributes as this component’s props',
      ).toBe(-1)
    }
  })

  it('⚑ …and there is no THIRD mount for this list to be silent about', () => {
    // 217 §9's own premise. `ReadingPane` imports no composer deliberately: a recording has no
    // session behind it and offers nothing that would need one.
    const users = ['ConversationPane.vue', 'NewConversation.vue']
    const src = join(here, '../src/renderer/src/components')
    const mounting = readFileSync(join(src, 'ReadingPane.vue'), 'utf8')
    expect(mounting).not.toContain('<PromptComposer')
    expect(users).toHaveLength(Object.keys(MOUNTS).length)
  })

  it('⚑ the extractor notices a prop that is missing — the teeth', () => {
    // A parser that returned an empty set for every mount would make "supplied by both" impossible
    // and this file loud rather than silent; a parser that returned EVERYTHING would make it green
    // forever. This is the second failure mode, and it is the dangerous one.
    const complete = handedBy('<PromptComposer :state="s" :draft="d" @send="go" />')
    expect(complete.props).toEqual(new Set(['state', 'draft']))
    expect(complete.emits).toEqual(new Set(['send']))
    const shy = handedBy('<PromptComposer :state="s" @send="go" />')
    expect(shy.props.has('draft')).toBe(false)
    // …and kebab really becomes camel, or `can-attach` would read as an eleventh prop nobody has.
    expect(handedBy('<PromptComposer :can-attach="true" />').props).toEqual(new Set(['canAttach']))
  })
})

describe('219 §3 · every load-bearing prop reaches BOTH mounts', () => {
  it('🔴 no prop is supplied to one composer and not the other, unless it is named', () => {
    for (const prop of PROPS) {
      const supplied = (Object.keys(MOUNTS) as Mount[]).filter((m) => handed[m].props.has(prop))
      if (supplied.length === 2) continue
      const named = DELIBERATE[prop]
      expect(
        named,
        `\`${prop}\` reaches ${supplied.join(' and ') || 'neither mount'} and nothing says that is ` +
          'deliberate — this is the shape 217 §9 found `blocked` in',
      ).toBeDefined()
      const withholding =
        supplied.length === 0 ? 'both' : supplied[0] === 'pane' ? 'launcher' : 'pane'
      expect(named!.withheldBy, `the note for \`${prop}\` names the wrong mount`).toBe(withholding)
    }
  })

  it('🔴 every EVENT reaches both mounts, with no exemptions at all', () => {
    // ⛔ 216's dropped attachment was exactly this: a `@update:attachments` the launcher did not
    // listen for, so every path a person staged there was cleared and thrown away. There is no
    // deliberate reason to ignore an event this component emits, so the list is empty by design.
    for (const event of EMITS) {
      for (const mount of Object.keys(MOUNTS) as Mount[]) {
        expect(handed[mount].emits, `${mount} does not listen for @${event}`).toContain(event)
      }
    }
  })

  it('🔴 …and the PANE supplies `blocked`, which is the whole of 219', () => {
    // Named on its own, so the regression has its own failure message rather than appearing as one
    // line of a loop. It was withheld by the pane from 169 until 219, and THAT is the half 219 is
    // about — the pane is the mount with a live session, a queue and a closing phase behind it.
    expect(handed.pane.props).toContain('blocked')
    // ⚑ **417 (HO-022 §2) took the launcher's half, and it is named rather than deleted.** The
    // launcher's `blocked` was `launchBlocked` — the profile name box's refusal and the folder
    // field's — and both controls went with everything else the front door used to ask. The
    // exemption is live: the loop above would fail if the note named the wrong mount, and the
    // staleness rule below fails the day the launcher binds it again.
    expect(handed.launcher.props.has('blocked')).toBe(false)
    expect(DELIBERATE.blocked?.withheldBy, '`blocked` is excused, but not for the launcher').toBe(
      'launcher',
    )
  })
})

describe('219 §3 · the named differences are still true', () => {
  it('🔴 every excused prop still exists, and still is not supplied by both', () => {
    for (const [prop, note] of Object.entries(DELIBERATE)) {
      expect(PROPS, `\`${prop}\` is excused here but is no longer a prop`).toContain(prop)
      expect(note.why.length, `\`${prop}\` is excused with no reason`).toBeGreaterThan(60)
      const supplied = (Object.keys(MOUNTS) as Mount[]).filter((m) => handed[m].props.has(prop))
      expect(
        supplied.length,
        `\`${prop}\` is now supplied by both mounts — the exemption is stale and should go`,
      ).toBeLessThan(2)
    }
  })

  it('🔴 `interruptible` is supplied by the PANE and not the launcher — 234 §2 gave it a caller', () => {
    // ⚠️ The distinction matters: a prop one mount sets and the other does not is a divergence; a
    // prop nobody sets is a branch nobody reaches. 217 §9 (c) reported it as unclear and 219 §4
    // scoped it out; `228` M2 is the finding that needed it, and this is the answer, pinned.
    expect(handed.pane.props.has('interruptible')).toBe(true)
    expect(handed.launcher.props.has('interruptible')).toBe(false)
    expect(composer, 'the prop was removed — delete this test and its note with it').toContain(
      'interruptible?: boolean',
    )
    // ⛔ …and it is bound to the CLOSING fact rather than to a constant, or the branch is dead
    // again with the census green.
    const pane = codeOf(readFileSync(MOUNTS.pane, 'utf8'))
    expect(pane, 'the pane stopped gating the stop affordances on `closing`').toContain(
      ':interruptible="interruptible"',
    )
    expect(pane).toMatch(
      /const interruptible = computed\(\(\) => props\.record\.phase !== 'closing'\)/,
    )
  })
})
