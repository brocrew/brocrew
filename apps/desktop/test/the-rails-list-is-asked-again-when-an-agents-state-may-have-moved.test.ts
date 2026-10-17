import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOOK_EVERY_MS } from '../src/renderer/src/lib/persons-queue'
import { proseSpans } from './lib/prose-spans'

/**
 * # D-019 · the rail learns what an agent is doing from the push, not by asking its list again
 *
 * ## What this file pins, and why it is a source census
 *
 * The host's one state (the one `get_agent_status` words) is drawn from the rail's list. UI-001
 * had the screen ask that list again wherever the state MIGHT have moved: when the five-second
 * waits reading moved, when work moved, and on the band's half-minute tick. Main now says when it
 * DID move — `runtime:states` carries each conversation whose state changed and the state it is in
 * now — so those re-reads are gone, and this file pins what took their place:
 *
 *  1. the screen hands every `runtime:states` message to the rail (`hearStates`) and lets go of it
 *     on unmount, and the rail folds it in without asking anything;
 *  2. the screen still asks the rail's list when work moves, for the work that names each
 *     conversation, which no push carries — and otherwise only on the `conversations` subject and
 *     after a retitle, never to learn a state;
 *  3. the band's half-minute tick reads the cast and nothing else;
 *  4. the waits reading keeps itself and asks nothing of the rail;
 *  5. the five-second tick feeds that reading and never asks the list itself.
 *
 * The file keeps the name the mutation tables know it by.
 *
 * Nothing in this repository mounts `RuntimeScreen`, so the wiring is read from its source, sliced
 * per function, per arm and per lifecycle hook, and every bound is asserted to exist before
 * anything is asserted about what lies between them.
 *
 * ## Every census below reads CODE, never prose
 *
 * The screen's and the rail's docblocks quote `onStates`, `hearStates` and `refreshResumable`
 * constantly. {@link code} blanks every comment through `prose-spans.ts`' parser, so a docblock
 * cannot satisfy or defeat a census.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(HERE, '../src')

const read = (path: string): string => readFileSync(join(SRC, path), 'utf8')

/**
 * Every comment blanked, newlines kept, so a docblock quoting the code cannot stand in for it.
 *
 * ⚠️ **Blanked line by line, where each span says it starts.** A run of `//` lines is one span,
 * joined WITHOUT the indentation between them, so an indented run is not in the source as one
 * string and replacing the span whole would leave it standing; each of its lines is in its own
 * source line, which is where it is looked for.
 */
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

/** One component's code, with the name its failures are said under. */
interface Source {
  readonly file: string
  readonly code: string
}

const sourceOf = (file: string): Source => ({
  file,
  code: code(file, read(`renderer/src/components/${file}`)),
})

const SCREEN = sourceOf('RuntimeScreen.vue')
const RAIL = sourceOf('SideRail.vue')

/** The index of a marker that is in the source exactly once. */
function once(marker: string, where: Source = SCREEN): number {
  const at = where.code.indexOf(marker)
  expect(at, `${JSON.stringify(marker)} is no longer in ${where.file}`).toBeGreaterThan(-1)
  expect(
    where.code.indexOf(marker, at + 1),
    `${JSON.stringify(marker)} is in ${where.file} more than once`,
  ).toBe(-1)
  return at
}

/** A top-level function, from its signature to (not including) the `}` that closes it. */
function functionOf(signature: string, where: Source = SCREEN): string {
  const at = once(signature, where)
  const end = where.code.indexOf('\n}', at)
  expect(end, `${signature} has no closing brace at column zero`).toBeGreaterThan(at)
  return where.code.slice(at, end)
}

/**
 * A top-level call whose callback holds `marker` — `onMounted(() => { … })` and its like — from
 * the call to (not including) the `})` at column zero that closes it.
 */
function hookAround(opener: string, marker: string, where: Source = SCREEN): string {
  const at = once(marker, where)
  const start = where.code.lastIndexOf(`\n${opener}`, at)
  expect(start, `${marker} is not inside a column-zero ${opener}`).toBeGreaterThan(-1)
  const end = where.code.indexOf('\n})', at)
  expect(end, `the ${opener} holding ${marker} is never closed at column zero`).toBeGreaterThan(at)
  return where.code.slice(start + 1, end)
}

