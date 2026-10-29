import {
  PluginMutationReviewSchema,
  type PluginMutationReview,
} from '../../../shared/plugin-settings'
import { downloadPluginBytes, PluginDownloadError } from '../catalogue/download'
import {
  releaseDisclosure,
  installedDisclosure,
  installedDisclosureIdentity,
  disclosureChanges,
  displayedDetailsHash,
} from '../mutation-disclosure'
import type { PluginRelease } from '../package-schema'
import { proposalFor } from './proposals'
import { pluginAdapter } from './adapters'
import { randomUUID, type KeyObject } from 'node:crypto'
import { z } from 'zod'
import type { PluginSettingsController } from '../settings'
import type { PluginUiHostOptions } from '../ui/host'
import type { PluginUiBinding } from '../ui/rpc'
import type { PluginTarget } from '../package-schema'
import { PluginPackageVault } from './vault'
import { ConsumerCommand, connectPersonPluginControl } from './person-control'
import type { WorkspaceProjection } from './types'
import { Installation } from '../state/format'
import { PLUGIN_STATES, pluginRemovalOutcome } from '../../../shared/plugin-settings'
import { createRepoAwarePluginVerifier } from '../package-verifier'
import { pluginSha256, verifyPluginDigest, PLUGIN_LIMITS } from '../package-digests'
import { strictPluginJson } from '../strict-json'
import type { PluginMutationBlocked, PluginMutationConsent } from '../../../shared/plugin-settings'
import { PluginSupervisorError } from '../supervisor/protocol'

const Cards = z
  .array(
    z.strictObject({
      id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
      name: z.string().min(1).max(128),
      state: z.enum(PLUGIN_STATES),
      installed: z.boolean(),
      priorityClamped: z.boolean().nullable().optional(),
      installedVersion: z.string().min(1).max(80).optional(),
      updateVersion: z.string().min(1).max(80).optional(),
      uninstallDeletesData: z.boolean().optional(),
    }),
  )
  .max(200)
