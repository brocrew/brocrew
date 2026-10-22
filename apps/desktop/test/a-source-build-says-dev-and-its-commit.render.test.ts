import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AppTitleBar from '../src/renderer/src/components/AppTitleBar.vue'
import { shownVersion } from '../src/main/build-identity'

/**
 * A source build's `package.json` says `0.0.0`; only a release is given its number when it is
 * packaged. So a window run from a checkout read "BroCrew 0.0.0" in About and in the updates menu.
 * It now says `dev` and the commit it was built from, and a release still says its number.
 */

const SHA = 'e76e7c6a1b2c3d4e5f60718293a4b5c6d7e8f900'
const BUILT = { id: 'e76e7c6', commit: SHA, dirty: false }

describe('the version a person reads', () => {
  it('a release says the number it was packaged with, whatever its stamp', () => {
    expect(shownVersion('0.1.6', true, BUILT)).toBe('0.1.6')
    expect(shownVersion('0.1.6', true, { id: 'unknown', commit: '', dirty: false })).toBe('0.1.6')
  })

  it('a source build says dev and its commit, never the placeholder number', () => {
    expect(shownVersion('0.0.0', false, BUILT)).toBe('dev e76e7c6')
    expect(shownVersion('0.0.0', false, { ...BUILT, dirty: true })).toBe('dev e76e7c6-dirty')
  })

  it('a source build no commit describes says only dev', () => {
    expect(shownVersion('0.0.0', false, { id: 'dev', commit: '', dirty: false })).toBe('dev')
    expect(shownVersion('0.0.0', false, { id: 'unknown', commit: '', dirty: false })).toBe('dev')
  })

  it('About, the window and the updates menu all read it', () => {
    const main = join(__dirname, '..', 'src', 'main')
    const index = readFileSync(join(main, 'index.ts'), 'utf8')
    const updates = readFileSync(join(main, 'updates-in-the-app.ts'), 'utf8')
    const shown = 'shownVersion(app.getVersion(), app.isPackaged)'
    expect(index).toContain(`version: ${shown},`)
    expect(index).toContain(`applicationVersion: ${shown},`)
    expect(updates).toContain(`version: ${shown},`)
  })
})

describe('the build chip’s hover', () => {
  const hover = async (version: string): Promise<string> => {
    const info = {
      name: 'BroCrew',
      version,
      step: 'Step 0',
      windowTitle: 'BroCrew',
      build: { ...BUILT, branches: null },
      db: { migrationsApplied: 7, providerSessionCount: 0 },
    }
    const html = await renderToString(
      createSSRApp({ render: () => h(AppTitleBar as never, { info, error: null }) }),
    )
    const span = /<span\b([^>]*)data-cy="build-line"([^>]*)>/.exec(html)
    expect(span, 'the chip is not in the markup').not.toBeNull()
    return /\btitle="([^"]*)"/.exec(`${span![1]} ${span![2]}`)?.[1] ?? ''
  }

  it('names a source build without a stray v', async () => {
    expect(await hover('dev e76e7c6')).toMatch(/^BroCrew dev e76e7c6 — built from /)
  })

  it('names a release as before', async () => {
    expect(await hover('0.1.6')).toMatch(/^BroCrew v0\.1\.6 — built from /)
  })
})
