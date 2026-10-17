import { relative, resolve } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { attestedRoot, isWithin, namesATarget } from '../internal/confinement'
import { realResolve } from '../internal/real-path'

/**
 * 🔴 **Where this CLI says its memory lives, taken from the CLI** (330 §2).
 *
 * ## ⛔ Nobody had ever asked what it sends back
 *
 * `claude-runtime.ts` has told the child `{ autoMemoryDirectory: claudeAutoMemoryDir(providerHome) }`
 * since 166. `318` measured the RECALL path across a real child and found no memory tool and no
 * citation; `319` ruled on that and closed it. ⚠️ **Neither measured the WRITE path**, and reading
 * the recall negative as one is `absence-in-a-capture-is-not-absence`.
 *
 * `330` §2 asked, with a search shaped to find a FIELD rather than an item type — because that is
 * exactly the shape `316` did not have, and the answer it missed was `agentMessage.memoryCitation`.
 * Two turns of a real `2.1.218` child, 133 distinct key paths enumerated at every depth of all 77
 * frames, plus a control write into the cwd. ⚑ **It is not empty:**
 *
 * ```
 * system/init.memory_paths.auto = "<providerHome>/memory/"          ⚑ every init frame, every turn
 * user.tool_use_result.memdirStamped = true                         ⚑ on the TOPIC file's result
 * ```
 *
 * ## ⚠️ Why this class reads the first and not the second
 *
 * `memdirStamped` is a genuine per-call memory signal and the control proves it — an ordinary
 * `Write` into the cwd, same session, same turn shape, carries no such field. ⛔ **But it is not a
 * predicate, because it is absent on the INDEX write.** Measured, both arms:
 *
 * | the call | `filePath` | `memdirStamped` |
 * |---|---|---|
 * | `Write release_notes_tag.md` | inside the store | **`true`** |
 * | `Write MEMORY.md` | inside the store | **absent** |
 * | `Write ordinary.md` (control) | the cwd | **absent** |
 *
 * Memory frontmatter stamps corroborate provider memory writes but do not decide their labels. The index is unstamped, and stamps arrive on the result after the row is drawn; relying on them alone would miss index writes.
 *
 * ## 🔴 `memory_paths.auto` outranks re-deriving the directory, and that is 330 §2's ruling
 *
 * 330 §3 proposed re-deriving `claudeAutoMemoryDir(providerHome)` where the row is built. That works
 * today and is the weaker of the two, because it labels a row from **what this app sent** rather
 * than from **what the provider resolved**. The CLI's own resolver takes `policySettings` above our
 * `flagSettings`, so the day those disagree, a re-derived label would name a directory the agent
 * is not writing to. ⚑ This one follows the provider.
 *
 * ⚠️ **It is not in `sdk.d.ts`** — zero occurrences of `memory_paths` in the pinned SDK's types, so
 * it is read defensively off the frame. A build that stops sending it leaves {@link root} `null` and
 * every row unlabelled, which is the safe direction: nothing is claimed that was not measured.
 *
 * ⚠️ **And it is not real-pathed by the provider.** In the same `init` frame the CLI reports
 * `cwd: "/private/var/folders/…"` — resolved — beside `memory_paths.auto: "/var/folders/…/memory/"`,
 * which is not. So this class resolves BOTH sides itself rather than trusting either spelling.
 *
 * ## ⚑ Why a registry, rather than a pure function
 *
 * The directory arrives on `system/init` and the calls that land in it arrive many frames later, so
 * the fact has to be held across messages — the same shape and the same reason as
 * {@link FileEdits}, {@link SubAgentTasks} and {@link BackgroundTasks}. A session owns one for its
 * life; omitting it is safe (nothing is labelled) and is what a replayed conversation does, because
 * a replay reads events out of the ledger and never runs this at all.
 */
export class ClaudeMemoryStore {
  /**
   * The store's absolute path as the provider named it, once attested — or `null` for every reason
   * there could be one: no `init` seen yet, no `memory_paths` on the wire, or a root that failed
   * {@link attestedRoot}.
   */
  private root: string | null = null

