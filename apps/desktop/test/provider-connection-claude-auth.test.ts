import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClaudeRuntime, type ClaudeQuery } from '@brobot2/runtime'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ApiKeys } from '../src/main/runtime/api-keys'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { resolveProviderConnection } from '../src/main/db/provider-connections'
import { onProviderConnection } from '../src/main/providers'

class Query implements ClaudeQuery {
  private end!: () => void
  private readonly ended = new Promise<void>((resolve) => {
    this.end = resolve
  })
  readonly close = vi.fn(() => this.end())
  async interrupt() {
    return undefined
  }
  async supportedModels() {
    return []
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: async () => {
        await this.ended
        return { done: true, value: undefined }
      },
    }
  }
}

let dir: string
let db: AppDatabase
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brocrew-connection-auth-'))
  db = openDatabase(':memory:')
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

for (const operation of ['start', 'resume', 'models'] as const) {
  it(`Claude ${operation}: changed-back key selection at authForALaunch cannot persist sign-in attribution`, async () => {
    const store = createSessionStore(db)
    const keys = new ApiKeys(store, {
      available: () => true,
      seal: (key) => Buffer.from(key).toString('base64'),
      open: (sealed) => Buffer.from(sealed, 'base64').toString(),
    })
    const home = join(dir, 'claude')
    mkdirSync(home)
    const query = new Query()
    const queryFactory = vi.fn(() => query)
    const spawn = vi.fn(() => {
      throw new Error('No provider process in this test')
    })
    const login = vi.fn(() => 'fictional-login')
    let consumed: string | null | undefined
    const actual = new ClaudeRuntime(
      queryFactory,
      async () => true,
      login,
      async () => login(),
      spawn,
      async () => {
        await keys.set('claude', 'fictional-fern-key')
        const key = await keys.read('claude')
        consumed = key === null ? 'sign-in' : 'api-key'
        keys.remove('claude')
        return key
      },
      'linux',
      () => 'Fictional login unavailable',
      '/fictional/claude',
    )
    const runtime = onProviderConnection(
      'claude',
      () => actual,
      (connectionId) => resolveProviderConnection(db, { provider: 'claude', connectionId }),
      undefined,
      () => keys.revision('claude'),
    )
    const options = { cwd: dir, providerHome: home }
    const pending =
      operation === 'models'
        ? runtime.listModels(options)
        : operation === 'start'
          ? runtime.start(options)
          : runtime.resume(
              { provider: 'claude', sessionId: 'fictional-native', cwd: dir, rotation: 0 },
              options,
            )
    await expect(pending).rejects.toThrow('connection changed')
    expect(consumed).toBe('api-key')
    expect(resolveProviderConnection(db, { provider: 'claude' }).id).toBe('claude:sign-in')
    expect(keys.revision('claude')).toBe(2)
    expect(queryFactory).toHaveBeenCalledTimes(1)
    expect(query.close).toHaveBeenCalledTimes(1)
    expect(login).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(db.prepare('SELECT connection_id FROM provider_session').all()).toEqual([])
  })
}
