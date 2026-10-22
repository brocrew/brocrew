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
}): Promise<PluginSettingsController & { close(): Promise<void> }> {
  const admittedCatalogue = createRepoAwarePluginVerifier({
    pinnedPublicKey: options.pinnedPublicKey,
    repoCatalogueSha256: options.repoCatalogueSha256,
    target: options.target,
  }).verifyCatalogue(options.catalogue.bytes, options.catalogue.signature)
  if (!admittedCatalogue.entries.length) throw new PluginSupervisorError('unavailable')
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
  return {
    async catalogue() {
      const cards = Cards.parse(await channel.call({ kind: modern ? 'list-v2' : 'list' }))
      // Project reviewed local adapter capabilities without expanding the legacy owner wire.
      return cards.map((card) => ({
        ...card,
        ...(!modern ? { uninstallDeletesData: Boolean(pluginAdapter(card.id)?.uninstall) } : {}),
        hasRemoteLogout: Boolean(pluginAdapter(card.id)?.uninstall),
      }))
    },
    ...(modern
      ? {
          async refreshCatalogue(catalogueDigest: string) {
            await channel.call({ kind: 'refresh', catalogueDigest })
          },
          async update(pluginId: string) {
            await invalidate(pluginId)
            await channel.call({ kind: 'update', pluginId, operationId: randomUUID() })
          },
        }
      : {}),
    async install(pluginId) {
      await channel.call({ kind: 'install', pluginId, operationId: randomUUID() })
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
