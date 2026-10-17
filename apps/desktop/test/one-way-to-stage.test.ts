import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyDroppedPaths,
  classifyHandedPath,
  tooManyDropped,
} from '../src/main/runtime/handed-path'
import { MAX_HANDED_PATHS } from '../src/shared/runtime-ipc'

/**
 * # ⛔ One implementation across picker and drop (218, acceptance 7)
 *
 * The dispatch: *"216 built the picker, the chip, remove-before-send, the refusal path and the
 * outside-cwd marker. 217 put them on the launcher and made them one implementation. Drop is a third
 * way to reach the SAME model. Do not add a fourth code path."* — and then: ⚠️ ***"say how a third
 * path cannot appear."***
 *
 * ## The answer, in two halves
 *
 * **In MAIN**, what a path IS has exactly one decider: `classifyHandedPath`. `app:choose-attachment`
 * calls it once, `app:hand-dropped-paths` calls it through {@link classifyDroppedPaths}, and
 * `recheckHandedPaths` calls it again at send time. `no-byte-authority.test.ts`'s import allowlist is
 * what keeps a fourth from growing its own: **nothing on the route may acquire a way to touch the
 * filesystem beyond the stat family**, so a hand-rolled classifier could not stat.
 *
 * **In the RENDERER**, becoming staged has exactly one writer: `commitStaged()`, which `stage()`,
 * `detach()` and `send()` all go through. That is the half this file censuses, because it is the
 * half where a "quick" second path is cheap to write — a drop handler that emitted
 * `update:attachments` itself would work, would look right, and would silently not have the dedup,
 * the ceiling, the refusal, or (since 236 §4) the pending-staged window that keeps two drops in the
 * same tick from overwriting each other.
 *
 * ⚠️ **This is a source census, and it is named as one** — `206` H1's argument and
 * `launch-carriage.test.ts`'s shape. It proves the call is written, not that it works; the DOM tests
 * are what prove the behaviour. The alternative measured honestly is nothing at all, because
 * *"nobody added a second way in"* has no observable consequence to assert.
 */

const here = dirname(fileURLToPath(import.meta.url))
const COMPOSER = join(here, '../src/renderer/src/components/PromptComposer.vue')
/**
 * ⛔ **Where the staging rules and the one writer live since 292 §2.**
 *
 * ⚠️ **They were in the composer, and that is what made `288` H2 possible**: a paste answered after
 * its composer has been torn down still has to be staged into the draft it was pasted into, and a
 * rule that lives in the component cannot be applied by anything that outlives it. The census
 * follows them rather than pretending they did not move.
 */
const DRAFTS = join(here, '../src/renderer/src/lib/drafts.ts')
const MAIN = join(here, '../src/main/index.ts')

/**
 * The file with comments removed — line comments, block comments and HTML comments.
 *
 * ⛔ **The stripper is part of the rule**, for `217`'s reason: this file's subject talks about
 * `emit('update:attachments'` in prose on purpose, and a census that counted those would report several
 * writers where there is one. ⚑ Deliberately simpler than `no-byte-authority.ts`'s: that one is
 * string-aware because it censuses whole modules; this one slices small function bodies, and its
 * non-vacuity floor below is what would catch it if the simplification ever cost something.
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

/**
 * One function's body, by the text its signature starts with, to the closing brace at column 0.
 *
 * ⚑ **ONE expression, used by the rules AND by their teeth test** — `216`'s M11 lesson: a slice that
 * silently matched nothing would leave every `not.toContain` below green over an empty string.
 */
function bodyOf(source: string, signature: string): string {
  const from = source.indexOf(signature)
  if (from === -1) return ''
  const to = source.indexOf('\n}', from)
  if (to === -1) return ''
  return source.slice(from, to)
}

/**
 * ⛔ **The channel that no longer exists, and the census keeps its name on purpose** (292 §2).
 *
 * `update:attachments` was how a staged path travelled to its owner, and Vue drops emissions from
 * an unmounted component — so the one gesture that can answer late had the one delivery mechanism
 * that stops working the moment you look at another conversation. ⚑ Kept as a rule rather than
 * deleted: a future author reaching for an emit here is reaching for the defect.
 */
const CHANNEL = "'update:attachments'"
const ADDS = `emit(${CHANNEL}`
/** The one mutation of a draft's stored list, inside the book. Everything else is a door onto it. */
const WRITES = 'attached.set('

