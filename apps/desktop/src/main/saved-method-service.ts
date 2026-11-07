import { unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isPathSegment } from '../shared/runtime-ipc'
import type { ActedBy } from '../shared/who-did-it'
import type {
  MethodDeleteSelection,
  MethodLibrary,
  MethodBody,
  MethodChangeSummary,
  MethodChangeResult,
  MethodHistoryResult,
} from '../shared/saved-method-library'
import { parseSavedMethodLine } from './saved-method-index'
import type {
  MethodChangeIntent,
  MethodChangeRecord,
  MethodChangeStore,
  MethodChangeReconciler,
  MethodFileState,
  MethodFileChange,
} from './db/method-changes'
import {
  captureSavedMethodDeletion,
  captureMethodFileGuard,
  listSavedMethodLibrary,
  readMethodFileCapture,
  readSavedMethodBody,
  safeMethodFileName,
  type MethodFileCapture,
  type MethodLibraryInputs,
} from './saved-method-library'
import type {
  stageKnowledgeFile,
  sweepKnowledgeStages,
  KnowledgeFileStage,
  MemoryWriteSeams,
} from './runtime/agent-memory'

interface Identity {
  readonly id: string
  readonly slug: string
}
export interface SavedMethodServiceInputs {
  readonly homesRoot: string
  /** Main derives this from a validated known identity, never from a window path. */
  readonly folderOf: (slug: string) => string
  readonly identities: () => readonly Identity[]
  readonly changes: MethodChangeStore & MethodChangeReconciler
  readonly now: () => number
  /** Main binds the existing private memory writer; no caller can choose a staging implementation. */
  readonly stage: typeof stageKnowledgeFile
  readonly sweep: typeof sweepKnowledgeStages
  readonly changed?: (slug: string) => void
  readonly seams?: {
    readonly beforePrepare?: () => Promise<void>
    readonly beforeUnlink?: (name: string) => void
    readonly writes?: MemoryWriteSeams
  }
}
export type SavedMethodResult = MethodChangeResult
export type SavedMethodService = Awaited<ReturnType<typeof createSavedMethodService>>

const locks = new Map<string, Promise<void>>()
async function locked<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => gate)
  locks.set(key, tail)
  await previous
  try {
    return await run()
  } finally {
    release()
    if (locks.get(key) === tail) locks.delete(key)
  }
}
const content = (bytes: Buffer): string => bytes.toString('base64')
/** Only a complete observation of unchanged bytes and permissions can be skipped for Undo. */
function noEffect(row: MethodChangeRecord): boolean {
  if (row.outcome === 'pending' || row.actual === null) return false
  return row.files.every((file) => {
    const actual = row.actual!.find((state) => state.name === file.name)
    return (
      actual !== undefined &&
      !actual.unreadable &&
      actual.mode !== undefined &&
      actual.base64 === (file.before?.base64 ?? null) &&
      actual.mode === (file.before?.mode ?? null)
    )
  })
}
const summary = (row: MethodChangeRecord, canUndo = false): MethodChangeSummary => ({
  id: row.id,
  sequence: row.sequence,
  operation: row.operation,
  sourceId: row.sourceId,
  target: row.target,
  outcome: row.outcome,
  by: row.by,
  createdAt: row.createdAt,
  settlement: row.settlement,
  canUndo,
  ...(noEffect(row) ? { noEffect: true } : {}),
})
interface FilePlan {
  readonly name: string
  readonly before: MethodFileCapture | null
  readonly after: Buffer | null
  readonly afterMode: number | null
}
function validNames(names: readonly string[]): boolean {
  return (
    names.length > 0 &&
    names.length <= 2 &&
    names.every(safeMethodFileName) &&
    new Set(names.map((name) => name.toLowerCase())).size === names.length
  )
}
function observed(
  inputs: MethodLibraryInputs,
  names: readonly string[],
): readonly MethodFileState[] {
  return names.map((name) => {
    try {
      const file = readMethodFileCapture(inputs, name)
      return { name, base64: file?.bytes.toString('base64') ?? null, mode: file?.mode ?? null }
    } catch (error) {
      return {
        name,
        base64: null,
        mode: null,
        unreadable: true as const,
        cause: `${join(inputs.folder, name)}: ${String(error)}`,
      }
    }
  })
}
function failed(reason: string): SavedMethodResult {
  return { ok: false, reason }
}

