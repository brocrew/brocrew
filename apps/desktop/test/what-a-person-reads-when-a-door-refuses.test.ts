import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readableError } from '../src/renderer/src/lib/session-record'

/**
 * 🔴 **427 §4 · a bridge rejection surfaced to a person goes through {@link readableError}.**
 *
 * ## ⛔ The sentence this exists to keep out of the product, measured live
 *
 * `423` F3 predicted it and could not see it. `427`'s live probe read it off a running app, from
 * two doors, in one run:
 *
 * ```
 * the + (repaired at 423)    There is already an agent called archivist. An agent's name is its
 *                            identity, so it cannot be reused — …
 * new project (unrepaired)   Error invoking remote method 'runtime:command': Error: cwd does not
 *                            exist: /private/var/folders/…/moved-away
 * ```
 *
 * ⚑ **The pair is the measurement.** One sentence is the app's; the other is the IPC library's,
 * and it names a method a person has never heard of before it gets to the fact.
 *
 * ## ⚠️ Why no existing test could have caught it, and why this one is a SOURCE census
 *
 * ⛔ **A fake bridge rejects with a plain `Error`**, so the wrapper `ipcMain.handle` adds is never
 * there to strip and every behavioural test passes with or without the fix
 * (`a-positive-assertion-must-differ-from-the-default`). The only two instruments that can see the
 * real wrapper are a live run and the source itself. §1 and §2 are the source half; the probe is
 * the other, and neither replaces the other.
 *
 * ## ⛔ The search shape, named — standing rule 4
 *
 * **What this could have found, and did:** inside a `catch (<id>) { … }` block anywhere in the
 * renderer, three spellings put the library's words in front of a person —
 *
 *  1. `<id>.message` (and `<id>?.message`, and `(<id> as Error).message`);
 *  2. `String(<id>)`, which on an `Error` is `"Error: <the same message>"`;
 *  3. the house idiom `<id> instanceof Error ? <id>.message : String(<id>)`, which is both at once.
 *
 * ⚑ **Scoped to catch blocks rather than to files**, because `.message` is a perfectly ordinary
 * field elsewhere in this tree — `event.message`, `catalogue.message`, `item.messageId` — and a
 * file-level grep would drown the rule in twenty true negatives
 * (`a-file-level-contains-cannot-tell-sibling-declarations-apart`).
 *
 * **What it cannot find, said out loud:** a rejection handed to a `.catch(fn)` callback rather
 * than a `catch` block, and a message that reaches a person through a variable assigned in one
 * function and read in another. §2's whole-renderer idiom scan covers the first of those for the
 * one spelling that matters; the second is not covered by anything here, and a `readableError`
 * that had to chase it would be a type system rather than a census.
 *
 * ## 🔴 The exemption class is EMPTY, and §3 is the test that says so
 *
 * ⛔ `420`'s ruling, one census over: *"an exemption list rots in one direction — a name stays on
 * it after the read that needed it is gone, and then it silently exempts a hook nobody mentions."*
 * There is exactly one legitimate raw read of `.message` in this renderer and it is the body of
 * {@link readableError} itself — which is **not inside a catch block**, so §1 does not have to
 * know about it at all, and §2 removes it by construction rather than by name.
 */

const RENDERER = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/src')

/**
 * ⚠️ **Prose is stripped before anything is asserted.** A docblock quoting the call it retired is
 * how a source census reports a phantom — `agent-store.ts` carries the sentence *"It was
 * `error.message` raw, and that is a library talking"* in a comment, and a census that read it
 * would report the file `423` fixed as the file `423` did not
 * (`a-source-census-must-strip-prose-before-it-asserts`).
 */
