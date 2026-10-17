import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { normalizeNotification } from '../src/codex/normalize'
import { MAX_UNKNOWN_RAW_BYTES, boundRaw, type DiscardedPayload } from '../src/events'

/**
 * `imageGeneration`, from the wire (067).
 *
 * ## The shape these fixtures are built from
 *
 * Measured, not imagined. Codex's own rollout for thread `019fcfb1-…` holds one 2,921,836-byte
 * `event_msg` line:
 *
 * ```
 * { type: 'image_generation_end', call_id: 'exec-297ad8c6-…', status: 'completed',
 *   revised_prompt: <745 chars>, result: <2,920,656 chars of base64>, saved_path: <200 chars> }
 * ```
 *
 * and the PNG at that `saved_path` is a real 2,190,491-byte file. The app-server v2 spelling of the
 * same item is `ImageGenerationItem = { id, status, revisedPrompt, result, savedPath? }` — camel
 * case, and every one of those field names is a literal string in the shipped 0.146.0 binary.
 */

const HERE = dirname(fileURLToPath(import.meta.url))

/** A base64 blob the size of the real one. This is the thing that must never be read. */
const HUGE = 'A'.repeat(2_920_656)

function imageItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'imageGeneration',
    id: 'exec-297ad8c6-8e4e-403d-a8af-4d6a5e025cb2',
    status: 'completed',
    revisedPrompt: 'a tiny, cheerful minimalist illustration of a curled-up red fox',
    result: HUGE,
    savedPath: '/somewhere/generated_images/thread/exec-297ad8c6-8e4e-403d-a8af-4d6a5e025cb2.png',
    ...overrides,
  }
}

describe('imageGeneration is an image, not a discarded payload (067)', () => {
  it('0.160.0 · a generation that hit its limit is said as that, not drawn as a lost image', () => {
    const failed = imageItem({
      status: 'failed',
      savedPath: undefined,
      failure: { type: 'usageLimitExceeded', limitId: 'images', resetsAt: 1_790_000_000 },
    })
    expect(normalizeNotification('item/completed', { item: failed })).toEqual([
      {
        type: 'error',
        message: `codex could not make the image: its usage limit was reached; it resets at ${new Date(1_790_000_000 * 1000).toISOString()}`,
        fatal: false,
      },
    ])
    // …and `failure: null`, the ordinary case, is still an image.
    expect(
      normalizeNotification('item/completed', { item: imageItem({ failure: null }) })[0],
    ).toMatchObject({
      type: 'image',
    })
  })

  it('completed → one `image` event carrying id, path and prompt', () => {
    expect(normalizeNotification('item/completed', { item: imageItem() })).toEqual([
      {
        type: 'image',
        imageId: 'exec-297ad8c6-8e4e-403d-a8af-4d6a5e025cb2',
        path: '/somewhere/generated_images/thread/exec-297ad8c6-8e4e-403d-a8af-4d6a5e025cb2.png',
        prompt: 'a tiny, cheerful minimalist illustration of a curled-up red fox',
      },
    ])
  })

  it('⚠️ the 2.9 MB base64 never appears in the event — the feature is which field is NOT read', () => {
    const [event] = normalizeNotification('item/completed', { item: imageItem() })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('AAAA')
    // Two orders of magnitude under the ceiling it used to be 45× over. This is the number that
    // says an image no longer costs anything to carry.
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(1_000)
  })

  it('⚠️ is never bounded, because it never becomes an `unknown` — the ceiling is untouched', () => {
    // The contrast, in one test. The SAME payload through the old door still produces the marker;
    // through the new one it produces an image. Nothing about `boundRaw` changed to allow that.
    const marker = boundRaw(imageItem(), 'imageGeneration') as DiscardedPayload
    expect(marker.brobot2Discarded).toBe(true)
    expect(marker.limitBytes).toBe(MAX_UNKNOWN_RAW_BYTES)
    const [event] = normalizeNotification('item/completed', { item: imageItem() })
    expect(event?.type).toBe('image')
    expect(JSON.stringify(event)).not.toContain('brobot2Discarded')
  })

  it('started → nothing: the file does not exist yet', () => {
    // An image event on `started` could never resolve to a file, and would then be followed by one
    // that does — two entries in the conversation for one picture, the first permanently broken.
    expect(normalizeNotification('item/started', { item: imageItem() })).toEqual([])
  })

  it('omits `path` when the provider named none, and `prompt` when it is empty or null', () => {
    // `savedPath` is optional in the vendored type and `revisedPrompt` is `string | null`. Absent is
    // absent — never an empty string, which a renderer would show as a blank caption.
    const [event] = normalizeNotification('item/completed', {
      item: imageItem({ savedPath: undefined, revisedPrompt: null }),
    })
    expect(event).toEqual({ type: 'image', imageId: 'exec-297ad8c6-8e4e-403d-a8af-4d6a5e025cb2' })
    const [blank] = normalizeNotification('item/completed', {
      item: imageItem({ revisedPrompt: '   ' }),
    })
    expect(blank).not.toHaveProperty('prompt')
  })

  it('⚠️ bounds the prompt — no provider string rides into the ledger unmeasured', () => {
    // Nothing in the protocol caps `revisedPrompt`, and this event is persisted and cloned across
    // IPC for the life of the session. 200 characters plus an ellipsis, the same rule and the same
    // helper every tool summary already uses.
    const [event] = normalizeNotification('item/completed', {
      item: imageItem({ revisedPrompt: 'x'.repeat(10_000) }),
    })
    const prompt = (event as { prompt?: string }).prompt ?? ''
    expect(prompt.length).toBeLessThan(250)
    expect(prompt.endsWith('…')).toBe(true)
  })

  it('an item with no id is surfaced as unrecognized rather than given an invented one', () => {
    // The id is the only handle on the image when there is no path — a fabricated one would index
    // an asset nobody can open. 035's pattern: refuse rather than fill in.
    const [event] = normalizeNotification('item/completed', { item: imageItem({ id: '' }) })
    expect(event).toMatchObject({ type: 'unknown', category: 'unrecognized' })
  })

  it('⚠️ a MALFORMED image item does not drag the base64 through `wrapUnknown` either', () => {
    // The path the first version of this change left open, and the one that made its own comment
    // false: an item with no id went to `wrapUnknown` whole, so `boundRaw` serialized 2.9 MB, found
    // it oversized, and replaced every field with a marker — the exact behaviour 067 removed,
    // surviving on the branch nobody looks at.
    const [event] = normalizeNotification('item/completed', { item: imageItem({ id: '' }) })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('AAAA')
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(2_000)
    // ⚠️ And it is now MORE informative than before, not less: with the base64 described instead of
    // carried, the rest of the item fits under the ceiling and survives verbatim — so the surprise
    // (a missing id, beside a real status and prompt) is readable rather than erased by a marker.
    expect(serialized).not.toContain('brobot2Discarded')
    expect(serialized).toContain('2920656 chars of base64')
    expect(serialized).toContain('curled-up red fox')
  })

  it('⚠️ `imageView` is still chatter — a viewed image is an ARBITRARY path', () => {
    // Pinned rather than left to the comment. Until `726` · R92 the asymmetry was also a security
    // argument (the images-root check in `generated-image.ts`); what stands is `normalize.ts`'s
    // other reason — `imageView` has never been observed on the wire.
    const [event] = normalizeNotification('item/completed', {
      item: { type: 'imageView', id: 'v1', path: '/Users/someone/.ssh/id_rsa' },
    })
    expect(event).toMatchObject({ type: 'unknown', category: 'activity', label: 'imageView' })
  })
})

