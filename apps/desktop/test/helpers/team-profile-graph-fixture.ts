import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import { graphCutoff, graphOracle } from '../fixtures/team-profile-graph-oracle'
import type { TeamProfileGraphReadContext } from '../../src/shared/team-profile-graph'

export const graphContext: TeamProfileGraphReadContext = {
  workspaceNonce: 'fictional-workspace',
  ownerNonce: 'fictional-window',
  hostRevision: '0',
  timezone: 'UTC',
}
export function graphFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'fictional-team-graph-'))
  const file = join(directory, 'fictional.sqlite')
  const executionFile = join(directory, 'profile-execution.json')
  const db = openDatabase(file)
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../../src/main/db/migrations'))
  const identity = (
    id: string,
    slug = id.slice(4),
    created = graphCutoff - 20 * 86_400_000,
    creator: string | null = null,
  ) =>
    db
      .prepare('INSERT INTO agent_identity(id,slug,created_at,created_by) VALUES(?,?,?,?)')
      .run(id, slug, created, creator)
  const session = (
    id: string,
    identity: string | null,
    at = graphCutoff - 86_400_000,
    provider = 'codex',
    model: string | null = null,
    status = 'idle',
    parent: string | null = null,
  ) =>
    db
      .prepare(
        "INSERT INTO provider_session(id,provider,profile_id,cwd,approval_mode,status,created_at,updated_at,agent_identity_id,model,parent_session_id) VALUES(?,?,?,'/fictional','ask',?,?,?,?,?,?)",
      )
      .run(id, provider, identity?.slice(4) ?? 'unbound', status, at, at, identity, model, parent)
  let sequence = 0
  const event = (
    session: string,
    type: string,
    payload: string,
    generation = 0,
    at = graphCutoff - 1,
    ordinal = ++sequence,
  ) =>
    db
      .prepare(
        'INSERT INTO events(id,session_id,ordinal,type,payload,created_at,generation) VALUES(?,?,?,?,?,?,?)',
      )
      .run(`event-${++sequence}`, session, ordinal, type, payload, at, generation)
  const root = (session: string) =>
    db
      .prepare(
        'INSERT INTO work(id,parent_id,number,owner_session_id,created_at) VALUES(?,NULL,?,?,?)',
      )
      .run(`root-${session}`, ++sequence, session, graphCutoff - 1)
  const seed = () => {
    for (const i of graphOracle.identities) identity(i.id, i.slug, i.created, i.creator)
    // Raw orphan identity binding deliberately exercises retained legacy metadata.
    db.pragma('foreign_keys = OFF')
    for (const s of graphOracle.sessions) {
      session(s.id, s.identity, graphCutoff - s.age * 86_400_000, s.provider, s.model, s.status)
      root(s.id)
      if (s.generation)
        db.prepare(
          'INSERT INTO derived_generation(session_id,active,normalizer_version,derived_through,highest,updated_at) VALUES(?,?,1,0,?,?)',
        ).run(s.id, s.generation, s.generation, graphCutoff)
    }
    db.pragma('foreign_keys = ON')
    for (const [id, giver, owner] of graphOracle.assignments)
      db.prepare(
        'INSERT INTO work(id,parent_id,number,owner_session_id,given_by_session_id,title,brief,created_at) VALUES(?,?,?,?,?,?,?,?)',
      ).run(id, 'root-a1', ++sequence, owner, giver, id, id, graphCutoff - 1)
    for (const [sender, generation, to] of graphOracle.messages)
      event(sender, 'message_sent', JSON.stringify({ to }), generation)
    for (const [sender, generation, requestId, to, parent] of graphOracle.routes)
      event(
        sender,
        'request_routed',
        JSON.stringify({ requestId, to, ...(parent === null ? {} : { parent }) }),
        generation,
      )
    for (const [s, generation, opened, closed] of graphOracle.turns)
      db.prepare(
        "INSERT INTO turn(id,session_id,ordinal,prompt,opened_at,closed_at,end_reason,generation) VALUES(?,?,?,'fictional',?,?,?,?)",
      ).run(
        `turn-${++sequence}`,
        s,
        sequence,
        opened,
        closed,
        closed === null ? null : 'completed',
        generation,
      )
  }
  return {
    directory,
    file,
    executionFile,
    db,
    identity,
    session,
    event,
    root,
    seed,
    close() {
      db.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
