import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  aSurfaceMayOpenADocument,
  type ResourceReader,
} from '../src/renderer/src/lib/opening-a-document'
import { READ_THE_DOCUMENT_NAMED } from '../src/renderer/src/lib/the-documents-a-reply-names'
import { OPEN_THE_DOCUMENT } from '../src/renderer/src/lib/the-document-a-report-names'
import type { ResourceReading } from '../src/shared/runtime-ipc'

/**
 * 🔴 **640 · three ways to open one document, folded to one** — `00-backlog` D14, boarded by
 * `562` §6 with a trigger and pulled by `635`.
 *
 * ## ⛔ What this file measures, and what it deliberately does not
 *
 * ⚑ **`562` counted the derivations behind a document press and found ONE of everything that
 * DECIDES** — *may this be pressed here* · *what the press says* · *where it goes* · *who
 * fetches* · *what a failure shows*. ⚠️ **What was three was HOW**: `ConversationPane` (510),
 * `ReadingPane` (510) and `ProjectWorkspace` (550) each held a `readingDocument`, each mounted
 * their own `OverlayHost` + `CanonicalDocumentViewer`, and each spelled the may-open test.
 *
 * ⛔ **So this is a REFACTOR and §2 below is the half that matters**: the five things that were
 * already one are asserted to be STILL one and still unchanged. ⚠️ A fold that moved any of them
 * has gone past the dispatch.
 *
 * ## ⚠️ The search shape, stated (rule 4)
 *
 * ⛔ **The count is derived from a WALK of the whole renderer tree**, `.ts` and `.vue`, not from a
 * list of filenames — because the brief's three names were a starting point and a fourth surface
 * growing its own viewer is exactly the thing this instrument exists to catch
 * ([[a-negative-is-only-as-strong-as-the-search-shape]]). ⚑ **What the walk could have found and
 * did not**: a fourth mount site, a second module answering *may this be pressed*, a surface that
 * kept its own fetched state. 🔴 **Its own control plants TWO** (rule 12): the walk is asserted to
 * see more than one file and to find every needle somewhere, so an empty walk cannot read as a
 * clean result.
 *
 * ## ⚑ And the no-execute guarantee is BELOW the fold, which is why the fold is safe
 *
 * ⛔ **`635`/`HO-097` §1.3 put *viewing never executes* in `CanonicalDocumentViewer`**, whose only
 * renderer is `DocumentBody` at markdown-it's `html: false`. ⚠️ **No surface ever sanitised
 * anything** — all three drew the same panel — so folding three mounts into one neither adds a
 * guard nor removes one. §4 pins that the document path is still exactly those three components.
 */

const here = fileURLToPath(new URL('.', import.meta.url))
const RENDERER = join(here, '../src/renderer/src')

/** Every renderer source file, walked — the shape the negatives below are taken over. */
function everyRendererFile(dir: string = RENDERER): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...everyRendererFile(path))
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.vue')) out.push(path)
  }
  return out
}

const FILES = everyRendererFile()
const SOURCE = new Map(FILES.map((path) => [path, readFileSync(path, 'utf8')]))
const named = (path: string): string => relative(RENDERER, path).replaceAll('\\', '/')

/** Every renderer file whose text contains `needle`, by its path under `renderer/src`. */
function filesContaining(needle: string): string[] {
  return [...SOURCE.entries()]
    .filter(([, text]) => text.includes(needle))
    .map(([path]) => named(path))
    .sort()
}

/** The same walk, for a fact a literal cannot name — a `ref` that HOLDS a fetched document. */
function filesMatching(pattern: RegExp): string[] {
  return [...SOURCE.entries()]
    .filter(([, text]) => pattern.test(text))
    .map(([path]) => named(path))
    .sort()
}

const CODE = (path: string): string => SOURCE.get(join(RENDERER, path))!