/** A `setInterval(...)` call, whole, by balancing its brackets, from a marker that names it. */
function intervalOf(marker: string): string {
  const at = once(marker)
  const open = SCREEN.code.indexOf('(', at + marker.length - 1)
  expect(open, `${marker} has no argument list`).toBe(at + marker.length - 1)
  let depth = 0
  let end = open
  for (; end < SCREEN.code.length; end += 1) {
    if (SCREEN.code[end] === '(') depth += 1
    if (SCREEN.code[end] === ')') {
      depth -= 1
      if (depth === 0) break
    }
  }
  expect(depth, `${marker} is never closed`).toBe(0)
  return SCREEN.code.slice(at, end + 1)
}

/** Where the rail's list is asked from this screen, however the call is awaited or chained. */
const ASKS_THE_RAILS_LIST = /\brail\.value\?\.refreshResumable\(\)/g

describe('D-019 · the rail learns what an agent is doing from the push, not by asking its list again', () => {
  it('the screen hands every `runtime:states` message to the rail, and lets go of it on unmount', () => {
    // The mount that owns what main tells the window: its neighbour is `runtime:changed`'s
    // listener, which is the control that this is the right hook.
    const mount = hookAround('onMounted(() => {', 'stopListening = whenTheWorldMoves(')
    expect(mount).toContain('window.api.runtime.onChanged(')

    // The whole message, handed to the rail's own door, unfiltered — and the one subscription.
    // ⚑ **UI-002** — the listener is a block since the channel carries the files kept too (D-026):
    // the rail still hears every message first and whole, and a message that kept a file reads the
    // files again.
    const heard =
      /^ {2}stopHearingStates = listenProviderStates\(window\.api\.runtime, store, \((\w+)\) => \{\n {4}rail\.value\?\.hearStates\(\1\)$/m.exec(
        mount,
      )
    expect(heard, 'the rail is not the first to hear each whole message').not.toBeNull()
    expect(mount).toContain(`    if (${heard![1]!}.kept.length > 0) void readTheFiles()`)
    expect(SCREEN.code.match(/\blistenProviderStates\(/g)).toHaveLength(1)
    expect(SCREEN.code.match(/\.onStates\(/g)).toBeNull()
    const listener = code(
      'renderer/src/lib/provider-limit-facts.ts',
      read('renderer/src/lib/provider-limit-facts.ts'),
    )
    expect(listener.match(/\.onStates\(/g)).toHaveLength(1)
    expect(listener).toMatch(
      /return bridge\.onStates\(\(message\) => \{\s*store\.hearProviderStates\(message\)\s*receive\(message\)\s*\}\)/,
    )

    // Let go of beside `stopListening`, for its HMR reason: every assignment is one of these two.
    const unmount = hookAround('onUnmounted(() => {', '  stopListening?.()')
    const letGo = [
      unmount.indexOf('stopHearingStates?.()'),
      unmount.indexOf('stopHearingStates = null'),
    ]
    for (const position of letGo) expect(position).toBeGreaterThan(-1)
    expect(letGo[0]).toBeLessThan(letGo[1] ?? -1)
    expect(SCREEN.code.match(/\bstopHearingStates = /g)).toHaveLength(2)

    // The rail's end: the door is exposed, and hearing asks nothing. The control is the rail's own
    // list read, which does ask, so the absence below is measured against a reader that has it.
    const exposed = hookAround('defineExpose({', '  refreshResumable: ', RAIL)
    expect(exposed).toMatch(/^ {2}hearStates,$/m)
    const asks = functionOf('async function refreshListed(): Promise<void> {', RAIL)
    expect(asks).toContain('window.api.runtime.listResumable()')
    expect(asks).toContain('window.api.runtime.listUnresumable()')
    const hears = functionOf('function hearStates(message: RuntimeStatesMessage): void {', RAIL)
    expect(hears).toContain('message.moved')
    expect(hears).not.toMatch(/window\.api|refreshListed|await/)

    // …and it does fold: each state is set into a copy of what was heard before (so an earlier
    // push is kept), the copy is stored, and the one list is drawn over each heard state.
    expect(hears).toMatch(/const next = new Map\(said\.value\)/)
    expect(hears).toMatch(
      /for \(const moved of message\.moved\) \{\s*next\.set\(moved\.conversation, \{ state: moved\.state, after: readsAsked \}\)\s*\}/,
    )
    expect(hears).toMatch(/said\.value = next\b/)
    const drawn = RAIL.code.slice(
      once('const listed = computed(', RAIL),
      once('async function refreshListed(', RAIL),
    )
    expect(drawn).toMatch(
      /\bsaid: new Map\(\[\.\.\.said\.value\]\.map\(\(\[(\w+), (\w+)\]\) => \[\1, \2\.state\]\)\)/,
    )
  })

  it('work moving still asks the rail’s list, for the work that names each conversation — and nothing asks it to learn a state', () => {
    const conversationsAt = once('    conversations: () => {')
    const workAt = once('    work: () => {')
    const agentsAt = once('    agents: ')
    expect(conversationsAt).toBeLessThan(workAt)
    expect(workAt).toBeLessThan(agentsAt)
    const arm = SCREEN.code.slice(workAt, agentsAt)

    // The control: this is the work arm and not a neighbour. It runs the work readers, and it
    // does not run the conversations arm's `readTheRoom`.
    expect(arm).toContain('void readTheCast()')
    expect(arm).toContain('void readWhoIsWorking()')
    expect(arm).toContain('void readTheWork()')
    expect(arm).not.toContain('readTheRoom')

    // The rail's list, asked once, as a bare statement: nothing waits on it here.
    expect(arm).toMatch(/^\s*void rail\.value\?\.refreshResumable\(\)\s*$/m)
    expect(arm.match(ASKS_THE_RAILS_LIST)).toHaveLength(1)

    // Every place the screen asks the rail's list, and none of them is a tick or the waits
    // reading: the `conversations` arm, this arm, and the retitle. The control: the library's
    // list is asked too, and the pattern does not count it.
    expect(SCREEN.code).toContain('void library.value?.refreshResumable()')
    const retitle = hookAround('const retitleOfActive = computed(', 'retitleWork(')
    const places = [SCREEN.code.slice(conversationsAt, workAt), arm, retitle]
    expect(places.map((place) => place.match(ASKS_THE_RAILS_LIST)?.length ?? 0)).toEqual([1, 1, 1])
    expect(SCREEN.code.match(ASKS_THE_RAILS_LIST)).toHaveLength(3)
  })

  it('W4.74 · the one glance left on a clock asks nothing of the rail and reads no cast', () => {
    // The whole call, so nothing can ride beside the glance — gated or not. ⚑ D-033 · the band
    // has no tick of its own any more: every move of its work is pushed.
    expect(intervalOf('glancing = setInterval(')).toBe(
      'glancing = setInterval(() => void glance(), ROSTER_EVERY_MS)',
    )
    expect(SCREEN.code).not.toContain('casting = setInterval(')
  })

  it('a waits reading keeps itself and asks nothing of the rail; a refused one keeps the last', () => {
    // The whole body: the reading is asked, and stored only when it is one — `null` is *we did
    // not look*, and blanking on it would put every row back on its live facets.
    const fn = functionOf('async function readWhatIsWaiting(): Promise<void> {')
    expect(fn).toMatch(
      /^async function readWhatIsWaiting\(\): Promise<void> \{\s*const reading = await store\.whatEachConversationIsWaitingOn\(\)\s*if \(reading !== null\) conversationWaits\.value = reading\s*$/,
    )
    // …and nothing is kept to compare the next reading with.
    expect(SCREEN.code).not.toMatch(/\bwaitsSeen\b/)
  })

  it('the five-second tick is what feeds the waits reading, and it never asks the list itself', () => {
    const call = intervalOf('looking = setInterval(')

    // The control: this is the queue's interval, and it holds the reader the waits come from.
    expect(call).toContain('void lookForWhatIsYours(true)')
    expect(call).toContain('void readTheWorkspace()')
    expect(call).toContain('void readWhatIsWaiting()')
    expect(call.endsWith(', LOOK_EVERY_MS)')).toBe(true)
    expect(LOOK_EVERY_MS).toBe(5_000)

    // The first reading exists too, on the first pass before the interval, so the waits are drawn
    // before the first tick.
    const firstPass = SCREEN.code.slice(
      SCREEN.code.indexOf('\n  void lookForWhatIsYours()\n'),
      SCREEN.code.indexOf('looking = setInterval('),
    )
    expect(SCREEN.code.indexOf('\n  void lookForWhatIsYours()\n')).toBeGreaterThan(-1)
    expect(SCREEN.code.indexOf('\n  void lookForWhatIsYours()\n')).toBe(
      SCREEN.code.lastIndexOf('\n  void lookForWhatIsYours()\n'),
    )
    expect(firstPass).toContain('void readWhatIsWaiting()')

    // The rail's list is not asked on the five seconds: what each agent is doing is pushed.
    expect(call).not.toMatch(/\brail\b|refreshResumable/)
  })
})
