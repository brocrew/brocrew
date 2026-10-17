import { describe, expect, it } from 'vitest'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { RuntimeEventSink, RuntimeHost } from '../src/main/runtime/runtime-host'

/**
 * # ⛔ 625 M13 · reading an agent's memory asks for a person — on the first page AND on a page named
 *
 * ⚑ F093 (8efcfba7) split `agentMemory` into two arms: a page named (`offset` / `limit`) goes to
 * `agentMemoryPage`, and no page to `agentMemory`, the first twenty. Each arm has its own
 * `requireAPerson`. A source census that the case's body CONTAINS the gate cannot see one of the two
 * dropped, since the other still matches — so this file asks the real dispatcher, arm by arm, with a
 * sink no person is behind: refused, and the host never read; the same command from a person reads.
 */

class Sink implements RuntimeEventSink {
  readonly ownerId = 'owner:1'
  readonly alive = true
  constructor(readonly aPersonIsBehindIt: boolean) {}
  send(): void {}
  sendLiveness(): void {}
}

/** A host that only records which read it was asked for — nothing else is reachable here. */
function aRecordingHost(): { host: RuntimeHost; asked: string[] } {
  const asked: string[] = []
  const host = {
    agentMemory: (profileId: string) => {
      asked.push(`first-page:${profileId}`)
      return { profileId, notes: [] }
    },
    agentMemoryPage: (profileId: string, offset: number, limit: number) => {
      asked.push(`page:${profileId}:${String(offset)}:${String(limit)}`)
      return { profileId, notes: [] }
    },
  } as unknown as RuntimeHost
  return { host, asked }
}

const FIRST_PAGE = { kind: 'agentMemory', profileId: 'pm' }
const A_PAGE = { kind: 'agentMemory', profileId: 'pm', offset: 20, limit: 20 }

describe('625 M13 · the memory read asks for a person on both arms', () => {
  for (const [arm, command, read] of [
    ['the first page', FIRST_PAGE, 'first-page:pm'],
    ['a page named', A_PAGE, 'page:pm:20:20'],
  ] as const) {
    it(`⛔ ${arm}: refused when no person is behind the sink, and the host is never read`, async () => {
      const { host, asked } = aRecordingHost()
      await expect(executeRuntimeCommand(host, new Sink(false), command)).rejects.toThrow()
      expect(asked).toEqual([])
    })

    it(`⚑ ${arm}: the same command from a person reads it`, async () => {
      const { host, asked } = aRecordingHost()
      await executeRuntimeCommand(host, new Sink(true), command)
      expect(asked).toEqual([read])
    })
  }
})
