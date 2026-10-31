import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import { createSessionStore } from '../../src/main/db/session-store'
import { FilesLibraryEngine } from '../../src/main/db/files-library-engine'
import { filesExample } from '../fixtures/files-library-example'
import type { FilesLibraryQuery, LibraryReadContext } from '../../src/shared/files-library'

export const workspaceQuery: FilesLibraryQuery = {
  scope: { type: 'workspace' },
  query: '',
  kind: 'all',
  role: 'all',
  sort: 'newest',
}
export const libraryContext: LibraryReadContext = {
  workspace: 'fictional-workspace',
  givers: [],
  hostRevision: '0',
}
export function filesLibraryFixture(now?: () => number) {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-files-library-'))
  const file = join(directory, 'fictional.sqlite')
  const db = openDatabase(file)
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../../src/main/db/migrations'))
  const store = createSessionStore(db)
  const engine = new FilesLibraryEngine(file, now)
  const owner = (id: string, name = id) => {
    store.create({ id, provider: 'codex', profileId: id, cwd: directory, approvalMode: 'ask' })
    store.setAgentDisplayName(id, name)
  }
  const task = (
    id: string,
    parent: string | null,
    number: number,
    held: string,
    given: string | null,
    title = id,
  ) => {
    db.prepare(
      `INSERT INTO work (id,parent_id,number,owner_session_id,given_by_session_id,title,brief,created_at)
      VALUES (?,?,?,?,?,?,?,1)`,
    ).run(id, parent, number, held, given, title, title)
  }
  const keep = (
    id: string,
    piece: string,
    sha: string,
    options: {
      name?: string
      title?: string
      role?: 'input' | 'made'
      at?: number
      by?: string | null
    } = {},
  ) => {
    db.prepare(
      `INSERT INTO work_resource
      (id,work_id,role,title,name,sha256,bytes,added_by_session_id,created_at)
      VALUES (?,?,?,?,?,?,1,?,?)`,
    ).run(
      id,
      piece,
      options.role ?? 'made',
      options.title ?? id,
      options.name ?? `${id}.md`,
      sha,
      options.by ?? null,
      options.at ?? 1,
    )
  }
  const example = () => {
    for (const conversation of filesExample.conversations)
      owner(conversation.id, conversation.agent)
    db.prepare('DELETE FROM work').run()
    for (const on of filesExample.tasks)
      task(
        on.id,
        on.parent,
        Number(on.label.split('.').at(-1)!.replace('W', '')),
        on.holder,
        on.givenBy,
        on.title,
      )
    for (const kept of filesExample.keeps) {
      const content = filesExample.files.find((file) => file.id === kept.file)!
      keep(kept.id, kept.task, content.sha256, {
        name: content.name,
        title: content.title,
        role: kept.role as 'made' | 'input',
        at: Date.parse(kept.at),
        by: kept.by,
      })
    }
  }
  return {
    directory,
    file,
    db,
    store,
    engine,
    owner,
    task,
    keep,
    example,
    close() {
      engine.close()
      db.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