/**
 * Whitespace collapsed, so a call broken across lines by the formatter still reads as one call.
 *
 * ⛔ **Found while writing this: `detach` emits over THREE lines**, because prettier wraps it. A
 * per-line census counted two writers where there are three and would have gone green on a fourth
 * that happened to wrap the same way. ⚠️ A census whose answer depends on line breaks is measuring
 * the formatter. ⚑ `detach` no longer emits at all as of 236 §4 — it calls `commitStaged` like the
 * other two — and this stays because the next writer to wrap is the one this would otherwise miss.
 */
function flat(source: string): string {
  // …and the space the wrap leaves after the opening bracket goes too, or `emit(\n  'update:…'`
  // collapses to `emit( 'update:…'` and still does not match the call it plainly is.
  return source.replace(/\s+/g, ' ').replace(/\(\s/g, '(')
}

/** How many times `needle` occurs in `haystack` — the count, not merely whether. */
function times(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('only one thing stages an attachment (218, acceptance 7)', () => {
  const code = codeOf(readFileSync(COMPOSER, 'utf8'))
  const drafts = codeOf(readFileSync(DRAFTS, 'utf8'))
  const book = flat(bodyOf(drafts, 'export function createAttachmentBook('))

  it('⚑ the census found real code — otherwise every rule below passes over nothing', () => {
    // Non-vacuity first. A stripper that latched, or a renamed component, would empty this file
    // silently and every assertion in it would be about a blank string.
    expect(code.length, 'the stripper returned almost nothing — it latched').toBeGreaterThan(4000)
    expect(bodyOf(code, 'async function attach(').length).toBeGreaterThan(80)
    expect(bodyOf(code, 'async function onDrop(').length).toBeGreaterThan(150)
    expect(bodyOf(code, 'async function onPaste(').length).toBeGreaterThan(150)
    expect(bodyOf(code, 'function pathsIn(').length).toBeGreaterThan(200)
    expect(bodyOf(code, 'async function classify(').length).toBeGreaterThan(80)
    // ⛔ 262 §1's primitive and the wait it feeds — sliced here so the rules below cannot pass over
    // an empty string if either is renamed.
    expect(bodyOf(code, 'async function acquire(').length).toBeGreaterThan(40)
    expect(bodyOf(code, 'async function settle(').length).toBeGreaterThan(30)
    // ⛔ 292 §1 split the press from the submission: `send` latches, `emitOnce` is the submission.
    expect(bodyOf(code, 'function send(').length).toBeGreaterThan(150)
    expect(bodyOf(code, 'async function emitOnce(').length).toBeGreaterThan(200)
    // ⛔ 292 §2 — the staging rules and the one writer, in the draft book.
    expect(drafts.length, 'the draft book stripper latched').toBeGreaterThan(2000)
    expect(bodyOf(drafts, 'export function stageVerdicts(').length).toBeGreaterThan(300)
    expect(book.length, 'createAttachmentBook moved — re-point this').toBeGreaterThan(600)
  })

  it('🔴 there is exactly ONE writer of a draft\u2019s staged list, and no more (292 §2)', () => {
    // ⛔ **The composer no longer writes at all** — it asks the transaction to. The old emit is the
    // rule's own tell: a gesture that reached for `emit('update:attachments', …)` would be reaching
    // for a channel that silently does nothing once the composer is gone.
    expect(
      times(flat(code), CHANNEL),
      'the composer emits attachments again — the transaction is the owner now',
    ).toBe(0)
    expect(times(flat(code), ADDS)).toBe(0)
    // ⛔ **…and in the book, one mutation of the stored list.** `stage`, `acquire`'s commit and
    // `restore` are three doors; `write` is the room.
    expect(
      times(book, WRITES),
      'a second writer of the stored list appeared — write() is the only one',
    ).toBe(1)
    expect(
      flat(bodyOf(drafts, 'export function createAttachmentBook(')).indexOf(WRITES),
    ).toBeGreaterThan(0)
  })

  it('🔴 …and the ADDING one is stageVerdicts(), which the transaction reaches for every gesture', () => {
    // ⛔ **Two occurrences and no more: the declaration, and the one call inside `acquire`.** A
    // gesture applying the rules itself would work, would look right, and would be staging without
    // ever having reserved the slot that holds the send — which is 262 §1's whole defect.
    expect(
      times(flat(drafts), 'stageVerdicts('),
      'the staging rules are applied somewhere other than an acquisition',
    ).toBe(2)
    expect(book).toContain('stageVerdicts(read(key), verdicts)')
    // ⛔ **The composer does not apply them at all**, which is what makes "the draft owns this"
    // true rather than merely intended.
    expect(
      times(flat(code), 'stageVerdicts('),
      'the composer applies the staging rules itself again',
    ).toBe(0)
    // ⛔ **It computes from the DRAFT, never from a prop** (236 §4, kept). `props.attachments` was a
    // render behind, so two drops resolving in one tick both read the pre-drop list and the second
    // one's answer won — the first file staged, then silently gone.
    expect(flat(code), 'the composer went back to reading a list prop it lags').not.toContain(
      'props.attachments',
    )
    const staging = flat(bodyOf(drafts, 'export function stageVerdicts('))
    expect(staging).toContain('MAX_HANDED_PATHS')
    expect(staging).toContain('alreadyStagedAs(')
  })

  /**
   * 🔴 **The invariant `259` lens C finding 1 asked for, held here rather than at runtime** (262 §1).
   *
   * ⛔ **The reviewer's rule is *a late result must never stage into the next message*.** The
   * mechanism is that {@link send} does not emit while an acquisition is open — which makes a
   * runtime epoch stamped on each result UNREACHABLE, and a branch no call site can produce is
   * `222` §4's *word nothing can produce*. ⚑ So the two structural facts the rule rests on are
   * asserted as source instead: **every gesture goes through the one primitive**, and **`send`
   * waits above its emit**. Both are killable by a mutation; a dead comparison is not.
   */
  it('🔴 …and every gesture reserves its slot through acquire(), which is the DRAFT\u2019s (262 §1, 292 §2)', () => {
    // ⛔ The composer's `acquire` and `settle` are one line each and both delegate — so the state
    // that decides whether a send waits belongs to the conversation, not to this mount.
    expect(flat(bodyOf(code, 'async function acquire('))).toContain('props.handing.acquire(work)')
    expect(flat(bodyOf(code, 'async function settle('))).toContain('props.handing.settle()')
    // ⚑ …and all three gestures ask for one. `attach` is included deliberately: a picker can stand
    // open for a minute, so it is the LIKELIEST instance of the defect rather than the rarest.
    for (const signature of [
      'async function attach(',
      'async function onDrop(',
      'async function onPaste(',
    ]) {
      const gesture = flat(bodyOf(code, signature))
      expect(gesture, `${signature} does not reserve a slot`).toContain('acquire(')
      expect(gesture, `${signature} stages without going through acquire()`).not.toContain(
        '.stage(',
      )
    }
  })

  it('🔴 …and every operation is STAMPED with the draft it was started for (292 §2)', () => {
    // ⛔ **This is the whole of `288` H2.** The composer is keyed by session id, so a conversation
    // switch tears it down while the bridge call is still in flight. An operation that committed to
    // "whatever draft is on screen" would put A's screenshot on B; one that committed through the
    // component would reach nothing at all, which is what was measured.
    expect(book).toContain('write(key, next)')
    expect(book).toContain('refuse(key, refusal)')
    // ⛔ …and a slot swept while its work was in flight is not resurrected by the answer.
    expect(book, 'a late answer can recreate a conversation that was closed').toContain(
      'if (!open.has(key)) return',
    )
  })

  it('🔴 …and send() waits for them ABOVE its emit, not after it (262 §1)', () => {
    const sending = flat(bodyOf(code, 'async function emitOnce('))
    // ⛔ The wait itself. Without it `send` reads an empty `staged`, emits the text-only turn, and
    // the screenshot lands on the message after.
    expect(sending, 'send() no longer waits for this draft\u2019s attachments').toContain(
      'if (acquiringNow.value) await settle()',
    )
    // ⛔ **ORDER, not merely presence.** A wait written below the emit would satisfy a `toContain`
    // and change nothing at all — the message would already have gone.
    const waits = sending.indexOf('await settle()')
    const emits = sending.indexOf("emit('send'")
    expect(emits, 'send() no longer emits — the slice is measuring nothing').toBeGreaterThan(0)
    expect(waits, 'the wait moved BELOW the emit, which is no wait at all').toBeLessThan(emits)
    // ⚠️ **…and above `canSend` too.** With an empty box and a screenshot still being written there
    // is nothing for `canSend` to say yes to, so a press would be dropped in silence.
    expect(waits).toBeLessThan(sending.indexOf('if (!canSend('))
  })

  it('🔴 …and the press that starts the wait LATCHES before it (292 §1)', () => {
    // 🔴 **`288` H1: the wait is the window.** Two presses both reached `await settle()` and both
    // came back; the second read a draft the parent had not patched yet and emitted the same words
    // again, without the attachment. ⛔ The latch has to be set with no `await` between reading it
    // and setting it, which is why `send` is not an async function at all — one `await` above the
    // assignment and the guarantee is gone while the code still reads as if it holds.
    const latch = flat(bodyOf(code, 'function send('))
    expect(latch).toContain('const already = sending.value')
    expect(latch, 'a second press starts a second continuation again').toContain(
      'return already.run',
    )
    expect(latch).toContain('sending.value = latch')
    expect(latch, 'send() awaits before it latches — the window is back').not.toContain('await ')
    // ⚑ …and it is released when the submission has emitted or refused, never before.
    expect(latch).toContain('sending.value = null')
    // ⛔ **The submission reads the LATCH's intent, not the argument it was first called with** —
    // otherwise a ⇧⌘↵ that arrives during the wait is a gesture that quietly did nothing (106).
    expect(flat(bodyOf(code, 'async function emitOnce('))).toContain(
      'sendIntentFor(props.state, latch.interrupting)',
    )
  })

  it('🔴 the PASTE decides nothing either — it asks main for the path AND for the bytes (254 §2)', () => {
    // ⚠️ **The paste is the one gesture that could have gone wrong in two directions at once.** It
    // could classify for itself, like the drop nearly did (`197`'s two classifiers) — and it could
    // read the bytes, which nothing before it was even able to do.
    const paste = flat(bodyOf(code, 'async function onPaste('))
    // ⛔ **A file COPIED in Finder has a real path: it is a drop by another gesture** — through the
    // SAME resolution the drop uses, so BroBot writes no copy of a file that already exists.
    // ⚑ **One copy of those eleven lines, and `216`'s own table is what found the duplicate**: three
    // rows protecting `onDrop` began matching in two places the moment the paste was written.
    expect(paste).toContain('pathsIn(pasted)')
    expect(paste).toContain('classify(paths)')
    expect(flat(bodyOf(code, 'async function onDrop('))).toContain('pathsIn(dropped)')
    const resolving = flat(bodyOf(code, 'function pathsIn('))
    expect(resolving).toContain('window.api.pathForDroppedFile')
    const asking = flat(bodyOf(code, 'async function classify('))
    expect(asking).toContain('window.api.handDroppedPaths')
    expect(asking).toContain('cwd: props.cwd')
    // ⛔ **The split is the fix for an ORDERING defect, not tidiness** (254, from the review). The
    // paste needs the pathless count BEFORE it asks main to look at the clipboard: with the path
    // round trip first, a `handDroppedPaths` that took seconds on a stalled mount left a window in
    // which something else could reach the pasteboard, and main would write and stage THAT.
    expect(paste.indexOf('pasteImage')).toBeLessThan(paste.indexOf('classify(paths)'))
    // ⛔ …and a picture with no path behind it is MAIN's to look at, never the renderer's.
    expect(paste).toContain('window.api.pasteImage')
    for (const guess of ['kind:', 'outsideCwd', 'arrayBuffer', 'FileReader', 'startsWith(']) {
      expect(paste, `the paste is deciding "${guess}" for itself`).not.toContain(guess)
      expect(resolving, `path resolution is deciding "${guess}" for itself`).not.toContain(guess)
    }
    // 🔒 **The default is NOT prevented, and that is a decision** (254 §2): a clipboard carrying an
    // image AND text would lose the text, and a textarea ignores an image on its own anyway.
    expect(
      code,
      'the paste swallows the event — the words on the clipboard would be lost',
    ).toContain('@paste="onPaste"')
    expect(paste).not.toContain('preventDefault')
    // ⛔ **…and it does NOT return on the ceiling** (292 §4, from `288` M3). `canStage` folds the
    // ceiling into "can this surface attach at all", so at ten staged the whole gesture vanished:
    // no write (right), no chip, no refusal, and no text either. The ceiling is answered by the
    // rules below it, out loud.
    expect(paste, 'the paste is silent again at the ceiling — 288 M3').not.toContain(
      'if (!canStage.value) return',
    )
    expect(paste).toContain('if (!props.canAttach || !canType.value) return')
  })

  it('🔴 the drop decides NOTHING about what a path is — it asks main, like the picker does', () => {
    // ⚠️ This is the rule that keeps `197`'s two-classifiers defect from happening a third time.
    // A drop that read `kind` off the `File`'s mime type, or guessed `outsideCwd` by string
    // prefix, would work for the common case and disagree with the send-time re-check.
    const drop = flat(bodyOf(code, 'async function onDrop('))
    // ⚑ **Through the shared resolution since 254 §2** — the drop and the paste ask main the same
    // question, in one place, so there is no second `cwd` to forget and no second `''` to mishandle.
    expect(drop).toContain('pathsIn(dropped)')
    expect(drop).toContain('classify(paths)')
    const asking = flat(bodyOf(code, 'async function classify('))
    expect(asking).toContain('window.api.handDroppedPaths')
    expect(asking).toContain('cwd: props.cwd')
    for (const guess of ['kind:', 'outsideCwd', 'startsWith(', 'endsWith(']) {
      expect(drop, `the drop is deciding "${guess}" for itself`).not.toContain(guess)
      expect(asking, `the door to main is deciding "${guess}" for itself`).not.toContain(guess)
      expect(
        flat(bodyOf(code, 'function pathsIn(')),
        `path resolution is deciding "${guess}" for itself`,
      ).not.toContain(guess)
    }
  })

  it('⛔ both gestures are gated by ONE predicate, so neither can act where the other cannot', () => {
    // A composer that greys the paperclip and still accepts a drop is two answers to the same
    // question. `canStage` is the answer; the button's `:disabled` and both drag handlers read it.
    expect(code).toContain('const canStage = computed(')
    expect(code).toContain(':disabled="!canStage"')
    expect(bodyOf(code, 'function onDragEnter(')).toContain('canStage.value')
    expect(bodyOf(code, 'function onDragOver(')).toContain('canStage.value')
    expect(bodyOf(code, 'async function onDrop(')).toContain('canStage.value')
  })

  it('⛔ main has three doors onto the classifier, and all three call the same function', () => {
    // ⚑ **Three since 254 §2 — and the third one is still not a third RULE.** The paste writes a
    // file that did not exist and then asks `classifyHandedPath` about it like everything else, so
    // what a path IS still has exactly one decider in main.
    const main = codeOf(readFileSync(MAIN, 'utf8'))
    const picker = main.slice(
      main.indexOf("'app:choose-attachment'"),
      main.indexOf("'app:classify-attachments'"),
    )
    const drop = main.slice(
      main.indexOf("'app:hand-dropped-paths'"),
      main.indexOf("'app:paste-image'"),
    )
    const paste = main.slice(
      main.indexOf("'app:paste-image'"),
      main.indexOf('registerRuntimeIpc({'),
    )
    expect(picker.length, 'the choose-attachment handler moved — re-point this').toBeGreaterThan(
      100,
    )
    expect(drop.length, 'the hand-dropped-paths handler moved — re-point this').toBeGreaterThan(100)
    expect(paste.length, 'the paste-image handler moved — re-point this').toBeGreaterThan(100)
    expect(picker).toContain('classifyHandedPath')
    expect(drop).toContain('classifyDroppedPaths')
    // ⛔ **The paste does not classify inline** — it hands the bytes to the module that writes them
    // down, and THAT module ends in the same classifier (`no-byte-authority.test.ts` pins it).
    expect(paste).toContain('pastePicture(')
    // ⛔ **And neither the drop nor the paste opens a dialog.** A native sheet in the middle of a
    // drag — or after a ⌘V — would be a gesture answering itself with another gesture.
    expect(drop).not.toContain('showOpenDialog')
    expect(paste).not.toContain('showOpenDialog')
  })
})

describe('the rule has teeth (218)', () => {
  it('🔴 a planted second writer IS caught, through the same slice the rules use', () => {
    // ⛔ Every assertion above is a string search, and a slice that came back empty would satisfy
    // the negative ones while silently failing to check the positives. This runs the same helpers
    // over source that has the defect and requires it to be visible.
    const defective = [
      'async function onDrop(event) {',
      '  const path = window.api.pathForDroppedFile(file)',
      "  emit('update:attachments', [...props.attachments, { path, kind: 'file' }])",
      '}',
    ].join('\n')
    const planted = codeOf(defective)
    expect(flat(bodyOf(planted, 'async function onDrop('))).toContain(ADDS)
    expect(bodyOf(planted, 'async function onDrop(')).toContain('kind:')
    expect(times(flat(planted), CHANNEL)).toBe(1)

    // ⛔ **…and the 292 §2 shape of the same defect: a gesture that stages for itself**, skipping
    // the reservation that holds the send. It emits nothing, so the rule above would not see it.
    const own = codeOf(
      [
        'async function onPaste(event) {',
        '  const verdicts = await window.api.pasteImage({})',
        '  props.handing.stage([...staged.value, verdicts.handed])',
        '}',
      ].join('\n'),
    )
    const gesture = flat(bodyOf(own, 'async function onPaste('))
    expect(gesture).toContain('.stage(')
    expect(
      gesture,
      'a gesture that stages for itself must not look like it reserved',
    ).not.toContain('acquire(')

    // ⛔ **…and the 292 §1 shape: a send that awaits before it latches.** The latch is still there,
    // the code still reads as single-flight, and the window is wide open.
    const late = codeOf(
      [
        'async function send(interrupting = false) {',
        '  await settle()',
        '  const already = sending.value',
        '  if (already !== null) return already.run',
        '}',
      ].join('\n'),
    )
    expect(flat(bodyOf(late, 'function send('))).toContain('await ')

    // ⛔ **And it is caught when the formatter WRAPS it**, which is how the first version of this
    // census missed `detach` entirely: three lines, one call, zero matches per-line.
    const wrapped = codeOf(
      [
        'async function onDrop(event) {',
        '  emit(',
        "    'update:attachments',",
        '    next,',
        '  )',
        '}',
      ].join('\n'),
    )
    expect(flat(bodyOf(wrapped, 'async function onDrop('))).toContain(ADDS)

    // ⛔ …and PROSE cannot satisfy or break a rule, which is what the stripper is for. Both a line
    // comment and an HTML comment, because this file censuses a `.vue`.
    const prosey = [
      'async function onDrop(event) {',
      "  // never emit('update:attachments', …) here — the draft owns it",
      '  acquire(work)',
      '}',
      "<!-- emit('update:attachments', …) in a template comment is prose too -->",
    ].join('\n')
    const stripped = codeOf(prosey)
    expect(flat(stripped)).not.toContain(CHANNEL)
    expect(bodyOf(stripped, 'async function onDrop(')).toContain('acquire(')

    // ⚑ …and a missing function yields an EMPTY slice rather than a passing one.
    expect(bodyOf('const nothing = 1\n', 'async function onDrop(')).toBe('')
  })
})

/**
 * ⛔ **The drop's own classifier** (218 §2/§3) — against a real filesystem, because the rule it
 * enforces is a rule about one.
 */
describe('classifying paths that arrived by drop (218 §2/§3)', () => {
  let scratch = ''

  afterEach(() => {
    if (scratch !== '') rmSync(scratch, { recursive: true, force: true })
    scratch = ''
  })

  function tree(): { root: string; file: string; folder: string } {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-drop-')))
    const folder = join(scratch, 'src')
    mkdirSync(folder)
    writeFileSync(join(folder, 'one.ts'), 'a')
    writeFileSync(join(folder, 'two.ts'), 'b')
    const file = join(scratch, 'notes.md')
    writeFileSync(file, 'hello')
    return { root: scratch, file, folder }
  }

  it('🔴 a dropped FOLDER is ONE path — not enumerated, not expanded, not counted (§3)', async () => {
    // ⛔ The dispatch is explicit. `215`'s whole choice was that the AGENT looks inside, with its
    // own tools, behind its own permission card — so a folder with two files in it is one chip.
    const { root, folder } = tree()

    const verdicts = await classifyDroppedPaths([folder], root)

    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toEqual({
      handed: { path: folder, kind: 'directory', outsideCwd: false },
    })
    // ⚑ The paired positive that makes "not counted" mean something: the folder really does have
    // things in it, so a version that walked it would have returned more than one.
    expect((await classifyDroppedPaths([join(folder, 'one.ts')], root))[0]).toHaveProperty('handed')
  })

  it('🔴 several dropped paths get several answers, in the order they were dropped', async () => {
    const { root, file, folder } = tree()

    const verdicts = await classifyDroppedPaths([file, folder], root)

    expect(verdicts.map((each) => ('handed' in each ? each.handed.kind : 'refused'))).toEqual([
      'file',
      'directory',
    ])
  })

  it('⛔ one answer PER path, refusals included — so the reply matches the request', async () => {
    // ⚠️ The caller shows one sentence per thing that could not be taken, and a verdict list that
    // silently shrank would leave a dropped file with no chip and no explanation.
    const { root, file } = tree()

    const verdicts = await classifyDroppedPaths([file, join(root, 'gone.md')], root)

    expect(verdicts).toHaveLength(2)
    expect(verdicts[0]).toHaveProperty('handed')
    expect(verdicts[1]).toEqual({ refusal: `there is nothing at ${join(root, 'gone.md')}` })
  })

  it('⛔ it is the PICKER’s rule, applied to a list — a dangling symlink says the same thing', async () => {
    // Acceptance 7 at the level that matters: the sentence a person reads for a broken shortcut is
    // the same one whether they picked it or dropped it, because it comes from the same function.
    const { root } = tree()
    const dangling = join(root, 'shortcut')
    symlinkSync(join(root, 'never-existed'), dangling)

    expect(await classifyDroppedPaths([dangling], root)).toEqual([
      { refusal: `that is a shortcut pointing at something that is not there: ${dangling}` },
    ])
  })

  it('⛔ a relative path is refused rather than resolved against main’s own cwd', async () => {
    // `217`'s review found this: single-argument `resolve` bases on the MAIN PROCESS's directory,
    // never on the session's, so a renderer sending `.env` got a real file classified and disclosed
    // as "attached by the user". A drop is exactly where an unexpected string could arrive.
    const { root } = tree()

    expect(await classifyDroppedPaths(['.env'], root)).toEqual([
      { refusal: 'that is not a full path, so there is no saying what it points at: .env' },
    ])
  })

  it('⛔ nothing that could never be a path reaches the classifier at all', async () => {
    // ⚠️ Dropped SILENTLY, unlike a refusal: an empty string, a number and a 5,000-character path
    // are not things a person did, they are things a wire produced. There is no sentence to show.
    const { root, file } = tree()

    const verdicts = await classifyDroppedPaths(
      ['', null, 42, { path: file }, 'x'.repeat(5000), file],
      root,
    )

    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toHaveProperty('handed')
  })

  it('⛔ the READ is bounded, so a drop of a thousand files is not a thousand stats', async () => {
    const { root, file } = tree()
    const many = Array.from({ length: MAX_HANDED_PATHS + 7 }, () => file)

    const verdicts = await classifyDroppedPaths(many, root)

    // ⛔ **The bound on the WORK is unchanged**: exactly ten were stat'd, whatever was dropped.
    expect(verdicts.filter((each) => 'handed' in each)).toHaveLength(MAX_HANDED_PATHS)
  })

  it('🔴 …and the ones it did not look at are SAID, not silently dropped (232 §3)', async () => {
    // ⚠️ **`227` MEDIUM 5, measured**: eleven files on an empty composer produced ten chips and the
    // eleventh vanished with no verdict, no sentence and nothing on screen that had changed. ⛔ The
    // composer's own ceiling refusal could not fire for it either — that one counts ACCEPTED
    // verdicts against the remaining slots, and a path with no verdict is a path it never counts.
    // ⚑ `106`: a cap is fine, a silent cap is not.
    const { root, file } = tree()
    const many = Array.from({ length: MAX_HANDED_PATHS + 7 }, () => file)

    const verdicts = await classifyDroppedPaths(many, root)

    expect(verdicts).toHaveLength(MAX_HANDED_PATHS + 1)
    expect(verdicts.at(-1)).toEqual({ refusal: tooManyDropped(7) })
    // …and it counts what was actually left over, rather than saying "some".
    expect(await classifyDroppedPaths([file, file], root)).toHaveLength(2)
  })

  it('⛔ it says OUTSIDE, and the caption is the message’s, not a permission', async () => {
    // 🔒 Outside is not refused — the person chose it, and that is consent (215). What it must not
    // be is silent.
    const { root, file } = tree()
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-elsewhere-')))
    try {
      const verdicts = await classifyDroppedPaths([file], elsewhere)
      expect(verdicts[0]).toEqual({ handed: { path: file, kind: 'file', outsideCwd: true } })
      // ⚑ The paired positive: against its own root the same path is inside, or "outside" would be
      // a constant rather than an answer.
      expect((await classifyDroppedPaths([file], root))[0]).toEqual({
        handed: { path: file, kind: 'file', outsideCwd: false },
      })
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})

/**
 * # ⛔ Two spellings of one folder are one attachment (221 §5)
 *
 * ⚠️ **`220` staged the same directory twice and got two chips.** It dropped
 * `/tmp/…/folder-drop` on the window and picked `/private/tmp/…/folder-drop` from the sheet — one
 * directory, two strings, **two chips with the same visible label**, and both were sent to the model
 * as separate attachments. `PromptComposer.stage` deduplicates on `path` and was right to; it had
 * been handed two different strings for one thing.
 *
 * ⛔ **This is the `/tmp` vs `/private/tmp` family again**, which broke live assertions in `176`,
 * `178` and `179` *after* `170` had spent a whole dispatch on path resolution — and it is why the
 * fixtures in this file now real-resolve their own temp root. Seven tests across four files turned
 * red on the fix, every one of them because `mkdtempSync(tmpdir())` hands back the alias.
 *
 * ⚑ **The resolution was always happening and was thrown away.** `describeKind` calls `realpathSync`
 * to answer file-vs-directory, and `outsideWorkingDirectory` real-resolves both sides before
 * comparing — so `outsideCwd` was a fact about the real path while `path` was a fact about the
 * spelling. `classifyHandedPath` now returns the one it already had.
 */
describe('one directory, however it was spelled (221 §5)', () => {
  let scratch = ''

  afterEach(() => {
    if (scratch !== '') rmSync(scratch, { recursive: true, force: true })
    scratch = ''
  })

  it('🔴 an alias and its target classify to the SAME path — so one chip, not two', async () => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-alias-')))
    const real = join(scratch, 'folder-drop')
    mkdirSync(real)
    // The alias, built the way macOS builds `/tmp`: a symlink standing in front of a real directory.
    const alias = join(scratch, 'shortcut')
    symlinkSync(real, alias)

    const dropped = (await classifyDroppedPaths([alias], scratch))[0]
    const picked = await classifyHandedPath(real, scratch)

    // ⛔ The property: the two GESTURES that reached one directory produce one string.
    expect(dropped).toEqual({ handed: { path: real, kind: 'directory', outsideCwd: false } })
    expect(picked).toEqual(dropped)
    // …which is what makes `stage`'s `next.some((each) => each.path === …)` collapse them, and what
    // `drop-to-attach.dom.test.ts`'s "dropping something already attached does not attach it twice"
    // has been asserting over identical strings all along.
  })

  it('⚑ …and two genuinely different things stay two — the paired positive', async () => {
    // ⚠️ Without this, a `classifyHandedPath` that returned a constant would satisfy the test above.
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-alias-')))
    const first = join(scratch, 'a.md')
    const second = join(scratch, 'b.md')
    writeFileSync(first, '1')
    writeFileSync(second, '2')

    const verdicts = await classifyDroppedPaths([first, second], scratch)

    expect(verdicts.map((each) => ('handed' in each ? each.handed.path : 'refused'))).toEqual([
      first,
      second,
    ])
  })

  it('⛔ a symlinked FILE is handed over as what it really is, and the label agrees with it', async () => {
    // ⚠️ **The half that was already inconsistent.** `outsideCwd` has always been computed on the
    // resolved path, so a link INSIDE the working directory pointing outside it was labelled
    // "outside" while the chip showed a path plainly inside. The two say the same thing now.
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-alias-')))
    const work = join(scratch, 'work')
    const away = join(scratch, 'away')
    mkdirSync(work)
    mkdirSync(away)
    const target = join(away, 'secret.md')
    writeFileSync(target, 'x')
    const inside = join(work, 'looks-local.md')
    symlinkSync(target, inside)

    expect(await classifyHandedPath(inside, work)).toEqual({
      handed: { path: target, kind: 'file', outsideCwd: true },
    })
  })
})
