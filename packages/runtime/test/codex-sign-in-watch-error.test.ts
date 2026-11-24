import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const signIn = (refresh: string, at: string): string =>
  JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      account_id: 'acct-fictional-one',
      access_token: `a-${refresh}`,
      refresh_token: refresh,
    },
    last_refresh: at,
  })
const noLinks = (): never => {
  throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
}

/**
 * # A home whose watch failed is still brought up to date before each turn
 *
 * Where Windows refuses links, each agent's sign-in is a copy kept in step by a watch on its home.
 * A watch that fails is closed, and the check before each turn still covers that home.
 */
describe('a home whose watch failed is still brought up to date before each turn', () => {
  let root: string
  const homeOf = (who: string) => join(root, 'homes', who, 'codex')
  const keyIn = (who: string) =>
    (
      JSON.parse(readFileSync(join(homeOf(who), 'auth.json'), 'utf8')) as {
        tokens: { refresh_token: string }
      }
    ).tokens.refresh_token

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-watch-error-'))
    for (const who of ['brobot', 'farah', 'ilse']) mkdirSync(homeOf(who), { recursive: true })
    writeFileSync(
      join(homeOf('brobot'), 'auth.json'),
      signIn('key-one', '2026-11-20T08:00:00.000Z'),
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
    writeFileSync(join(homeOf('farah'), 'auth.json'), signIn('key-two', '2026-11-24T01:00:00.000Z'))
    catchUpCodexSignIn(homeOf('ilse'))
    expect(keyIn('ilse')).toBe('key-two')
  })
})
