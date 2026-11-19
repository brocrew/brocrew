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

it('a same-path acquisition at capacity remains a newer attachment without duplicating saved paths', async () => {
  const book = createDraftBook()
  const key = draftKey('full')
  const files = Array.from({ length: MAX_HANDED_PATHS }, (_, index) => ({
    path: `/fictional/${index}.md`, kind: 'file' as const, outsideCwd: false,
  }))
  book.write(key, 'First message')
  book.paths.write(key, files)
  let reply!: (accepted: boolean) => void
  const pending = book.send(key, () => new Promise<boolean>((resolve) => { reply = resolve }), true)
  await book.paths.handing(key).acquire(async () => [{ handed: { ...files[0]! } }])
  expect(book.paths.handing(key).staged).toEqual([files[0]])
  const snapshot = draftsToSave(book)
  expect(savedDraftsFrom(snapshot)).toEqual(snapshot)
  expect(snapshot.drafts[0]!.attached).toHaveLength(MAX_HANDED_PATHS)
  book.paths.handing(key).stage([])
  expect(book.paths.handing(key).staged).toEqual([])
  expect(draftsToSave(book).drafts[0]!.attached).toHaveLength(MAX_HANDED_PATHS)
  reply(true)
  await pending
  expect(book.paths.read(key)).toEqual([])
})