const SURFACES = [
  'components/ConversationPane.vue',
  'components/ReadingPane.vue',
  // ⚑ **701 added a fourth** — `KeptOpenPane`, a conversation the quit left open — and ⚑ **D-017b
  // took it away**: every conversation opens in the one full view, `ConversationPane`.
  // ⚑ **D-016 took the third** — `ProjectWorkspace`, the project room, went with projects.
]

describe('640 §0 · the walk is real before anything is counted over it', () => {
  it('⚑ the walk reaches the whole renderer, the surfaces included', () => {
    // ⛔ **The control for every negative below.** A walk that found nothing would make each
    // `toEqual([…one…])` a sentence about an empty set.
    expect(FILES.length).toBeGreaterThan(100)
    for (const surface of SURFACES) expect(SOURCE.has(join(RENDERER, surface)), surface).toBe(true)
    // ⚑ …and it really descends: `lib/` and `components/` are both in it.
    expect(SOURCE.has(join(RENDERER, 'lib/opening-a-document.ts'))).toBe(true)
    expect(SOURCE.has(join(RENDERER, 'components/CanonicalDocumentOverlay.vue'))).toBe(true)
  })
})

describe('640 §1 · one readingDocument, one mount, one place deciding', () => {
  it('🔴 exactly one component mounts the canonical viewer, and it is the overlay', () => {
    // ⛔ **The deliverable.** Three mounts before the fold; a fourth surface now mounts
    // `CanonicalDocumentOverlay` and inherits the host, the state and the `067` scope guard.
    expect(filesContaining('<CanonicalDocumentViewer')).toEqual([
      'components/CanonicalDocumentOverlay.vue',
    ])
    // ⚑ **Non-vacuity in the other direction**: the needle is a real one and it is found.
    // ⚑ **UI-002** — the panel is handed the row the press was drawn from too, for its header.
    // ⚑ **D-032** — …and the id pressed, the picture or PDF to draw, and the door to Finder.
    expect(CODE('components/CanonicalDocumentOverlay.vue')).toMatch(
      /<CanonicalDocumentViewer\s+:resource-id="showing\.resourceId"\s+:result="showing\.result"\s+:file="showing\.file"\s+:drawing="showing\.drawing"\s+:reveal="props\.reveal"\s+@close="reading = null"\s*\/>/,
    )
  })

  it('🔴 exactly one place holds a fetched document, and none of the surfaces does', () => {
    // ⛔ The state a surface used to keep for itself: `{ documentId, result }`, fetched.
    // ⚠️ **A `ref` and not a prop** — `CanonicalDocumentViewer` is HANDED a result and holds
    // none, which is the distinction this pattern draws and a bare name search could not.
    // ⚑ **D-016 · re-anchored, not loosened**: a document is a kept RESOURCE now, so the fetched
    // result is a `ResourceReading` where it was a `CanonicalDocumentResult`.
    expect(filesMatching(/ref<[\s\S]{0,200}?ResourceReading/)).toEqual([
      'components/CanonicalDocumentOverlay.vue',
    ])
    // ⚑ The control for the pattern: the panel really does name the type, and is not matched.
    // ⚑ **UI-002** — …and beside the result, the row it may be handed for its header's facts.
    // ⚑ **D-032** — …and the drawing it is handed, never one it fetches.
    expect(CODE('components/CanonicalDocumentViewer.vue')).toMatch(
      /defineProps<\{[\s\S]{0,400}?result: ResourceReading[\s\S]{0,400}?drawing\?: ResourceDrawing \| null[\s\S]{0,400}?file\?: KeptFile \| null\s*\}>\(\)/,
    )
    // ⚠️ …and no surface kept the old ref under its old name either.
    for (const surface of SURFACES) expect(CODE(surface), surface).not.toContain('readingDocument')
  })

  it('🔴 exactly one place decides whether a surface may open one', () => {
    // ⛔ `106`/`118`: the press is ABSENT rather than dead where the surface was given no door.
    // ⚑ The RULE is one function; the surfaces ASK it.
    expect(filesContaining('export function aSurfaceMayOpenADocument')).toEqual([
      'lib/opening-a-document.ts',
    ])
    // ⚑ **701 · re-aimed, not stripped** (rule 26): a FOURTH surface asked — the pane of a
    // conversation the quit left open. ⚑ **D-017b** — that pane is gone (one full view for every
    // conversation), so the three surfaces ask again. ⚑ **D-016** — and the room went with
    // projects, so two surfaces ask.
    expect(filesContaining('aSurfaceMayOpenADocument(')).toEqual([
      'components/CanonicalDocumentOverlay.vue',
      'components/ConversationPane.vue',
      'components/ReadingPane.vue',
      'lib/opening-a-document.ts',
    ])
    // ⛔ **And nobody kept a second, private answer to the same question** — the two spellings the
    // fold removed, asserted gone rather than assumed gone. ⚑ **D-016** — under the prop's new
    // name (`onReadResource`), because a spelling that came back would come back under that one.
    expect(filesContaining('onReadResource !== undefined')).toEqual([])
    expect(filesContaining("props.onReadResource ? 'button'")).toEqual([])
    expect(filesContaining('aSurfaceMayOpenADocument(props.onReadResource)')).toEqual([
      'components/ConversationPane.vue',
      'components/ReadingPane.vue',
    ])
  })

  it('⚑ the rule answers both ways, and it narrows the caller that passes it', () => {
    const read: ResourceReader = async () => ({ ok: false, reason: 'no-store' })
    expect(aSurfaceMayOpenADocument(read)).toBe(true)
    // ⛔ The paired negative, which is the whole of `106` on this control.
    expect(aSurfaceMayOpenADocument(undefined)).toBe(false)
  })
})

