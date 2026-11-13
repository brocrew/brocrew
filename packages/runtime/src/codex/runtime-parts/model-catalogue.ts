import type { EffortChoice, ModelChoice } from '../../runtime'
import { isRecord, readString } from './wire-values'

// A whole-probe deadline bounds cursor paging; no hidden rows are requested or displayed.
export const MODEL_LIST_PAGE_LIMIT = 20

export const MODEL_PROBE_TIMEOUT_MS = 15_000

export function modelChoiceOf(row: unknown): ModelChoice | null {
  if (!isRecord(row)) return null
  if (row['hidden'] === true) return null
  const id = readString(row, 'id') || readString(row, 'model')
  if (!id) return null
  const description = readString(row, 'description')
  // The provider's own words, in the order it offers them: the full migration sentence when there
  // is one, else the bare "there is a successor" fact. Never composed here — 058's dispatch guessed
  // this field meant a plan gate and the probe said deprecation, so phrasing it would risk shipping
  // that guess as a warning.
  const upgradeInfo = row['upgradeInfo']
  const migration = isRecord(upgradeInfo) ? readString(upgradeInfo, 'migrationMarkdown').trim() : ''
  const successor = readString(row, 'upgrade')
  const note = migration || (successor ? `Superseded by ${successor}.` : '')
  // What efforts THIS model accepts, in the server's own order, each with the server's own sentence
  // about it (076). `supportedReasoningEfforts` is `Array<ReasoningEffortOption>` in the vendored
  // protocol — `{reasoningEffort, description}` — and the effort itself is `ReasoningEffort = string`,
  // open by construction. So this is read defensively rather than cast: a row that answers with
  // something unexpected contributes no options rather than an option named `undefined`.
  //
  // ⚠️ **Per MODEL, which is why this hangs off the row.** The same login answers differently for two
  // models, so there is no provider-wide list that would be true — see `ModelChoice.efforts`.
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
  // ⚑ **D-042 · what the row's id points at, when the server says another** (`Model.model`), and
  // ⚑ **R1 — the server's own default, by name** (`Model.isDefault`): its row, chosen by its id.
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
