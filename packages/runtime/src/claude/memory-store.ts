import { relative, resolve } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { attestedRoot, isWithin, namesATarget } from '../internal/confinement'
import { realResolve } from '../internal/real-path'

/**
 * Where this CLI says its memory lives, taken from `system/init.memory_paths.auto` rather than
 * re-derived from `claudeAutoMemoryDir(providerHome)`, which is what the app sent. The CLI's own
 * resolver ranks `policySettings` above our `flagSettings`, so the two can disagree, and a label
 * should name the directory the agent really writes to.
 *
 * `memdirStamped` on a tool result is not used as the predicate: it is absent on the `MEMORY.md`
 * index write and arrives after the row is drawn. Stamps may corroborate but do not decide labels.
 *
 * `memory_paths` is not in the SDK types, so it is read defensively off the frame. A build that does
 * not send it leaves {@link root} `null` and every row unlabelled. The provider does not real-path
 * it (`cwd` in the same frame is resolved, this is not), so both sides are resolved here.
 *
 * It is a registry, not a pure function: the directory arrives on `system/init` and the calls that
 * land in it many frames later, like {@link FileEdits}, {@link SubAgentTasks} and
 * {@link BackgroundTasks}. Omitting it is safe (nothing is labelled); a replay reads events from the
 * ledger and never runs this.
 */
export class ClaudeMemoryStore {
  /**
   * The store's absolute path as the provider named it, once attested, or `null`: no `init` yet, no
   * `memory_paths` on the wire, or a root that failed {@link attestedRoot}.
   */
  private root: string | null = null

  /** The same directory with every symlink on the way to it resolved. See {@link target}. */
  private realRoot: string | null = null

  /**
   * Read the store's location off a `system/init` frame. The CLI sends one per turn, so the
   * attestation is redone each time and a store that became a symlink mid-session stops being
   * attested.
   *
   * {@link attestedRoot} refuses a root whose last component redirects: with `<home>/memory` a link
   * to `<home>`, the profile's own `CLAUDE.md` would pass every containment test. The `PreToolUse`
   * hook attests this same directory with the same function, so the label and the permission cannot
   * disagree.
   */
  noteInit(message: SDKMessage): void {
    if (message.type !== 'system' || message.subtype !== 'init') return
    const paths = (message as unknown as Record<string, unknown>)['memory_paths']
    const auto =
      paths !== null && typeof paths === 'object'
        ? (paths as Record<string, unknown>)['auto']
        : undefined
    if (typeof auto !== 'string' || auto === '') {
      this.root = null
      this.realRoot = null
      return
    }
    // The provider writes it with a trailing separator; `resolve` inside `attestedRoot` drops it.
    const attested = attestedRoot(auto)
    const real = attested === null ? null : realResolve(attested)
    // Both or neither: a half-set pair would force {@link target} to remember to refuse it.
    this.root = real === null ? null : attested
    this.realRoot = real
  }

  /**
   * What this call names inside the store, relative to it, or `null` when it names nothing there. The
   * relative path keeps the informative filename visible under the row's ellipsis.
   *
   *  - {@link namesATarget} is the single test for "is this string the file the call writes", shared
   *    with `confinement.ts` so the label cannot disagree with the permission.
   *  - Top-level keys only (`Write`, `Edit`, `MultiEdit`, `NotebookEdit` declare paths there); a tool
   *    with a nested path goes unlabelled rather than mislabelled.
   *  - Both lexical and real paths must be inside the store, so a symlink pointing out of it fails,
   *    and a path that cannot be resolved is not labelled ("could not tell" is not "is a memory").
   *  - The store directory itself (empty relative path) is `null`.
   */
  target(input: unknown): string | null {
    const root = this.root
    const realRoot = this.realRoot
    if (root === null || realRoot === null) return null
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (typeof value !== 'string' || !namesATarget(value, key)) continue
      const lexical = resolve(value)
      // Cheap lexical check first: most file-tool calls are nowhere near the store, so only a path
      // already inside it lexically pays the `realpathSync`.
      if (!isWithin(root, lexical)) continue
      const real = realResolve(lexical)
      if (real === null || !isWithin(realRoot, real)) continue
      const rel = relative(root, lexical)
      if (rel !== '') return rel
    }
    return null
  }
}
