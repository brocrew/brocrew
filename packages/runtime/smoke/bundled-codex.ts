import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createSpawnTransportFactory, type TransportFactory } from '../src/index'

export const BUNDLED_CODEX_DESKTOP_MANIFEST = new URL(
  '../../../apps/desktop/package.json',
  import.meta.url,
)

/**
 * The transport factory pointed at the codex the app SHIPS (014). Smoke evidence is only
 * evidence if it is gathered against the pinned binary — the default bare-`codex` transport
 * would test whatever the developer's PATH holds, which is exactly the coupling 014 removed
 * from the app. Resolved the same way the app resolves it: require.resolve from apps/desktop.
 */
export function bundledCodexTransportFactory(): TransportFactory {
  return createSpawnTransportFactory(bundledCodexBinary())
}

/**
 * The absolute path of the codex the app ships — split out of the factory above (098) so a probe
 * that speaks the protocol itself, rather than through an adapter, still runs the pinned binary.
 */
export function bundledCodexBinary(): string {
  const desktopRequire = createRequire(BUNDLED_CODEX_DESKTOP_MANIFEST)
  return realpathSync(
    join(
      dirname(desktopRequire.resolve('@openai/codex-darwin-arm64/package.json')),
      'vendor',
      'aarch64-apple-darwin',
      'bin',
      'codex',
    ),
  )
}
