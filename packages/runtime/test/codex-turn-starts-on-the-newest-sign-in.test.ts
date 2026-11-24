import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexRuntime } from '../src/codex/codex-runtime'
import type { CodexTransport } from '../src/codex/codex-transport'
import { CODEX_PROTOCOL_VERSION } from '../src/codex/protocol-version'
import { shareCodexSignIn, stopKeepingCodexSignInsInStep } from '../src/codex/shared-sign-in'
import { AsyncQueue } from '../src/internal/async-queue'
import { codexHomesUnder, noLinks, signIn } from './fixtures/codex-sign-in-homes'
import { threadStartResponse, turnStartResponse } from './fixtures/codex-protocol'

/**
 * # A home kept as a file starts each turn on its account's newest sign-in
 *
 * Where Windows refuses links, each agent's sign-in is a copy kept in step. Before a Codex turn
 * starts, the agent takes its account's newest sign-in, so a renewal no watch passed on is not
 * spent again.
 */
describe('a home kept as a file starts each turn on its account’s newest sign-in', () => {
  let root: string
  const { homeOf, keyIn } = codexHomesUnder(() => root)
  const holding = (who: string, key: string, at: string) => {
    mkdirSync(homeOf(who), { recursive: true })
    writeFileSync(join(homeOf(who), 'auth.json'), JSON.stringify(signIn('acct-fictional', key, at)))
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'codex-turn-catch-up-'))
  })
  afterEach(() => {
    vi.useRealTimers()
    stopKeepingCodexSignInsInStep()
    rmSync(root, { recursive: true, force: true })
  })

  it('🔴 the turn goes out on the renewal another agent made, with no watch to pass it on', async () => {
    holding('brobot', 'key-one', '2026-11-20T08:00:00.000Z')
    for (const who of ['farah', 'ilse']) {
      mkdirSync(homeOf(who), { recursive: true })
      await shareCodexSignIn(homeOf(who), {
        managedRoot: root,
        ownHome: homeOf('brobot'),
        link: noLinks,
        platform: 'win32',
      })
    }
    // What the app-server is asked, answered as a conformant one answers; the key Ilse's home
    // holds is read as its turn goes out.
    const startedOn: string[] = []
    const answers: Record<string, () => unknown> = {
      initialize: () => ({
        userAgent: `brobot2/${CODEX_PROTOCOL_VERSION} (Mac OS 26.3.0; arm64)`,
        codexHome: homeOf('ilse'),
        platformFamily: 'unix',
        platformOs: 'macos',
      }),
      'thread/start': () => threadStartResponse('th_1', '/tmp/x'),
      'turn/start': () => {
        startedOn.push(keyIn('ilse'))
        return turnStartResponse('tn_1')
      },
    }
    const queue = new AsyncQueue<never>()
    const transport = {
      request: (method: string) => Promise.resolve(answers[method]?.() ?? {}),
      notify: () => {},
      respond: () => {},
      respondError: () => {},
      incoming: () => queue,
      close: () => queue.close(),
      exited: undefined,
    } as unknown as CodexTransport
    const handle = await new CodexRuntime(() => transport).start({
      cwd: '/tmp/x',
      providerHome: homeOf('ilse'),
    })
    // Farah's Codex renews, and the watch never passes it on: its timer does not run.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    holding('farah', 'key-two', '2026-11-24T01:00:00.000Z')
    await handle.send('the next turn')
    await vi.waitFor(() => expect(startedOn).toEqual(['key-two']))
    vi.useRealTimers()
    await handle.close()
  })
})
