import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { proseSpans } from './lib/prose-spans'

/**
 * # 🔴 W4.74 · D-033 · the one glance left on a clock, and no re-read of the work on one
 *
 * ⚑ Since D-033 the host pushes every move of a piece as `work`, so `RuntimeScreen` dropped its
 * three half-minute re-reads (the Team page's forest, the band, the Work tab). ⚑ One glance is left,
 * at what no push carries — what each agent is doing this moment, and its process's memory — and it
 * runs ⛔ **only while a person can see it**: this window in front and the page visible. It also asks
 * again after a read that did not answer, and coming back to the front glances at once.
 *
 * ⚠️ Nothing in this repository mounts `RuntimeScreen`, so the wiring is read from its source —
 * `the-rails-list-is-asked-again-when-an-agents-state-may-have-moved`'s instrument: comments
 * blanked through `prose-spans.ts`, each function sliced at its own bounds, and every bound asserted
 * to exist before anything is asserted about what lies between them.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const FILE = 'RuntimeScreen.vue'
const RAW = readFileSync(join(HERE, '../src/renderer/src/components', FILE), 'utf8')

/** Every comment blanked, newlines kept, so a docblock quoting the code cannot stand in for it. */
function code(file: string, source: string): string {
  const lines = source.split('\n')
  for (const span of proseSpans(file, source)) {
    span.text.split('\n').forEach((said, offset) => {
      const at = span.line - 1 + offset
      const from = lines[at]?.indexOf(said) ?? -1
      if (from < 0) throw new Error(`${file}:${at + 1} does not hold the comment ${said}`)
      const line = lines[at] ?? ''
      lines[at] = line.slice(0, from) + ' '.repeat(said.length) + line.slice(from + said.length)
    })
  }
  return lines.join('\n')
}

const SCREEN = code(FILE, RAW)

/** The index of a marker that is in the code exactly once. */
function once(marker: string): number {
  const at = SCREEN.indexOf(marker)
  expect(at, `${JSON.stringify(marker)} is no longer in ${FILE}`).toBeGreaterThan(-1)
  expect(SCREEN.indexOf(marker, at + 1), `${JSON.stringify(marker)} is in ${FILE} twice`).toBe(-1)
  return at
}

/** A top-level function, from its signature to (not including) the `}` that closes it. */
function functionOf(signature: string): string {
  const at = once(signature)
  const end = SCREEN.indexOf('\n}', at)
  expect(end, `${signature} has no closing brace at column zero`).toBeGreaterThan(at)
  return SCREEN.slice(at, end)
}

/** The column-zero hook (`onMounted(` …) whose callback holds `marker`, whole. */
function hookAround(opener: string, marker: string): string {
  const at = once(marker)
  const start = SCREEN.lastIndexOf(`\n${opener}`, at)
  expect(start, `${marker} is not inside a column-zero ${opener}`).toBeGreaterThan(-1)
  const end = SCREEN.indexOf('\n})', at)
  expect(end, `the ${opener} holding ${marker} is never closed`).toBeGreaterThan(at)
  return SCREEN.slice(start + 1, end)
}

