import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { claudeProjectDirName, claudeTranscriptPath, type SessionRef } from '@brobot2/runtime'
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
 * How much of a `.meta.json` sidecar is read (115 review, MEDIUM).
 *
 * ⚠️ **A ceiling, because the sibling `.jsonl` has one and a sidecar had none.** Measured, every
 * sidecar on this machine is 123–138 bytes; 64 KB is four hundred times the largest and still small
 * enough that a symlink pointed at something enormous cannot stall the process that paints the
 * window.
 */
export const MAX_SIDECAR_BYTES = 64 * 1024

/**
 * Which of a child's artefacts to open.
 *
 * `journal` and `script` are here because they sit in the same directory and answer the same
 * question from a different angle: the journal is each agent's actual RETURN VALUE, and the script
 * is what the fan-out was. Both are addressed by an agent id rather than by a run id, because the
 * run id is the thing we do not have — see the header.
 */
export type ChildWorkPart = 'transcript' | 'journal' | 'script'

export interface ChildWorkLocation {
  path: string
  /** The workflow run it belongs to. Null for a plain Task child, which is in no run. */
  runId: string | null
}

/** A file that was read, and the RESOLVED path it was read from — a symlink's landing, not its name. */
export interface ReadFile extends TextFile {
  path: string
}

/** What a child's file is, once read. */
export interface ChildWorkFile extends TextFile {
  name: string
  runId: string | null
}

/**
 * Where a parent session keeps everything its children wrote: `<sessionId>/` beside its transcript.
 *
 * 🔴 **731 · `706` F-5 — beside the transcript the CLI RECORDED** ({@link claudeTranscriptPath}, the
 * lookup the archive uses), so a parent whose working folder names a folder Claude never wrote still
 * shows its children. ⚠️ With no transcript yet, the folder named from the cwd — where the CLI will
 * write one. Until `731` that folder was the only one asked.
 */
export function childWorkRoot(providerHome: string, parent: SessionRef): string {
  const transcript = claudeTranscriptPath(parent.sessionId, parent.cwd, providerHome)
  const folder =
    transcript !== null
      ? dirname(transcript)
      : join(providerHome, 'projects', claudeProjectDirName(parent.cwd))
  return join(folder, parent.sessionId)
}

/**
 * An id we are willing to put in a path.
 *
 * The ledger check upstream is the real gate; this is the second lock. Measured ids are 17 hex
 * characters (`a4d82f4376e9dd5c5`) and run directories are `wf_7658bea5-b25`, so the shape below is
 * wider than anything observed and still cannot contain a separator or a dot segment.
 */
function isPlainId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

