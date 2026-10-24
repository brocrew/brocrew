import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DEFAULT_PROFILE_ID, listProfileIds } from '../src/main/runtime/provider-homes'

const folders: string[] = []
afterEach(() =>
  folders.splice(0).forEach((folder) => rmSync(folder, { recursive: true, force: true })),
)
it('lists a provider’s existing homes without mistaking another provider’s home for its own', () => {
  const root = mkdtempSync(join(tmpdir(), 'brocrew-provider-list-'))
  folders.push(root)
  mkdirSync(join(root, 'provider-homes/default/lark/claude'), { recursive: true })
  mkdirSync(join(root, 'provider-homes/default/wren/codex'), { recursive: true })
  expect(listProfileIds(root)).toEqual([DEFAULT_PROFILE_ID, 'lark', 'wren'])
  expect(listProfileIds(root, 'claude')).toEqual([DEFAULT_PROFILE_ID, 'lark'])
  expect(listProfileIds(root, 'codex')).toEqual([DEFAULT_PROFILE_ID, 'wren'])
})
