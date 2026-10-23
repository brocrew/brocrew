import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUPPORTED_PROVIDERS } from '@brobot2/shared'
import { claudeAutoMemoryIndex, codexAdHocNotesDir, codexMemoryDir } from '@brobot2/runtime'
import {
  memoryStoreCounts,
  readAgentMemoryPage,
  readSessionInstructions,
} from '../src/main/runtime/instructions'
import { whatThisLaunchGave } from '../src/main/runtime/what-this-agent-was-given'
import { BUNDLE_LEAF } from '../src/main/runtime/profile-bundle'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'knowledge-bytes-'))
  vi.spyOn(Date, 'now').mockReturnValue(1234)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})
const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
function portable(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll(root, '<root>').replaceAll('\\', '/')
  if (Array.isArray(value)) return value.map(portable)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, portable(item)]))
  return value
}

describe.each(SUPPORTED_PROVIDERS)('%s knowledge bytes on the landed base', (provider) => {
  it.each(['empty', 'profile-and-memory', 'blocked-bundle'] as const)(
    'keeps the exact launch, receipt and memory page for %s',
    (scenario) => {
      const home = join(root, 'homes', 'fern', provider)
      const cwd = join(root, 'work', 'child')
      mkdirSync(home, { recursive: true })
      mkdirSync(cwd, { recursive: true })
      const path = join(home, BUNDLE_LEAF[provider])
      const text = 'Profile rules: keep examples small.\n'
      const populated = scenario !== 'empty'
      if (populated) {
        write(path, text)
        write(join(home, 'CLAUDE.md'), 'Private instructions.\n')
        write(join(root, 'work', 'CLAUDE.md'), 'Repository instructions.\n')
        write(join(cwd, 'AGENTS.md'), 'Shared conventions.\n')
        write(claudeAutoMemoryIndex(home), 'Memory index.\n')
        write(join(dirname(claudeAutoMemoryIndex(home)), 'preferences.md'), 'Use short examples.\n')
        write(join(codexMemoryDir(home), 'memory_summary.md'), 'A memory summary.\n')
        write(join(codexMemoryDir(home), 'MEMORY.md'), 'A memory index.\n')
        write(join(codexAdHocNotesDir(home), '2026-01-02-one.md'), 'A requested memory.\n')
      }
      const read = readSessionInstructions({
        provider,
        cwd,
        providerHome: home,
        home: root,
        identity: { profileSlug: 'fern', displayName: 'Fern' },
        ...(populated
          ? {
              bundle:
                scenario === 'blocked-bundle'
                  ? { ok: false as const, path, reason: 'unmanaged-override' as const }
                  : { ok: true as const, path, bytes: Buffer.byteLength(text) },
              bundleComposed: { text, spans: [] },
            }
          : {}),
        thisConversation: { text: 'Work on the sample project.', spans: [] },
      })
      const receipt = whatThisLaunchGave({
        provider,
        build: null,
        instructions: read.instructions,
        profileFile: read.profileFile,
        ownInstructionsVersion: 3,
        reportedByTheProvider: populated ? [join(cwd, 'AGENTS.md')] : [],
        toolset: { server: 'sample-tools', tools: [], instructions: 'Use the sample tools.' },
        launchSettings: [],
      })
      expect(
        portable({
          read,
          receipt,
          page: readAgentMemoryPage(provider, home, 0, 1),
          counts: memoryStoreCounts(provider, home),
        }),
      ).toMatchSnapshot()
    },
  )
})
