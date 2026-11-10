import { describe, expect, it } from 'vitest'
import {
  aSurfaceMayOpenADocument,
  type ResourceReader,
} from '../src/renderer/src/lib/opening-a-document'
import { READ_THE_DOCUMENT_NAMED } from '../src/renderer/src/lib/the-documents-a-reply-names'
import { OPEN_THE_DOCUMENT } from '../src/renderer/src/lib/the-document-a-report-names'

describe('640 §1 · one readingDocument, one mount, one place deciding', () => {
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
})
