import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { claudeAutoMemoryDir, claudeAutoMemoryIndex } from '@brobot2/runtime/claude'
import { codexAdHocNotesDir, codexMemorySummary } from '@brobot2/runtime/codex'
import { expect, it, vi } from 'vitest'
import { readSavedMethods } from '../src/main/saved-methods'
import { F093World } from './lib/f093-host'

const MEMORY_LINE = 'Memory changed (observed at '
const MEMORY_NUDGE = 'Fix or remove outdated memory in '
const QUIET_AFTER_COMPACTION = [
  MEMORY_LINE,
  MEMORY_NUDGE,
  'Your own notes (',
  'Shared skill (',
  'Plugin information (',
  'Other conversations of this profile',
]

function memoryLine(footer: string): string | undefined {
  return footer.split('\n').find((line) => line.startsWith(MEMORY_LINE))
}

it.each(['claude', 'codex'] as const)(
  '%s names only changed skills and methods after their first delivery and across a reopen',
  async (provider) => {
    const world = new F093World()
    try {
      const root = join(world.userData, 'skills')
      const methods = join(world.userData, 'methods')
      mkdirSync(methods, { recursive: true })
      const first = '- Rotate the fictional log | weekly | verified 2026-10-12 | rotate.md'
      writeFileSync(join(methods, 'rotate.md'), '# Rotate\n')
      writeFileSync(join(methods, 'index.md'), first + '\n')
      let revision = 'original'
      const builtInGuide = 'built-in-guide — Use the fictional built-in skill.'
      const host = world.buildHost(true, {
        readPromptSkills: () => ({
          root,
          entries: [
            { id: 'shared:guide', name: 'Fictional guide', revision },
            { id: 'built-in:guide', name: 'Unchanged guide', revision: 'always' },
          ],
        }),
        savedMethodsFolderFor: () => methods,
        readSavedMethodsFor: (_profile, at) => readSavedMethods(methods, at),
        prepareBuiltInSkills: async () => ({
          context: { root, skills: [] },
          reminder: builtInGuide,
          version: 'fictional-v1',
          isCurrent: () => true,
        }),
      })
      const id = await world.open(host, provider, 'fictional-reader')
      const turn = async (text: string) => {
        const endpoint = world.end.newest()
        await vi.waitFor(() => expect(endpoint.handle.status()).toBe('idle'))
        await host.send(id, text, world.window)
        await vi.waitFor(() => expect(endpoint.handle.status()).toBe('idle'))
        return endpoint.sends.at(-1) ?? ''
      }
      const firstWords = await turn('Read the first fictional guide.')
      const firstFooter = firstWords.slice(firstWords.indexOf('This app adds what follows'))
      const start = world.end.newest().options.systemHint ?? firstWords
      expect(start).toContain('To save a method')
      expect(start).toContain(builtInGuide)
      expect(firstFooter).toContain('Rotate the fictional log')
      expect(firstFooter).not.toContain('To save a method')
      expect(firstFooter).not.toContain(builtInGuide)
      expect(firstFooter).not.toContain('Unchanged guide')

      revision = 'edited body'
      writeFileSync(join(methods, 'check.md'), '# Check\n')
      writeFileSync(
        join(methods, 'index.md'),
        first + '\n- Check the fictional backup | weekly | verified 2026-10-12 | check.md\n',
      )
      const changed = await turn('Read the changes.')
      expect(changed).toContain('Shared skill (observed at')
      expect(changed).toContain('Fictional guide')
      expect(changed).not.toContain('Unchanged guide')
      expect(changed).toContain('Check the fictional backup')
      expect(changed).not.toContain('Rotate the fictional log')

      await host.close(id, world.window)
      await host.resumeSession(id, world.window)
      const repeated = await turn('Read after reopening.')
      expect(repeated).not.toContain('Fictional guide')
      expect(repeated).not.toContain('Unchanged guide')
      expect(repeated).not.toContain('Check the fictional backup')
      expect(repeated).not.toContain('Rotate the fictional log')
      expect(repeated).not.toContain(builtInGuide)

      world.end.newest().handle.simulateCompaction()
      await vi.waitFor(() => expect(world.countOf(id, 'compaction')).toBe(1))
      expect(await turn('Deliver methods after compaction.')).toContain(
        'Check the fictional backup',
      )
      for (const text of ['First quiet turn.', 'Second quiet turn.', 'Third quiet turn.'])
        expect(await turn(text)).not.toContain('Check the fictional backup')
      await host.close(id, world.window)
      await host.resumeSession(id, world.window)
      expect(await turn('Reopen the same thread.')).not.toContain('Check the fictional backup')
    } finally {
      await world.dispose()
    }
  },
)