describe('640 §2 · the five things 562 found to be ONE are still one, and unchanged', () => {
  it('⛔ what the press says — two sentences, each true of its own row, neither re-spelled', () => {
    // ⚑ **D-016** — the second sentence moved with its last reader: the room's document band is
    // deleted, and a reply's named document (`the-documents-a-reply-names.ts`) draws it now.
    // ⚑ **D-016 · commit 3** — and both say FILE: what a press opens is a file kept with a reply,
    // and *Read the full response* retired because the summary is the whole reply now.
    expect(OPEN_THE_DOCUMENT).toBe('Open the file kept with this reply')
    expect(READ_THE_DOCUMENT_NAMED).toBe('Open this file')
    expect(OPEN_THE_DOCUMENT).not.toBe(READ_THE_DOCUMENT_NAMED)
  })

  it('⛔ where it goes — one event, through the hops 510 built and 562 reused', () => {
    // ⚑ **D-016 · the same event, carrying a resource id** — one press per file a report keeps,
    // so the id is the loop's `resource` where it was the report's one `documentId`.
    expect(CODE('components/WorkReportEntry.vue')).toContain("emit('openDocument', resource)")
    expect(CODE('components/AssistantMessage.vue')).toContain("emit('openDocument', resourceId)")
    expect(CODE('components/TranscriptView.vue')).toContain(
      '@open-document="(resourceId) => $emit(\'openDocument\', resourceId)"',
    )
    // ⚑ Both panes still take the event at the top and hand it one id.
    for (const pane of ['components/ConversationPane.vue', 'components/ReadingPane.vue'])
      expect(CODE(pane), pane).toContain(
        '@open-document="(resourceId) => void openResource(resourceId)"',
      )
  })

  it('⛔ who fetches — one implementation, on the screen that owns the bridge', () => {
    // ⚑ **D-016 · the same one fetch, of a resource** — `readResource` where it was
    // `readCanonicalDocument`, on the same screen.
    expect(filesContaining('store.readResource(resourceId)')).toEqual([
      'components/RuntimeScreen.vue',
    ])
    // ⚠️ **The fold did not move the fetch and did not add a second route to it**: each surface
    // is still handed the one function as a prop.
    expect(filesContaining(':on-read-resource="readResourceForAnySurface"')).toEqual([
      'components/RuntimeScreen.vue',
    ])
    expect(
      (
        CODE('components/RuntimeScreen.vue').match(
          /:on-read-resource="readResourceForAnySurface"/g,
        ) ?? []
      ).length,
      // ⚑ **701** made it four with the kept-open pane; ⚑ **D-017b** — three again: the pane, the
      // recording, the room. ⚑ **D-016** — two: the pane and the recording; the room is deleted.
    ).toBe(2)
  })

  it('⛔ what a failure shows — four refusals and four forms, in the one panel', () => {
    const viewer = CODE('components/CanonicalDocumentViewer.vue')
    // ⚑ **D-016 · a resource's four refusals** — `ResourceReading`'s own union: a document id reads
    // `no-such-resource`, the store is `no-store`, and `outside` went with the registry's folder.
    const REFUSALS: readonly Extract<ResourceReading, { ok: false }>['reason'][] = [
      'no-such-resource',
      'no-store',
      'unreadable',
      'changed',
    ]
    for (const reason of REFUSALS)
      expect(viewer, reason).toContain(`${reason.includes('-') ? `'${reason}'` : reason}:`)
    for (const gone of ['no-such-document', 'no-registry', 'outside'])
      expect(viewer, gone).not.toContain(`${gone.includes('-') ? `'${gone}'` : gone}:`)
    // ⚑ `635`'s four forms are still the panel's, not the overlay's.
    expect(filesContaining('NOT_DRAWN')).toEqual(['components/CanonicalDocumentViewer.vue'])
  })
})