/** Electron-main adapter for the exact app-admitted repo list, or the dormant signed test path. */
export async function connectPluginSettings(options: {
  path: string
  personKey: string
  root: string
  pinnedPublicKey: KeyObject | null
  repoCatalogueSha256?: string
  target: PluginTarget
  catalogue: { bytes: Uint8Array; signature: Uint8Array }
  projection: WorkspaceProjection
  propose(publicProposal: unknown, revision: number): void
  lost?(): void
  signal?: AbortSignal
  /** Inert unit-test transport; production uses the bounded admitted archive transport. */
  download?(release: Readonly<PluginRelease>, signal: AbortSignal): Promise<Uint8Array>
}): Promise<PluginSettingsController & { close(): Promise<void> }> {
  let catalogueProof = {
    bytes: Buffer.from(options.catalogue.bytes),
    signature: Buffer.from(options.catalogue.signature),
  }
  let admitted = createRepoAwarePluginVerifier({
    pinnedPublicKey: options.pinnedPublicKey,
    repoCatalogueSha256: options.repoCatalogueSha256,
    target: options.target,
  }).verifyCatalogue(catalogueProof.bytes, catalogueProof.signature)
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
  const vault = new PluginPackageVault(
    options.root,
    options.pinnedPublicKey,
    options.target,
    options.repoCatalogueSha256,
  )
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
  async function readFeatures(ticket: number) {
    if (!modern || !featureReadable) return
    const reply = await channel.call({ kind: 'features' })
    if (!alive || generation !== ticket) return failPolicy()
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
  async function checkOwner() {
    if (!alive) throw new PluginSupervisorError('unavailable')
    if (switching) return failPolicy()
    const ticket = generation
    await readFeatures(ticket)
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
      const reply = await channel.call({ kind: 'mutation-status', catalogueDigest: digest })
      if (!alive || generation !== ticket) return failPolicy()
      z.strictObject({ format: z.literal(1), catalogueDigest: z.literal(digest) }).parse(reply)
      blocked = null
    } catch (error) {
      if (generation !== ticket) return failPolicy()
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
      await channel.call({
        kind: action + '-prepared',
        pluginId: id,
        operationId: randomUUID(),
        releaseDigest: parsed.data.releaseDigest,
        preparation: parsed.data.preparation,
      })
      invalidateConsent()
    } catch (error) {
      invalidateConsent()
      if (error instanceof PluginSupervisorError && error.code === 'source-mismatch')
        blocked = 'source-mismatch'
      throw error
    }
  }
  async function prepareOwnerMutation(action: 'install' | 'update', id: string) {
    consents.delete(id)
    try {
      if (!policyDigest && blocked !== 'source-mismatch') await negotiate(true)
      await checkOwner()
      if (blocked) return refuseBlocked()
      if (sourceFormat !== 2) throw new PluginSupervisorError('incompatible')
      const ticket = generation,
        entry = admitted.entries.find((one) => one.id === id)
      if (!entry?.authors) return failPolicy()
      const proof = z.strictObject({ preparation: z.uuid() }).parse(
        await channel.call({
          kind: 'prepare-mutation',
          action,
          pluginId: id,
          releaseDigest: entry.archive.sha256,
        }),
      )
      if (!alive || switching || ticket !== generation) return failPolicy()
      const consent = { preparation: proof.preparation, releaseDigest: entry.archive.sha256 }
      consents.set(id, { ...consent, action })
      return consent
    } catch (error) {
      invalidateConsent()
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
    async reviewMutation(action, id) {
      invalidateConsent()
      await checkOwner()
      if (blocked) return refuseBlocked()
      if (sourceFormat !== 2) throw new PluginSupervisorError('incompatible')
      const ticket = generation,
        epoch = reviewEpoch,
        catalogue = admitted,
        entry = catalogue.entries.find((one) => one.id === id),
        abort = new AbortController()
      if (!entry?.authors) return failPolicy()
      reviewing = abort
      const signal = AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(30000),
        ...(options.signal ? [options.signal] : []),
      ])
      const current = () =>
        alive &&
        !switching &&
        generation === ticket &&
        reviewEpoch === epoch &&
        !signal.aborted &&
        admitted === catalogue
      try {
        const archive = await (
          options.download ??
          ((release, signal) =>
            downloadPluginBytes({
              url: release.archive.url,
              maximum: PLUGIN_LIMITS.archiveBytes,
              size: release.archive.size,
              sha256: release.archive.sha256,
              signal,
            }))
        )(entry, signal)
        if (!current()) return failPolicy()
        verifyPluginDigest(archive, entry.archive, PLUGIN_LIMITS.archiveBytes)
        const details = releaseDisclosure(catalogue.verifyPackage(id, entry.version, archive))
        if (!details.authors) return failPolicy()
        const previous =
          action === 'update'
            ? await installedDisclosure(options.root, id, vault)
            : { identity: null, details: null }
        if (!current()) return failPolicy()
        const proof = await prepareOwnerMutation(action, id)
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
        consents.delete(id)
        reviews.delete(id)
        if (!current()) return failPolicy()
        if (error instanceof PluginSupervisorError) throw error
        throw new PluginSupervisorError(
          error instanceof PluginDownloadError && error.kind === 'transport'
            ? 'network'
            : 'policy-refused',
        )
      } finally {
        if (reviewing === abort) reviewing = undefined
      }
    },
    async catalogue() {
      await checkOwner()
      const cards = Cards.parse(await channel.call({ kind: modern ? 'list-v2' : 'list' }))
      // Project reviewed local adapter capabilities without expanding the legacy owner wire.
      return cards.map((card) => ({
        ...card,
        ...(!modern ? { uninstallDeletesData: Boolean(pluginAdapter(card.id)?.uninstall) } : {}),
        hasRemoteLogout: Boolean(pluginAdapter(card.id)?.uninstall),
        ...(sourceFormat === 2 || blocked ? { preparationRequired: true as const } : {}),
        ...(blocked ? { mutationBlocked: blocked } : {}),
      }))
    },
    ...(modern
      ? {
          async refreshCatalogue(
            catalogueDigest: string,
            source?: { bytes: Uint8Array; signature: Uint8Array },
          ) {
            if (source)
              source = { bytes: Buffer.from(source.bytes), signature: Buffer.from(source.signature) }
            pendingCatalogueRefreshes++
            invalidateConsent()
            switching = true
            const work = catalogueRefresh.then(async () => {
              if (!alive || closing) return failPolicy()
              const ticket = ++generation
            invalidateConsent()
            switching = true
            try {
              if (source) {
                try {
                  if (pluginSha256(source.bytes) !== catalogueDigest) return failPolicy()
                  const verified = createRepoAwarePluginVerifier({
                    pinnedPublicKey: options.pinnedPublicKey,
                    repoCatalogueSha256:
                      options.pinnedPublicKey === null ? catalogueDigest : undefined,
                    target: options.target,
                    knownReleases: admitted.pins,
                  }).verifyCatalogue(source.bytes, source.signature)
                  const format = (
                    strictPluginJson(source.bytes, PLUGIN_LIMITS.catalogueBytes) as {
                      format: 1 | 2
                    }
                  ).format
                  if (sourceFormat === 2 && format !== 2) return failPolicy()
                  catalogueProof = {
                    bytes: Buffer.from(source.bytes),
                    signature: Buffer.from(source.signature),
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
            }).finally(() => {
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
      const removing = channel.call({ kind: 'uninstall', pluginId, operationId: randomUUID() })
      const result = await Promise.allSettled([closing, removing])
      if (result.some((one) => one.status !== 'fulfilled'))
        throw new PluginSupervisorError('unavailable')
      const reply = result[1]
      if (!reply || reply.status !== 'fulfilled') throw new PluginSupervisorError('unavailable')
      // Legacy owners returned only true; local deletion never proves remote logout.
      if (reply.value === true) {
        if (pluginAdapter(pluginId)?.uninstall) return { data: 'deleted', logout: 'unconfirmed' }
        return
      }
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
      const checked = await vault.load(
        {
          id: pluginId,
          version: installed.release.version,
          manifestSha256: installed.release.manifestSha256,
          archive: { sha256: installed.release.archiveSha256 },
        },
        [],
      )
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
            const schema = proposalFor(pluginId)
            if (!schema || !current(binding) || applying || signal.aborted)
              throw new PluginSupervisorError('unavailable')
            const proposal = schema.parse(payload)
            applying = true
            try {
              // The person's package-screen button press is confirmation; no second dialog.
              await channel.call({
                kind: 'apply',
                pluginId,
                installId: installed.installId,
                incarnation: installed.incarnation,
                revision,
                proposal,
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