const memoryFixtures = [
  {
    provider: 'claude',
    memoryDir: claudeAutoMemoryDir,
    indexPath: claudeAutoMemoryIndex,
    note: 'fictional-notebook.md',
    index: 'MEMORY.md',
  },
  {
    provider: 'codex',
    memoryDir: codexAdHocNotesDir,
    indexPath: codexMemorySummary,
    note: '2026-11-24T15-05-00-fictional-notebook.md',
    index: 'memory_summary.md',
  },
] as const

it.each(memoryFixtures)(
  '$provider sends changed memory titles once and restores the start baseline after compaction',
  async (fixture) => {
    const world = new F093World()
    try {
      const profile = 'fictional-memory-reader'
      const claudeFolder = claudeAutoMemoryDir(world.homeOf('claude', profile))
      const codexFolder = codexAdHocNotesDir(world.homeOf('codex', profile))
      const nudge = `${MEMORY_NUDGE}\`${claudeFolder}\`, \`${codexFolder}\`.`
      const home = world.homeOf(fixture.provider, profile)
      const directory = fixture.memoryDir(home)
      mkdirSync(directory, { recursive: true })
      writeFileSync(fixture.indexPath(home), 'An existing index.')
      const host = world.buildHost(true, {
        readPromptSkills: () => ({
          root: join(world.userData, 'skills'),
          entries: [{ id: 'shared:steady', name: 'Fictional steady skill', revision: 'steady' }],
        }),
      })
      const peer = await world.open(host, fixture.provider, profile)
      await host.send(peer, 'Give the peer its title.', world.window)
      const id = await world.open(host, fixture.provider, profile)
      const turn = async (text: string) => {
        const endpoint = world.end.newest()
        await vi.waitFor(() => expect(endpoint.handle.status()).toBe('idle'))
        await host.send(id, text, world.window)
        await vi.waitFor(() => expect(endpoint.handle.status()).toBe('idle'))
        const sent = endpoint.sends.at(-1) ?? ''
        return sent.slice(sent.indexOf('This app adds what follows'))
      }
      const compact = async () => {
        const before = world.countOf(id, 'compaction')
        world.end.newest().handle.simulateCompaction()
        await vi.waitFor(() => expect(world.countOf(id, 'compaction')).toBe(before + 1))
      }
      const first = await turn('Establish the baseline.')
      expect(first.split('\n').find((line) => line.startsWith(MEMORY_NUDGE))).toBe(nudge)
      expect(first).not.toContain(MEMORY_LINE)
      await compact()
      const quiet = await turn('After an unchanged compaction.')
      expect(quiet).not.toContain('Your own instructions (')
      for (const title of QUIET_AFTER_COMPACTION) expect(quiet).not.toContain(title)

      writeFileSync(join(directory, fixture.note), 'Body stays out of the footer.')
      const added = await turn('Read the changed memory title.')
      expect(memoryLine(added)?.split('): ')[1]).toBe(`${fixture.note}.`)
      expect(added).not.toContain('Body stays out')
      expect(await turn('The note is unchanged.')).not.toContain(MEMORY_LINE)

      const other = memoryFixtures.find(({ provider }) => provider !== fixture.provider)!
      const otherHome = world.homeOf(other.provider, profile)
      const otherDirectory = other.memoryDir(otherHome)
      mkdirSync(otherDirectory, { recursive: true })
      const otherPath = join(otherDirectory, other.note)
      writeFileSync(otherPath, 'The other store has a new entry.')
      const fromOther = await turn('Read the other store change.')
      const line = memoryLine(fromOther)
      expect(line?.split('): ')[1]).toBe(`\`${otherPath}\`.`)
      expect(fromOther).toContain(`${line}\n${nudge}`)
      const repeated = await turn('The other store is unchanged.')
      expect(repeated).not.toContain(otherPath)
      expect(repeated).not.toContain(MEMORY_NUDGE)

      writeFileSync(fixture.indexPath(home), 'A changed index, longer than before.')
      expect(memoryLine(await turn('Read which index changed.'))?.split('): ')[1]).toBe(
        `${fixture.index}.`,
      )
      expect(await turn('The index is unchanged.')).not.toContain(MEMORY_LINE)

      const rule = 'Use the violet notebook for this fictional task.'
      expect(host.instructAgent(profile, rule, undefined, world.window)).not.toBeNull()
      expect(await turn('Read the new rule.')).toContain(rule)
      writeFileSync(join(directory, fixture.note), 'A second version before compaction.')
      await compact()
      const after = await turn('After a compaction with one standing change.')
      expect(after).toContain(rule)
      for (const title of QUIET_AFTER_COMPACTION) expect(after).not.toContain(title)
      expect(await turn('After the change was re-sent.')).not.toContain(rule)

      await host.close(id, world.window)
      await host.resumeSession(id, world.window)
      const reopened = await turn('First ordinary footer after reopen.')
      expect(reopened.split('\n').find((line) => line.startsWith(MEMORY_NUDGE))).toBe(nudge)
      expect(reopened).not.toContain(MEMORY_LINE)
    } finally {
      await world.dispose()
    }
  },
)
