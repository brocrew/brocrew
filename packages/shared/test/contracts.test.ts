import { describe, expect, it } from 'vitest'
import { appInfoSchema, providerSchema, sessionStatusSchema } from '../src/contracts'

describe('shared contracts', () => {
  it('accepts the known providers and rejects others', () => {
    expect(providerSchema.parse('claude')).toBe('claude')
    expect(providerSchema.parse('codex')).toBe('codex')
    expect(providerSchema.safeParse('gemini').success).toBe(false)
  })

  it('accepts the session status vocabulary', () => {
    for (const status of ['idle', 'working', 'waiting_permission', 'ended', 'errored']) {
      expect(sessionStatusSchema.safeParse(status).success).toBe(true)
    }
    expect(sessionStatusSchema.safeParse('paused').success).toBe(false)
  })

  it('validates an AppInfo payload', () => {
    const info = appInfoSchema.parse({
      name: 'BroBot2',
      windowTitle: 'BroBot2',
      workspace: { name: 'Default', path: '/x/@brobot2/desktop', isDefault: true },
      version: '0.0.0',
      step: 'Step 0',
      build: { id: 'e76e7c6', commit: 'e76e7c6f'.padEnd(40, '0'), dirty: false, branches: null },
      db: { migrationsApplied: 1, providerSessionCount: 0 },
    })
    expect(info.db.migrationsApplied).toBe(1)
    expect(info.build.id).toBe('e76e7c6')
    expect(appInfoSchema.safeParse({ name: 'x' }).success).toBe(false)
  })

  /**
   * ⛔ **The build is REQUIRED, and this is the assertion that keeps it that way** (331).
   *
   * ⚠️ The chip renders the build and the schema count behind one `v-if`, so an `app:info` that
   * parsed without a build would be a payload the renderer reads as `undefined.id` — and 039's
   * comment in `RuntimeScreen.vue` is about the last time one read on that line took its neighbour
   * down. Optional here would move that failure from this test to a blank titlebar.
   */
  it('🔴 W4.105 · A0 — the workspace is required, and every part of it', () => {
    const whole = {
      name: 'BroBot',
      windowTitle: 'BroBot — brobot-research',
      workspace: { name: 'Research', path: '/Users/x/brobot-research', isDefault: false },
      version: '0.0.0',
      step: 'Step 0',
      build: { id: 'dev', commit: '', dirty: false, branches: null },
      db: { migrationsApplied: 7, providerSessionCount: 0 },
    }
    expect(appInfoSchema.parse(whole).workspace).toEqual({
      name: 'Research',
      path: '/Users/x/brobot-research',
      isDefault: false,
    })
    const { workspace, ...withNone } = whole
    expect(appInfoSchema.safeParse(withNone).success).toBe(false)
    for (const part of ['name', 'path', 'isDefault'] as const) {
      const rest: Record<string, unknown> = { ...workspace }
      delete rest[part]
      expect(appInfoSchema.safeParse({ ...whole, workspace: rest }).success, part).toBe(false)
    }
  })

  it('refuses an AppInfo with no build — and every part of one is required', () => {
    const whole = {
      name: 'BroBot2',
      windowTitle: 'BroBot2',
      workspace: { name: 'Default', path: '/x/@brobot2/desktop', isDefault: true },
      version: '0.0.0',
      step: 'Step 0',
      build: { id: 'dev', commit: '', dirty: false, branches: null },
      db: { migrationsApplied: 1, providerSessionCount: 0 },
    }
    // ⚑ The positive first, so the four refusals below are refusing something that otherwise passes.
    expect(appInfoSchema.safeParse(whole).success).toBe(true)
    const without = { ...whole } as Record<string, unknown>
    delete without.build
    expect(appInfoSchema.safeParse(without).success).toBe(false)
    for (const missing of ['id', 'commit', 'dirty'] as const) {
      const build = { ...whole.build } as Record<string, unknown>
      delete build[missing]
      expect(appInfoSchema.safeParse({ ...whole, build }).success).toBe(false)
    }
    // An empty commit is a legal value — `dev` and `unknown` builds have one — and only the field
    // being absent is the error. Without this line the loop above would also pass for a schema
    // that demanded a non-empty string, which would refuse every dev build at runtime.
    expect(
      appInfoSchema.safeParse({ ...whole, build: { ...whole.build, commit: '' } }).success,
    ).toBe(true)
  })
})
