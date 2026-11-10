import {
  PluginMutationReviewSchema,
  PluginActionSchema,
  type PluginMutationReview,
} from '../../../shared/plugin-settings'
import {
  downloadPluginBytes,
  pluginDownloadFailure,
  PluginDownloadError,
} from '../catalogue/download'
import { PluginVerificationError } from '../verification-error'
import {
  releaseDisclosure,
  installedDisclosure,
  installedDisclosureIdentity,
  disclosureChanges,
  displayedDetailsHash,
} from '../mutation-disclosure'
import type { PluginRelease } from '../package-schema'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PluginSettingsController } from '../settings'
import type { PluginUiHostOptions } from '../ui/host'
import type { PluginUiBinding } from '../ui/rpc'
import type { PluginTarget } from '../package-schema'
import { PluginPackageVault } from './vault'
import { ConsumerCommand, connectPersonPluginControl } from './person-control'
import type { PersonProjection } from './types'
import { Installation } from '../state/format'
import {
  PLUGIN_STATES,
  PLUGIN_UNAVAILABLE_REASONS,
  PluginStartupDiagnosticSchema,
  pluginRemovalOutcome,
  PluginReviewProgressSchema,
  type PluginReviewProgress,
} from '../../../shared/plugin-settings'
import { createRepoAwarePluginVerifier } from '../package-verifier'
import { pluginSha256, verifyPluginDigest, PLUGIN_LIMITS } from '../package-digests'
import { strictPluginJson } from '../strict-json'
import type { PluginMutationBlocked, PluginMutationConsent } from '../../../shared/plugin-settings'
import { PluginSupervisorError, type Refusal } from '../supervisor/protocol'
import {
  PluginStartupError,
  pluginStartupReason,
  type PluginOwnerCheckStage,
  type PluginReviewStage,
} from '../startup-failure'

const Cards = z
  .array(
    z.strictObject({
      id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
      name: z.string().min(1).max(128),
      state: z.enum(PLUGIN_STATES),
      installed: z.boolean(),
      priorityClamped: z.boolean().nullable().optional(),
      toolsUnavailable: z.literal(true).optional(),
      toolsPending: z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,63}$/)
        .optional(),
      unavailableReason: z.enum(PLUGIN_UNAVAILABLE_REASONS).optional(),
      startupDiagnostic: PluginStartupDiagnosticSchema.optional(),
      toolsCause: z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,63}(?:: [a-z][a-z0-9-]{0,63})?$/)
        .optional(),
      action: PluginActionSchema.optional(),
      installedVersion: z.string().min(1).max(80).optional(),
      updateVersion: z.string().min(1).max(80).optional(),
      uninstallDeletesData: z.boolean().optional(),
      uninstallNote: PluginActionSchema.shape.note.optional(),
    }),
  )
  .max(200)