/** Directory entries, or none — an absent directory is an ordinary state, not a failure. */
function subdirectories(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * The run directory holding this agent's transcript, and the transcript itself.
 *
 * Two shapes, tried in order, and the flat one first because it is 036's and it is the cheaper
 * `existsSync`. A workflow child is found by scanning the run directories — which is also how the
 * run id is learned, since nothing on the wire carries it.
 *
 * ⚑ **Both branches fire now (115).** `112` shipped the flat one unreached and said so: the host's
 * allowlist was the `workflow_run` roster, so the only ids that arrived were a dynamic workflow's
 * and those are never in the flat directory. `115` widened the allowlist to the `sub_agent` events
 * this session recorded, which is how a plain `Task` child is announced — and the flat branch is
 * the one that resolves it. Measured on this machine: **11 of the 12 Claude sub-agents this app has
 * ever recorded have a file at `subagents/agent-<agentId>.jsonl`**, and the twelfth is an id from
 * before the provider used this shape, which is an honest `gone`.
 *
 * ⚠️ **`task_notification.output_file` names this same file and is NOT a substitute** (036, carried
 * here when the module that held it was deleted as dead in 117). It is the provider's own pointer,
 * so it is worth reading as a cross-check — but it arrives only with the ENDING, and this door is
 * asked while a child may still be running. Resolution has to work without it.
 */
function locateAgentFile(root: string, agentId: string): ChildWorkLocation | null {
  const subagents = join(root, 'subagents')
  const file = `agent-${agentId}.jsonl`
  const flat = join(subagents, file)
  if (existsSync(flat)) return { path: flat, runId: null }
  const runs = join(subagents, 'workflows')
  for (const runId of subdirectories(runs)) {
    const candidate = join(runs, runId, file)
    if (existsSync(candidate)) return { path: candidate, runId }
  }
  return null
}

/**
 * Which file to open for `part`, on behalf of `agentId`.
 *
 * `null` is "there is nothing on disk to open", which is an ordinary answer: a child announced
 * before it wrote its first line has no file yet, and a plain Task child belongs to no run and so
 * has no journal and no script.
 */
export function locateChildWork(
  root: string,
  agentId: string,
  part: ChildWorkPart,
): ChildWorkLocation | null {
  if (!isPlainId(agentId)) return null
  const agent = locateAgentFile(root, agentId)
  if (agent === null || part === 'transcript') return agent
  const runId = agent.runId
  if (runId === null) return null
  if (part === 'journal') {
    const journal = join(root, 'subagents', 'workflows', runId, 'journal.jsonl')
    return existsSync(journal) ? { path: journal, runId } : null
  }
  // The script is named `<workflowName>-<runId>.js`, and the workflow name is free text the author
  // chose — so it is matched by the suffix this app can derive rather than reconstructed.
  const scripts = join(root, 'workflows', 'scripts')
  const suffix = `-${runId}.js`
  try {
    const name = readdirSync(scripts).find((entry) => entry.endsWith(suffix))
    return name === undefined ? null : { path: join(scripts, name), runId }
  } catch {
    return null
  }
}

/**
 * What the `.meta.json` beside a child's transcript says about it. Every field is optional.
 *
 * ⛔ **No `kind`, and that is `117`'s own deletion criterion applied to itself** (review, LOW). The
 * sidecar really does carry `agentType`, but nothing reads it: `readChildWork` spreads only `title`
 * and `parentToolCallId`, and `ChildWorkResult` has no field it could travel in. The card already
 * knows the kind from the parent's own stream, which is where it belongs. Parsing a value no
 * surface can display — and testing it — is what makes a field look load-bearing when it is not.
 */
export interface ChildSidecar {
  /** What it was asked to do. */
  title?: string
  /**
   * The dispatching tool-use id. **This is the attribution key** — the same id `029/035` nest a
   * card under, so a child read through this door can be placed without a new renderer branch.
   */
  parentToolCallId?: string
}

/**
 * Where the sidecar sits: beside the transcript, same stem, `.meta.json` — or `null` when the
 * transcript is not a `.jsonl` at all.
 *
 * ⚠️ **The suffix is CHECKED rather than assumed, and a followed symlink is why** (117 review,
 * LOW). This is handed the RESOLVED path, and the Claude door follows links by design and applies
 * no extension allow-list (since `731` no door does) — so the landing can be any file at all. Chopping six
 * characters off `…/subagents/notes.txt` yields the stem `…/subagents/n`, and if anything with that
 * stem carries a `description` it would be rendered as this child's title: a card naming one file
 * and described by another, which is exactly what resolving first is supposed to prevent.
 */
export function claudeSidecarPath(transcriptPath: string): string | null {
  if (!transcriptPath.endsWith('.jsonl')) return null
  return `${transcriptPath.slice(0, -'.jsonl'.length)}.meta.json`
}

/**
 * The sidecar's CONTENTS, parsed — and **only** the contents: the bytes are read by the caller,
 * through {@link readChildFile}, so this cannot become a second way to open a file.
 *
 * ⚠️ **That split is the whole point, and `117` is where the other half was deleted.** `036` shipped
 * a `readClaudeSidecar(path)` that was `existsSync` + `readFileSync` — no `realpath`, no
 * `O_NOFOLLOW`, no `O_NONBLOCK`, no regular-file check and no ceiling, every one of which
 * `readTextFile` applies to the `.jsonl` beside it. It was harmless only while nothing
 * renderer-reachable called it; `115` made this door reachable and had to be careful to use the
 * hardened path instead, leaving the unhardened one sitting in the drawer with no callers and no
 * tests. Hardening the transcript's read does not harden the sidecar's: a transcript can be an
 * ordinary file while `agent-<id>.meta.json` beside it is a symlink to a fifo or to `/dev/zero`.
 *
 * ⚠️ **The two sidecar shapes are NOT the same, and assuming the workflow one loses the useful
 * half** (115, measured). A dynamic workflow's agent gets `{"agentType":"workflow-subagent",
 * "spawnDepth":1}` — no description, no tool-use id. A plain `Task` child's carries both:
 * `{"agentType":"Explore","description":"Summarize workspace contents","toolUseId":"toolu_…",
 * "spawnDepth":1}`. So each field is taken only if it is really there, and a workflow child is
 * described by what its own sidecar says rather than by what the other kind's would have said.
 */
export function parseClaudeSidecar(text: string): ChildSidecar {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}
  const record = parsed as Record<string, unknown>
  const title = record['description']
  const parentToolCallId = record['toolUseId']
  return {
    ...(typeof title === 'string' && title ? { title } : {}),
    ...(typeof parentToolCallId === 'string' && parentToolCallId ? { parentToolCallId } : {}),
  }
}

/**
 * How many thinking blocks the child recorded, and it is a count rather than a rendering.
 *
 * ⛔ **109's rule: do not promise readable chain-of-thought.** Measured across every child file on
 * this machine — 30 files, 42 to 63 lines each — there are **10 thinking blocks and every one has
 * `thinking: ""`** beside a signature. The reasoning is not in the file.
 *
 * ⚠️ It also cannot be counted downstream: `importClaudeTranscript` drops an empty thinking block
 * entirely, so a record of `[thinking(""), text]` arrives as an `assistant_message` alone — the same
 * 30 files yield **zero** `thinking` events. Counting here, off the records themselves, is what
 * makes the viewer able to say *"three were recorded with no body"* instead of either saying
 * nothing (which reads as "it did not think") or drawing empty cards (which reads as more).
 */
export function countThinkingBlocks(lines: string[]): number {
  let count = 0
  for (const line of lines) {
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    const content = (record as { message?: { content?: unknown } }).message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if ((block as { type?: unknown })?.type === 'thinking') count++
    }
  }
  return count
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

/** Read one of a child's files, or say why not. See {@link readChildFile}. */
export function readChildWork(
  root: string,
  agentId: string,
  part: ChildWorkPart,
  max = MAX_CHILD_WORK_BYTES,
): ChildWorkFile | ReadRefusal {
  const found = locateChildWork(root, agentId, part)
  if (found === null) return 'gone'
  const read = readChildFile(found.path, max)
  if (typeof read === 'string') return read
  // ⛔ **Spelled out rather than spread, because `path` must not travel.** `ChildWorkFile` is what
  // the host hands to the renderer, and `...read` would put an absolute path on this machine into
  // it — the one thing this whole door exists to keep the renderer from ever holding. The NAME is
  // taken from where the link LANDS, which is the file that was really read.
  return {
    name: basename(read.path),
    runId: found.runId,
    text: read.text,
    truncated: read.truncated,
    bytes: read.bytes,
  }
}
