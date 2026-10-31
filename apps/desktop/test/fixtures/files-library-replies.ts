import { formOfName } from '../../src/shared/documents'
import {
  compareLibraryFiles,
  type FilesLibraryRequest,
  type FilesLibraryResult,
  type LibraryKeep,
  type LibraryTask,
} from '../../src/shared/files-library'
import { filesExample } from './files-library-example'
import { filesDense } from './files-library-dense'

/** Fictional worker replies for component checks. Native query correctness is tested separately. */
export function filesLibraryReplies(dense = false) {
  const source = dense ? filesDense : filesExample
  const tasks = filesExample.tasks
  const breadcrumb = (id: string): string => {
    const task = tasks.find((one) => one.id === id)!
    return (
      (task.parent === null ? '' : `${breadcrumb(task.parent)} / `) +
      `${task.label} · ${task.title}`
    )
  }
  const keeps: LibraryKeep[] = source.keeps.map((keep) => {
    const file = source.files.find((one) => one.id === keep.file)!
    const task = tasks.find((one) => one.id === keep.task)!
    const by = filesExample.conversations.find((one) => one.id === keep.by)
    return {
      resourceId: keep.id,
      sha256: file.sha256,
      title: file.title,
      name: file.name,
      bytes: file.bytes,
      role: keep.role as 'made' | 'input',
      form: formOfName(file.name),
      keptAt: Date.parse(keep.at),
      piece: task.id,
      label: task.label,
      pieceTitle: task.title,
      breadcrumb: breadcrumb(task.id),
      clipped: false,
      addedBy: by === undefined ? null : { conversation: by.id, name: by.agent, identity: by.id },
    }
  })
  let serial = 0
  let current: Extract<FilesLibraryResult, { type: 'files' }> | null = null
  let matching = new Set<string>()
  const stamp = () => ({
    snapshot: `fictional-${serial}`,
    readAt: Date.parse('2026-10-25T00:00:00Z'),
    stale: false,
    metrics: { rows: keeps.length, bytes: 1, elapsedMs: 1, cacheBytes: 1 },
  })
  const tokenMatches = (text: string, query: string) =>
    query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .every((word) => text.toLowerCase().includes(word))
  const kind = (file: LibraryKeep) =>
    file.form === 'image' ? 'images' : file.form === null ? 'unknown' : 'documents'
  const distinct = (list: LibraryKeep[]) => new Set(list.map((one) => one.sha256)).size
  async function read(request: FilesLibraryRequest): Promise<FilesLibraryResult> {
    if (request.operation === 'release') {
      current = null
      return { type: 'released' }
    }
    if (request.operation === 'query') {
      serial++
      const query = request.query,
        scope = query.scope
      const included = new Set(
        tasks
          .filter(
            (task) =>
              scope.type === 'workspace' ||
              (scope.type === 'task'
                ? task.id === scope.id
                : task.holder === scope.id || task.givenBy === scope.id),
          )
          .map((task) => task.id),
      )
      if (scope.type !== 'workspace' && scope.includeSubtasks) {
        let before = -1
        while (before !== included.size) {
          before = included.size
          for (const task of tasks)
            if (task.parent !== null && included.has(task.parent)) included.add(task.id)
        }
      }
      const scoped = keeps.filter((keep) => included.has(keep.piece))
      const searched = scoped.filter((keep) =>
        tokenMatches(
          [
            keep.title,
            keep.name,
            keep.breadcrumb,
            keep.addedBy?.name ?? 'person',
            keep.addedBy?.identity ?? '',
            keep.role,
            kind(keep),
            keep.form ?? 'unknown',
          ].join(' '),
          query.query,
        ),
      )
      const kindBase = searched.filter((keep) => query.role === 'all' || keep.role === query.role)
      const roleBase = searched.filter((keep) => query.kind === 'all' || kind(keep) === query.kind)
      const filtered = searched.filter(
        (keep) =>
          (query.kind === 'all' || kind(keep) === query.kind) &&
          (query.role === 'all' || keep.role === query.role),
      )
      matching = new Set(filtered.map((keep) => keep.resourceId))
      const hashes = [...new Set(filtered.map((keep) => keep.sha256))]
      const files = hashes
        .map((hash) => {
          const same = filtered
            .filter((keep) => keep.sha256 === hash)
            .sort((a, b) => b.keptAt - a.keptAt || (a.resourceId < b.resourceId ? 1 : -1))
          return { file: same[0]!, matchingKeeps: same.length }
        })
        .sort((a, b) => compareLibraryFiles(a.file, b.file, query.sort))
      current = {
        type: 'files',
        ...stamp(),
        files,
        totalFiles: files.length,
        totalKeeps: filtered.length,
        scopeKeeps: scoped.length,
        next: null,
        facets: {
          kinds: {
            all: distinct(kindBase),
            documents: distinct(kindBase.filter((keep) => kind(keep) === 'documents')),
            images: distinct(kindBase.filter((keep) => kind(keep) === 'images')),
          },
          roles: {
            all: distinct(roleBase),
            made: distinct(roleBase.filter((keep) => keep.role === 'made')),
            input: distinct(roleBase.filter((keep) => keep.role === 'input')),
          },
        },
      }
      return sliceFiles(0, request.size ?? 60)
    }
    if (request.operation === 'page')
      return sliceFiles(Number(request.cursor.split(':').at(-1)), request.size ?? 60)
    if (request.operation === 'provenance') {
      const selected = keeps
        .filter((keep) => keep.sha256 === request.sha256)
        .sort((a, b) => b.keptAt - a.keptAt)
      const from = request.cursor === undefined ? 0 : Number(request.cursor.split(':').at(-1))
      const end = Math.min(selected.length, from + (request.size ?? 50))
      return {
        type: 'provenance',
        ...stamp(),
        sha256: request.sha256,
        total: selected.length,
        matching: selected.filter((keep) => matching.has(keep.resourceId)).length,
        keeps: selected
          .slice(from, end)
          .map((file) => ({ file, matching: matching.has(file.resourceId) })),
        next: end < selected.length ? `provenance:${end}` : null,
      }
    }
    const found: LibraryTask[] = tasks
      .filter((task) =>
        request.query
          ? tokenMatches(`${task.label} ${task.title} ${breadcrumb(task.id)}`, request.query)
          : task.parent === request.parent,
      )
      .map((task) => ({
        id: task.id,
        label: task.label,
        title: task.title,
        breadcrumb: breadcrumb(task.id),
        clipped: false,
        children: tasks.filter((child) => child.parent === task.id).length,
      }))
    return { type: 'tasks', ...stamp(), tasks: found, total: found.length, next: null }
  }
  function sliceFiles(from: number, size: number): FilesLibraryResult {
    if (current === null)
      return {
        type: 'unavailable',
        cause: 'cursor-expired',
        complete: false,
        visited: 0,
        unread: 0,
      }
    const end = Math.min(current.files.length, from + size)
    return {
      ...current,
      files: current.files.slice(from, end),
      next: end < current.files.length ? `files:${end}` : null,
    }
  }
  return { read, keeps, source }
}
