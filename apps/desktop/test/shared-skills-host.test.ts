import { afterEach, beforeEach, expect, it } from 'vitest'
import { join } from 'node:path'
import { F093World } from './lib/f093-host'
let world: F093World
beforeEach(() => {
  world = new F093World()
})
afterEach(async () => {
  await world.dispose()
})
it.each(['claude', 'codex'] as const)(
  'hands every %s profile the shared root at start/resume and tells each turn where to write',
  async (provider) => {
    const root = join(world.userData, 'skills')
    const beforeSkillDiscovery = async () => {}
    const lifetimes: { until: Promise<void>; settled: boolean }[] = []
    const host = world.buildHost(false, {
      sharedSkillsRoot: async () => root,
      prepareSharedSkills: async () => {},
      beforeSkillDiscovery,
      prepareBuiltInSkills: async ({ isCurrent, inUseUntil }) => {
        expect(inUseUntil).toBeInstanceOf(Promise)
        const lifetime = { until: inUseUntil!, settled: false }
        lifetimes.push(lifetime)
        void inUseUntil!.then(() => {
          lifetime.settled = true
        })
        return {
          context: { root: join(world.userData, 'built-ins'), skills: [] },
          reminder: '',
          version: 'v23',
          isCurrent,
        }
      },
    })
    for (const profile of ['recipe-writer', 'recipe-reviewer']) {
      const id = await world.open(host, provider, profile)
      const firstLifetime = lifetimes.at(-1)!
      expect(firstLifetime.settled).toBe(false)
      expect(world.end.newest().options.sharedSkillsRoot).toBe(root)
      expect(world.end.newest().options.beforeSkillDiscovery).toBe(beforeSkillDiscovery)
      await host.send(id, 'Check the fictional recipe.', world.window)
      expect(world.end.newest().sends.at(-1)).toContain(
        `Shared skills: ${root}. Add or edit a skill there; every agent sees it from its next turn.`,
      )
      await host.close(id, world.window)
      await firstLifetime.until
      expect(firstLifetime.settled).toBe(true)
      await host.resumeSession(id, world.window)
      expect(world.end.newest().options.sharedSkillsRoot).toBe(root)
      expect(world.end.newest().options.beforeSkillDiscovery).toBe(beforeSkillDiscovery)
      expect(lifetimes.at(-1)!.until).not.toBe(firstLifetime.until)
      expect(lifetimes.at(-1)!.settled).toBe(false)
      await host.send(id, 'Check it again.', world.window)
      expect(world.end.newest().sends.at(-1)).toContain(`Shared skills: ${root}.`)
      await host.close(id, world.window)
      await lifetimes.at(-1)!.until
      expect(lifetimes.at(-1)!.settled).toBe(true)
    }
  },
)