describe('640 §3 · viewing still never executes, and the guarantee did not move', () => {
  /**
   * ⛔ **The document path, end to end**: `CanonicalDocumentOverlay` → `CanonicalDocumentViewer`
   * → `DocumentBody`. ⚠️ **The positive control is `DocumentBody` itself**, which holds the one
   * `v-html` in this chain behind markdown-it at `html: false` — so the silence below is a
   * measurement rather than a needle nobody could ever find.
   */
  const RUNS_CODE = ['v-html', 'srcdoc', 'innerHTML', '<iframe', '<webview', 'new Function']

  it('🔴 nothing on the path between a press and the paper can execute', () => {
    for (const file of ['components/CanonicalDocumentOverlay.vue', ...SURFACES])
      for (const needle of RUNS_CODE)
        expect(CODE(file), `${file} · ${needle}`).not.toContain(needle)
    // ⚑ **The control**: the needle IS findable one component further down, which is where the
    // ruling put it and where `635` planted a hostile page to measure it.
    expect(CODE('components/DocumentBody.vue')).toContain('v-html')
    expect(CODE('lib/markdown.ts')).toContain('html: false')
  })

  it('⛔ the overlay renders the panel and nothing else', () => {
    const overlay = CODE('components/CanonicalDocumentOverlay.vue')
    // ⚠️ Two imports, both components, and neither is a renderer of its own.
    expect(overlay).toContain("import OverlayHost from './OverlayHost.vue'")
    expect(overlay).toContain("import CanonicalDocumentViewer from './CanonicalDocumentViewer.vue'")
    expect((overlay.match(/^import .* from '\.\/[A-Z]/gm) ?? []).length).toBe(2)
    // ⛔ …and the chrome is still `OverlayHost`'s: Esc, the backdrop, the trap, focus returned.
    const host = overlay.slice(
      overlay.indexOf('<OverlayHost'),
      overlay.indexOf('<CanonicalDocumentViewer'),
    )
    expect(host).toContain('v-if="showing"')
    expect(host).toContain(':label=')
    expect(host).toContain('@close="close"')
  })
})
