import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))

function dependencies(packageJsonPath: string): Record<string, string> {
  const raw = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>
  }
  return raw.dependencies ?? {}
}

/**
 * The Claude SDK is a dependency of `@brobot2/runtime`, but the desktop app must
 * declare it too: the main bundle inlines the workspace packages from source and
 * leaves real dependencies external, so the SDK has to resolve from the app's own
 * `node_modules` at runtime. Two declarations mean two chances to drift — and the
 * SDK pin is exact on purpose, because the adapters are written against one
 * protocol surface. This keeps them in lockstep.
 */
describe('Claude SDK pin', () => {
  const SDK = '@anthropic-ai/claude-agent-sdk'
  const app = dependencies(join(here, '../package.json'))
  const runtime = dependencies(join(here, '../../../packages/runtime/package.json'))

  it('is declared by the desktop app so the externalized import resolves', () => {
    expect(app[SDK]).toBeDefined()
  })

  it('matches the runtime package exactly', () => {
    expect(app[SDK]).toBe(runtime[SDK])
  })

  it('stays exact — no range that could drift between the two', () => {
    expect(app[SDK]).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
