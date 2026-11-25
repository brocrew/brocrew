import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { vi } from 'vitest'
import * as codex from '@brobot2/runtime/codex'
import { createCodexModule } from '../../src/main/providers/codex'
import type { CodexKeySeam } from '../../src/main/providers/codex/types'

/** A Codex module over fictional homes, with no program ever started. */
export function aCodexWorkspace(
  root: string,
  homeOf: (profile: string) => string,
  profiles: readonly string[],
  key: CodexKeySeam,
): ReturnType<typeof createCodexModule> {
  return createCodexModule(
    {
      managedRoot: root,
      defaultProfile: 'brobot',
      homeOf,
      profiles: () => [...profiles],
      assertMayOpen: () => {},
    },
    {
      runtime: { command: () => 'fictional-not-started' },
      home: {
        provisionHome: (_root, target) => {
          mkdirSync(target, { recursive: true })
        },
        key,
      },
      auth: { command: () => 'fictional-not-started', key },
    },
  )
}

/**
 * Codex's own sign-in, stood in for: it writes `written` in the home it runs in, or nothing when
 * `written` is null, and reports success only when it wrote. Answers where it ran.
 */
export function aFakeNativeSignIn(
  written: string | null,
  options: { finish?: Promise<void>; success?: boolean } = {},
) {
  let ranIn: string | null = null
  const success = options.success ?? written !== null
  const requests: string[] = []
  const originalStart = codex.startCodexLogin
  vi.spyOn(codex, 'startCodexLogin').mockImplementation(async (_factory, target, cwd, signal) => {
    ranIn = target
    let arrived!: () => void
    const completion = new Promise<void>((done) => {
      arrived = done
    })
    const transport: codex.CodexTransport = {
      async request(method) {
        requests.push(method)
        if (method === 'account/login/start') {
          if (written !== null) writeFileSync(join(target, 'auth.json'), written)
          arrived()
          return { loginId: 'fictional-login', authUrl: 'https://login.example.invalid/fictional' }
        }
        if (method === 'getAuthStatus')
          return {
            authMethod: success ? 'chatgpt' : null,
            authToken: null,
            requiresOpenaiAuth: true,
          }
        if (method === 'account/read')
          return {
            account: success
              ? { type: 'chatgpt', email: 'fictional@example.invalid', planType: 'pro' }
              : null,
          }
        return {}
      },
      notify() {},
      respond() {},
      respondError() {},
      close() {},
      async *incoming() {
        await completion
        await options.finish
        yield { kind: 'notification', method: 'account/login/completed', params: { success } }
      },
    }
    return originalStart(() => transport, target, cwd, signal)
  })
  return { ranIn: () => ranIn, requests }
}
