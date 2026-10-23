import { z } from 'zod'
const disclosureText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .regex(/^[^\p{Cc}\p{Cs}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]+$/u)
const disclosureDigest = z.string().regex(/^[a-f0-9]{64}$/)
export const PluginReleaseDetailsSchema = z.strictObject({
  version: disclosureText(80),
  digest: disclosureDigest,
  manifestSha256: disclosureDigest,
  authors: z
    .array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/))
    .min(1)
    .max(8)
    .refine((a) => new Set(a).size === a.length && a.join(',') === [...a].sort().join(','))
    .nullable(),
  permissions: z.strictObject({
    description: disclosureText(2000),
    resources: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
          label: disclosureText(160),
          read: z.boolean(),
          write: z.boolean(),
        }),
      )
      .max(128),
  }),
})
export type PluginReleaseDetails = z.infer<typeof PluginReleaseDetailsSchema>
export const PluginReviewConsentSchema = z.strictObject({
  releaseDigest: disclosureDigest,
  preparation: z.uuid(),
  displayedDetailsHash: disclosureDigest,
})
export const PluginDisplayedConsentSchema = z.strictObject({
  reviewId: z.uuid(),
  displayedDetailsHash: disclosureDigest,
})
export type PluginDisplayedConsent = z.infer<typeof PluginDisplayedConsentSchema>
const reviewDisplay = {
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  action: z.enum(['install', 'update']),
  catalogueDigest: disclosureDigest,
  details: PluginReleaseDetailsSchema.refine((d) => d.authors !== null),
  installed: PluginReleaseDetailsSchema.nullable(),
  changes: z.strictObject({ authors: z.boolean(), permissions: z.boolean() }),
}
/** Internal main-process review: the owner preparation never crosses renderer IPC. */
export const PluginMutationReviewSchema = z
  .strictObject({
    ...reviewDisplay,
    consent: PluginReviewConsentSchema,
  })
  .refine((r) => r.details.digest === r.consent.releaseDigest)
export type PluginMutationReview = z.infer<typeof PluginMutationReviewSchema>
export const PluginWindowReviewSchema = z.strictObject({
  ...reviewDisplay,
  consent: PluginDisplayedConsentSchema,
})
export type PluginWindowReview = z.infer<typeof PluginWindowReviewSchema>
/** Read primitive fields out of Vue's reactive review; never send its consent Proxy over IPC. */
export function pluginDisplayedConsent(
  review: Pick<PluginWindowReview, 'consent'>,
): PluginDisplayedConsent {
  return {
    reviewId: review.consent.reviewId,
    displayedDetailsHash: review.consent.displayedDetailsHash,
  }
}
/** Canonical JSON for the same bounded, validated display snapshot on both sides of IPC. */
export function canonicalPluginDisclosure(value: unknown): string {
  function sort(one: unknown): unknown {
    if (Array.isArray(one)) return one.map(sort)
    if (one !== null && typeof one === 'object')
      return Object.fromEntries(
        Object.keys(one)
          .sort()
          .map((key) => [key, sort((one as Record<string, unknown>)[key])]),
      )
    return one
  }
  return JSON.stringify(sort(value))
}
/** W4-approved static disclosure text. Package data is validated separately and escaped by Vue. */
export const PLUGIN_DISCLOSURE_WORDS = Object.freeze({
  reviewInstall: 'Review install',
  reviewUpdate: 'Review update',
  details: 'Plugin details',
  version: 'Version',
  authors: 'Authors',
  permissions: 'Permissions',
  read: 'Read',
  write: 'Write',
  noAccess: 'No access',
  changes: 'Changes in this update',
  authorsChanged: 'Authors changed.',
  authorsUnchanged: 'Authors are unchanged.',
  permissionsChanged: 'Permissions changed.',
  permissionsUnchanged: 'Permissions are unchanged.',
  unknownInstalled:
    "The installed version's details couldn't be checked, so all its authors and permissions are shown as new.",
  beforeChange: 'Review details before installing or updating this plugin.',
  cancel: 'Cancel',
  reviewAgain:
    "This change couldn't be confirmed. If the plugin now shows as installed or updated, it went through. Otherwise, review it again.",
  network: "Couldn't download this plugin. Check your connection and try again.",
})
export type PluginMutationFailure =
  PluginMutationBlocked | 'policy-refused' | 'network' | 'unavailable'