function withoutProse(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

function rendererSources(): { readonly path: string; readonly code: string }[] {
  return readdirSync(RENDERER, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(vue|ts)$/.test(name))
    .map((name) => ({
      path: name.replaceAll('\\', '/'),
      code: withoutProse(readFileSync(join(RENDERER, name), 'utf8')),
    }))
}

const SOURCES = rendererSources()

/** `catch (<id>)` and `catch (<id>: unknown)`, which are the two spellings in this tree. */
const CATCH = /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*(?::[^)]*)?\)\s*\{/g

/**
 * Every catch block in one file, as `{ binding, body }`.
 *
 * ⛔ **Brace-matched rather than line-sliced.** `a-fixed-width-slice-runs-into-the-next-region`:
 * a fixed number of lines after the `catch` runs into whatever follows it, so a clean handler
 * three lines long would be judged on its neighbour's code — and a long one would be judged on
 * its first third.
 */
function catchBlocksIn(code: string): { readonly binding: string; readonly body: string }[] {
  const blocks: { binding: string; body: string }[] = []
  for (const found of code.matchAll(CATCH)) {
    // ⛔ **A match with no binding is a STOP too.** `noUncheckedIndexedAccess` makes the capture
    // `string | undefined`, and the honest reading of `undefined` here is *the pattern changed and
    // stopped capturing* — which would hand every rule below an empty name to build a regex from.
    if (found[1] === undefined) {
      throw new Error('the catch pattern matched without capturing a binding')
    }
    const open = found.index + found[0].length - 1
    let depth = 0
    let end = -1
    for (let at = open; at < code.length; at += 1) {
      if (code[at] === '{') depth += 1
      else if (code[at] === '}') {
        depth -= 1
        if (depth === 0) {
          end = at
          break
        }
      }
    }
    // ⛔ **An unparsable handler is a STOP, not an empty body.** The first version fell back to
    // `end = open`, which yields `''` — and an empty body satisfies every rule below, so a catch
    // whose braces this counter could not follow (a string literal holding a lone `}`, say) would
    // have read as clean. ⚑ Measured at `427`: 31 blocks in the renderer, none unclosed, longest
    // 214 characters — so a throw here is a real stop rather than a routine one.
    if (end === -1) {
      throw new Error(`a catch block in this source has no closing brace this reader can find`)
    }
    blocks.push({ binding: found[1], body: code.slice(open + 1, end) })
  }
  return blocks
}

/** The three spellings, built from the binding so the rule cannot be satisfied by a neighbour. */
function libraryWordsIn(binding: string, body: string): string[] {
  const id = binding.replace(/[$]/g, '\\$')
  const found: string[] = []
  if (new RegExp(`\\b${id}\\s*\\??\\.message\\b`).test(body)) found.push(`${binding}.message`)
  if (new RegExp(`\\(\\s*${id}\\s+as\\s+Error\\s*\\)\\s*\\.message`).test(body)) {
    found.push(`(${binding} as Error).message`)
  }
  if (new RegExp(`\\bString\\(\\s*${id}\\s*\\)`).test(body)) found.push(`String(${binding})`)
  return found
}

/** Where the whole house idiom appears, whatever the binding is called. */
const HOUSE_IDIOM = /\b([A-Za-z_$][\w$]*) instanceof Error \? \1\.message : String\(\1\)/g

/**
 * ⛔ **`readableError`'s own body, removed by CONSTRUCTION.** It is the one place the raw read
 * belongs — it is the implementation — and naming the file in a list would be an exemption that
 * outlives whatever moves. Brace-matched from the declaration, so a rename of the file, a move
 * within it, or a second function beside it all keep working; a rename of the FUNCTION makes this
 * find nothing to strip and §2 goes red, which is the right answer.
 */
function withoutTheImplementation(code: string): string {
  const at = code.indexOf('export function readableError(')
  if (at === -1) return code
  const open = code.indexOf('{', at)
  let depth = 0
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1
    else if (code[i] === '}') {
      depth -= 1
      if (depth === 0) return code.slice(0, at) + code.slice(i + 1)
    }
  }
  return code
}

/* ── §0 · the reader can see each shape, and does not see the repaired one ─────────────────── */

const PLANTED = {
  dotMessage: `
    try { await window.api.runtime.createProject(x) } catch (cause) {
      refusal.value = cause.message
    }`,
  optionalChain: `
    try { await go() } catch (cause: unknown) {
      refusal.value = cause?.message ?? 'something'
    }`,
  castThenMessage: `
    try { await go() } catch (cause) {
      refusal.value = (cause as Error).message
    }`,
  stringified: `
    try { await go() } catch (cause) {
      refusal.value = String(cause)
    }`,
  houseIdiom: `
    try { await go() } catch (error) {
      refusal.value = error instanceof Error ? error.message : String(error)
    }`,
  repaired: `
    try { await go() } catch (cause) {
      refusal.value = readableError(cause)
    }`,
  /**
   * ⚠️ **A neighbouring binding, which is the trap this rule is built to survive.** The catch
   * holds `cause`; the `.message` belongs to an EVENT. A file-level or block-level grep for
   * `.message` calls this a violation and the rule starts failing correct code
   * (`an-assertion-can-be-satisfied-by-a-neighbouring-element`).
   */
  neighbour: `
    try { await go() } catch (cause) {
      refusal.value = readableError(cause)
      log(event.message)
    }`,
  /** ⚠️ A handler long enough that a fixed-width slice would stop before the offence. */
  late: `
    try { await go() } catch (cause) {
      a()
      b()
      c()
      d()
      e()
      f()
      g()
      refusal.value = cause.message
    }`,
}

