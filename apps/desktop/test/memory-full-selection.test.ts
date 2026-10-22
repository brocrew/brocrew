import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeAutoMemoryDir, codexAdHocNotesDir } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { amendAgentMemory, readAgentMemoryPaged } from '../src/main/runtime/agent-memory'

let root: string
let homesRoot: string
const homeOf = (provider: Provider) => join(homesRoot, 'default', 'lark', provider)
const inputs = () => ({ profileId: 'lark', homesRoot, homeOf })
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'memory-pages-'))
  homesRoot = join(root, 'homes')
  for (const folder of [
    claudeAutoMemoryDir(homeOf('claude')),
    codexAdHocNotesDir(homeOf('codex')),
  ]) {
    mkdirSync(folder, { recursive: true })
    for (let i = 0; i < 45; i++)
      writeFileSync(join(folder, `note-${String(i).padStart(3, '0')}.md`), `note ${i}`)
  }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('the book can change an entry selected beyond the launch memory page', () => {
  it.each(['claude', 'codex'] as const)('offers the selected page entry for %s', (provider) => {
    const store = readAgentMemoryPaged(inputs(), { offset: 20, limit: 10 }).stores.find(
      (one) => one.provider === provider,
    )!
    expect(store.entries).toHaveLength(10)
    expect(store.entries.every((one) => one.amendable)).toBe(true)
    expect(store.nextOffset).toBe(30)
  })
  it.each(['claude', 'codex'] as const)(
    'deletes the selected later entry for %s and preserves its old text',
    async (provider) => {
      const entry = join(
        provider === 'claude'
          ? claudeAutoMemoryDir(homeOf(provider))
          : codexAdHocNotesDir(homeOf(provider)),
        provider === 'claude' ? 'note-025.md' : 'note-005.md',
      )
      expect(
        await amendAgentMemory({ ...inputs(), provider, entry, act: 'removed', text: '' }),
      ).toEqual({ done: true, entry, textBefore: provider === 'claude' ? 'note 25' : 'note 5' })
      expect(existsSync(entry)).toBe(false)
      expect(
        readFileSync(
          join(
            provider === 'claude'
              ? claudeAutoMemoryDir(homeOf(provider))
              : codexAdHocNotesDir(homeOf(provider)),
            'note-000.md',
          ),
          'utf8',
        ),
      ).toBe('note 0')
    },
  )
  it('corrects a later note with the same guarded writer', async () => {
    const entry = join(codexAdHocNotesDir(homeOf('codex')), 'note-000.md')
    expect(
      await amendAgentMemory({
        ...inputs(),
        provider: 'codex',
        entry,
        act: 'corrected',
        text: 'corrected',
      }),
    ).toEqual({ done: true, entry, textBefore: 'note 0' })
    expect(readFileSync(entry, 'utf8')).toBe('corrected')
  })
  it('continues to refuse an entry that was never derived for this identity', async () => {
    const entry = join(root, 'outside.md')
    writeFileSync(entry, 'outside')
    expect(
      await amendAgentMemory({ ...inputs(), provider: 'claude', entry, act: 'removed', text: '' }),
    ).toMatchObject({ done: false, refused: 'no-such-entry' })
    expect(readFileSync(entry, 'utf8')).toBe('outside')
  })
})
