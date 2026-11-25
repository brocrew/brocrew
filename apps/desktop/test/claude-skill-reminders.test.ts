import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
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
  },
  {
    provider: 'codex',
    memoryDir: codexAdHocNotesDir,
    indexPath: codexMemorySummary,
    note: '2026-11-24T15-05-00-fictional-notebook.md',
  },
] as const

it.each(memoryFixtures)(
  '$provider names only existing editable folders and prints one title-ending full stop',
  async ({ provider }) => {
    const world = new F093World()
    try {
      const host = world.buildHost(true)
      for (const hasFolder of [true, false]) {
        const profile = hasFolder ? 'fictional-claude-memory' : 'fictional-no-memory'
        const folder = claudeAutoMemoryDir(world.homeOf('claude', profile))
        if (hasFolder) mkdirSync(folder, { recursive: true })
        const id = await world.open(host, provider, profile)
        const title = 'Fictional questions.'
        expect(
          await host.renameConversation({ conversation: id, title }, { kind: 'person' }),
        ).toMatchObject({ ok: true })
        const endpoint = world.end.newest()
        await host.send(id, 'Read the footer.', world.window)
        await vi.waitFor(() => expect(endpoint.handle.status()).toBe('idle'))
        const lines = endpoint.sends.at(-1)?.split('\n') ?? []
        const current = lines.find((line) => line.startsWith('Your current work: task '))
        expect(current).toContain(`${title} If the task's title`)
        const nudge = lines.find((line) => line.startsWith(MEMORY_NUDGE))
        expect(nudge).toBe(hasFolder ? `${MEMORY_NUDGE}\`${folder}\`.` : undefined)
        if (!hasFolder) {
          mkdirSync(folder, { recursive: true })
          await host.send(id, 'Read after the empty folder was made.', world.window)
          await vi.waitFor(() => expect(endpoint.handle.status()).toBe('idle'))
          expect(endpoint.sends.at(-1)).not.toContain(MEMORY_NUDGE)
        }
      }
    } finally {
      await world.dispose()
    }
  },
)

