import { refuseState, STATE_LIMITS } from './format'

export const stageName = /^\.stage-[0-9a-f-]{36}$/
export const recordName = /^\d{8}\.json$/
const sealName = /^\d{8}-[a-f0-9]{64}\.seal$/

export function journalEntries(names: string[]) {
  if (
    names.length > STATE_LIMITS.records * 2 ||
    names.some((name) => !recordName.test(name) && !stageName.test(name) && !sealName.test(name))
  )
    refuseState('corrupt')
  const records = names.filter((name) => recordName.test(name)).sort()
  if (records.length === 0) refuseState('missing-guard')
  if (records.length > STATE_LIMITS.records) refuseState('limit')
  const recordNames = new Set(records)
  const seals = new Map<string, string>()
  for (const name of names.filter((name) => sealName.test(name))) {
    const sequence = name.slice(0, 8)
    if (seals.has(sequence) || !recordNames.has(`${sequence}.json`)) refuseState('corrupt')
    seals.set(sequence, name)
  }
  return { records, seals }
}