/** Awaited boot observation completes before main can expose any mutation or removal door. */
export async function createSavedMethodService(deps: SavedMethodServiceInputs) {
  const identity = (slug: string) =>
    isPathSegment(slug) ? deps.identities().find((one) => one.slug === slug) : undefined
  const inputsOf = (slug: string): MethodLibraryInputs => ({
    homesRoot: deps.homesRoot,
    folder: deps.folderOf(slug),
  })
  const keyOf = (slug: string) => `${resolve(deps.homesRoot)}\0${slug}`
  const announce = (slug: string) => {
    try {
      deps.changed?.(slug)
    } catch {
      /* A closed view does not undo a durable change. */
    }
  }
  const latest = (id: string) => deps.changes.list(id, 0, 1)[0]
  const undoCandidate = (id: string): MethodChangeRecord | undefined => {
    for (let offset = 0; ; offset += 100) {
      const page = deps.changes.list(id, offset, 100)
      const candidate = page.find((row) => !noEffect(row))
      if (candidate !== undefined || page.length < 100) return candidate
    }
  }

  for (const one of deps.identities()) {
    if (!isPathSegment(one.slug)) continue
    await locked(keyOf(one.slug), async () => {
      try {
        if (deps.changes.hasPending(one.id)) {
          const row = latest(one.id)
          if (row === undefined || row.outcome !== 'pending')
            throw new Error('Pending recovery is unreadable')
          const actual = observed(
            inputsOf(one.slug),
            row.files.map((file) => file.name),
          )
          if (!deps.changes.reconcile(one.id, row.id, actual, { who: 'the-app-itself' }))
            throw new Error('Recovery observation was not saved')
          announce(one.slug)
        }
        // Cleanup is separate from the observation-only ledger door and ignores live stages.
        const inputs = inputsOf(one.slug)
        try {
          deps.sweep(inputs.folder, captureMethodFileGuard(inputs))
        } catch {
          /* Missing homes are never provisioned. */
        }
      } catch (error) {
        console.warn(`Saved methods ${one.slug}: ${String(error)}`)
      }
    })
  }

  function intendedAfter(
    row: MethodChangeRecord,
    file: MethodFileChange,
    identityId: string,
  ): string | null | undefined {
    if (file.afterBase64 !== undefined) return file.afterBase64
    // A historical digest is not bytes. Reconstruct only a completed ordinary operation.
    if (row.outcome !== 'done') return undefined
    if (row.operation === 'undo') {
      const original = row.sourceId === null ? null : deps.changes.read(identityId, row.sourceId)
      const restored = original?.files.find((one) => one.name === file.name)
      return restored === undefined ? undefined : (restored.before?.base64 ?? null)
    }
    if (file.name === row.target) return null
    if (file.name.toLowerCase() !== 'index.md' || file.before === null) return undefined
    const bytes = Buffer.from(file.before.base64, 'base64')
    const kept: Buffer[] = []
    let start = 0
    for (let end = 0; end <= bytes.length; end++) {
      if (end !== bytes.length && bytes[end] !== 10) continue
      const line = parseSavedMethodLine(bytes.subarray(start, end).toString('utf8'))
      if (line === null || line.file.toLowerCase() !== row.target.toLowerCase())
        kept.push(bytes.subarray(start, Math.min(end + 1, bytes.length)))
      start = end + 1
    }
    return Buffer.concat(kept).toString('base64')
  }

  function reversePlan(
    inputs: MethodLibraryInputs,
    row: MethodChangeRecord,
    identityId: string,
  ): readonly FilePlan[] {
    if (
      row.outcome === 'pending' ||
      row.actual === null ||
      !validNames(row.files.map((file) => file.name)) ||
      !row.files.some((file) => file.name === row.target)
    )
      throw new Error('This change cannot be reversed')
    return row.files.map((file) => {
      const actual = row.actual!.find((state) => state.name === file.name)
      const after = intendedAfter(row, file, identityId)
      if (actual === undefined || actual.unreadable || after === undefined)
        throw new Error('The recorded content is unresolved')
      const beforeMode = file.before?.mode ?? null
      const afterMode =
        file.afterMode === undefined ? (after === null ? null : beforeMode) : file.afterMode
      const before = readMethodFileCapture(inputs, file.name)
      const current = before?.bytes.toString('base64') ?? null
      const currentMode = before?.mode ?? null
      if (actual.base64 === undefined) {
        // A completed old operation can be undone only when a fresh ordinary read matches its result.
        if (row.outcome !== 'done' || current !== after || currentMode !== afterMode)
          throw new Error('The file changed after this operation')
      } else {
        const knownBefore =
          actual.base64 === (file.before?.base64 ?? null) && actual.mode === beforeMode
        const knownAfter = actual.base64 === after && actual.mode === afterMode
        if (
          (!knownBefore && !knownAfter) ||
          current !== actual.base64 ||
          currentMode !== actual.mode
        )
          throw new Error('The file changed after this operation')
      }
      return {
        name: file.name,
        before,
        after: file.before === null ? null : Buffer.from(file.before.base64, 'base64'),
        afterMode: beforeMode,
      }
    })
  }
  function canUndo(
    inputs: MethodLibraryInputs,
    row: MethodChangeRecord,
    identityId: string,
  ): boolean {
    try {
      return reversePlan(inputs, row, identityId).some(
        (file) =>
          (file.before?.bytes.toString('base64') ?? null) !==
            (file.after === null ? null : content(file.after)) ||
          (file.before?.mode ?? null) !== file.afterMode,
      )
    } catch {
      return false
    }
  }

  async function apply(
    one: Identity,
    inputs: MethodLibraryInputs,
    files: readonly FilePlan[],
    target: string,
    source: MethodChangeRecord | null,
  ): Promise<SavedMethodResult> {
    if (!validNames(files.map((file) => file.name)) || !files.some((file) => file.name === target))
      return failed('unsafe-name')
    const namespace = captureMethodFileGuard(inputs)
    const intent: MethodChangeIntent = {
      operation: source === null ? 'delete' : 'undo',
      sourceId: source?.id ?? null,
      target,
      files: files.map((file) => ({
        name: file.name,
        before:
          file.before === null
            ? null
            : {
                base64: file.before.bytes.toString('base64'),
                mode: file.before.mode,
              },
        afterBase64: file.after === null ? null : content(file.after),
        afterMode: file.afterMode,
      })),
    }
    let row: MethodChangeRecord | null
    try {
      row = deps.changes.begin(one.id, intent, { who: 'a-person' }, deps.now())
    } catch (error) {
      return { ok: false, reason: 'history-unreadable', cause: String(error) }
    }
    if (row === null) return failed('change-not-started')
    announce(one.slug)
    const expected = new Map(
      files.map((file) => [
        file.name,
        {
          base64: file.before?.bytes.toString('base64') ?? null,
          mode: file.before?.mode ?? null,
        },
      ]),
    )
    const guard = () => {
      namespace()
      for (const [name, before] of expected) {
        const current = readMethodFileCapture(inputs, name)
        if (
          (current?.bytes.toString('base64') ?? null) !== before.base64 ||
          (current?.mode ?? null) !== before.mode
        )
          throw new Error(`${join(inputs.folder, name)}: the saved method changed during this edit`)
      }
    }
    const stages = new Map<string, KnowledgeFileStage>()
    let operationFailed: unknown
    try {
      guard()
      await deps.seams?.beforePrepare?.()
      guard()
      for (const file of files) {
        if (
          file.after !== null &&
          ((file.before?.bytes.toString('base64') ?? null) !== content(file.after) ||
            file.before?.mode !== file.afterMode)
        ) {
          stages.set(
            file.name,
            await deps.stage(
              join(inputs.folder, file.name),
              file.after,
              file.afterMode!,
              deps.homesRoot,
              guard,
              deps.seams?.writes,
            ),
          )
          guard()
        }
      }
      guard()
      // Delete removes references first; Undo restores a method before restoring its references.
      const ordered =
        source === null
          ? files
          : [...files].sort(
              (a, b) =>
                Number(a.name.toLowerCase() === 'index.md') -
                Number(b.name.toLowerCase() === 'index.md'),
            )
      for (const file of ordered) {
        guard()
        const stage = stages.get(file.name)
        if (stage !== undefined) stage.install(file.before !== null, guard)
        else if (file.after === null && file.before !== null) {
          deps.seams?.beforeUnlink?.(file.name)
          guard()
          unlinkSync(join(inputs.folder, file.name))
        }
        expected.set(file.name, {
          base64: file.after === null ? null : content(file.after),
          mode: file.afterMode,
        })
      }
    } catch (error) {
      operationFailed = error
    } finally {
      for (const stage of stages.values()) stage.discard()
    }
    const actual = observed(
      inputs,
      files.map((file) => file.name),
    )
    const matches = actual.every((state) => {
      const plan = intent.files.find((file) => file.name === state.name)!
      return !state.unreadable && state.base64 === plan.afterBase64 && state.mode === plan.afterMode
    })
    try {
      if (
        !deps.changes.settle(one.id, row.id, matches ? 'done' : 'partial', actual, {
          who: 'a-person',
        })
      )
        return { ok: false, reason: 'settlement-pending', change: summary(row) }
      const saved = deps.changes.read(one.id, row.id)!
      announce(one.slug)
      return matches && operationFailed === undefined
        ? { ok: true, change: summary(saved) }
        : {
            ok: false,
            reason: 'change-incomplete',
            ...((operationFailed ?? actual.find((state) => state.cause)?.cause) === undefined
              ? {}
              : {
                  cause: `${join(inputs.folder, target)}: ${String(operationFailed ?? actual.find((state) => state.cause)?.cause)}`,
                }),
            change: summary(saved),
          }
    } catch (error) {
      return { ok: false, reason: 'settlement-pending', cause: String(error), change: summary(row) }
    }
  }

  const mutate = async (
    slug: string,
    by: ActedBy,
    run: (one: Identity, inputs: MethodLibraryInputs) => Promise<SavedMethodResult>,
  ): Promise<SavedMethodResult> => {
    if (by.who !== 'a-person') return failed('person-required')
    if (identity(slug) === undefined) return failed('no-such-agent')
    return locked(keyOf(slug), async () => {
      const one = identity(slug)
      if (one === undefined) return failed('no-such-agent')
      try {
        if (deps.changes.hasPending(one.id)) return failed('unfinished-change')
        return await run(one, inputsOf(slug))
      } catch (error) {
        return {
          ok: false,
          reason: 'changed-or-unreadable',
          cause: `${inputsOf(slug).folder}: ${String(error)}`,
        }
      }
    })
  }
  return {
    /** The host uses this same fact for its removal door and the roster's disabled control. */
    hasPending(slug: string): boolean {
      const one = identity(slug)
      return one !== undefined && deps.changes.hasPending(one.id)
    },
    body(slug: string, key: string): MethodBody {
      if (identity(slug) === undefined) return { ok: false, problem: 'missing' }
      return readSavedMethodBody(inputsOf(slug), key)
    },
    list(slug: string, offset = 0, limit = 50): MethodLibrary {
      const one = identity(slug)
      if (one === undefined)
        return {
          state: 'unavailable',
          items: [],
          total: 0,
          offset,
          nextOffset: null,
          indexState: 'problem',
          indexProblem: 'unreadable',
          problem: 'unreadable',
          truncated: false,
          malformedLines: 0,
          readAt: deps.now(),
        }
      const listed = listSavedMethodLibrary(inputsOf(slug), deps.now(), offset, limit)
      const blocked = deps.changes.hasPending(one.id)
      return {
        ...listed,
        items: listed.items.map((item) => ({
          ...item,
          canDelete: item.canDelete && !blocked && safeMethodFileName(item.name),
        })),
      }
    },
    remove(
      slug: string,
      selection: MethodDeleteSelection,
      by: ActedBy,
    ): Promise<SavedMethodResult> {
      if (selection.confirmed !== true) return Promise.resolve(failed('confirmation-required'))
      return mutate(slug, by, async (one, inputs) => {
        const plan = captureSavedMethodDeletion(inputs, selection)
        const files = plan.files.map((file) => ({
          ...file,
          afterMode: file.after === null ? null : file.before!.mode,
        }))
        return apply(one, inputs, files, plan.target, null)
      })
    },
    undo(slug: string, id: string, by: ActedBy): Promise<SavedMethodResult> {
      return mutate(slug, by, async (one, inputs) => {
        const row = undoCandidate(one.id)
        if (row === undefined || row.id !== id) return failed('not-latest-change')
        const files = reversePlan(inputs, row, one.id)
        if (!canUndo(inputs, row, one.id)) return failed('nothing-to-restore')
        return apply(one, inputs, files, row.target, row)
      })
    },
    async checkInterrupted(
      slug: string,
      confirmed: boolean,
      by: ActedBy,
    ): Promise<SavedMethodResult> {
      if (by.who !== 'a-person') return failed('person-required')
      if (confirmed !== true) return failed('confirmation-required')
      if (identity(slug) === undefined) return failed('no-such-agent')
      return locked(keyOf(slug), async () => {
        try {
          const one = identity(slug)
          if (one === undefined) return failed('no-such-agent')
          const row = latest(one.id)
          if (row?.outcome !== 'pending') return failed('no-interrupted-change')
          const actual = observed(
            inputsOf(slug),
            row.files.map((file) => file.name),
          )
          const done = actual.every((state) => {
            const file = row.files.find((file) => file.name === state.name)!
            return (
              !state.unreadable &&
              state.base64 === file.afterBase64 &&
              state.mode === file.afterMode
            )
          })
          if (
            !deps.changes.settle(one.id, row.id, done ? 'done' : 'partial', actual, {
              who: 'a-person',
            })
          )
            return failed('settlement-pending')
          announce(slug)
          const change = summary(deps.changes.read(one.id, row.id)!)
          const cause = actual.find((state) => state.cause)?.cause
          return cause === undefined
            ? { ok: true, change }
            : { ok: false, reason: 'change-incomplete', cause, change }
        } catch (error) {
          return {
            ok: false,
            reason: 'history-unreadable',
            cause: `${inputsOf(slug).folder}: ${String(error)}`,
          }
        }
      })
    },
    history(slug: string, offset = 0, limit = 50): MethodHistoryResult {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        return { ok: false as const, reason: 'bad-pagination' }
      const one = identity(slug)
      if (one === undefined) return { ok: false as const, reason: 'no-such-agent' }
      try {
        const rows = deps.changes.list(one.id, offset, limit)
        const newest = deps.changes.hasPending(one.id) ? undefined : undoCandidate(one.id)
        return {
          ok: true as const,
          changes: rows.map((row) =>
            summary(row, row.id === newest?.id && canUndo(inputsOf(slug), row, one.id)),
          ),
        }
      } catch (error) {
        return { ok: false as const, reason: 'history-unreadable', cause: String(error) }
      }
    },
  }
}