describe('what Claude does with images — measured, and the answer is nothing (067 acceptance 5)', () => {
  /**
   * ⚠️ **This test exists because the dispatch said "do not assume symmetry", and the honest answer
   * is an absence** — which is the hardest kind of finding to keep true. Four independent measures
   * agreed, and the two that a source file can still check are checked here so that the day Claude
   * grows an image tool, this fails and someone re-reads the verdict instead of inheriting it.
   *
   * The measures, all against the exact-pinned `claude-agent-sdk@0.3.218`:
   *  1. `ToolInputSchemas` lists every tool Claude can call. There is no image-generation tool.
   *  2. `claude/normalize.ts` contains no image handling of any kind.
   *  3. The app-managed Claude provider home holds no image file of any format — measured with
   *     `find` over the whole tree.
   *  4. `CLAUDE_CAPABILITIES` declares `planMode`, `thinking`, `subAgents`, and nothing else.
   *
   * The SDK's image-shaped types are all INPUT: `FileReadOutput{type:'image'}` is a file Claude
   * READ, `REPLOutput.images` and `BashOutput.isImage` are base64 in a tool result. None of them is
   * a file Claude persisted to a directory we own, which is what Codex does and what this feature
   * indexes. **So there is nothing to list for Claude, and nothing is listed.**
   */
  it('NO file in the Claude adapter builds an image event — so it can emit none', () => {
    // ⚠️ **Widened twice after review.** The first version read ONE file and matched ONE spelling:
    // a `type: "image"` in double quotes, or the same literal in `claude-runtime.ts` instead of
    // `normalize.ts`, would have sailed past a guard whose entire job is to notice. Now: every
    // source file in the adapter, and every quoting style TypeScript allows.
    const dir = join(HERE, '..', 'src', 'claude')
    const files = readdirSync(dir).filter((name) => name.endsWith('.ts'))
    // Non-vacuity, twice over: the directory has files, and they are the ones we think they are.
    expect(files.length).toBeGreaterThan(2)
    const sources = files.map((name) => readFileSync(join(dir, name), 'utf8'))
    expect(sources.join('\n')).toContain('assistant_message')
    for (const [i, source] of sources.entries()) {
      expect(source, `${files[i]} builds an image event`).not.toMatch(/type:\s*['"`]image['"`]/)
    }
  })

  it('the Claude capability descriptor claims nothing image-shaped at all', () => {
    // The keyword is `image`, not `imageGeneration`: a capability named `imageGen`, `image_gen` or
    // `imageOutput` is exactly as much of a reason to re-read this verdict, and the narrow spelling
    // would have missed every one of them.
    const source = readFileSync(join(HERE, '..', 'src', 'claude', 'capabilities.ts'), 'utf8')
    expect(source).toContain('planMode')
    expect(source.toLowerCase()).not.toContain('image')
  })
})
