import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { oneReadAtATime } from '../src/renderer/src/lib/one-read-at-a-time'

/**
 * # 🔴 672 §3 · the Team page's re-read, priced and then bounded
 *
 * ⚑ **Measured before it was changed** (`672` §3, a real sqlite store under the real host): one
 * `theWholeForest` on a 200-conversation workspace took 22–24 ms at ~200 ledger events a
 * conversation and 123–131 ms at ~2,000; ending three children announces six times in one
 * macrotask, and each announcement was one more synchronous read on the main process — 132–146 ms
 * and 741–788 ms for one burst. ⚑ **At most one read in flight and one owed** makes any burst two
 * reads: 44–49 ms and 247–263 ms.
 *
 * ⚠️ `RuntimeScreen` is the component nothing mounts, so the RULE is here (`one-read-at-a-time.ts`)
 * and the screen is held to calling it by §3's census.
 */

/** A read the test releases by hand, recording which version of the world each one saw. */
function gatedReads() {
  let world = 0
  const seen: number[] = []
  const waiting: (() => void)[] = []
  const read = (): Promise<void> => {
    const at = world
    return new Promise<void>((resolve) => {
      waiting.push(() => {
        seen.push(at)
        resolve()
      })
    })
  }
  return {
    read,
    change: () => (world += 1),
    get world() {
      return world
    },
    seen,
    started: () => waiting.length,
    release: async () => {
      const next = waiting.shift()
      if (next === undefined) throw new Error('no read is in flight')
      next()
      // ⚠️ let the drain loop reach its next `await` before the test looks again
      for (let i = 0; i < 5; i += 1) await Promise.resolve()
    },
  }
}

describe('§1 · a burst costs two reads, whatever its size', () => {
  it('🔴 six asks while one read is in flight start ONE more read — not five', async () => {
    const g = gatedReads()
    const ask = oneReadAtATime(g.read)
    const first = ask()
    for (let i = 0; i < 5; i += 1) {
      g.change()
      void ask()
    }
    expect(g.started()).toBe(1)
    await g.release()
    // ⚑ the owed read starts as the first one lands
    expect(g.started()).toBe(1)
    await g.release()
    await first
    expect(g.seen).toHaveLength(2)
  })

  it('⚑ the planted control — one ask, one read, and nothing owed afterwards', async () => {
    const g = gatedReads()
    const ask = oneReadAtATime(g.read)
    const only = ask()
    await g.release()
    await only
    expect(g.seen).toHaveLength(1)
    expect(g.started()).toBe(0)
  })
})

describe('§2 · the last change is always read', () => {
  it('🔴 a change announced after the in-flight read began is read by the owed one', async () => {
    const g = gatedReads()
    const ask = oneReadAtATime(g.read)
    const done = ask()
    g.change()
    void ask()
    await g.release()
    await g.release()
    await done
    // ⛔ the in-flight read saw the world BEFORE the change; only the owed one saw it
    expect(g.seen).toEqual([0, 1])
    expect(g.seen.at(-1)).toBe(g.world)
  })

  it('🔴 a change during the OWED read owes one more — the loop does not stop at two', async () => {
    const g = gatedReads()
    const ask = oneReadAtATime(g.read)
    const done = ask()
    g.change()
    void ask()
    await g.release()
    // the owed read is in flight now, and the world moves again under it
    g.change()
    void ask()
    await g.release()
    await g.release()
    await done
    expect(g.seen).toEqual([0, 1, 2])
    expect(g.seen.at(-1)).toBe(g.world)
  })

  it('⚑ once everything has landed, the next ask starts a fresh read', async () => {
    const g = gatedReads()
    const ask = oneReadAtATime(g.read)
    const one = ask()
    await g.release()
    await one
    g.change()
    const two = ask()
    expect(g.started()).toBe(1)
    await g.release()
    await two
    expect(g.seen).toEqual([0, 1])
  })

  it('⚠️ a failed read does not swallow the one owed after it, and only the LAST outcome is reported', async () => {
    let calls = 0
    const ask = oneReadAtATime(async () => {
      calls += 1
      if (calls === 1) {
        void ask() // an announcement lands while the first read is failing
        throw new Error('the first read failed')
      }
    })
    await expect(ask()).resolves.toBeUndefined()
    expect(calls).toBe(2)
    // ⚑ the control — the last read failing IS reported
    const failing = oneReadAtATime(async () => {
      throw new Error('it failed')
    })
    await expect(failing()).rejects.toThrow('it failed')
  })
})

