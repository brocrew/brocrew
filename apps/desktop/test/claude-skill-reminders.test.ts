import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { readSavedMethods } from '../src/main/saved-methods'
import { F093World } from './lib/f093-host'

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
    } finally {
      await world.dispose()
    }
  },
)