describe('427 §4 · §0 the reader finds each shape it claims to find', () => {
  const reasonsIn = (code: string): string[] =>
    catchBlocksIn(code).flatMap((block) => libraryWordsIn(block.binding, block.body))

  it.each([
    ['a plain .message read', PLANTED.dotMessage, 'cause.message'],
    ['an optional chain', PLANTED.optionalChain, 'cause.message'],
    ['a cast then .message', PLANTED.castThenMessage, '(cause as Error).message'],
    ['a bare String()', PLANTED.stringified, 'String(cause)'],
    ['the house idiom', PLANTED.houseIdiom, 'error.message'],
    ['an offence past a fixed-width slice', PLANTED.late, 'cause.message'],
  ])('⛔ finds %s', (_what, planted, expected) => {
    expect(reasonsIn(planted)).toContain(expected)
  })

  it('✅ finds nothing in a handler that goes through readableError', () => {
    expect(reasonsIn(PLANTED.repaired)).toEqual([])
  })

  it('⚠️ is not satisfied by a neighbouring binding that legitimately has a .message', () => {
    expect(reasonsIn(PLANTED.neighbour)).toEqual([])
  })

  it('⛔ the house idiom is found wherever it is, and by its own shape', () => {
    expect([...PLANTED.houseIdiom.matchAll(HOUSE_IDIOM)].map((m) => m[1])).toEqual(['error'])
    // …and a MIXED pair of bindings is not the idiom — the back-reference is what makes it one.
    expect([...'a instanceof Error ? b.message : String(a)'.matchAll(HOUSE_IDIOM)]).toEqual([])
  })

  /**
   * ⚠️ **The strip carries no rule against the tree as it stands, and the fixture is why it stays.**
   * Measured at `427`: with prose-stripping ON and OFF, the renderer yields the same zero
   * offences — there is no docblock in it quoting a catch's `.message` today. ⛔ So the rule is
   * insurance, and insurance with no test is a line no mutation can kill
   * (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚑ Planted here instead, where it can
   * fail: the very next comment explaining *why* a handler stopped reading `.message` would put a
   * phantom offence in front of whoever wrote it.
   */
  it('⛔ prose is stripped on the way in — docblock, line comment and markup alike', () => {
    const doc = '/**\n * catch (cause) { refusal = cause.message }\n */'
    const line = '// refusal = error instanceof Error ? error.message : String(error)'
    const markup = '<!-- catch (cause) { refusal = String(cause) } -->'
    expect(withoutProse([doc, line, markup].join('\n')).trim()).toBe('')
    // ⚠️ …and the paired positive, so a stripper that ate everything would not pass: real code
    // beside the prose survives, and is still seen by the rules above.
    const kept = withoutProse(
      [line, 'try { go() } catch (cause) { say(cause.message) }'].join('\n'),
    )
    expect(kept).toContain('try {')
    expect(
      catchBlocksIn(kept).flatMap((block) => libraryWordsIn(block.binding, block.body)),
    ).toEqual(['cause.message'])
  })

  it('⛔ withoutTheImplementation removes readableError and nothing else', () => {
    const both = `export function readableError(e: unknown) {\n  return e instanceof Error ? e.message : String(e)\n}\nexport function other(e: unknown) {\n  return e instanceof Error ? e.message : String(e)\n}\n`
    const left = withoutTheImplementation(both)
    expect(left).not.toContain('readableError')
    expect([...left.matchAll(HOUSE_IDIOM)]).toHaveLength(1)
  })
})

/* ── §1 · the renderer, in full ─────────────────────────────────────────────────────────────── */

