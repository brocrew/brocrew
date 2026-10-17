import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import CommandPalette from '../src/renderer/src/components/CommandPalette.vue'
import OverlayHost from '../src/renderer/src/components/OverlayHost.vue'

/**
 * # 🔴 251 §0 · A component that cannot be server-rendered is a real constraint here
 *
 * ⛔ **`main` was RED at `c5a6d35` and this is the shape of it.** `CommandPalette.vue` called
 * `window.addEventListener` in the BODY of `setup`; the whole `desktop` vitest project is SSR, where
 * there is no `window`. It was invisible for exactly as long as nothing server-rendered the
 * component — and then `249` mounted the palette inside `SideRail`, so every SSR test that renders
 * the rail imports it, and `250`'s `idle-truth.render.test.ts` was the first one to arrive. Seven
 * tests, one `ReferenceError`, in a file that had nothing to do with the palette.
 *
 * ⚠️ **`249`'s latent defect, not `250`'s test being wrong** — the dispatch is explicit, and the
 * fix is a guard rather than a moved test, *"because moving it would hide the constraint rather than
 * satisfy it."*
 *
 * ## ⛔ It was not alone, which is why this file has two halves
 *
 * `OverlayHost.vue` had the identical line, and survived for the identical reason: every overlay in
 * the app is behind a `v-if` that is false until something is open, so no SSR test had ever reached
 * its `setup`. **Satisfied by accident is not satisfied**, and the accident is one `.render.test.ts`
 * away from ending. Both are `onMounted` now, which is what `ConversationPane.vue:699`,
 * `RuntimeScreen.vue:843` and `FacetBar` were already doing.
 *
 * ## ⚠️ What the census below does NOT cover, said out loud
 *
 * It looks for `addEventListener` on a browser global at the top level of a `<script setup>` — the
 * defect class that actually happened, twice. A top-level `const w = window.innerWidth` would break
 * SSR in the same way and this would not see it. Widening it means deciding what a *guarded* read
 * looks like (`PromptComposer.vue` has one: `typeof navigator === 'undefined' ? '' : …`) and telling
 * a real `document` from a prop that happens to be called one — `AllDocumentsSheet` and
 * `ProjectWorkspace` both have that parameter. A narrow census that is exactly right beats a wide
 * one with exceptions, and naming the gap is the difference between the two (`092`'s rule, applied
 * to coverage rather than to a cap).
 *
 * ⛔ **And where it cannot read, it says so rather than passing.** `scrub` cannot tell a regex
 * literal from a division, so a `/'/` anywhere in a `<script setup>` blanks the rest of the file to
 * this census — the failure mode where an instrument reports a clean sweep of something it never
 * saw. {@link topLevelListeners} checks that the brackets balance after scrubbing and THROWS when
 * they do not, so that outcome is a red with a reason instead of a silence.
 */

const here = dirname(fileURLToPath(import.meta.url))
const COMPONENTS = join(here, '../src/renderer/src')

describe('251 §0 · the two components that could not be server-rendered', () => {
  it('🔴 OverlayHost renders on the server, and renders its real chrome', async () => {
    const html = await renderToString(createSSRApp(OverlayHost, { label: 'A sheet' }))
    // The positive that makes this a test rather than a "did not throw": the host's own backdrop,
    // its dialog role and its focus target are all in the markup.
    expect(html).toContain('data-cy="overlay-host"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('aria-label="A sheet"')
  })

  it('🔴 CommandPalette renders on the server, teleport and all', async () => {
    const context: { teleports?: Record<string, string> } = {}
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(CommandPalette as never, {
            open: [],
            closed: [],
            closedLooked: true,
            closedError: null,
            projects: [],
            activeId: null,
          }),
      }),
      context,
    )
    // ⚠️ The panel is `Teleport to="body"` and closed by default, so the MAIN string is empty by
    // design and asserting on it would prove nothing. The teleport BUFFER existing is the fact: it
    // is only written once `setup` has run to completion and the template has rendered.
    expect(html).toBe('<!--teleport start--><!--teleport end-->')
    // ⚑ The buffer is keyed by the teleport's TARGET (`body`), and it only exists once `setup` has
    // run to completion and the template has rendered — which is the fact this test is buying.
    expect(Object.keys(context.teleports ?? {})).toEqual(['body'])
  })
})

/** Every `.vue` under the renderer, so a new component is censused the day it is written. */
function components(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...components(path))
    else if (path.endsWith('.vue')) out.push(path)
  }
  return out
}

/**
 * Comments and string literals blanked, so brace-depth counting is honest.
 *
 * ⚠️ **Written rather than regexed.** A `//` inside a string, a `'` inside a comment and a template
 * literal spanning lines each break the naive version, and this census exists to catch a real defect
 * — one that reports a phantom is one that gets deleted.
 */
function scrub(source: string): string {
  let out = ''
  let i = 0
  const blank = (char: string): string => (char === '\n' ? '\n' : ' ')
  while (i < source.length) {
    const char = source[i]!
    const next = source[i + 1]
    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') out += blank(source[i++]!)
      continue
    }
    if (char === '/' && next === '*') {
      out += '  '
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += blank(source[i++]!)
      }
      out += '  '
      i += 2
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      out += ' '
      i += 1
      while (i < source.length && source[i] !== char) {
        if (source[i] === '\\') {
          out += ' '
          i += 1
        }
        out += blank(source[i++]!)
      }
      out += ' '
      i += 1
      continue
    }
    out += char
    i += 1
  }
  return out
}

