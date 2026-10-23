"""Main-process provider import boundaries.

Each plant adds a value import to public application source. The boundary test parses the graph
without loading provider code. verify_row.py runs the unmodified guard first, applies one plant,
names its failing assertion, and restores and hashes every touched file.
"""

MUTATIONS = [
    ("M1 · a provider implementation imports the shared facade back — killed by `provider-module-import-boundary.test.ts`", [("apps/desktop/src/main/providers/claude/index.ts", "import { ApiKeyUnreadableError } from '../../runtime/api-keys'", "import '../../runtime/provider-homes'\nimport { ApiKeyUnreadableError } from '../../runtime/api-keys'")]),
    ("M2 · the registry imports the shared facade back — killed by `provider-module-import-boundary.test.ts`", [("apps/desktop/src/main/providers/index.ts", "import { providerRecord, type Provider } from '@brobot2/shared'", "import '../runtime/provider-homes'\nimport { providerRecord, type Provider } from '@brobot2/shared'")]),
    ("M3 · a neutral facade bypasses the registry to import an implementation — killed by `provider-module-import-boundary.test.ts`", [("apps/desktop/src/main/runtime/provider-homes.ts", "import { existsSync, readdirSync } from 'node:fs'", "import '../providers/claude'\nimport { existsSync, readdirSync } from 'node:fs'")]),
    ("M4 · a worker value-import closure reaches the main registry — killed by `provider-module-import-boundary.test.ts`", [("apps/desktop/src/main/limits-reader.worker.ts", "import { parentPort, workerData } from 'node:worker_threads'", "import './providers'\nimport { parentPort, workerData } from 'node:worker_threads'")]),
    ("M5 · the worker normalizer leaf reaches runtime registration — killed by `provider-module-import-boundary.test.ts`", [("apps/desktop/src/main/archive/normalizer.ts", "export const NORMALIZER_VERSION = 4", "import '../providers'\nexport const NORMALIZER_VERSION = 4")]),
    ("M6 · the worker normalizer leaf reaches stateless definitions — killed by `provider-module-import-boundary.test.ts`", [("apps/desktop/src/main/archive/normalizer.ts", "export const NORMALIZER_VERSION = 4", "import '../providers/definitions'\nexport const NORMALIZER_VERSION = 4")]),
    ("M7 · stateless definitions load runtime construction — killed by `provider-module-import-boundary.test.ts`", [("apps/desktop/src/main/providers/definitions.ts", "import type { Provider } from '@brobot2/shared'", "import './claude'\nimport type { Provider } from '@brobot2/shared'")]),
    ("M8 · an explicit home override still reads the operating system default — killed by `provider-home-discovery-defaults.test.ts`", [("apps/desktop/src/main/adopt/user-homes.ts", "  return providerDefinitions[provider].discovery.userHome(env, homedir)", "  const defaultHome = homedir()\n  return providerDefinitions[provider].discovery.userHome(env, () => defaultHome)")]),
    ("M9 · light transcript definitions load instruction readers — killed by `provider-module-import-boundary.test.ts`", [("apps/desktop/src/main/providers/definitions.ts", "import type { Provider } from '@brobot2/shared'", "import './claude/instructions'\nimport type { Provider } from '@brobot2/shared'")]),
    ("M10 · host launch registration names a provider instead of consuming its policy — killed by `provider-knowledge-module-boundary.test.ts`", [("apps/desktop/src/main/runtime/runtime-host.ts", "    const { id, provider, handle, sink } = options", "    const { id, provider, handle, sink } = options\n    if (provider === 'claude') void 0")]),
    ("M11 · a native-loadable provider layout imports the shared facade back — killed by `provider-module-import-boundary.test.ts`", [("apps/desktop/src/main/providers/claude/layout.mjs", "export const CLAUDE_INSTRUCTIONS_FILE = 'CLAUDE.md'", "import '../../runtime/provider-homes'\nexport const CLAUDE_INSTRUCTIONS_FILE = 'CLAUDE.md'")]),
]
