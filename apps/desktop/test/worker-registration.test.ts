import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { profileExecutionFile, writeProfileExecution } from '../src/main/profile-execution-file'
import { workerRegistrationOf } from '../src/main/worker-registration'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

// Fictional SQLite sessions only; no provider start is needed for a worker birth.
describe('a normal worker birth', () => {
  let world: AServiceWorld
  beforeEach(() => {
    world = aServiceWorld()
  })
  afterEach(async () => {
    await world.cleanUp()
  })

  function prepared() {
    const identity = world.anAgent('document-reader', 'normal')
    world.store.create({
      id: 'giver',
      provider: 'codex',
      cwd: world.folder,
      approvalMode: 'ask',
      profileId: 'review-lead',
    })
    const worker = {
      identity: identity.id,
      identityCreatedAt: identity.createdAt,
      giver: 'giver',
      number: 1,
    }
    return {
      worker,
      record: {
        id: 'worker',
        provider: 'codex' as const,
        cwd: world.folder,
        approvalMode: 'ask' as const,
        profileId: 'document-reader',
        parentSessionId: 'giver',
        worker,
      },
    }
  }

  it('records a matching birth atomically with the first conversation, not a new identity or root', () => {
    const { worker, record } = prepared()
    world.store.create(record)
    expect(world.store.workersBorn()).toEqual([{ ...worker, conversation: 'worker' }])
    expect(world.ledger('worker')[0]).toEqual({ type: 'worker_registered', ...worker })
    expect(world.store.nextOrdinal('worker')).toBe(1)
    expect(world.store.rootOf('worker')).toBeNull()
    expect(world.store.parentOf('worker')).toBe('giver')
    expect(
      world.store.agentIdentities().filter((one) => one.slug === 'document-reader'),
    ).toHaveLength(1)
  })

  it('rolls back a birth for another identity, leaving the existing identity and giver intact', () => {
    const { record } = prepared()
    expect(() =>
      world.store.create({ ...record, worker: { ...record.worker, identity: 'wrong-identity' } }),
    ).toThrow('does not match')
    expect(world.store.recordedOne('worker')).toBeNull()
    expect(world.store.workersBorn()).toEqual([])
    expect(world.store.recordedOne('giver')).not.toBeNull()
  })

  it('rolls back a mismatched giver instead of keeping a conflicted birth', () => {
    const { record } = prepared()
    world.store.create({
      id: 'foreign-giver',
      provider: 'codex',
      cwd: world.folder,
      approvalMode: 'ask',
      profileId: 'other-lead',
    })
    expect(() =>
      world.store.create({ ...record, worker: { ...record.worker, giver: 'foreign-giver' } }),
    ).toThrow('does not match')
    expect(world.store.recordedOne('worker')).toBeNull()
    expect(world.store.workersBorn()).toEqual([])
    expect(world.store.recordedOne('giver')).not.toBeNull()
    expect(world.store.recordedOne('foreign-giver')).not.toBeNull()
  })

  it('does not reuse a registered number, but permits the same number in a different giver pool', () => {
    const { worker, record } = prepared()
    world.store.create(record)
    expect(() => world.store.create({ ...record, id: 'duplicate' })).toThrow('already registered')
    expect(world.store.recordedOne('duplicate')).toBeNull()
    world.store.create({
      id: 'other-giver',
      provider: 'codex',
      cwd: world.folder,
      approvalMode: 'ask',
      profileId: 'another-lead',
    })
    world.store.create({
      ...record,
      id: 'other-worker',
      parentSessionId: 'other-giver',
      worker: { ...worker, giver: 'other-giver' },
    })
    expect(world.store.workersBorn()).toHaveLength(2)
  })

  it('rolls the conversation and birth back together when the ledger refuses the insertion', () => {
    const { record } = prepared()
    world.db.exec(`CREATE TEMP TRIGGER refuse_worker_birth BEFORE INSERT ON events
      WHEN NEW.type = 'worker_registered' BEGIN SELECT RAISE(ABORT, 'fixture refuses birth'); END`)
    expect(() => world.store.create(record)).toThrow('fixture refuses birth')
    expect(world.store.recordedOne('worker')).toBeNull()
    expect(world.store.workersBorn()).toEqual([])
    world.db.exec('DROP TRIGGER refuse_worker_birth')
    world.store.create(record)
    expect(world.store.workersBorn()).toHaveLength(1)
    expect(world.store.nextOrdinal('worker')).toBe(1)
  })

  it('does not interpret malformed stored registration as no workers', () => {
    const { record } = prepared()
    world.store.create(record)
    world.db
      .prepare("UPDATE events SET payload = ? WHERE session_id = 'worker' AND ordinal = 0")
      .run('{"type":"worker_registered"}')
    expect(() => world.store.workersBorn()).toThrow('does not match')
  })

  function withReplacement() {
    const { worker, record } = prepared()
    world.store.create(record)
    world.store.create({
      id: 'new-giver',
      provider: 'codex',
      cwd: world.folder,
      approvalMode: 'ask',
      profileId: 'review-lead',
    })
    world.store.append(
      'giver',
      world.store.nextOrdinal('giver'),
      { type: 'replaced_by', sessionId: 'new-giver' },
      123,
    )
    world.store.create({
      ...record,
      id: 'worker-two',
      parentSessionId: 'new-giver',
      worker: { ...worker, number: 2 },
    })
    writeProfileExecution(profileExecutionFile(world.folder), {
      profiles: {
        [worker.identity]: {
          kind: 'normal',
          identityCreatedAt: worker.identityCreatedAt,
          workerPools: [
            {
              giver: 'giver',
              nextNumber: 3,
              workers: [
                { number: 1, conversation: 'worker', phase: 'bound' },
                { number: 2, conversation: 'worker-two', phase: 'bound' },
              ],
            },
          ],
        },
      },
    })
  }

  it('proves replacement-giver ancestry at startup independently of the later live cache', () => {
    withReplacement()
    expect(world.store.workerGiverContains('giver', 'new-giver')).toBe(true)
    expect(world.store.workerGiverContains('giver', 'other-giver')).toBe(false)
    expect(world.aHost().profileKindOf('document-reader')).toBe('normal')
  })

  it('leaves a worker binding unknown when the required replacement row is unreadable', () => {
    withReplacement()
    world.db
      .prepare("UPDATE events SET payload = ? WHERE session_id = 'giver' AND type = 'replaced_by'")
      .run('{')
    expect(() => world.store.workerGiverContains('giver', 'new-giver')).toThrow('unreadable')
    expect(world.aHost().profileKindOf('document-reader')).toBe('unknown')
  })

  it('does not treat conflicting replacement evidence as a successful giver proof', () => {
    withReplacement()
    world.store.append(
      'giver',
      world.store.nextOrdinal('giver'),
      { type: 'replaced_by', sessionId: 'worker' },
      124,
    )
    expect(() => world.store.workerGiverContains('giver', 'new-giver')).toThrow('ambiguous')
    expect(world.aHost().profileKindOf('document-reader')).toBe('unknown')
  })

  it('keeps registration metadata out of the reading transcript without changing ordinary reply text', () => {
    const { worker } = prepared()
    const state = createTranscript()
    applyEvent(state, { type: 'assistant_message', text: 'The draft is ready.' })
    const before = structuredClone(state)
    applyEvent(state, { type: 'worker_registered', ...worker }, 123, 0)
    expect(state).toEqual(before)
    expect(state.items).toMatchObject([{ text: 'The draft is ready.' }])
  })

  it('requires complete typed birth data rather than silently dropping unknown or missing fields', () => {
    const { worker } = prepared()
    const event = { type: 'worker_registered', ...worker }
    expect(workerRegistrationOf(event)).toEqual(event)
    expect(workerRegistrationOf({ ...event, identityCreatedAt: -1 })).toBeNull()
    expect(workerRegistrationOf({ ...event, number: 0 })).toBeNull()
    expect(workerRegistrationOf({ ...event, giver: '' })).toBeNull()
    expect(workerRegistrationOf({ ...event, extra: true })).toBeNull()
    expect(workerRegistrationOf({ type: 'worker_registered' })).toBeNull()
  })
})