  /** The same directory with every symlink on the way to it resolved. See {@link target}. */
  private realRoot: string | null = null

  /**
   * Read the store's location off a `system/init` frame.
   *
   * ⚠️ **Called on every `init`, and the CLI sends one per turn** — measured three in a three-turn
   * session, all naming the same directory. Re-reading is therefore ordinary rather than a
   * correction, and the attestation is redone with it: a store that became a symlink mid-session
   * stops being attested at the next turn rather than at no point at all.
   *
   * ⛔ **{@link attestedRoot}, and it is 170's finding rather than caution.** `<home>/memory` being
   * a LINK to `<home>` makes `<home>/memory/CLAUDE.md` — the profile's own instruction file, which
   * is not a memory — pass every containment test by construction, because a redirected root
   * satisfies both spellings. `attestedRoot` refuses a root whose own last component redirects, and
   * it is the same function the `PreToolUse` hook attests this very directory with, so the label and
   * the permission cannot disagree about which directory this is.
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
    // ⛔ **Both or neither** (found reviewing this diff). An attested root whose real path cannot be
    // established would otherwise leave `root` set and `realRoot` null — a half-set pair that
    // {@link target} has to remember to refuse, and that nothing else in this class expects.
    this.root = real === null ? null : attested
    this.realRoot = real
  }

  /**
   * 🔴 **What this call names inside the store, relative to it — or `null` when it names nothing
   * there.**
   *
   * Use a path relative to the memory store so the informative filename survives the row's ellipsis. Match `MemoryRecallEntry`'s convention and retain the full path in `summary`.
   *
   * ⛔ **{@link namesATarget}, not a second classifier** (197 §1). It is the one test for *"is this
   * string the file this call would write to"* — absolute, nameable, and under a declared path key —
   * and the reason it is shared is that `memory-bound.ts` once answered differently from
   * `confinement.ts` about one string and 256 KiB went to disk with no card. A LABEL that disagreed
   * with the permission about which string is the target would be the same split, in words.
   *
   * ⚠️ **Top-level keys only.** These four tools (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`)
   * declare their path at the top level; `MultiEdit`'s nested `edits` declare none. A tool that
   * grows a nested path field goes unlabelled rather than mislabelled, which is the direction to be
   * wrong in.
   *
   * ⛔ **Both spellings, resolved** — `330` §3.2, and `183`'s rule about what `null` means. A
   * symlink INSIDE the store pointing out of it fails the real comparison; a path whose destination
   * cannot be established at all is not labelled, because "we could not tell" and "it is a memory"
   * are not the same answer (`074`).
   *
   * ⚠️ **The empty relative path is `null`.** `resolve(root)` of the store itself is inside the
   * store and is not a file in it — a `Read` of the directory would otherwise be labelled with a
   * blank name.
   *
   * ⚑ **One `realResolve` per file-tool call**, which is the same cost the `PreToolUse` hook already
   * pays on the same calls, and none at all once {@link root} is `null`.
   */
  target(input: unknown): string | null {
    const root = this.root
    const realRoot = this.realRoot
    if (root === null || realRoot === null) return null
    if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (typeof value !== 'string' || !namesATarget(value, key)) continue
      const lexical = resolve(value)
      // ⚠️ **The cheap comparison FIRST, and it is a cost decision rather than a style one** (found
      // reviewing this diff, and `stamp-a-measurement-when-you-ask-not-when-it-answers`' rule about
      // asking the cheap question first). Resolving before comparing put a `realpathSync` climb on
      // every file-tool call in the app — the overwhelming majority of which name a workspace file
      // that is nowhere near the store — to decide a LABEL. The conjunction is unchanged; what
      // changes is that the syscall is only paid by a path already inside the store lexically.
      if (!isWithin(root, lexical)) continue
      const real = realResolve(lexical)
      if (real === null || !isWithin(realRoot, real)) continue
      const rel = relative(root, lexical)
      if (rel !== '') return rel
    }
    return null
  }
}
