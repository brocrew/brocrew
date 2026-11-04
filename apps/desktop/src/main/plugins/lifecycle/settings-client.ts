import { randomUUID, type KeyObject } from 'node:crypto'
import { z } from 'zod'
import type { PackageRef, PluginPackageInput } from '../../../shared/plugin-package'
import { PLUGIN_STATES, pluginRemovalOutcome } from '../../../shared/plugin-settings'
import type { PluginSettingsController } from '../settings'
import type { PluginUiHostOptions } from '../ui/host'
import type { PluginUiBinding } from '../ui/rpc'
import type { PluginTarget, PluginRelease } from '../package-schema'
import { parsePluginCatalogue } from '../package-schema'
import { inspectPluginPackage, selectPluginPackage, releasePackageRef } from '../package-source'
import { releaseDisclosure, installedDisclosureIdentity } from '../mutation-disclosure'
import { PluginPackageVault } from './vault'
import { ConsumerCommand, connectPersonPluginControl } from './person-control'
import type { WorkspaceProjection } from './types'
import { Installation } from '../state/format'
import { proposalFor } from './proposals'
import { pluginAdapter } from './adapters'
import { PluginSupervisorError } from '../supervisor/protocol'

const Cards = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    state: z.enum(PLUGIN_STATES),
    installed: z.boolean(),
    installedVersion: z.string().optional(),
    updateVersion: z.string().optional(),
    priorityClamped: z.boolean().nullable().optional(),
    toolsUnavailable: z.literal(true).optional(),
    uninstallDeletesData: z.boolean().optional(),
  }),
)
/** Each app window selects its own packages; the owner only serializes installation writes. */
export async function connectPluginSettings(options: {
  path: string
  personKey: string
  root: string
  pinnedPublicKey: KeyObject | null
  repoCatalogueSha256?: string
  target: PluginTarget
  appVersion?: string
  catalogue: { bytes: Uint8Array; signature: Uint8Array }
  projection: WorkspaceProjection
  propose(publicProposal: unknown, revision: number): void
  lost?(): void
  signal?: AbortSignal
  download?(release: Readonly<PluginRelease>, signal: AbortSignal): Promise<Uint8Array>
}): Promise<PluginSettingsController & { close(): Promise<void> }> {
  let releases = parsePluginCatalogue(options.catalogue.bytes)
  const vault = new PluginPackageVault(
    options.root,
    options.pinnedPublicKey,
    options.target,
    options.repoCatalogueSha256,
    options.appVersion ?? '0.0.0',
  )
  const screens = new Map<
    string,
    { install: string; live: boolean; revokers: Set<() => void | Promise<void>> }
  >()
  const generations = new Map<string, number>()
  let alive = true
  async function invalidate(id: string, bump = true) {
    if (bump) generations.set(id, (generations.get(id) ?? 0) + 1)
    const screen = screens.get(id)
    if (!screen) return
    screen.live = false
    await Promise.all([...screen.revokers].map((revoke) => Promise.resolve().then(revoke)))
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
      await options.projection.reconcile(request.change)
      return true
    },
  })
  const abort = () => channel.close()
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) channel.close()
  channel.onClose(() => {
    options.signal?.removeEventListener('abort', abort)
    alive = false
    options.lost?.()
    for (const id of screens.keys()) void invalidate(id).catch(() => {})
  })
  try {
    await channel.call({ kind: 'attach', workspaceId: options.projection.workspaceId })
  } catch (error) {
    channel.close()
    throw error
  }
  const featureReply = await channel.call({ kind: 'features' }).catch(() => ({ features: [] }))
  const features = z.object({ features: z.array(z.string()) }).parse(featureReply).features
  const selectedRef = (input: string | PackageRef): PackageRef => {
    if (typeof input !== 'string') return input
    const release = releases.find((one) => one.id === input)
    if (!release) throw new PluginSupervisorError('unavailable')
    return releasePackageRef(release)
  }
  async function applyPackage(ref: PackageRef, action: 'install' | 'update') {
    if (!alive) throw new PluginSupervisorError('unavailable')
    await channel.call({ kind: 'package-install', package: ref, action, operationId: randomUUID() })
  }
  async function inspectPackage(input: PluginPackageInput) {
    const explicitSource =
      typeof input === 'object' && !('sha256' in input) ? input.source : undefined
    const selection = (explicitSource === undefined ? input : explicitSource) as string | PackageRef
    const release =
      explicitSource === undefined
        ? releases.find((one) =>
            typeof selection === 'string'
              ? one.id === selection
              : one.archive.sha256 === selection.sha256,
          )
        : undefined
    const inspectOptions = {
      target: options.target,
      appVersion: options.appVersion ?? '0.0.0',
      signal: options.signal,
      ...(options.download && release
        ? {
            fetch: async () =>
              new Response(
                Uint8Array.from(
                  await options.download!(release, options.signal ?? new AbortController().signal),
                ),
              ),
          }
        : {}),
    }
    const installed =
      explicitSource === undefined && typeof selection === 'string'
        ? installedDisclosureIdentity(options.root, selection)
        : null
    const cachedDigest =
      explicitSource !== undefined
        ? undefined
        : typeof selection === 'object'
          ? selection.sha256
          : (release?.archive.sha256 ?? installed?.archiveSha256)
    const cached = cachedDigest
      ? await vault.selection(cachedDigest).catch(() => undefined)
      : undefined
    if (cached && typeof selection === 'object' && cached.archive.length !== selection.bytes)
      throw new Error('The selected package byte count does not match its archive.')
    const inspected = cached
      ? {
          ...cached,
          ref: typeof selection === 'object' ? selection : releasePackageRef(cached.release),
        }
      : explicitSource !== undefined
        ? await selectPluginPackage(explicitSource, inspectOptions)
        : typeof selection === 'string' && !releases.some((one) => one.id === selection)
          ? await selectPluginPackage(selection, inspectOptions)
          : await inspectPluginPackage(selectedRef(selection), inspectOptions)
    await vault.stage(
      inspected.release,
      inspected.archive,
      { bytes: Buffer.alloc(0), signature: Buffer.alloc(0) },
      [],
    )
    return {
      id: inspected.package.manifest.id,
      name: inspected.package.contract.name,
      ref: inspected.ref,
      details: releaseDisclosure(inspected.package),
      manifest: inspected.package.manifest,
    }
  }
  return {
    features: () => features,
    mutationStatus: () => null,
    mutationRequired: () => false,
    inspectPackage,
    applyPackage,
    async catalogue() {
      const cards = Cards.parse(await channel.call({ kind: 'list-tool-health' }))
      const byId = new Map(
        cards
          .filter((card) => card.installed || releases.some((one) => one.id === card.id))
          .map((card) => [card.id, card]),
      )
      for (const release of releases) {
        const card = byId.get(release.id)
        if (!card)
          byId.set(release.id, {
            id: release.id,
            name: release.id,
            state: 'Available',
            installed: false,
          })
        else if (card.installed) {
          const installed = installedDisclosureIdentity(options.root, release.id)
          if (installed?.archiveSha256 === release.archive.sha256) delete card.updateVersion
          else card.updateVersion = release.version
        }
      }
      return [...byId.values()].map((card) => ({
        ...card,
        ...(features.includes('plugin-restart-v1') &&
        card.installed &&
        (card.toolsUnavailable || card.state === 'Unavailable')
          ? { canRestart: true as const }
          : {}),
      }))
    },
    async refreshCatalogue(_digest, source) {
      if (source) releases = parsePluginCatalogue(source.bytes)
    },
    async install(id) {
      const inspected = await inspectPackage(id)
      await applyPackage(inspected.ref, 'install')
    },
    async update(id) {
      await invalidate(id)
      const inspected = await inspectPackage(id)
      await applyPackage(inspected.ref, 'update')
    },
    ...(features.includes('plugin-restart-v1')
      ? {
          async restartPlugin(pluginId: string) {
            if ((await channel.call({ kind: 'restart-plugin', pluginId })) !== true)
              throw new PluginSupervisorError('unavailable')
          },
        }
      : {}),
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
      alive = false
      try {
        await channel.call({ kind: 'detach' }, 30_000)
      } finally {
        channel.close()
      }
    },
  }
}
