import { expect, it } from 'vitest'
import { createDraftBook, draftKey } from '../src/renderer/src/lib/drafts'
import { draftsToSave, restoreDrafts } from '../src/renderer/src/lib/kept-drafts'
import { savedDraftsFrom } from '../src/main/saved-drafts'
import { MAX_HANDED_PATHS } from '../src/shared/runtime-ipc'

for (const accepted of [false, true]) {
  it(`keeps queued files through the real saved-draft parser, accepted=${accepted}`, async () => {
    const book = createDraftBook()
    const key = draftKey('queued')
    const original = Array.from({ length: MAX_HANDED_PATHS }, (_, index) => ({
      path: `/fictional/${index}.md`,
      kind: 'file' as const,
      outsideCwd: false,
    }))
    book.write(key, 'First message')
    book.paths.write(key, original)
    let reply!: (accepted: boolean) => void
    const pending = book.send(
      key,
      () =>
        new Promise<boolean>((resolve) => {
          reply = resolve
        }),
      true,
    )
    book.write(key, 'Newer typing')
    book.paths.handing(key).stage([{ path: '/fictional/new.md', kind: 'file', outsideCwd: false }])
    expect(book.paths.handing(key).refusal).toContain(`${MAX_HANDED_PATHS} attachments`)
    const snapshot = draftsToSave(book)
    expect(snapshot.drafts[0]!.attached).toEqual(original)
    const packet = savedDraftsFrom(JSON.parse(JSON.stringify(snapshot)))
    expect(packet).toEqual(snapshot)
    const restarted = createDraftBook()
    restoreDrafts(restarted, packet)
    expect(restarted.read(key)).toBe('First message\n\nNewer typing')
    expect(restarted.paths.read(key)).toEqual(original)
    reply(accepted)
    await pending
    expect(book.read(key)).toBe(accepted ? 'Newer typing' : 'First message\n\nNewer typing')
    expect(book.paths.handing(key).staged).toEqual(accepted ? [] : original)
  })
}