/** Every `setInterval(…)` call in the code, whole, by balancing its brackets. */
function everyInterval(): string[] {
  const calls: string[] = []
  for (
    let at = SCREEN.indexOf('setInterval(');
    at >= 0;
    at = SCREEN.indexOf('setInterval(', at + 1)
  ) {
    let depth = 0
    let end = at + 'setInterval'.length
    for (; end < SCREEN.length; end += 1) {
      if (SCREEN[end] === '(') depth += 1
      if (SCREEN[end] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    expect(depth, `a setInterval at ${String(at)} is never closed`).toBe(0)
    calls.push(SCREEN.slice(at, end + 1))
  }
  return calls
}

/** The lines of a slice that hold `call`, trimmed. */
const linesWith = (slice: string, call: string): string[] =>
  slice
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(call))

const GLANCE = functionOf('async function glance(): Promise<void> {')

describe('§1 · no re-read of the work on a clock', () => {
  it('🔴 no interval reads the forest, the band or the Work tab — and the glance is on one', () => {
    const intervals = everyInterval()
    // ⚑ THE POSITIVE CONTROL: the census sees intervals, and the glance is one of them.
    expect(intervals.some((one) => one.includes('glance()'))).toBe(true)
    for (const reader of ['readWhoIsWorking', 'readTheCast', 'readTheWork']) {
      expect(
        // ⚑ The call, not the name: `readTheWorkspace()` is no read of the Work tab.
        intervals.filter((one) => one.includes(`${reader}(`)),
        `an interval re-reads ${reader} on a clock`,
      ).toEqual([])
    }
  })

  it('⛔ the glance reads the work and the band again ONLY after a read that did not answer', () => {
    const work = linesWith(GLANCE, 'readTheWork()')
    expect(work, 'the glance no longer asks a refused Work tab again').toHaveLength(1)
    expect(work[0]).toContain('!work.value.answered')

    const cast = linesWith(GLANCE, 'readTheCast()')
    expect(cast).toHaveLength(1)
    // ⚑ Its guard is the `if` that opens the block it sits in.
    const castAt = GLANCE.indexOf('void readTheCast()')
    const guard = GLANCE.slice(GLANCE.lastIndexOf('if (', castAt), castAt)
    expect(guard, 'the glance re-reads the band whether or not it answered').toContain(
      '!cast.reading.value.answered',
    )

    const forest = linesWith(GLANCE, 'readWhoIsWorking()')
    expect(forest).toHaveLength(1)
    const forestAt = GLANCE.indexOf('void readWhoIsWorking()')
    expect(GLANCE.slice(GLANCE.lastIndexOf('if (', forestAt), forestAt)).toContain(
      'theForest.value === null',
    )
  })

  it('⚑ what no push carries IS glanced at: what each agent is doing, and its memory', () => {
    expect(GLANCE.match(/store\.whatIsBeingDone\(\)/g) ?? []).toHaveLength(2)
    expect(linesWith(GLANCE, 'readProcessMemory()')).toHaveLength(1)
  })
})

describe('§2 · only while a person can see it', () => {
  it('🔴 the glance does nothing unless the page is visible AND this window is in front', () => {
    const body = GLANCE.slice(GLANCE.indexOf('{') + 1).trim()
    const first = body.split('\n')[0] ?? ''
    // ⚑ Its FIRST statement, so no read is asked before it.
    expect(first).toContain("document.visibilityState !== 'visible'")
    expect(first).toContain('!document.hasFocus()')
    expect(first).toContain('return')
    // ⛔ An `&&` would let a hidden-but-focused (or visible-but-behind) window glance.
    expect(first).toContain('||')
  })

  it('⛔ a glance that lands after a newer one, or on another page, writes nothing', () => {
    const doing = linesWith(GLANCE, 'beingDone.value = doing')
    expect(doing).toHaveLength(1)
    expect(doing[0]).toContain('mine === glanceRead')
    expect(doing[0]).toContain("surface.value === 'team'")
    // ⚑ The band's half: a stale glance, or one for a conversation no longer on screen, returns first.
    expect(GLANCE).toContain('if (mine !== glanceRead || asked !== activeId.value) return')
  })

  it('🔴 coming back to the front glances at once — and the listeners go with the screen', () => {
    const onReturn = functionOf('function glanceOnReturn(): void {')
    expect(onReturn).toContain("document.visibilityState === 'visible' && document.hasFocus()")
    expect(onReturn).toContain('void glance()')

    const mounted = hookAround('onMounted(', 'glancing = setInterval(')
    const unmounted = hookAround('onUnmounted(', 'clearInterval(glancing)')
    for (const [target, event] of [
      ['window', 'focus'],
      ['document', 'visibilitychange'],
    ] as const) {
      expect(mounted).toContain(`${target}.addEventListener('${event}', glanceOnReturn)`)
      // ⛔ A listener left behind would glance into a screen that has been replaced.
      expect(unmounted).toContain(`${target}.removeEventListener('${event}', glanceOnReturn)`)
    }
  })
})
