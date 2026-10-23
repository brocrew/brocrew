import { readTextFile, realPathOf, type ReadRefusal, type TextFile } from './read-text-file'
/**
 * Read what a provider sub-agent actually did from its own files.
 *
 * ## Where the work is, measured rather than assumed
 *
 * `109` reported `claude/tasks/<uuid>/N.json` as the candidate and `112` disproved it — that tree
 * is stale, four directories with nothing written since 7 Aug. The children write a **sidecar
 * directory beside the parent's own transcript**, and this is the layout on this machine:
 *
 * ```
 * <providerHome>/projects/<the folder the parent's transcript is in>/<parentSessionId>/
 * ├── subagents/
 * │   ├── agent-<agentId>.jsonl            ← a plain Task child (036 found this half)
 * │   └── workflows/<runId>/
 * │       ├── agent-<agentId>.jsonl        ← a dynamic workflow's agents
 * │       ├── agent-<agentId>.meta.json    {"agentType":"workflow-subagent","spawnDepth":1}
 * │       └── journal.jsonl                started/result, one row per agent per event
 * └── workflows/
 *     ├── <runId>.json                     runId, taskId, and the entire script
 *     └── scripts/<name>-<runId>.js
 * ```
 *
 * ⚑ **Each `agent-*.jsonl` is an ordinary Claude transcript** — `type: user|assistant`, message
 * content blocks, `uuid`/`parentUuid`, plus `isSidechain: true`. So it is read by
 * `importClaudeTranscript`, the same parser the archive uses, and rendered by the same components.
 * Nothing new parses anything.
 *
 * ## The correlation, verified on three runs before anything was built on it
 *
 * `workflow_run.agents[].agentId` → `agent-<agentId>.jsonl`. Checked as **set equality** against the
 * directories on disk for all three runs this app has a ledger for: 9/9, 13/13 and 3/3, no misses
 * and no extras. `112` asked for that check by name because `096` and `108` both had a confidently
 * cited shape turn out wrong.
 *
 * ⚠️ **The `runId` is NOT on the wire.** `112` said the payload carries one; it does not — the
 * persisted keys are `type, taskId, toolUseId, description, phases, agents, usage, outcome,
 * outputFile, name, source`. So the run directory is found by **looking for the agent's own file**
 * rather than by composing a path from an id we do not have. That is why {@link locateChildWork}
 * scans one directory level instead of doing arithmetic on strings.
 *
 * ## Where the path comes from
 *
 * Every path here starts from the session's OWN provider home, cwd and provider session id — all
 * three out of this app's database — and the parent's folder is the one the CLI RECORDED its
 * transcript in, found under that home by the session id (`731`, {@link childWorkRoot}); usually
 * the one named from the cwd. The renderer contributes an agent id, and only one the ledger already
 * knows. (`726` · R92: the resolved file no longer has to stay inside that directory — see
 * {@link readChildFile}.)
 */

/** How much of a child's file is read. Beyond this the reader is told, and told the real size. */
export const MAX_CHILD_WORK_BYTES = 1024 * 1024

/**
 * Which of a child's artefacts to open.
 *
 * `journal` and `script` are here because they sit in the same directory and answer the same
 * question from a different angle: the journal is each agent's actual RETURN VALUE, and the script
 * is what the fan-out was. Both are addressed by an agent id rather than by a run id, because the
 * run id is the thing we do not have — see the header.
 */
export type ChildWorkPart = 'transcript' | 'journal' | 'script'

/** A file that was read, and the RESOLVED path it was read from — a symlink's landing, not its name. */
export interface ReadFile extends TextFile {
  path: string
}

/**
 * Read one of a child's files by its real path, or say why not (112, 115).
 *
 * Resolve provider symlinks, then use {@link readTextFile} to read a regular file by descriptor with `O_NOFOLLOW` and a reported byte ceiling. The resolved file may be outside the directory searched for the child.
 */
export function readChildFile(path: string, max: number): ReadFile | ReadRefusal {
  const resolved = realPathOf(path)
  if (!resolved.ok) return resolved.reason
  const read = readTextFile(resolved.path, max)
  return typeof read === 'string' ? read : { path: resolved.path, ...read }
}
