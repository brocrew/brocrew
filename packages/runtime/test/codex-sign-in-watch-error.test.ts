import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Every watch made, so a test can make one fail. */
const watches = vi.hoisted(() => [] as { emit(event: string, error: Error): boolean }[])
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return {
    ...fs,
    watch: () => {
      const watch = Object.assign(new EventEmitter(), { close() {}, unref() {} })
      watches.push(watch)
      return watch
    },
  }
})

const { catchUpCodexSignIn, shareCodexSignIn, stopKeepingCodexSignInsInStep } =
  await import('../src/codex/shared-sign-in')

const { codexHomesUnder, noLinks, signIn } = await import('./fixtures/codex-sign-in-homes')
const account = (refresh: string, at: string): string =>
  JSON.stringify(signIn('acct-fictional-one', refresh, at))

/**
 * # A home whose watch failed is still brought up to date before each turn
 *
 * Where Windows refuses links, each agent's sign-in is a copy kept in step by a watch on its home.
 * A watch that fails is closed, and the check before each turn still covers that home.
 */
describe('a home whose watch failed is still brought up to date before each turn', () => {
  let root: string
  const { homeOf, keyIn } = codexHomesUnder(() => root)

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-watch-error-'))
    for (const who of ['brobot', 'farah', 'ilse']) mkdirSync(homeOf(who), { recursive: true })
    writeFileSync(
      join(homeOf('brobot'), 'auth.json'),
      account('key-one', '2026-11-20T08:00:00.000Z'),
    )
    watches.length = 0
  })
  afterEach(() => {
    stopKeepingCodexSignInsInStep()
    rmSync(root, { recursive: true, force: true })
  })

  it('🔴 a renewal in a home whose watch failed reaches the others at their next turn', async () => {
    for (const who of ['farah', 'ilse']) {
      await shareCodexSignIn(homeOf(who), {
        managedRoot: root,
        ownHome: homeOf('brobot'),
        link: noLinks,
        platform: 'win32',
      })
    }
    for (const watch of watches) watch.emit('error', new Error('the watch failed'))
    writeFileSync(
      join(homeOf('farah'), 'auth.json'),
      account('key-two', '2026-11-24T01:00:00.000Z'),
    )
    catchUpCodexSignIn(homeOf('ilse'))
    expect(keyIn('ilse')).toBe('key-two')
  })
})
