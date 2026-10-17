import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * # ⛔ The launch carries the paths, and hands them back — as a RULE (217 §1/§2)
 *
 * `013` makes the launcher's prompt the FIRST message, and `RuntimeScreen.start` is the four lines
 * that decide what that message is made of: the two commands it issues, and the two ways it can
 * fail. ⚠️ **Every one of those lines used to drop the attachments**, which is the whole of why a
 * conversation could not begin with a file.
 *
 * ⛔ **And every one of them is UNREACHABLE from a test.** Nothing in this repository mounts
 * `RuntimeScreen` — `211` §11 item 2, `212` §9 item 4 and `214` §8 item 6 each named that gap, and
 * a `216` mutation survived its table on exactly it. ⚑ **Where a rule could be moved somewhere
 * reachable, `217` moved it**: `liveDraftSlots` and `drafts.restore` are ordinary functions with
 * ordinary tests. What cannot be moved is the CARRIAGE itself — passing an argument at a call site
 * is not a rule you can extract, it is the call.
 *
 * ⚠️ **So the check moves to where it CAN be exact: the source.** That is `206` H1's own argument
 * and `no-byte-authority.test.ts`'s shape, applied to four lines rather than to a boundary. It is a
 * weaker instrument than a behavioural test and it is named as one — it proves the call is written,
 * not that it works — but the alternative measured honestly is nothing at all.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SCREEN = join(here, '../src/renderer/src/components/RuntimeScreen.vue')

/**
 * The body of `start()`, from its signature to the closing brace at column 0.
 *
 * ⚑ **ONE expression, used by the rules AND by their own teeth test** — the `M11` lesson from
 * `216`: a slice that silently matched nothing would leave every assertion below green over an
 * empty string.
 */
function launchBody(source: string): string {
  const from = source.indexOf('async function start(')
  if (from === -1) return ''
  const to = source.indexOf('\n}', from)
  if (to === -1) return ''
  // ⛔ **Comments stripped before anything is asserted** (found in review). This slices raw source,
  // so prose could satisfy a rule — a line explaining `store.send(sessionId, firstMessage, 'now',
  // attachments)` would pass the positive with the call itself deleted — and prose could BREAK one:
  // the negative below fails on the words `drafts.write(` written in a comment about why it is not
  // used. ⚠️ A census over source has to read code, or it is grepping an essay.
  return source
    .slice(from, to)
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//')
      return at === -1 ? line : line.slice(0, at)
    })
    .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('/*'))
    .join('\n')
}

describe('what the first message is made of (217)', () => {
  const body = launchBody(readFileSync(SCREEN, 'utf8'))

  it('⚑ the slice found the function at all — otherwise every rule below passes over nothing', () => {
    // Non-vacuity first, because a rename of `start` would empty this file silently.
    expect(body.length, 'start() moved or was renamed — re-point this file').toBeGreaterThan(400)
    // ⚑ **718 · `door` and `told.refused`** — which surface pressed it, and the refusal of THIS
    // launch handed back to it (`710` F-9): the sheet's launch has its own key and its own error,
    // and `start` is still the one function that calls `store.create`.
    expect(body).toContain('await store.create(input, door, told.refused)')
  })

  it('🔴 the first message is sent WITH what was attached to it', () => {
    // ⛔ The last of the four hops, and the one the wire actually reads: called with three
    // arguments, `attachments` falls to its default `[]` and the launch carries nothing however
    // well the launcher carried it.
    expect(body).toContain("await store.send(sessionId, firstMessage, 'now', attachments)")
  })

  it('🔴 a launch that never opened hands BOTH halves back', () => {
    // `drafts.write` returns the words and leaves the paths where the composer cleared them — a
    // draft that looks whole and is not, which is `211`'s defect wearing a new coat (§2).
    // ⚑ Through `restoreRefused` since 236 §5 — the book merges, and the screen says so when the
    // ceiling kept part of it out. The rule this asserts is unchanged: BOTH halves go back.
    expect(body).toContain('restoreRefused(draftSlot(null), firstMessage, attachments)')
  })

  it('🔴 …and so does a conversation that opened but could not send', () => {
    expect(body).toContain('restoreRefused(draftKey(sessionId), firstMessage, attachments)')
  })

  it('⛔ neither exit uses the half-restore that loses the paths', () => {
    // The negative that makes the three positives above mean something: a `drafts.write` ANYWHERE
    // in this function is one of the two exits having quietly gone back to returning words alone.
    expect(body).not.toContain('drafts.write(')
  })

  it('⛔ start() takes the paths at all — the signature the four hops end at', () => {
    expect(body).toContain('attachments: HandedPath[] = [],')
  })

  it('🔴 …and what would not FIT under the ceiling is said out loud (236 §5)', () => {
    // ⛔ **`227` LOW 3's other half.** The book merges the returned paths into whatever was staged
    // while the send was in flight, and the ceiling still binds — so a refused message can come
    // back one file short. ⚠️ Nothing in this repository mounts `RuntimeScreen`, so this is a
    // source census like the three above it: the count is computed in `drafts.ts`, where a test can
    // read it, and this is the assertion that the screen does not compute it and throw it away.
    const screen = readFileSync(
      join(here, '../src/renderer/src/components/RuntimeScreen.vue'),
      'utf8',
    )
    const restore = screen.slice(
      screen.indexOf('function restoreRefused('),
      screen.indexOf('function restoreRefused(') + 400,
    )
    expect(restore.length, 'restoreRefused moved or was renamed — re-point this').toBeGreaterThan(
      100,
    )
    expect(restore).toContain('const refused = drafts.restore(slot, text, attachments)')
    expect(restore).toContain('if (refused > 0) say(attachmentsNotRestored(refused))')
  })
})