describe('§2b · what `672`’s review found the first tests did not hold', () => {
  it('🔴 R2 · a successful read that asks as it starts never puts a second read beside itself', async () => {
    // ⛔ `M29`'s harm, asserted directly — it used to die only through the failure-reporting path
    let inFlight = 0
    let most = 0
    let calls = 0
    const ask = oneReadAtATime(async () => {
      calls += 1
      inFlight += 1
      most = Math.max(most, inFlight)
      if (calls === 1) void ask() // an announcement the read itself wakes, synchronously
      await Promise.resolve()
      inFlight -= 1
    })
    await ask()
    expect(most, 'two reads were in the air at once').toBe(1)
    expect(calls, 'the ask made during the read was owed and read').toBe(2)
  })

  it('🔴 R3 · a caller’s promise waits for the OWED read — not only for the one in flight', async () => {
    const g = gatedReads()
    const ask = oneReadAtATime(g.read)
    let settled = false
    const done = ask().then(() => {
      settled = true
    })
    g.change()
    void ask()
    await g.release()
    // ⚑ the first read landed, a read is still owed — the caller has not been told yet
    expect(settled).toBe(false)
    await g.release()
    await done
    expect(settled).toBe(true)
  })

  it('🔴 R1 · a read that throws before its first await still hands the caller a promise that rejects', async () => {
    const ask = oneReadAtATime((() => {
      throw new Error('it threw at once')
    }) as unknown as () => Promise<void>)
    const outcome = ask()
    expect(outcome, 'the caller was handed no promise').toBeInstanceOf(Promise)
    await expect(outcome).rejects.toThrow('it threw at once')
  })
})

describe('§3 · the Team page reads through it, from every trigger', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const screen = readFileSync(
    join(here, '../src/renderer/src/components/RuntimeScreen.vue'),
    'utf8',
  )
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('🔴 the one read is wrapped, and nothing calls it unwrapped', () => {
    expect(screen).toContain('const readWhoIsWorking = oneReadAtATime(readWhoIsWorkingOnce)')
    // ⛔ its definition and the wrap, and no third mention — a trigger calling the bare read would
    // put a second read in the air, which is the burst this exists to bound
    expect(screen.match(/\breadWhoIsWorkingOnce\b/g)).toHaveLength(2)
  })

  it('⚑ the four triggers all call the wrapped one — arrival, both arms, and a refused read asked again', () => {
    // ⚑ W4.74 · D-033 · the Team page's half-minute re-read is gone: every move of the work is
    // pushed, and the forest is read again on it; the glance asks again only after a read that did
    // not answer.
    const calls = screen.match(/\breadWhoIsWorking\(\)/g) ?? []
    expect(calls).toHaveLength(4)
    expect(screen).toContain("if (now === 'team') void readWhoIsWorking()")
    expect(screen).not.toContain('teaming = setInterval(')
  })
})

/**
 * 🔴 **678 · §4 — the two other readers that were PRICED material, wrapped the same way.**
 *
 * ⚑ **`678` §4 measured every reader the change announcements fire** (200 conversations × 2,000
 * events, fake runtime): the workspace reading 155 ms, the room's 88 ms — ⛔ material — and the
 * rail's lists, the cast, the Work tab and the identities each under 5 ms, so left as they are
 * (672's rule: coalesce only what the measurement says is material). ⚠️ The per-read cost of the
 * workspace reading stays over the bar even coalesced; making it cheaper is main's, handed back.
 *
 * ⚑ **D-016 deleted the room** — the project workspace and its reader `readTheRoom` went with
 * projects — so the workspace reading is the one of the two left to hold to the wrap.
 */
describe('§4 · 678 · the workspace reads through it too', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const screen = readFileSync(
    join(here, '../src/renderer/src/components/RuntimeScreen.vue'),
    'utf8',
  )
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  for (const [wrapped, once] of [['readTheWorkspace', 'readTheWorkspaceOnce']] as const) {
    it(`🔴 \`${wrapped}\` is wrapped, and nothing calls \`${once}\` bare`, () => {
      expect(screen).toContain(`const ${wrapped} = oneReadAtATime(${once})`)
      // ⛔ its definition and the wrap — a third mention is a trigger with a second read in the air
      expect(screen.match(new RegExp(`\\b${once}\\b`, 'g'))).toHaveLength(2)
    })
  }

  it('⚑ the readers priced NOT material stay unwrapped — a wrap nobody measured is a claim', () => {
    for (const name of ['readTheCast', 'readTheWork']) {
      expect(screen, name).not.toContain(`const ${name} = oneReadAtATime(`)
      expect(screen, name).toContain(`async function ${name}(`)
    }
  })
})