export const PLUGIN_REVIEW_INVALIDATED = 'plugins:review-invalidated'
// Person-control may wait 180 seconds for a cold plugin start; leave room for its page load.
export const PLUGIN_CONFIGURATION_TIMEOUT = 200_000
export const PLUGIN_SETTINGS_CHANNEL = 'plugins:settings'
export const PLUGIN_SCREEN_CLOSED = 'plugins:screen-closed'
export const PLUGIN_STATES = [
  'Available',
  'Installed',
  'Running',
  'Needs setup',
  'Unavailable',
] as const
export type PluginState = (typeof PLUGIN_STATES)[number]
export type PluginMutationBlocked = 'owner-incompatible' | 'source-mismatch'
export interface PluginMutationConsent {
  releaseDigest: string
  preparation: string
  displayedDetailsHash?: string
}
export interface PluginCard {
  id: string
  name: string
  /** null means storage could not establish presence; never permission to install. */
  installed: boolean | null
  state: PluginState
  /** Scheduling snapshot, unknown off macOS or when the owned process cannot be read. */
  priorityClamped?: boolean | null
  installedVersion?: string
  updateVersion?: string
  /** Installed package is manageable but has no release admitted for this app. */
  updatesUnavailable?: true
  uninstallDeletesData?: boolean
  hasRemoteLogout?: boolean
  preparationRequired?: true
  mutationBlocked?: PluginMutationBlocked
}
/** Versioned actions remain denied until verified disclosure can supply consent. */
export function pluginMutationAllowed(
  card: PluginCard,
  action: 'install' | 'update',
  review?: PluginMutationReview | PluginWindowReview,
): boolean {
  if (card.mutationBlocked) return false
  if (
    card.preparationRequired &&
    (!review ||
      review.id !== card.id ||
      review.action !== action ||
      (!PluginMutationReviewSchema.safeParse(review).success &&
        !PluginWindowReviewSchema.safeParse(review).success))
  )
    return false
  return action === 'install'
    ? card.installed === false && card.state === 'Available'
    : card.installed === true && !!card.updateVersion && card.state !== 'Unavailable'
}
export function pluginMutationNotice(cause: PluginMutationBlocked): string {
  return cause === 'source-mismatch'
    ? 'Install and update are unavailable because another BroCrew window on this computer uses a different plugin list. You can still configure or uninstall installed plugins.'
    : 'Install and update are unavailable until every BroCrew app on this computer is updated and restarted. You can still configure or uninstall installed plugins.'
}
export function pluginMutationFailureNotice(cause: PluginMutationFailure): string {
  if (cause === 'source-mismatch' || cause === 'owner-incompatible')
    return pluginMutationNotice(cause)
  if (cause === 'policy-refused') return PLUGIN_DISCLOSURE_WORDS.reviewAgain
  if (cause === 'network') return PLUGIN_DISCLOSURE_WORDS.network
  return 'Plugin unavailable. Try again.'
}
/** Closed uninstall facts; remote removal is never inferred from deleting local data. */
export interface PluginRemovalOutcome {
  data: 'deleted'
  logout: 'confirmed' | 'unconfirmed'
}
export function pluginRemovalOutcome(value: unknown): PluginRemovalOutcome | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Partial<PluginRemovalOutcome>
  if (
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'data') ||
    !Object.hasOwn(value, 'logout') ||
    result.data !== 'deleted' ||
    (result.logout !== 'confirmed' && result.logout !== 'unconfirmed')
  )
    return null
  return { data: 'deleted', logout: result.logout }
}
export interface PluginScreenBounds {
  x: number
  y: number
  width: number
  height: number
}
export type PluginSettingsRequest =
  | { kind: 'list' | 'availability' }
  | { kind: 'install' | 'update'; id: string; consent?: PluginDisplayedConsent }
  | { kind: 'uninstall' | 'retry'; id: string }
  | { kind: 'prepare'; action: 'install' | 'update'; id: string }
  | { kind: 'configure'; id: string; screenId: string; bounds: PluginScreenBounds }
  | { kind: 'bounds'; bounds: PluginScreenBounds }
  | { kind: 'close' }
export type PluginListState = 'ready' | 'empty' | 'not-published' | 'fetch-error'
export type PluginSettingsReply =
  | {
      ok: true
      review?: PluginWindowReview
      cards?: PluginCard[]
      available?: boolean
      listState?: PluginListState
      refreshFailed?: boolean
      removal?: PluginRemovalOutcome
    }
  | { ok: false; listState: 'not-published' | 'fetch-error' }
  | { ok: false; error: 'Plugin unavailable. Try again.'; mutationFailure?: PluginMutationFailure }
export interface PluginsClient {
  request(input: PluginSettingsRequest): Promise<PluginSettingsReply>
  onReviewInvalidated?(listener: () => void): () => void
  onClosed(listener: (screenId: string) => void): () => void
}
