import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import { aServiceWorld } from './helpers/a-service-world'
import { windowWriterSampler } from '../src/main/db/window-writer-stamp'
import { limitsWriterSampler } from '../src/main/db/fresh-limits-snapshot'

it('measures fifty distinct links over five thousand fictional instruction events', async () => {
  const world = aServiceWorld()
  try {
    world.anAgent('fictional', 'normal')
    const host = world.aHost({
      windowWriterStamp: windowWriterSampler(
        world.db,
        () => world.store.canReadFreshSnapshot?.() === true,
      ),
      limitsWriterStamp: limitsWriterSampler(
        world.db,
        () => world.store.canReadFreshSnapshot?.() === true,
      ),
    })
    const create = (id: string) =>
      world.store.create({
        id,
        provider: 'claude',
        cwd: world.folder,
        approvalMode: 'ask',
        profileId: 'fictional',
      })
    create('fictional-history')
    world.store.atomically(() => {
      for (let at = 0; at < 2500; at++) {
        const askId = `fictional-${at}`
        world.store.append(
          'fictional-history',
          at * 2,
          {
            type: 'instruction_proposed',
            askId,
            ask: 'propose',
            about: 'fictional',
            proposedBy: 'fictional',
            text: 'Fictional rule.',
            why: 'Fictional reason.',
          },
          world.clock++,
        )
        world.store.append(
          'fictional-history',
          at * 2 + 1,
          {
            type: 'instruction_settled',
            askId,
            ending: 'refused',
          },
          world.clock++,
        )
      }
    })
    const targets = Array.from({ length: 50 }, (_, at) => {
      const id = `fictional-link-${at}`
      create(id)
      host.retitleForAPerson(world.store.rootOf(id)!.piece, `Fictional plan ${at}`)
      return `brocrew://conversation/${id}`
    })
    expect(world.store.events('fictional-history')).toHaveLength(5000)
    const measure = () => {
      const cpu = process.cpuUsage()
      const start = performance.now()
      const answers = targets.map((target) => host.resolveLink(target))
      const wallMs = performance.now() - start
      const used = process.cpuUsage(cpu)
      expect(answers.every((answer) => answer.state === 'available')).toBe(true)
      return { wallMs, cpuMs: (used.user + used.system) / 1000 }
    }
    process.stdout.write(
      'LINK_RESOLUTION_MEASUREMENT ' +
        JSON.stringify({
          phase: process.env.LINK_BENCHMARK_PHASE ?? 'unspecified',
          links: 50,
          events: 5000,
          cold: measure(),
          warm: measure(),
        }) +
        '\n',
    )
  } finally {
    await world.cleanUp()
  }
})
