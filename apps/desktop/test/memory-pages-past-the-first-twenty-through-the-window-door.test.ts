import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { AgentMemoryReading, AgentMemoryStore } from '../src/shared/agent-memory'
import { F093World } from './lib/f093-host'

/**
 * # F093 · C8 b — `agentMemory({ profileId, offset, limit })`, paged, through the window's own door
 *
 * ⚑ The contract (§1.7): `limit` defaults to 20 and is at most 100; each store carries `total` and
 * `nextOffset` (`null` after the last page); the fixed files are on page one only; a page ends at its
 * 256 KiB budget and `nextOffset` points at the file that did not fit, so no file falls between two
 * pages; **entries past a store's first 20 topic files come with `amendable: false`** — by where they
 * are in the store, not by which page they are on.
 *
 * ⚑ The dev's test reads `host.agentMemoryPage` directly with offset 0 and 20; these go through
 * `executeRuntimeCommand`, as the preload's `agentMemory` does, and read a second full page, the last
 * partial one, a page that straddles the twentieth file, a page past the end, and the budget's edge.
 */

describe('F093 · memory pages, through the window’s door', () => {
  let world: F093World
  let host: RuntimeHost

  beforeEach(() => {
    world = new F093World()
    host = world.buildHost()
  })

  afterEach(async () => {
    await world.dispose()
  })

  /** `MEMORY.md` and `count` topic files, `topic-00.md` … — each `bytes` long when given. */
  const seed = (count: number, bytes?: (at: number) => number): void => {
    const dir = join(world.homeOf('claude', 'lead'), 'memory')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'MEMORY.md'), '- [Style](style.md) — one line per change\n')
    for (let at = 0; at < count; at++) {
      const name = `topic-${String(at).padStart(2, '0')}.md`
      const size = bytes?.(at)
      writeFileSync(
        join(dir, name),
        size === undefined ? `Topic ${String(at)}.\n` : 'x'.repeat(size),
      )
    }
  }

  const page = async (input: { offset?: number; limit?: number }): Promise<AgentMemoryStore> => {
    const reading = (await executeRuntimeCommand(host, world.window, {
      kind: 'agentMemory',
      profileId: 'lead',
      ...input,
    })) as AgentMemoryReading
    const claude = reading.stores.find((one) => one.provider === 'claude')
    if (claude === undefined) throw new Error('no Claude store')
    return claude
  }

  const names = (store: AgentMemoryStore): string[] =>
    store.entries.map((one) => basename(one.path))
  const topics = (from: number, to: number): string[] =>
    Array.from({ length: to - from }, (_, at) => `topic-${String(from + at).padStart(2, '0')}.md`)

  it('⚑ a limit alone pages: the fixed file and the first topics, with the total and where the next page starts', async () => {
    seed(45)
    const first = await page({ limit: 5 })
    expect(names(first)).toEqual(['MEMORY.md', ...topics(0, 5)])
    expect(first.total).toBe(46)
    expect(first.nextOffset).toBe(5)
    expect(first.entries.every((one) => one.amendable)).toBe(true)
  })

  it('⚑ an offset alone pages twenty: a second full page, without the fixed file', async () => {
    seed(45)
    const second = await page({ offset: 20 })
    expect(names(second)).toEqual(topics(20, 40))
    expect(second.total).toBe(46)
    expect(second.nextOffset).toBe(40)
    expect(second.entries.some((one) => one.amendable)).toBe(false)
  })

  it('⚑ the last page is partial and says it is the last', async () => {
    seed(45)
    const last = await page({ offset: 40, limit: 20 })
    expect(names(last)).toEqual(topics(40, 45))
    expect(last.nextOffset).toBeNull()
    expect(last.total).toBe(46)
    expect(last.entries.some((one) => one.amendable)).toBe(false)
  })

  it('⛔ a page that straddles the twentieth file: amendable up to it, and not past it — whatever the page', async () => {
    seed(45)
    const straddle = await page({ offset: 15, limit: 10 })
    expect(names(straddle)).toEqual(topics(15, 25))
    expect(straddle.nextOffset).toBe(25)
    const amendable = Object.fromEntries(
      straddle.entries.map((one) => [basename(one.path), one.amendable]),
    )
    for (const name of topics(15, 20)) expect(amendable[name], name).toBe(true)
    for (const name of topics(20, 25)) expect(amendable[name], name).toBe(false)
  })

  it('⚑ an offset at or past the end is an empty last page, and still says how many there are', async () => {
    seed(45)
    for (const offset of [45, 1_000]) {
      const beyond = await page({ offset, limit: 20 })
      expect(beyond.entries, String(offset)).toEqual([])
      expect(beyond.nextOffset, String(offset)).toBeNull()
      expect(beyond.total, String(offset)).toBe(46)
      // ⚑ W4.177 — not "nothing written": the store holds 46.
      expect(beyond.state, String(offset)).toBe('past-the-last-page')
    }
  })

  it('⛔ a limit over 100 is refused at the door', async () => {
    seed(3)
    await expect(page({ limit: 101 })).rejects.toThrow(/invalid runtime command/)
    expect(names(await page({ limit: 100 }))).toEqual(['MEMORY.md', ...topics(0, 3)])
  })

  it('⛔ a page ends where its 256 KiB do, and the next starts at the file that did not fit — none falls between', async () => {
    // ⚑ Five of 60 KiB and a small sixth: four fit beside MEMORY.md, the fifth does not.
    seed(6, (at) => (at < 5 ? 60 * 1024 : 1024))
    const first = await page({ limit: 20 })
    expect(names(first)).toEqual(['MEMORY.md', ...topics(0, 4)])
    expect(first.nextOffset).toBe(4)
    const second = await page({ offset: first.nextOffset ?? -1, limit: 20 })
    expect(names(second)).toEqual(topics(4, 6))
    expect(second.nextOffset).toBeNull()
    // ⛔ Every topic file once, in order, across the two pages.
    expect([...names(first).slice(1), ...names(second)]).toEqual(topics(0, 6))
  })
})
