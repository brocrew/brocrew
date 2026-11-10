import type { Provider } from '@brobot2/shared'
import { providerDescriptor, providerRecord } from '@brobot2/shared/providers'

/**
 * ⛔ **What the two programs are CALLED, on screen** (151's register, applied by 169 §2).
 *
 * Use the program names Claude and Codex and call their storage location a folder in reader-facing prose. Share this table from main's `session-store.ts` vocabulary with renderer surfaces so they can explain whose folder they mean rather than rely on the unexplained term provider home.
 *
 * ⚠️ **`SideRail` had already written the answer as a literal** — *"Conversations from here, and
 * from Claude's and Codex's own folders"* — and that sentence is what the rest of the sweep was
 * matched to. A second literal beside it is how one of them comes to say `Codex CLI` one day.
 */
export const PROVIDER_NAME: Record<Provider, string> = providerRecord(
  (provider) => providerDescriptor(provider).displayName,
)
