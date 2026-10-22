import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { providerDescriptor, type Provider } from '@brobot2/shared'
export { CLAUDE_SDK_OPTIONS, CODEX_THREAD_START_CLAIMS, type SdkOptionClaim } from '@brobot2/shared'
import type { ProviderConfigInfo } from '../../shared/runtime-ipc'

/**
 * What a provider's config actually is, and what is actually in its home.
 *
 * This lives in the main process because it is the only side that can **look**. The
 * renderer is sandboxed and has no filesystem access, so a renderer-side version of
 * this could only ever assume — and an assumed list is how the info block came to
 * claim a `config.toml` that was not there while hiding a `.claude.json` that was.
 *
 * The shared provider registry holds the static configuration facts. Every provider must
 * supply them before it can be registered. Only
 * the files worth naming are reported — a provider home is also full of caches,
 * sqlite state and session logs that nobody configures.
 */

/** Whether the file is there right now. Never throws — an unreadable home reads as absent. */
function present(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

/**
 * Read the real state of a session's provider home. Called at session creation and
 * again on demand, because a snapshot goes stale the moment a file is added.
 */
export function readProviderConfig(provider: Provider, home: string): ProviderConfigInfo {
  const layout = providerDescriptor(provider).config
  return {
    home,
    homeEnv: layout.homeEnv,
    model: layout.model,
    authNote: layout.authNote,
    files: layout.files.map(({ name, note }) => {
      const path = join(home, name)
      return { name, path, note, exists: present(path) }
    }),
  }
}
