import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BUNDLED_CODEX_DESKTOP_MANIFEST, bundledCodexBinary } from '../smoke/bundled-codex'

const DESKTOP_MANIFEST = new URL('../../../apps/desktop/package.json', import.meta.url)

describe('bundled codex smoke binary', () => {
  it('anchors package resolution at the real desktop manifest on every platform', () => {
    expect(realpathSync(fileURLToPath(BUNDLED_CODEX_DESKTOP_MANIFEST))).toBe(
      realpathSync(fileURLToPath(DESKTOP_MANIFEST)),
    )
    const desktopRequire = createRequire(BUNDLED_CODEX_DESKTOP_MANIFEST)
    expect(realpathSync(desktopRequire.resolve('./package.json'))).toBe(
      realpathSync(fileURLToPath(DESKTOP_MANIFEST)),
    )
  })

  it.runIf(process.platform === 'darwin' && process.arch === 'arm64')(
    'resolves the real installed binary from the desktop dependency tree',
    () => {
      const manifest = JSON.parse(readFileSync(DESKTOP_MANIFEST, 'utf8')) as {
        optionalDependencies?: Record<string, string>
      }
      expect(manifest.optionalDependencies?.['@openai/codex-darwin-arm64']).toBeTruthy()

      const desktopRequire = createRequire(DESKTOP_MANIFEST)
      const packageJson = desktopRequire.resolve('@openai/codex-darwin-arm64/package.json')
      const expected = realpathSync(
        join(dirname(packageJson), 'vendor', 'aarch64-apple-darwin', 'bin', 'codex'),
      )

      expect(bundledCodexBinary()).toBe(expected)
      expect(existsSync(expected)).toBe(true)
    },
  )
})