it.each(memoryFixtures)(
  '$provider sends memory changes by path once and restores the start baseline after compaction',
  async (fixture) => {
    const world = new F093World()
    const idleDelay = 86_400_000
    const countdowns = vi.spyOn(globalThis, 'setTimeout')
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
        idleStopAfterMs: idleDelay,
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
        const endings = world.countOf(id, 'turn')
        await host.send(id, text, world.window)
        await vi.waitFor(() => expect(world.countOf(id, 'turn')).toBe(endings + 1))
        const sent = endpoint.sends.at(-1) ?? ''
        return sent.slice(sent.indexOf('This app adds what follows'))
      }
      const compact = async () => {
        const before = world.countOf(id, 'compaction')
        world.end.newest().handle.simulateCompaction()
        await vi.waitFor(() => expect(world.countOf(id, 'compaction')).toBe(before + 1))
      }
      const fail = async (text: string) => {
        const endpoint = world.end.newest()
        const endings = world.countOf(id, 'turn')
        endpoint.handle.holdNextTurn()
        await host.send(id, text, world.window)
        await vi.waitFor(() => expect(endpoint.handle.status()).toBe('working'))
        endpoint.handle.simulateError('The fictional provider exited.', true)
        await vi.waitFor(() => {
          const settled = world.ledger(id).filter((event) => event.type === 'turn')[endings]
          expect(settled).toMatchObject({ state: 'failed', wordOf: 'this-app' })
        })
        await host.close(id, world.window)
        await host.resumeSession(id, world.window)
        return endpoint.sends.at(-1)
      }
      expect(await fail('Fail before the first nudge could be kept.')).toContain(MEMORY_NUDGE)
      const first = await turn('Establish the baseline.')
      expect(first.split('\n').find((line) => line.startsWith(MEMORY_NUDGE))).toBe(
        `${MEMORY_NUDGE}\`${directory}\`.`,
      )
      expect(first).not.toContain(MEMORY_LINE)
      expect(await fail('Fail after the nudge was kept.')).not.toContain(MEMORY_NUDGE)
      expect(await turn('Resume the same context again.')).not.toContain(MEMORY_NUDGE)
      await compact()
      const quiet = await turn('After an unchanged compaction.')
      expect(quiet).not.toContain('Your own instructions (')
      expect(quiet).toContain(MEMORY_NUDGE)
      for (const title of QUIET_AFTER_COMPACTION) expect(quiet).not.toContain(title)

      const ownPath = join(directory, fixture.note)
      writeFileSync(ownPath, 'Body stays out of the footer.')
      const added = await turn('Read the changed memory path.')
      expect(memoryLine(added)?.split('): ')[1]).toBe(`\`${ownPath}\`.`)
      expect(added).not.toContain('Body stays out')
      expect(added).toContain(MEMORY_NUDGE)
      const unchanged = await turn('The note is unchanged.')
      expect(unchanged).not.toContain(MEMORY_LINE)
      expect(unchanged).not.toContain(MEMORY_NUDGE)

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

      for (const path of [ownPath, otherPath]) {
        writeFileSync(path, 'This edit replaces the old body.')
        expect(memoryLine(await turn('Read which note was edited.'))?.split('): ')[1]).toBe(
          `\`${path}\`.`,
        )
        expect(await turn('The edit was already announced.')).not.toContain(MEMORY_LINE)

        unlinkSync(path)
        expect(memoryLine(await turn('Read which note was removed.'))?.split('): ')[1]).toBe(
          `removed: \`${path}\`.`,
        )
        expect(await turn('The removal was already announced.')).not.toContain(MEMORY_LINE)
      }

      writeFileSync(fixture.indexPath(home), 'A changed index, longer than before.')
      expect(memoryLine(await turn('Read which index changed.'))?.split('): ')[1]).toBe(
        `\`${fixture.indexPath(home)}\`.`,
      )
      expect(await turn('The index is unchanged.')).not.toContain(MEMORY_LINE)

      const rule = 'Use the violet notebook for this fictional task.'
      expect(host.instructAgent(profile, rule, undefined, world.window)).not.toBeNull()
      expect(await turn('Read the new rule.')).toContain(rule)
      writeFileSync(ownPath, 'A note recreated before compaction.')
      await compact()
      const after = await turn('After a compaction with one standing change.')
      expect(after).toContain(rule)
      expect(after).toContain(MEMORY_NUDGE)
      for (const title of QUIET_AFTER_COMPACTION) expect(after).not.toContain(title)
      const afterResend = await turn('After the change was re-sent.')
      expect(afterResend).not.toContain(rule)
      expect(afterResend).not.toContain(MEMORY_NUDGE)

      const previous = world.end.newest().handle
      const countdown = countdowns.mock.calls.map(([, delay]) => delay).lastIndexOf(idleDelay)
      expect(countdown).toBeGreaterThanOrEqual(0)
      clearTimeout(countdowns.mock.results[countdown]?.value)
      countdowns.mock.calls[countdown]?.[0]()
      await vi.waitFor(() => expect(previous.status()).toBe('ended'))
      const wake = await host.startAndSend(
        id,
        'First ordinary footer after idle stop.',
        world.window,
      )
      expect('notSent' in wake).toBe(false)
      const resumed = world.end.newest()
      expect(resumed.handle).not.toBe(previous)
      expect(resumed.handle.ref.sessionId).toBe(previous.ref.sessionId)
      const reopened = resumed.sends.at(-1)
      expect(reopened).toContain('First ordinary footer after idle stop.')
      expect(reopened).not.toContain(MEMORY_NUDGE)
      expect(reopened).not.toContain(MEMORY_LINE)
    } finally {
      countdowns.mockRestore()
      await world.dispose()
    }
  },
)