describe('427 §4 · §1 no catch block in the renderer hands a person the IPC library’s words', () => {
  it('⛔ the census really read the renderer', () => {
    // ⛔ **The floors are the address, not the answer** (`hook-reach.test.mjs`'s rule). An empty
    // read is what a moved directory looks like AND what a clean tree looks like, and the two must
    // not be one green.
    expect(SOURCES.length, 'no renderer sources were read at all').toBeGreaterThan(100)
    const blocks = SOURCES.flatMap((one) => catchBlocksIn(one.code))
    // ⚠️ **A floor, deliberately well under the real number.** Measured at `427`: 31. A floor of
    // 30 would go red the day somebody deletes one handler, for a reason that has nothing to do
    // with this rule — `the floors are the address, not the answer`.
    expect(blocks.length, 'no catch block was parsed out of the renderer').toBeGreaterThan(20)
    // ⚠️ **And the bindings are really bindings** — a broken regex that matched `catch` and
    // captured nothing would give thirty blocks with empty names and every rule below would pass.
    expect(blocks.every((block) => /^[A-Za-z_$][\w$]*$/.test(block.binding))).toBe(true)
  })

  it('🔴 every caught rejection reaches a person through readableError', () => {
    const offences = SOURCES.flatMap((one) =>
      catchBlocksIn(one.code).flatMap((block) =>
        libraryWordsIn(block.binding, block.body).map((what) => `${one.path}: ${what}`),
      ),
    ).sort()
    expect(
      offences,
      `these handlers put Electron's "Error invoking remote method 'runtime:command': …" in ` +
        `front of a person. Route the caught value through readableError(…) from ` +
        `renderer/src/lib/session-record.ts.`,
    ).toEqual([])
  })
})

/* ── §2 · the idiom, wherever it is, not only in a catch ───────────────────────────────────── */

describe('427 §4 · §2 the house idiom lives in exactly one place', () => {
  it('🔴 nothing but readableError itself turns a thrown value into text by hand', () => {
    const elsewhere = SOURCES.flatMap((one) =>
      [...withoutTheImplementation(one.code).matchAll(HOUSE_IDIOM)].map(
        (m) => `${one.path}: ${m[1]}`,
      ),
    ).sort()
    expect(
      elsewhere,
      `"<e> instanceof Error ? <e>.message : String(<e>)" is readableError's body. A second ` +
        `copy is a second answer to one question, and the copy is the one that will not strip ` +
        `the wrapper the day somebody changes it.`,
    ).toEqual([])
  })

  it('⛔ and the implementation is still there to have been removed', () => {
    const record = SOURCES.find((one) => one.path.endsWith('lib/session-record.ts'))
    expect(record, 'session-record.ts was not read').toBeDefined()
    // ⚑ **Non-vacuity for the construction above.** If `readableError` is renamed or moved,
    // `withoutTheImplementation` strips nothing, §2 goes red, and this says which of the two
    // happened.
    expect([...(record?.code.matchAll(HOUSE_IDIOM) ?? [])]).toHaveLength(1)
  })
})

/* ── §3 · and it strips the wrapper a running app really produces ──────────────────────────── */

describe('427 §4 · §3 the wrapper, as a live app writes it', () => {
  /**
   * 🔴 **Measured, not invented.** These are the exact strings `427`'s `probe:two-doors` read off
   * the renderer of a running build — the reason this dispatch exists is that no fake bridge in
   * this repo produces them.
   */
  const LIVE = [
    "Error invoking remote method 'runtime:command': Error: cwd does not exist: /private/var/folders/2k/x/T/b2-doors-work-XfKaiF/moved-away",
    "Error invoking remote method 'runtime:command': Error: There is already an agent called archivist. An agent's name is its identity, so it cannot be reused — and names are compared without case, because a profile is its folder.",
  ] as const

  it('🔴 strips both halves of the wrapper — the method and the class name', () => {
    expect(readableError(new Error(LIVE[0]))).toBe(
      'cwd does not exist: /private/var/folders/2k/x/T/b2-doors-work-XfKaiF/moved-away',
    )
    expect(readableError(new Error(LIVE[1]))).toBe(
      "There is already an agent called archivist. An agent's name is its identity, so it cannot " +
        'be reused — and names are compared without case, because a profile is its folder.',
    )
  })

  it('⚠️ the control: a message that never went through the wire is left exactly alone', () => {
    // ⛔ Without this the test above passes for a `readableError` that returns `''`, and passes
    // for one that strips the first colon-delimited clause of every sentence in the app.
    const ours = 'There is no project called default.'
    expect(readableError(new Error(ours))).toBe(ours)
    expect(readableError(ours)).toBe(ours)
  })
})
