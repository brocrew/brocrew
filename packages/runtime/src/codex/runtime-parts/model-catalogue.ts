import type { EffortChoice, ModelChoice } from '../../runtime'
import { isRecord, readString } from './wire-values'

// A whole-probe deadline bounds cursor paging; no hidden rows are requested or displayed.
export const MODEL_LIST_PAGE_LIMIT = 20

/**
 * How long listing the models may take in total, shared by the handshake and every page.
 *
 * A total limit with a reason: the probe starts a throwaway app-server for a settings screen nobody
 * is watching, and `model/list` waits on the network without sending anything, so a quiet pipe
 * cannot tell a slow link from a hung child. The limit stops the child and lets the screen say it
 * could not ask. It is far above a slow PC's handshake, so a probe that is only slow still lists.
 */
export const MODEL_PROBE_TIMEOUT_MS = 60_000

export function modelChoiceOf(row: unknown): ModelChoice | null {
  if (!isRecord(row)) return null
  if (row['hidden'] === true) return null
  const id = readString(row, 'id') || readString(row, 'model')
  if (!id) return null
  const description = readString(row, 'description')
  // The provider's own migration sentence, else the bare successor fact; never phrased locally.
  const upgradeInfo = row['upgradeInfo']
  const migration = isRecord(upgradeInfo) ? readString(upgradeInfo, 'migrationMarkdown').trim() : ''
  const successor = readString(row, 'upgrade')
  const note = migration || (successor ? `Superseded by ${successor}.` : '')
  // Efforts this model accepts, in the server's order. Per model, since one login answers differently
  // for two models. Read defensively: an unexpected row yields no option rather than `undefined`.
  const efforts: EffortChoice[] = []
  const supported = row['supportedReasoningEfforts']
  if (Array.isArray(supported)) {
    for (const option of supported) {
      if (!isRecord(option)) continue
      const value = readString(option, 'reasoningEffort').trim()
      if (!value) continue
      const explains = readString(option, 'description').trim()
      efforts.push({ id: value, label: value, ...(explains ? { description: explains } : {}) })
    }
  }
  const defaultEffort = readString(row, 'defaultReasoningEffort').trim()
  // `model` is what the row's id points at when the server names another; `isDefault` marks the server's default.
  const resolvesTo = readString(row, 'model').trim()
  return {
    id,
    label: readString(row, 'displayName') || id,
    ...(description ? { description } : {}),
    ...(note ? { note } : {}),
    ...(efforts.length > 0 ? { efforts } : {}),
    ...(defaultEffort ? { defaultEffort } : {}),
    ...(resolvesTo && resolvesTo !== id ? { resolvesTo } : {}),
    ...(row['isDefault'] === true ? { isDefault: true as const } : {}),
  }
}
