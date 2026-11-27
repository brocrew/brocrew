import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pluginSha256 } from '../package-digests'
import { decodeState, equalState, JournalRecord, refuseState } from './format'
import {
  admitOperation,
  keepLatestPerPlugin,
  newLifecycle,
  planOperation,
  resolveOperation,
  type LifecycleState,
} from './machine'

const recordName = /^\d{8}\.json$/
const sealName = /^\d{8}-[a-f0-9]{64}\.seal$/
const stageName = /^\.stage-[0-9a-f-]{36}$/

/**
 * The journal the state file replaced, read once into that state. It only reads: every journal
 * file stays exactly as it was. It counts the records the old recovery counted. A record whose
 * empty seal is missing counts, as the old recovery would have sealed it. A seal naming another
 * record, with bytes in it, or with no record, refuses. An interrupted write's leftover stage is
 * never read.
 * Workspace receipts are not carried: nothing reads them any more.
 */
export function readJournal(guard: string): LifecycleState {
  let names: string[]
  try {
    names = readdirSync(guard)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      refuseState('missing-guard')
    throw error
  }
  if (names.some((name) => !recordName.test(name) && !sealName.test(name) && !stageName.test(name)))
    refuseState('corrupt')
  const records = names.filter((name) => recordName.test(name)).sort()
  if (records.length === 0) refuseState('missing-guard')
  const seals = new Map<string, string>()
  for (const name of names.filter((one) => sealName.test(one))) {
    const sequence = name.slice(0, 8)
    if (seals.has(sequence) || !records.includes(`${sequence}.json`)) refuseState('corrupt')
    seals.set(sequence, name)
  }
  const state = newLifecycle('', '')
  state.sequence = -1
  let head: string | null = null
  records.forEach((name, index) => {
    if (name !== `${String(index).padStart(8, '0')}.json`) refuseState('corrupt')
    const bytes = readFileSync(join(guard, name))
    const checksum = pluginSha256(bytes)
    const seal = seals.get(name.slice(0, 8))
    if (
      seal !== undefined &&
      (seal !== `${name.slice(0, 8)}-${checksum}.seal` || statSync(join(guard, seal)).size !== 0)
    )
      refuseState('corrupt')
    const record = decodeState(bytes, JournalRecord)
    if (record.sequence !== index || record.previous !== head) refuseState('corrupt')
    fold(state, record)
    state.sequence = index
    head = checksum
  })
  keepLatestPerPlugin(state)
  return state
}

function fold(state: LifecycleState, record: JournalRecord): void {
  const event = record.event
  if ((event.kind === 'created') !== (record.sequence === 0)) refuseState('corrupt')
  if (event.kind === 'created') {
    state.rootId = event.rootId
    state.epoch = event.epoch
  } else if (event.kind === 'prepared') {
    const operation = event.operation
    if (
      state.operations.has(operation.request.operationId) ||
      !equalState(planOperation(state, operation.request, operation.allocated), operation)
    )
      refuseState('corrupt')
    admitOperation(state, operation)
  } else if (event.kind === 'completed' || event.kind === 'aborted') {
    if (state.pending?.request.operationId !== event.operationId) refuseState('corrupt')
    resolveOperation(state, event.kind === 'completed')
  } else if (state.pending !== null) refuseState('corrupt')
}