/** Electron-main adapter for the exact app-admitted repo list. */
export async function connectPluginSettings(options: {
  path: string
  personKey: string
  root: string
  repoCatalogueSha256?: string
  target: PluginTarget
  catalogue: { bytes: Uint8Array }
  projection: PersonProjection
  propose(publicProposal: unknown, revision: number): void
  lost?(): void
  signal?: AbortSignal
  /** Inert unit-test transport; production uses the bounded admitted archive transport. */
  download?(
    release: Readonly<PluginRelease>,
    signal: AbortSignal,
    onProgress?: (received: number) => void,
  ): Promise<Uint8Array>
  recordReviewFailure?(
    action: 'install' | 'update',
    stage: PluginReviewStage,
    code: Refusal,
    cause: Refusal | 'integrity' | 'transport' | 'verification' | 'unknown',
  ): void | Promise<void>
}): Promise<PluginSettingsController & { close(): Promise<void> }> {
  if (
    options.repoCatalogueSha256 !== undefined &&
    pluginSha256(options.catalogue.bytes) !== options.repoCatalogueSha256
  )
    throw new PluginSupervisorError('unavailable')
  let catalogueProof = {
    bytes: Buffer.from(options.catalogue.bytes),
  }
  let admitted = createRepoAwarePluginVerifier({
    target: options.target,
  }).verifyCatalogue(catalogueProof.bytes)
  let sourceFormat = (
    strictPluginJson(catalogueProof.bytes, PLUGIN_LIMITS.catalogueBytes) as { format: 1 | 2 }
  ).format
  let generation = 0,
    switching = false,
    badSource = false
  let blocked: PluginMutationBlocked | null = null,
    policyDigest: string | undefined
  const consents = new Map<string, PluginMutationConsent & { action: 'install' | 'update' }>()
  const reviews = new Map<string, PluginMutationReview>()
  const reviewListeners = new Set<() => void>()
  let reviewEpoch = 0
  let reviewing: AbortController | undefined
  const Consent = z.strictObject({
    releaseDigest: z.string().regex(/^[a-f0-9]{64}$/),
    preparation: z.uuid(),
    displayedDetailsHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  const vault = new PluginPackageVault(options.root, options.target)
  const screens = new Map<
    string,
    { install: string; live: boolean; revokers: Set<() => void | Promise<void>> }
  >()
  const generations = new Map<string, number>()
  let alive = true
  let catalogueRefresh = Promise.resolve()
  let pendingCatalogueRefreshes = 0
  let closing = false
  async function invalidate(id: string, bump = true) {
    if (bump) generations.set(id, (generations.get(id) ?? 0) + 1)
    const screen = screens.get(id)
    if (!screen) return
    screen.live = false // Deny page RPC synchronously before waiting for destruction/storage cleanup.
    const result = await Promise.allSettled(
      [...screen.revokers].map((revoke) => Promise.resolve().then(revoke)),
    )
    if (result.some((one) => one.status !== 'fulfilled'))
      throw new PluginSupervisorError('cleanup-pending')
    if (screens.get(id) === screen) screens.delete(id)
  }
  const channel = await connectPersonPluginControl({
    path: options.path,
    key: options.personKey,
    async handle(input) {
      const request = ConsumerCommand.parse(input)
      if (request.kind === 'revoke') {
        const screen = screens.get(request.pluginId)
        if (!screen || screen.install === request.installId) await invalidate(request.pluginId)
        return options.projection.revoke(request.pluginId, request.installId)
      }
      if (request.kind === 'applied') {
        await options.projection.applied(request.pluginId, request.receipt)
        return true
      }
      const change = request.change
      await options.projection.reconcile(change)
      return true
    },
  })
  const abort = () => channel.close()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) channel.close()
  channel.onClose(() => {
    options.signal?.removeEventListener('abort', abort)
    alive = false
    generation++
    invalidateConsent()
    options.lost?.()
    for (const id of screens.keys()) void invalidate(id).catch(() => undefined)
  })
  let modern = false
  try {
    const attached = await channel.call({
      kind: 'attach',
      workspaceId: options.projection.workspaceId,
    })
    modern = z.strictObject({ personProtocol: z.literal(2) }).safeParse(attached).success
  } catch {
    channel.close()
    throw new PluginSupervisorError('unavailable')
  }
  let features: readonly string[] = Object.freeze([])
  let featureReadable = false
  if (modern) {
    await channel.call({ kind: 'features' }).then(
      (reply) => {
        try {
          features = Object.freeze(
            z
              .strictObject({
                features: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).max(32),
              })
              .parse(reply).features,
          )
          featureReadable = true
        } catch {
          channel.close()
          throw new PluginSupervisorError('incompatible')
        }
      },
      () => undefined,
    )
    // Older owners reject this request without losing the person channel. Keep their old format.
    await channel.call({ kind: 'configure-ledger', format: 2 }).then(
      (reply) => {
        try {
          z.strictObject({
            format: z.literal(2),
            maxRevision: z.literal(Number.MAX_SAFE_INTEGER),
          }).parse(reply)
        } catch {
          channel.close()
          throw new PluginSupervisorError('incompatible')
        }
      },
      () => undefined,
    )
  }
  const failPolicy = (): never => {
    throw new PluginSupervisorError('policy-refused')
  }
  const refuseBlocked = (): never => {
    throw new PluginSupervisorError(
      blocked === 'source-mismatch' ? 'source-mismatch' : 'incompatible',
    )
  }
  function invalidateConsent() {
    const hadReview = reviews.size > 0 || consents.size > 0
    consents.clear()
    reviewEpoch++
    reviewing?.abort()
    reviews.clear()
    if (hadReview) for (const listener of reviewListeners) listener()
  }
  function supportsPrepared() {
    return features.includes('prepared-mutations-v1') && features.includes('authors-v1')
  }
  function legacyBlocked(): PluginMutationBlocked | null {
    return features.includes('prepared-mutations-v1')
      ? 'source-mismatch'
      : features.includes('authors-v1')
        ? 'owner-incompatible'
        : null
  }
  async function readFeatures(ticket: number, noteStage?: (stage: PluginOwnerCheckStage) => void) {
    if (!modern || !featureReadable) return
    noteStage?.('owner-features')
    const reply = await channel.call({ kind: 'features' })
    if (!alive || generation !== ticket) {
      noteStage?.('owner-generation')
      return failPolicy()
    }
    noteStage?.('owner-response')
    const next = z
      .strictObject({ features: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).max(32) })
      .parse(reply).features
    if (JSON.stringify([...features].sort()) !== JSON.stringify([...next].sort()))
      invalidateConsent()
    features = Object.freeze(next)
  }
  async function negotiate(probe = false) {
    const ticket = generation
    invalidateConsent()
    policyDigest = undefined
    if (probe) await readFeatures(ticket)
    if (badSource) {
      blocked = 'source-mismatch'
      return
    }
    if (sourceFormat === 1) {
      blocked = legacyBlocked()
      return
    }
    blocked = 'owner-incompatible'
    if (!supportsPrepared()) return
    const digest = pluginSha256(catalogueProof.bytes)
    try {
      const reply = await channel.call({ kind: 'mutation-policy', catalogueDigest: digest })
      if (!alive || generation !== ticket) return failPolicy()
      z.strictObject({ format: z.literal(1), catalogueDigest: z.literal(digest) }).parse(reply)
      blocked = null
      policyDigest = digest
    } catch (error) {
      if (generation !== ticket) return failPolicy()
      blocked =
        error instanceof PluginSupervisorError && error.code === 'source-mismatch'
          ? 'source-mismatch'
          : 'owner-incompatible'
    }
  }
  async function checkOwner(noteStage?: (stage: PluginOwnerCheckStage) => void) {
    noteStage?.('owner-local-state')
    if (!alive) throw new PluginSupervisorError('unavailable')
    if (switching) return failPolicy()
    const ticket = generation
    await readFeatures(ticket, noteStage)
    if (badSource) {
      blocked = 'source-mismatch'
      return
    }
    if (sourceFormat === 1) {
      blocked = legacyBlocked()
      return
    }
    if (!supportsPrepared()) {
      blocked = 'owner-incompatible'
      invalidateConsent()
      return
    }
    if (!policyDigest) {
      blocked ??= 'owner-incompatible'
      invalidateConsent()
      return
    }
    try {
      const digest = pluginSha256(catalogueProof.bytes)
      noteStage?.('owner-mutation-status')
      const reply = await channel.call({ kind: 'mutation-status', catalogueDigest: digest })
      if (!alive || generation !== ticket) {
        noteStage?.('owner-generation')
        return failPolicy()
      }
      noteStage?.('owner-response')
      z.strictObject({ format: z.literal(1), catalogueDigest: z.literal(digest) }).parse(reply)
      blocked = null
    } catch (error) {
      if (generation !== ticket) {
        noteStage?.('owner-generation')
        return failPolicy()
      }
      invalidateConsent()
      if (error instanceof PluginSupervisorError && error.code === 'source-mismatch')
        blocked = 'source-mismatch'
      else if (
        error instanceof z.ZodError ||
        (error instanceof PluginSupervisorError && error.code === 'incompatible')
      )
        blocked = 'owner-incompatible'
      else throw error
    }
  }
  async function ownerDownloadCall(
    request: object,
    id: string,
    transfer?: {
      requestId: string
      signal: AbortSignal
      onProgress(progress: PluginReviewProgress): void
    },
  ) {
    if (!transfer) return channel.call(request)
    const entry = admitted.entries.find((one) => one.id === id)
    if (!entry) return failPolicy()
    transfer.signal.throwIfAborted()
    const cancel = () => {
      void channel.call({ kind: 'cancel-transfer', requestId: transfer.requestId }).catch(() => {})
    }
    transfer.signal.addEventListener('abort', cancel, { once: true })
    let received = 0
    try {
      const reply = await channel.call(
        { ...request, requestId: transfer.requestId },
        undefined,
        (input) => {
          const value = PluginReviewProgressSchema.parse(input)
          if (
            value.requestId !== transfer.requestId ||
            value.id !== id ||
            value.totalBytes !== entry.archive.size ||
            value.receivedBytes > entry.archive.size ||
            (value.phase === 'downloading' && value.receivedBytes < received)
          )
            throw new PluginSupervisorError('unavailable')
          const advanced = value.phase === 'downloading' && value.receivedBytes > received
          if (advanced) received = value.receivedBytes
          if (transfer.signal.aborted) return false
          transfer.onProgress(value)
          return advanced
        },
      )
      transfer.signal.throwIfAborted()
      return reply
    } finally {
      transfer.signal.removeEventListener('abort', cancel)
    }
  }
  async function mutate(action: 'install' | 'update', id: string, consent?: PluginMutationConsent) {
    const ticket = generation
    try {
      await checkOwner()
      if (!alive || switching || ticket !== generation) return failPolicy()
      if (blocked) return refuseBlocked()
      if (sourceFormat === 1) {
        if (action === 'update') await invalidate(id)
        if (!alive || switching || ticket !== generation) return failPolicy()
        await channel.call({ kind: action, pluginId: id, operationId: randomUUID() })
        return
      }
      const value = consents.get(id),
        parsed = Consent.safeParse(consent)
      consents.delete(id)
      reviews.delete(id)
      if (
        !parsed.success ||
        !value ||
        value.action !== action ||
        value.preparation !== parsed.data.preparation ||
        value.releaseDigest !== parsed.data.releaseDigest ||
        (value.displayedDetailsHash !== undefined &&
          value.displayedDetailsHash !== parsed.data.displayedDetailsHash) ||
        admitted.entries.find((entry) => entry.id === id)?.archive.sha256 !== value.releaseDigest
      )
        return failPolicy()
      if (action === 'update') await invalidate(id)
      if (!alive || switching || ticket !== generation) return failPolicy()
      await ownerDownloadCall(
        {
          kind: action + '-prepared',
          pluginId: id,
          operationId: randomUUID(),
          releaseDigest: parsed.data.releaseDigest,
          preparation: parsed.data.preparation,
        },
        id,
        features.includes('download-progress-v1')
          ? {
              requestId: randomUUID(),
              signal: options.signal ?? new AbortController().signal,
              onProgress() {},
            }
          : undefined,
      )
      invalidateConsent()
    } catch (error) {
      invalidateConsent()
      if (error instanceof PluginSupervisorError && error.code === 'source-mismatch')
        blocked = 'source-mismatch'
      throw error
    }
  }
  async function prepareOwnerMutation(
    action: 'install' | 'update',
    id: string,
    transfer?: {
      requestId: string
      signal: AbortSignal
      onProgress(progress: PluginReviewProgress): void
    },
  ) {
    consents.delete(id)
    try {
      if (!policyDigest && blocked !== 'source-mismatch') await negotiate(true)
      await checkOwner()
      if (blocked) return refuseBlocked()
      if (sourceFormat !== 2) throw new PluginSupervisorError('incompatible')
      if (transfer && !features.includes('download-progress-v1'))
        throw new PluginSupervisorError('incompatible')
      const ticket = generation,
        entry = admitted.entries.find((one) => one.id === id)
      if (!entry?.authors) return failPolicy()
      const proof = z.strictObject({ preparation: z.uuid() }).parse(
        await ownerDownloadCall(
          {
            kind: 'prepare-mutation',
            action,
            pluginId: id,
            releaseDigest: entry.archive.sha256,
          },
          id,
          transfer,
        ),
      )
      if (!alive || switching || ticket !== generation) return failPolicy()
      const consent = { preparation: proof.preparation, releaseDigest: entry.archive.sha256 }
      consents.set(id, { ...consent, action })
      return consent
    } catch (error) {
      // The review caller owns teardown; aborting it here would hide the owner's real failure.
      if (!transfer) invalidateConsent()
      if (error instanceof PluginSupervisorError && error.code === 'source-mismatch')
        blocked = 'source-mismatch'
      throw error
    }
  }
  await negotiate()
  return {
    features: () => features,
    mutationStatus: () => blocked,
    mutationRequired: () => sourceFormat === 2 || blocked !== null,
    prepareMutation(action, id) {
      if (reviews.has(id)) invalidateConsent()
      return prepareOwnerMutation(action, id)
    },
    cancelPreparations: invalidateConsent,
    onReviewInvalidated(listener) {
      reviewListeners.add(listener)
      return () => {
        reviewListeners.delete(listener)
      }
    },
    async reviewMutation(action, id, transfer) {
      invalidateConsent()
      await checkOwner()
      if (blocked) return refuseBlocked()
      if (sourceFormat !== 2) throw new PluginSupervisorError('incompatible')
      if (!features.includes('download-progress-v1'))
        throw new PluginSupervisorError('incompatible')
      const ticket = generation,
        epoch = reviewEpoch,
        catalogue = admitted,
        entry = catalogue.entries.find((one) => one.id === id),
        abort = new AbortController()
      if (!entry?.authors) return failPolicy()
      reviewing = abort
      const signal = AbortSignal.any([
        abort.signal,
        ...(options.signal ? [options.signal] : []),
        ...(transfer ? [transfer.signal] : []),
      ])
      const current = () =>
        alive &&
        !switching &&
        generation === ticket &&
        reviewEpoch === epoch &&
        !signal.aborted &&
        admitted === catalogue
      let stage: PluginReviewStage = 'download'
      const requestId = transfer?.requestId ?? randomUUID()
      const progress = (value: Omit<PluginReviewProgress, 'requestId' | 'id'>) => {
        if (current()) transfer?.onProgress({ ...value, requestId, id })
      }
      try {
        const archive = await (
          options.download ??
          ((release, signal, onProgress) =>
            downloadPluginBytes({
              url: release.archive.url,
              maximum: PLUGIN_LIMITS.archiveBytes,
              size: release.archive.size,
              sha256: release.archive.sha256,
              signal,
              onProgress,
            }))
        )(entry, signal, (receivedBytes) =>
          progress({ phase: 'downloading', receivedBytes, totalBytes: entry.archive.size }),
        )
        if (!current()) return failPolicy()
        progress({
          phase: 'checking',
          receivedBytes: archive.length,
          totalBytes: entry.archive.size,
        })
        stage = 'verify'
        verifyPluginDigest(archive, entry.archive, PLUGIN_LIMITS.archiveBytes)
        const details = releaseDisclosure(catalogue.verifyPackage(id, entry.version, archive))
        if (!details.authors) return failPolicy()
        stage = 'installed-disclosure'
        const previous =
          action === 'update'
            ? await installedDisclosure(options.root, id, vault)
            : { identity: null, details: null }
        if (!current()) return failPolicy()
        stage = 'owner-prepare'
        const proof = await prepareOwnerMutation(action, id, {
          requestId,
          signal,
          onProgress: (value) => progress(value),
        })
        if (!current()) return failPolicy()
        if (
          action === 'update' &&
          JSON.stringify(installedDisclosureIdentity(options.root, id)) !==
            JSON.stringify(previous.identity)
        )
          return failPolicy()
        const display = {
          id,
          action,
          catalogueDigest: pluginSha256(catalogueProof.bytes),
          details,
          installed: previous.details,
          changes: disclosureChanges(details, previous.details),
        }
        if (
          policyDigest !== pluginSha256(catalogueProof.bytes) ||
          proof.releaseDigest !== details.digest
        )
          return failPolicy()
        const consent = { ...proof, displayedDetailsHash: displayedDetailsHash(display) }
        const shown = PluginMutationReviewSchema.parse({ ...display, consent })
        reviews.set(id, shown)
        consents.set(id, { ...consent, action })
        return structuredClone(shown)
      } catch (error) {
        if (reviewing === abort) {
          consents.delete(id)
          reviews.delete(id)
        }
        const cause =
          error instanceof PluginSupervisorError
            ? error.code
            : error instanceof PluginDownloadError
              ? error.stalled
                ? 'download-stalled'
                : error.kind
              : error instanceof PluginVerificationError
                ? 'verification'
                : 'unknown'
        const code = !current()
          ? 'policy-refused'
          : error instanceof PluginSupervisorError
            ? error.code
            : pluginDownloadFailure(error)
        await options.recordReviewFailure?.(action, stage, code, cause)
        throw new PluginSupervisorError(code, { cause: error })
      } finally {
        if (reviewing === abort) reviewing = undefined
      }
    },
    async catalogue() {
      // A catalogue switch refuses owner checks while it runs. A list waits for the switch and
      // reads its outcome, so the switch is never reported as the plugin service failing.
      for (;;) {
        while (switching) await catalogueRefresh
        const ticket = generation
        let detail: PluginOwnerCheckStage = 'owner-local-state'
        try {
          await checkOwner((stage) => {
            detail = stage
          })
          break
        } catch (error) {
          if (!switching && generation === ticket)
            throw new PluginStartupError(
              pluginStartupReason(error, 'catalogue-response'),
              error,
              'owner-check',
              detail,
            )
        }
      }
      let reply: unknown
      try {
        reply = await channel.call({
          kind: features.includes('plugin-actions-v1')
            ? 'list-actions'
            : modern
              ? features.includes('tool-starting-v1')
                ? 'list-tool-starting'
                : features.includes('startup-diagnostic-v1')
                  ? 'list-startup-diagnostic'
                  : features.includes('tool-cause-v1')
                    ? 'list-tool-cause'
                    : features.includes('tool-health-v1')
                      ? 'list-tool-health'
                      : 'list-v2'
              : 'list',
        })
      } catch (error) {
        throw new PluginStartupError(pluginStartupReason(error, 'catalogue-response'), error, 'rpc')
      }
      let cards: z.infer<typeof Cards>
      try {
        cards = Cards.parse(reply)
      } catch (error) {
        throw new PluginStartupError(
          pluginStartupReason(error, 'catalogue-response'),
          error,
          'schema',
        )
      }
      return Promise.all(cards.map(async (card) => {
        let removal
        if (!modern && card.installed) {
          const installed = Installation.parse(await channel.call({ kind: 'screen', pluginId: card.id }))
          const checked = await vault.load({
            id: card.id,
            version: installed.release.version,
            manifestSha256: installed.release.manifestSha256,
            archive: { sha256: installed.release.archiveSha256 },
          })
          removal = checked.manifest.removal
        }
        return {
          ...card,
          ...(!modern && card.installed ? {
            uninstallDeletesData: removal?.data === 'delete',
            ...(removal ? { uninstallNote: removal.note } : {}),
          } : {}),
          ...(sourceFormat === 2 || blocked ? { preparationRequired: true as const } : {}),
          ...(blocked ? { mutationBlocked: blocked } : {}),
        }
      }))
    },
    ...(features.includes('plugin-actions-v1')
      ? {
          async action(id, actionId) {
            await checkOwner()
            if (!features.includes('plugin-actions-v1'))
              throw new PluginSupervisorError('incompatible')
            if ((await channel.call({ kind: 'plugin-action', pluginId: id, actionId })) !== true)
              throw new PluginSupervisorError('unavailable')
          },
        }
      : {}),
    ...(modern
      ? {
          async refreshCatalogue(catalogueDigest: string, source?: { bytes: Uint8Array }) {
            if (source)
              source = {
                bytes: Buffer.from(source.bytes),
              }
            pendingCatalogueRefreshes++
            invalidateConsent()
            switching = true
            const work = catalogueRefresh
              .then(async () => {
                if (!alive || closing) return failPolicy()
                const ticket = ++generation
                invalidateConsent()
                switching = true
                try {
                  if (source) {
                    try {
                      if (pluginSha256(source.bytes) !== catalogueDigest) return failPolicy()
                      const verified = createRepoAwarePluginVerifier({
                        target: options.target,
                      }).verifyCatalogue(source.bytes)
                      const format = (
                        strictPluginJson(source.bytes, PLUGIN_LIMITS.catalogueBytes) as {
                          format: 1 | 2
                        }
                      ).format
                      if (sourceFormat === 2 && format !== 2) return failPolicy()
                      catalogueProof = {
                        bytes: Buffer.from(source.bytes),
                      }
                      admitted = verified
                      sourceFormat = format
                      badSource = false
                    } catch (error) {
                      badSource = true
                      blocked = 'source-mismatch'
                      throw error
                    }
                  } else if (
                    sourceFormat === 2 &&
                    pluginSha256(catalogueProof.bytes) !== catalogueDigest
                  ) {
                    badSource = true
                    blocked = 'source-mismatch'
                    return refuseBlocked()
                  }
                  await channel.call({ kind: 'refresh', catalogueDigest })
                  if (ticket !== generation || !alive) return failPolicy()
                  if (sourceFormat === 2) await negotiate(true)
                  if (blocked) return refuseBlocked()
                } catch (error) {
                  if (sourceFormat === 2)
                    blocked =
                      error instanceof PluginSupervisorError && error.code === 'source-mismatch'
                        ? 'source-mismatch'
                        : 'owner-incompatible'
                  throw error
                }
              })
              .finally(() => {
                pendingCatalogueRefreshes--
                if (pendingCatalogueRefreshes === 0) switching = false
              })
            catalogueRefresh = work.catch(() => {})
            return work
          },
          async update(pluginId: string, consent?: PluginMutationConsent) {
            await mutate('update', pluginId, consent)
          },
        }
      : {}),
    async install(pluginId, consent) {
      await mutate('install', pluginId, consent)
    },
    async uninstall(pluginId) {
      // The caller's UI is denied immediately too; other workspace consumers get a reverse revoke.
      const closing = invalidate(pluginId)
      const removing = channel.call({
        kind: features.includes('removal-results-v1') ? 'uninstall-result-v1' : 'uninstall',
        pluginId,
        operationId: randomUUID(),
      })
      const result = await Promise.allSettled([closing, removing])
      if (result.some((one) => one.status !== 'fulfilled'))
        throw new PluginSupervisorError('unavailable')
      const reply = result[1]
      if (!reply || reply.status !== 'fulfilled') throw new PluginSupervisorError('unavailable')
      if (reply.value === true) return
      const outcome = pluginRemovalOutcome(reply.value)
      if (!outcome) throw new PluginSupervisorError('unavailable')
      return outcome
    },
    async screen(pluginId): Promise<PluginUiHostOptions> {
      const generation = (generations.get(pluginId) ?? 0) + 1
      generations.set(pluginId, generation)
      await invalidate(pluginId, false)
      const installed = Installation.parse(await channel.call({ kind: 'screen', pluginId }))
      if (installed.pluginId !== pluginId || installed.phase !== 'active')
        throw new PluginSupervisorError('unavailable')
      const checked = await vault.load({
        id: pluginId,
        version: installed.release.version,
        manifestSha256: installed.release.manifestSha256,
        archive: { sha256: installed.release.archiveSha256 },
      })
      if (!alive || (generations.get(pluginId) ?? 0) !== generation)
        throw new PluginSupervisorError('unavailable')
      const state = {
        install: installed.installId,
        live: true,
        revokers: new Set<() => void | Promise<void>>(),
      }
      if (!alive || generations.get(pluginId) !== generation)
        throw new PluginSupervisorError('unavailable')
      screens.set(pluginId, state)
      const binding: PluginUiBinding = Object.freeze({
        pluginId,
        installId: installed.installId,
        incarnation: installed.incarnation,
        releaseDigest: installed.release.archiveSha256,
        leaseId: randomUUID(), // UI scope identity only. Never a supervisor/broker/agent lease capability.
      })
      let applying = false
      const current = (candidate: Readonly<PluginUiBinding>) =>
        alive && state.live && screens.get(pluginId) === state && candidate === binding
      const read = async () => {
        if (!current(binding)) throw new PluginSupervisorError('unavailable')
        const result = await channel.call({
          kind: 'read',
          pluginId,
          installId: installed.installId,
        })
        if (!current(binding)) throw new PluginSupervisorError('unavailable')
        return result
      }
      return {
        verified: checked,
        binding,
        // Host snapshots are copies; compare every bound field, not object identity.
        current: (candidate) =>
          alive &&
          state.live &&
          screens.get(pluginId) === state &&
          Object.keys(binding).every(
            (key) =>
              candidate[key as keyof PluginUiBinding] === binding[key as keyof PluginUiBinding],
          ),
        onInvalidate(revoke) {
          state.revokers.add(revoke)
          return () => state.revokers.delete(revoke)
        },
        propose: options.propose,
        peer: {
          async read() {
            return read()
          },
          async subscribe(_payload, _revision, _binding, signal, emit) {
            let stopped = false
            const update = async () => {
              try {
                const value = await read()
                if (!stopped && !signal.aborted) emit(value)
              } catch {
                /* RPC admission fails closed. */
              }
            }
            await update()
            const timer = setInterval(() => {
              void update()
            }, 3000)
            const stop = () => {
              stopped = true
              clearInterval(timer)
            }
            signal.addEventListener('abort', stop, { once: true })
            return () => {
              stop()
              signal.removeEventListener('abort', stop)
            }
          },
          async proposeConfig(payload, revision, _binding, signal) {
            if (!current(binding) || applying || signal.aborted)
              throw new PluginSupervisorError('unavailable')
            applying = true
            try {
              // The person's package-screen button press is confirmation; no second dialog.
              await channel.call({
                kind: 'apply',
                pluginId,
                installId: installed.installId,
                incarnation: installed.incarnation,
                revision,
                proposal: payload,
              })
              if (!current(binding) || signal.aborted)
                throw new PluginSupervisorError('unavailable')
              return { applied: true }
            } finally {
              applying = false
            }
          },
        },
      }
    },
    async close() {
      closing = true
      invalidateConsent()
      generation++
      try {
        // Quit waits for this answer, and detaching starts or stops nothing.
        await channel.call({ kind: 'detach' }, 30_000)
      } finally {
        alive = false
        channel.close()
      }
    },
  }
}
