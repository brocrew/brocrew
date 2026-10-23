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
]
