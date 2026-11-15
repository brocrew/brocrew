import {
  requireEvidence,
  startOrder,
  READY_LINE,
  CHECKPOINT_LINE,
  FAIL_LINE,
} from './upgrade-path.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CAPPED = new Set(['provider_commands', 'tool_inventory', 'launched'])

/** Ordinary, freshly generated fixtures: only the three absolute-one history caps may remove rows. */
export function retainedFixtureTables(before, after, version) {
  if (!/^0\.2\.(?:2[7-9]|[3-9]\d)(?:$|[-+])/.test(version)) return { tables: before, removed: [] }
  const present = new Set((after.events ?? []).map((row) => row.id))
  const all = new Map((after.events ?? []).map((row) => [row.id, row]))
  for (const row of before.events ?? []) all.set(row.id, row)
  const active = new Map(
    (after.derived_generation ?? []).map((row) => [row.session_id, row.active]),
  )
  const groups = new Map()
  for (const row of all.values()) {
    const key = JSON.stringify([row.session_id, row.type])
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  const allowed = new Set()
  const payloadOf = (row) => {
    try {
      const value = JSON.parse(row.payload)
      return value && !Array.isArray(value) && value.type === row.type ? value : null
    } catch {
      return null
    }
  }
  for (const group of groups.values()) {
    if (!CAPPED.has(group[0].type)) continue
    const generation = active.get(group[0].session_id) ?? 0
    group.sort(
      (a, b) =>
        Number(b.generation === generation) - Number(a.generation === generation) ||
        b.generation - a.generation ||
        b.ordinal - a.ordinal,
    )
    requireEvidence(
      group.every(
        (row, index) =>
          index === 0 ||
          row.generation !== group[index - 1].generation ||
          row.ordinal !== group[index - 1].ordinal,
      ),
      'The retention fixture has ambiguous event ordering.',
    )
    const current = group.filter((row) => row.generation === generation && payloadOf(row))
    const anchors = new Set(current.slice(0, 1).map((row) => row.id))
    if (group[0].type === 'tool_inventory') {
      const declaration = current.find((row) => payloadOf(row).source !== 'thread/resume')
      if (declaration) anchors.add(declaration.id)
    }
    if (group[0].type === 'launched') {
      const reset = Math.max(
        -1,
        ...[...all.values()]
          .filter(
            (row) =>
              row.session_id === group[0].session_id &&
              row.generation === generation &&
              ['compaction', 'conversation_reset'].includes(row.type),
          )
          .map((row) => row.ordinal),
      )
      for (const row of current) if (row.ordinal > reset) anchors.add(row.id)
    }
    for (const row of group.slice(1))
      if (payloadOf(row) && !anchors.has(row.id)) allowed.add(row.id)
  }
  const removed = (before.events ?? []).filter((row) => !present.has(row.id) && allowed.has(row.id))
  const ids = new Set(removed.map((row) => row.id))
  return {
    tables: { ...before, events: (before.events ?? []).filter((row) => !ids.has(row.id)) },
    removed: removed.map(({ id, session_id, type, generation, ordinal }) => ({
      id,
      session_id,
      type,
      generation,
      ordinal,
    })),
  }
}

export function startupLogEvidence(
  evidence,
  check,
  holds,
  stage,
  { checkpoint, completion, observation, checkpointCount },
) {
  const log = readFileSync(join(evidence, `${stage}.log`), 'utf8')
  const order = holds(
    checkpoint
      ? `${stage}: over its whole log, the expected checked recovery copies (${completion}), one READY, and no failure`
      : `${stage}: over its whole log, READY, no recovery copy and no failure`,
    () => startOrder(log, { checkpoint: checkpointCount ?? checkpoint, completion, observation }),
  )
  const other = join(evidence, `${stage}.stdout.log`)
  if (existsSync(other)) {
    const out = readFileSync(other, 'utf8')
    check(
      ![READY_LINE, CHECKPOINT_LINE, FAIL_LINE].some((line) => out.includes(line)),
      `${stage}: none of the start's lines is on its other stream`,
    )
  }
  return order
}

export function replacementSetMatches(copies, compact) {
  return compact
    ? copies.made.length === 1 &&
        copies.others.length === 0 &&
        copies.unread.length === 0 &&
        copies.changed.length === 0 &&
        copies.gone.length === copies.previousCount
    : copies.same
}