describe('the rule has teeth (217)', () => {
  it('🔴 a planted regression IS caught, through the same slice the rules use', () => {
    // ⛔ Every assertion above is a `toContain` over a string, and a string that came back empty
    // would satisfy the negative one while silently failing to check the positives. This runs the
    // same `launchBody` over source that has the defect and requires it to be visible.
    const before = [
      'async function start(',
      '  input: CreateSessionInput,',
      '  firstMessage: string,',
      '  attachments: HandedPath[] = [],',
      '): Promise<void> {',
      '  const sessionId = await store.create(input)',
      '  if (!sessionId) {',
      '    drafts.write(draftSlot(null), firstMessage)',
      '    return',
      '  }',
      '  await store.send(sessionId, firstMessage)',
      '}',
    ].join('\n')

    const caught = launchBody(before)
    expect(caught).not.toBe('')

    // ⛔ …and PROSE cannot satisfy or break a rule, which is what the stripper is for.
    const prosey = [
      'async function start(',
      '  attachments: HandedPath[] = [],',
      '): Promise<void> {',
      '  const sessionId = await store.create(input)',
      '  // never use drafts.write( here — see the note above',
      "  // the call below used to be store.send(sessionId, firstMessage, 'now', attachments)",
      '  await store.send(sessionId, firstMessage)',
      '}',
    ].join('\n')
    const stripped = launchBody(prosey)
    expect(stripped).not.toContain('drafts.write(')
    expect(stripped).not.toContain("await store.send(sessionId, firstMessage, 'now', attachments)")
    expect(caught).not.toContain("await store.send(sessionId, firstMessage, 'now', attachments)")
    expect(caught).toContain('drafts.write(')

    // ⚑ …and the paired positive: a body that does it right passes the same three checks, so the
    // rules are followable rather than simply always-failing.
    const after = before
      .replace(
        'drafts.write(draftSlot(null), firstMessage)',
        'drafts.restore(draftSlot(null), firstMessage, attachments)',
      )
      .replace(
        'await store.send(sessionId, firstMessage)',
        "await store.send(sessionId, firstMessage, 'now', attachments)",
      )
    const clean = launchBody(after)
    expect(clean).toContain("await store.send(sessionId, firstMessage, 'now', attachments)")
    expect(clean).not.toContain('drafts.write(')
  })

  it('⚠️ …and a missing function yields an EMPTY slice rather than a passing one', () => {
    // The failure mode this file's first test exists to catch, pinned here too.
    expect(launchBody('const nothing = 1\n')).toBe('')
  })
})
