import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  captionHandedPaths,
  classifyHandedPath,
  messageWithHandedPaths,
  recheckHandedPaths,
} from '../src/main/runtime/handed-path'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import { restoreSavedDrafts, savedDraftsFrom } from '../src/main/saved-drafts'
import { stageVerdicts } from '../src/renderer/src/lib/drafts'
import { alreadyStagedAs, profileAlreadyNamed, quotedLiteral } from '../src/shared/runtime-ipc'

const names = [
  'Notes.md',
  'notes.md',
  'a\nb.md',
  'a\rb.md',
  'a\tb.md',
  'a\u001bb.md',
  'a\u007fb.md',
  'a"b\\c.md',
  'a\u2028b\u2029c.md',
  'notes — résumé 日本語.md',
]

describe('attachment path spelling', () => {
  let dir: string
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'brocrew-path-spelling-')))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('matches attachment paths exactly while leaving profile-name matching alone', () => {
    expect(alreadyStagedAs('/work/notes.md', ['/work/Notes.md'])).toBeNull()
    expect(alreadyStagedAs('/work/Notes.md', ['/work/Notes.md'])).toBe('/work/Notes.md')
    expect(profileAlreadyNamed('Worker', ['worker'])).toBe('worker')
    const upper = { path: '/work/Notes.md', kind: 'file' as const, outsideCwd: false }
    const lower = { ...upper, path: '/work/notes.md' }
    expect(stageVerdicts([upper], [{ handed: lower }, { handed: upper }])).toEqual({
      next: [upper, lower],
      refusal: null,
    })
  })

  it.each(names)('round-trips the path through the existing quoted literal: %j', (name) => {
    const path = join(dir, name)
    expect(JSON.parse(quotedLiteral(path))).toBe(path)
    const block = messageWithHandedPaths('look', [{ path, kind: 'file', outsideCwd: false }])
    const lines = block.split('\n')
    expect(lines).toHaveLength(4)
    expect(JSON.parse(lines[3]!.slice('- file: '.length))).toBe(path)
  })

  it('preserves filename characters through every send attachment schema', () => {
    for (const name of names) {
      const path = join(dir, name)
      for (const kind of ['send', 'sendInterrupting', 'queueMessage', 'startAndSend']) {
        const command = runtimeCommandSchema.parse({
          kind,
          sessionId: 'session',
          text: 'look',
          attachments: [{ path, kind: 'file', outsideCwd: false }],
        })
        expect('attachments' in command && command.attachments?.[0]?.path).toBe(path)
      }
    }
  })

  it.skipIf(process.platform === 'win32').each(names)(
    'keeps a valid POSIX filename through choose, caption and send recheck: %j',
    async (name) => {
      const path = join(dir, name)
      writeFileSync(path, 'a note')
      const verdict = await classifyHandedPath(path, dir)
      const handed = { path, kind: 'file' as const, outsideCwd: false }
      expect(verdict).toEqual({ handed })
      expect(await captionHandedPaths([handed], dir)).toEqual([handed])
      expect(await recheckHandedPaths([handed], dir)).toEqual({ paths: [handed] })
    },
  )

  it.skipIf(process.platform === 'win32')('uses the canonical path to deduplicate a symlink alias', async () => {
    const target = join(dir, 'Notes.md')
    const alias = join(dir, 'alias.md')
    writeFileSync(target, 'a note')
    symlinkSync(target, alias)
    const first = await classifyHandedPath(target, dir)
    const second = await classifyHandedPath(alias, dir)
    expect(first).toEqual(second)
    expect(stageVerdicts([], [first, second])).toEqual({
      next: [{ path: target, kind: 'file', outsideCwd: false }],
      refusal: null,
    })
  })

  it('preserves path spelling through JSON persistence and draft restore', async () => {
    const attached = names.map((name) => ({
      path: join(dir, name),
      kind: 'file' as const,
      outsideCwd: false,
    }))
    const raw = JSON.parse(
      JSON.stringify({ drafts: [{ slot: 'new', text: 'look', attached }] }),
    )
    expect(savedDraftsFrom(raw)).toEqual(raw)
    const checked: string[] = []
    expect(
      await restoreSavedDrafts(raw, {
        exists: () => true,
        isGone: async (path) => {
          checked.push(path)
          return false
        },
      }),
    ).toEqual(raw)
    expect(checked).toEqual(attached.map((one) => one.path))
  })

  it('keeps actual filesystem failures as refusals', async () => {
    expect(await classifyHandedPath(join(dir, 'not-there'), dir)).toEqual({
      refusal: `there is nothing at ${join(dir, 'not-there')}`,
      gone: true,
    })
    const invalid = join(dir, 'not\0a-file')
    expect(await classifyHandedPath(invalid, dir)).toEqual({
      refusal: `there is nothing at ${invalid}`,
      gone: true,
    })
  })
})