const LISTENER = /\b(?:window|document)\s*\.\s*(?:add|remove)EventListener\s*\(/g

/**
 * The 1-based lines of a `<script setup>` body that register a global listener **at the top level**.
 *
 * ⛔ **Depth is counted per CHARACTER, not per line, and that distinction is the whole test.**
 * `onMounted(() => window.addEventListener(…))` begins its line at depth 0 — the first draft of this
 * census flagged every correct call in the app, including the two this dispatch had just written.
 * What matters is the depth at the character the match STARTS on: inside a hook callback it is 2,
 * and in the body of `setup` it is 0.
 */
function topLevelListeners(body: string): number[] {
  const scrubbed = scrub(body)
  // ⛔ **The scrub's own self-check, and it is what keeps this census from going blind** (found by
  // the adversarial pass over 251's diff). `scrub` does not know a REGEX LITERAL from a division, so
  // an ordinary `s.replace(/'/g, '')` opens a string that never closes — and everything after it in
  // that component is blanked, silently, including a listener registered during `setup`. A parser
  // that mis-read cannot be allowed to report "nothing here": brackets that do not balance mean the
  // read failed, and this throws instead.
  const closed = [...scrubbed].reduce(
    (depth, char) => depth + ('{(['.includes(char) ? 1 : '})]'.includes(char) ? -1 : 0),
    0,
  )
  if (closed !== 0) {
    throw new Error(
      `the SSR census could not parse this <script setup>: brackets end at depth ${closed}, ` +
        'so the scrub mis-read something (a regex literal is the known case) and a listener ' +
        'registered during setup could be hiding behind it',
    )
  }
  // ⚠️ Indexed by UTF-16 unit, NOT `for…of`. That iterates code points, and `match.index` is a
  // UTF-16 offset — one astral character anywhere in a component would slide the whole table and
  // make this census quietly read the wrong depth.
  const depthAt: number[] = new Array<number>(scrubbed.length)
  let depth = 0
  for (let i = 0; i < scrubbed.length; i += 1) {
    depthAt[i] = depth
    const char = scrubbed[i]!
    if ('{(['.includes(char)) depth += 1
    else if ('})]'.includes(char)) depth -= 1
  }
  const lines: number[] = []
  for (const match of scrubbed.matchAll(LISTENER)) {
    if (depthAt[match.index] !== 0) continue
    lines.push(scrubbed.slice(0, match.index).split('\n').length)
  }
  return lines
}

describe('251 §0 · the census — no component registers a listener during setup', () => {
  it('⛔ every global listener in the app is registered in a LIFECYCLE hook', () => {
    const offenders: string[] = []
    const files = components(COMPONENTS)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const block = /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(source)
      if (!block) continue
      const offset = source.slice(0, block.index).split('\n').length - 1
      const raw = block[1]!.split('\n')
      for (const line of topLevelListeners(block[1]!)) {
        offenders.push(`${relative(here, file)}:${offset + line}  ${raw[line - 1]!.trim()}`)
      }
    }
    expect(offenders, 'registered during setup — move it into onMounted').toEqual([])
    // ⚑ The paired positive, and the whole reason this census is not vacuous: the walk really read
    // the components and really found the two this dispatch fixed. Without it, a wrong path or a
    // regex that matches nothing reports "no offenders" about a directory it never opened.
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((file) => file.endsWith('CommandPalette.vue'))).toBe(true)
    expect(files.some((file) => file.endsWith('OverlayHost.vue'))).toBe(true)
  })

  it('⚠️ …and the census can SEE one, so an empty result means something', () => {
    const planted = [
      'const onKey = (): void => {}', // 1
      "// window.addEventListener('keydown', onKey) ← a comment must not count", // 2
      'const s = "window.addEventListener(\'keydown\', onKey)" // nor a string', // 3
      "onMounted(() => window.addEventListener('keydown', onKey))", // 4 — correct, depth 2
      "window.addEventListener('keydown', onKey, { capture: true })", // 5 — THE DEFECT
      'onUnmounted(() => {', // 6
      "  document.removeEventListener('pointerdown', onKey)", // 7 — correct, depth 3
      '})', // 8
      "document.addEventListener('pointerdown', onKey)", // 9 — the defect, other global
    ].join('\n')
    expect(topLevelListeners(`\n${planted}\n`)).toEqual([6, 10])
  })

  it('🔴 …and a block it CANNOT parse throws rather than reporting nothing', () => {
    // The known blind spot, made loud. `scrub` reads the `'` inside the regex as a string opener, so
    // everything after it is blanked and the listener below would vanish from the census. The
    // unbalanced brackets that leaves are what this catches.
    const blind = [
      "const clean = (s: string): string => s.replace(/'/g, '')",
      "window.addEventListener('keydown', onKey)",
    ].join('\n')
    expect(() => topLevelListeners(blind)).toThrow(/could not parse/)
    // …and the paired positive: without the regex, the same listener IS found.
    expect(topLevelListeners("window.addEventListener('keydown', onKey)")).toEqual([1])
  })
})
