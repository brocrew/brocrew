import { PluginVerificationError } from '../verification-error'
import { PluginDownloadError, downloadPluginBytes } from '../catalogue/download'
import { PluginListError } from '../catalogue/list-error'
import { createContributionRegistry, pluginContributions } from '../contributions'
import { pluginNodePolicy } from '../node-policy'
import { newerPluginVersion } from '../catalogue/newer-version'
import { parseRepoPluginList } from '../catalogue/repo-list'
import { PluginProfileLedger } from './profile-ledger'
import { chromeProfileIntent, ChromeProposal } from './chrome-apply'
import { pluginAdapter } from './adapters'
import { PluginProposal, proposalFor } from './proposals'
import { PLUGIN_LIMITS, pluginSha256 } from '../package-digests'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createRepoAwarePluginVerifier, type VerifiedPluginPackage } from '../package-verifier'
import { PluginSupervisorError } from '../supervisor/protocol'
import { downloadPluginArchive } from './download'
import { LifecycleEffects, type Effect } from './files'
import { PluginPackageVault } from './vault'
import type {
  LifecycleOptions,
  LifecycleRun,
  LifecycleWorkspace,
  WorkspaceProjection,
  ProjectionReceipt,
  Installation,
  PluginReleasePin,
} from './types'
import type { PluginCard, PluginRemovalOutcome } from '../../../shared/plugin-settings'

const refuse = (): never => {
  throw new PluginSupervisorError('unavailable')
}
const pending = (): never => {
  throw new PluginSupervisorError('cleanup-pending')
}
async function bounded<T>(work: () => Promise<T>, ms = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PluginSupervisorError('cleanup-pending')), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
const idSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
interface Workspace {
  sink: WorkspaceProjection
  receipts: Map<string, ProjectionReceipt>
  live: boolean
}
/** The journal's pending operation, which a list under the state lock sees only once it is stuck. */
interface Unfinished {
  install: Installation
  operationId: string
}
interface Running {
  installId: string
  run: LifecycleRun
  package: VerifiedPluginPackage
  ended: boolean
  revocation?: Promise<void>
  priorityClamped?: boolean | null
}

export interface PreparedPluginMutation {
  action: 'install' | 'update'
  pluginId: string
  releaseDigest: string
  catalogueDigest: string
  sequence: number
  catalogueRevision: number
  installId: string | null
}

/** One instance per exclusively owned supervisor. Settings/person authority is never an agent API. */
export class PluginLifecycleController {
  private readonly workspaces = new Map<LifecycleWorkspace, Workspace>()
  private readonly blocks = new Map<string, symbol>()
  private readonly runs = new Map<string, Running>()
  private readonly attempted = new Set<string>()
  private readonly localOperations = new Set<string>()
  private readonly admittedCatalogues = new Map<string, readonly string[]>()
  private readonly cleanup = new Set<string>()
  private catalogueRevision = 0
  private draining = false
  private drained = false
  private drainWork: Promise<void> | undefined
  private retrying: Promise<void> | undefined
  private retryAt = 0
  private retryDelay = 5_000
  private readonly registrations = createContributionRegistry()
  private readonly profileCalls = new Map<string, AbortController>()
  private constructor(
    private readonly options: LifecycleOptions,
    private readonly effects: LifecycleEffects,
    private readonly vault: PluginPackageVault,
  ) {}
  static async open(options: LifecycleOptions): Promise<PluginLifecycleController> {
    try {
      const state = options.state.inspect()
      const controller = new PluginLifecycleController(
        options,
        await LifecycleEffects.open(options.root, state.guards.length === 0),
        new PluginPackageVault(
          options.root,
          options.pinnedPublicKey,
          options.target,
          options.repoCatalogueSha256,
        ),
      )
      const catalogue = controller.catalogue() // Complete verification before retaining provenance.
      controller.retainCatalogue(
        options.catalogue.bytes,
        catalogue.entries.map((one) => one.id),
      )
      controller.retainRepoList(options.repoList, options.repoCatalogueSha256)
      controller.retainLegacyRepoList(options.legacyRepoList)
      await options.state.withExclusive(() => controller.recover())
      return controller
    } catch {
      return refuse()
    }
  }
  private pins(): PluginReleasePin[] {
    return this.options.state.inspect().operations.flatMap(({ operation }) => {
      const consent = operation.request.consent
      return consent.pluginId && consent.release
        ? [
            {
              id: consent.pluginId,
              version: consent.release.version,
              archiveSha256: consent.release.archiveSha256,
              manifestSha256: consent.release.manifestSha256,
            },
          ]
        : []
    })
  }
  catalogueIdentity(): string {
    return pluginSha256(this.options.catalogue.bytes)
  }
  private retainCatalogue(bytes: Uint8Array, ids: readonly string[]): void {
    const digest = pluginSha256(bytes)
    if (this.admittedCatalogues.has(digest)) return
    // Never evict a source underneath an attached or returning older app.
    if (this.admittedCatalogues.size >= 512) throw new PluginSupervisorError('incompatible')
    this.admittedCatalogues.set(digest, Object.freeze([...new Set(ids)].sort()))
  }
  private retainRepoList(source: LifecycleOptions['repoList'], expected: string | undefined): void {
    if (!source) return
    if (
      this.options.pinnedPublicKey !== null ||
      !expected ||
      pluginSha256(source.bytes) !== source.sha256
    )
      return refuse()
    const parsed = parseRepoPluginList(source.bytes, this.options.target, source.appVersion)
    if (parsed.sha256 !== expected) return refuse()
    const fresh = parsed.legacyCatalogues.filter((one) => !this.admittedCatalogues.has(one.sha256))
    if (this.admittedCatalogues.size + fresh.length > 512)
      throw new PluginSupervisorError('incompatible')
    for (const view of fresh)
      this.retainCatalogue(
        view.bytes,
        view.releases.map((one) => one.id),
      )
  }
  private retainLegacyRepoList(source: LifecycleOptions['legacyRepoList']): void {
    if (!source) return
    if (this.options.pinnedPublicKey !== null || pluginSha256(source.bytes) !== source.sha256)
      return refuse()
    const parsed = parseRepoPluginList(source.bytes, this.options.target, source.appVersion)
    if (parsed.format !== 1) return refuse()
    const fresh = parsed.legacyCatalogues.filter(
      (view) => !this.admittedCatalogues.has(view.sha256),
    )
    if (this.admittedCatalogues.size + fresh.length > 512)
      throw new PluginSupervisorError('incompatible')
    for (const view of fresh)
      this.retainCatalogue(
        view.bytes,
        view.releases.map((release) => release.id),
      )
  }
  /** Only sources actually verified and admitted by this owner identify a legacy client's IDs. */
  legacyCatalogueIds(digest: string): readonly string[] {
    const ids = this.admittedCatalogues.get(digest)
    if (!ids) throw new PluginSupervisorError('incompatible')
    return ids
  }
  async refreshCatalogue(expectedDigest: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(expectedDigest) || !this.options.refreshCatalogue) return refuse()
    await this.mutationFence(async () => {
      const next = await this.options.refreshCatalogue!()
      const verified = createRepoAwarePluginVerifier({
        pinnedPublicKey: this.options.pinnedPublicKey,
        repoCatalogueSha256: next.repoCatalogueSha256,
        target: this.options.target,
        knownReleases: this.pins(),
      }).verifyCatalogue(next.catalogue.bytes, next.catalogue.signature)
      if (pluginSha256(next.catalogue.bytes) !== expectedDigest) {
        if (this.requiresPreparedMutations()) throw new PluginSupervisorError('source-mismatch')
        return refuse()
      }
      this.retainRepoList(next.repoList, next.repoCatalogueSha256)
      this.retainLegacyRepoList(next.legacyRepoList)
      this.retainCatalogue(
        next.catalogue.bytes,
        verified.entries.map((one) => one.id),
      )
      this.catalogueRevision++
      this.options.catalogue = next.catalogue
      this.options.repoCatalogueSha256 = next.repoCatalogueSha256
      this.options.repoList = next.repoList
      this.options.legacyRepoList = next.legacyRepoList
      this.options.names = next.names
    })
  }
  private catalogue() {
    return createRepoAwarePluginVerifier({
      pinnedPublicKey: this.options.pinnedPublicKey,
      repoCatalogueSha256: this.options.repoCatalogueSha256,
      target: this.options.target,
      knownReleases: this.pins(),
    }).verifyCatalogue(this.options.catalogue.bytes, this.options.catalogue.signature)
  }
  /** Verify author identity before revoking or changing any installation authority. */
  private async mutationPackage(id: string) {
    const proof = this.options.catalogue,
      catalogue = this.catalogue()
    const release = catalogue.entries.find((entry) => entry.id === id)
    if (!release?.authors) throw new PluginSupervisorError('policy-refused')
    let bytes: Uint8Array | undefined
    const checked = await this.vault
      .load(release, this.pins(), catalogue)
      .catch(async () => {
        bytes = await (
          this.options.download ??
          ((entry, signal) =>
            downloadPluginBytes({
              url: entry.archive.url,
              maximum: PLUGIN_LIMITS.archiveBytes,
              size: entry.archive.size,
              sha256: entry.archive.sha256,
              signal,
            }))
        )(release, AbortSignal.timeout(30000))
        return catalogue.verifyPackage(id, release.version, bytes)
      })
      .catch((error) => {
        if (error instanceof PluginVerificationError || error instanceof PluginDownloadError)
          throw new PluginSupervisorError(
            error instanceof PluginDownloadError && error.kind === 'transport'
              ? 'network'
              : 'policy-refused',
          )
        throw error
      })
    if (
      this.options.catalogue !== proof ||
      checked.manifest.format !== 2 ||
      JSON.stringify(checked.manifest.authors) !== JSON.stringify(release.authors)
    )
      throw new PluginSupervisorError('policy-refused')
    return { proof, release, checked, bytes }
  }
  /** Policy is a normal refusal, never a storage exception. Leave real disk errors to the fence. */
  private async mutationFence<T>(work: () => Promise<T>): Promise<T> {
    const outcome = await this.options.state.withExclusive(async () => {
      // Preserve the existing storage-error path for the dormant v1 policy.
      if (!this.requiresPreparedMutations()) return { ok: true, value: await work() } as const
      const before = this.options.state.inspect()
      try {
        return { ok: true, value: await work() } as const
      } catch (error) {
        const after = this.options.state.inspect()
        if (after.sequence !== before.sequence || after.pending !== null) throw error
        if (
          error instanceof PluginSupervisorError &&
          ['policy-refused', 'source-mismatch', 'network', 'incompatible'].includes(error.code)
        )
          return { ok: false, error } as const
        if (
          error instanceof PluginVerificationError ||
          error instanceof PluginDownloadError ||
          error instanceof PluginListError
        )
          return {
            ok: false,
            error: new PluginSupervisorError(
              (error instanceof PluginDownloadError && error.kind === 'transport') ||
                (error instanceof PluginListError && error.state === 'fetch-error')
                ? 'network'
                : 'policy-refused',
            ),
          } as const
        throw error
      }
    })
    if (!outcome.ok) throw outcome.error
    return outcome.value
  }
  requiresPreparedMutations(): boolean {
    const catalogue = this.catalogue()
    return catalogue.format === 2 || catalogue.entries.some((entry) => entry.authors !== undefined)
  }
  mutationCatalogueDigest(): string {
    return pluginSha256(this.options.catalogue.bytes)
  }
  requireMutationSource(digest: string): void {
    if (!this.requiresPreparedMutations()) throw new PluginSupervisorError('incompatible')
    if (digest !== this.mutationCatalogueDigest())
      throw new PluginSupervisorError('source-mismatch')
  }
  private requirePreparation(
    id: string,
    action: 'install' | 'update',
    prepared: PreparedPluginMutation | undefined,
  ): void {
    if (!this.requiresPreparedMutations()) {
      if (prepared) throw new PluginSupervisorError('incompatible')
      return
    }
    if (!prepared || typeof prepared !== 'object') throw new PluginSupervisorError('policy-refused')
    this.requireMutationSource(prepared.catalogueDigest)
    const state = this.options.state.inspect()
    if (
      prepared.action !== action ||
      prepared.pluginId !== id ||
      prepared.sequence !== state.sequence ||
      prepared.catalogueRevision !== this.catalogueRevision ||
      prepared.installId !== (this.current(id)?.installId ?? null) ||
      prepared.releaseDigest !== this.catalogue().entries.find((e) => e.id === id)?.archive.sha256
    )
      throw new PluginSupervisorError('policy-refused')
  }
  async prepareMutation(
    handle: LifecycleWorkspace,
    action: 'install' | 'update',
    id: string,
    releaseDigest: string,
    catalogueDigest: string,
  ): Promise<PreparedPluginMutation> {
    this.workspace(handle)
    this.requireMutationSource(catalogueDigest)
    if (this.catalogue().entries.find((e) => e.id === id)?.archive.sha256 !== releaseDigest)
      throw new PluginSupervisorError('policy-refused')
    const checked = await this.mutationPackage(id)
    if (checked.release.archive.sha256 !== releaseDigest || !checked.release.authors)
      throw new PluginSupervisorError('policy-refused')
    return this.mutationFence(async () => {
      this.requireMutationSource(catalogueDigest)
      if (this.options.catalogue !== checked.proof)
        throw new PluginSupervisorError('policy-refused')
      const current = this.current(id)
      if (
        (action === 'install' && current) ||
        (action === 'update' &&
          (!current || !newerPluginVersion(checked.release.version, current.release.version)))
      )
        throw new PluginSupervisorError('policy-refused')
      return Object.freeze({
        action,
        pluginId: id,
        releaseDigest,
        catalogueDigest,
        sequence: this.options.state.inspect().sequence,
        catalogueRevision: this.catalogueRevision,
        installId: current?.installId ?? null,
      })
    })
  }
  private descriptor(install: Installation) {
    return {
      id: install.pluginId,
      version: install.release.version,
      manifestSha256: install.release.manifestSha256,
      archive: { sha256: install.release.archiveSha256 },
    }
  }
  private block(id: string): symbol {
    this.registrations.revoke(id)
    this.profileCalls.get(id)?.abort()
    const token = Symbol()
    this.blocks.set(id, token)
    try {
      this.options.deny(id)
    } catch {
      return refuse()
    }
    return token
  }
  private workspace(handle: LifecycleWorkspace): Workspace {
    const workspace = this.workspaces.get(handle)
    if (!workspace?.live) return refuse()
    return workspace
  }
  private current(id: string): Installation | undefined {
    const state = this.options.state.inspect()
    if (state.pending) return undefined
    return this.options.state.exportActivation().entries.find((one) => one.pluginId === id)
  }
  admitted(handle: LifecycleWorkspace, id: string, installId: string): boolean {
    try {
      const workspace = this.workspace(handle),
        active = this.current(id),
        run = this.runs.get(id)
      return (
        !this.blocks.has(id) &&
        active?.installId === installId &&
        run?.installId === installId &&
        !run.ended &&
        this.options.state.matchesProjection(workspace.receipts.get(id), workspace.sink.workspaceId)
      )
    } catch {
      return false
    }
  }
  async status(): Promise<{ cards: PluginCard[]; cleanupPending: string[] }> {
    let unfinished: Unfinished | undefined
    const read = await this.options.state.withExclusive(async () => {
      const releases = this.catalogue().entries
      const state = this.options.state.inspect()
      if (state.pending?.next)
        unfinished = { install: state.pending.next, operationId: state.pending.request.operationId }
      const activations = state.pending ? [] : this.options.state.exportActivation().entries
      const names = new Set([
        ...releases.map((one) => one.id),
        ...state.guards.map((one) => one.pluginId),
      ])
      return {
        cards: [...names].sort().map((id) => {
          const active = activations.find((one) => one.pluginId === id),
            release = releases.find((one) => one.id === id)
          const name = this.options.names[id] ?? id
          if (
            typeof name !== 'string' ||
            !name.length ||
            name.length > 128 ||
            /[\r\n\0]/.test(name)
          )
            return refuse()
          return {
            id,
            name,
            uninstallDeletesData: Boolean(pluginAdapter(id)?.uninstall),
            ...(active ? { installedVersion: active.release.version } : {}),
            ...(active &&
            release &&
            newerPluginVersion(release.version, active.release.version) &&
            release.platforms.some(
              (one) => one.os === this.options.target.os && one.cpu === this.options.target.cpu,
            )
              ? { updateVersion: release.version }
              : {}),
            ...(this.runs.get(id)?.priorityClamped !== undefined
              ? { priorityClamped: this.runs.get(id)!.priorityClamped }
              : {}),
            installed:
              !!active ||
              (['uninstall', 'update'].includes(state.pending?.request.consent.action ?? '') &&
                state.pending?.next?.pluginId === id),
            state:
              this.cleanup.has(id) || this.blocks.has(id)
                ? 'Unavailable'
                : active
                  ? this.runs.has(id) && !this.runs.get(id)!.ended
                    ? 'Running'
                    : 'Installed'
                  : release?.platforms.some(
                        (one) =>
                          one.os === this.options.target.os && one.cpu === this.options.target.cpu,
                      )
                    ? 'Available'
                    : 'Unavailable',
          } as PluginCard
        }),
        cleanupPending: [...this.cleanup].sort(),
      }
    })
    this.retryLater(unfinished)
    return read
  }
  // A removal or install that failed part way is finished as the next owner's start would finish
  // it, after 5 s and then up to 60 s apart, so it needs neither a restart nor a second press.
  // A stop that already failed is tried again before the state lock, so one that keeps failing
  // never holds up lists, Install or another plugin's attach.
  private retryLater(unfinished: Unfinished | undefined): void {
    if (!unfinished) {
      this.retryAt = 0
      this.retryDelay = 5_000
      return
    }
    if (this.draining || this.retrying) return
    const now = (this.options.now ?? Date.now)()
    this.retryAt ||= now + this.retryDelay
    if (now < this.retryAt) return
    const { install, operationId } = unfinished
    this.retrying = (async () => {
      const run = this.runs.get(install.pluginId)
      if (run?.ended && run.installId === install.installId)
        await this.stop(install.pluginId, operationId)
      if (this.draining) return
      await this.options.state.withExclusive(async () => {
        if (this.options.state.inspect().pending?.request.operationId === operationId)
          await this.recover()
      })
    })()
      .catch(() => undefined)
      .finally(() => {
        this.retrying = undefined
        this.retryDelay = Math.min(this.retryDelay * 2, 60_000)
        this.retryAt = 0
      })
  }
  async attach(sink: WorkspaceProjection): Promise<LifecycleWorkspace> {
    if (
      !z.uuid().safeParse(sink.workspaceId).success ||
      [...this.workspaces.values()].some(
        (one) => one.live && one.sink.workspaceId === sink.workspaceId,
      )
    )
      return refuse()
    const handle = Object.freeze({}) as LifecycleWorkspace
    const workspace: Workspace = { sink, receipts: new Map(), live: true }
    this.workspaces.set(handle, workspace)
    const touched = new Map<string, { before: ProjectionReceipt | null; ids: Set<string> }>()
    try {
      await this.options.state.withExclusive(async () => {
        const before = this.options.state.projections(sink.workspaceId)
        const active = this.options.state.exportActivation().entries
        const guards = this.options.state.inspect().guards
        const ids = new Set([
          ...before.map((one) => one.pluginId),
          ...guards.map((one) => one.pluginId),
        ])
        for (const id of ids) {
          const old = before.find((one) => one.pluginId === id) ?? null
          const guard = guards.find((one) => one.pluginId === id)
          if (old) workspace.receipts.set(id, old)
          const identities = new Set(
            [old?.installId, guard?.installId].filter((one): one is string => !!one),
          )
          touched.set(id, { before: old, ids: identities })
          // A restored workspace row is never proof. Clear old consumers/UI for every known
          // identity, including tombstoned plugins with no remaining workspace receipt.
          for (const installId of identities) {
            if ((await bounded(() => sink.revoke(id, installId))) !== true) return pending()
          }
          await sink.reconcile({ pluginId: id, before: old, receipt: null })
          await sink.applied(id, null)
          this.options.state.recordProjection(sink.workspaceId, id, null)
          workspace.receipts.delete(id)
          const installed = active.find((one) => one.pluginId === id)
          if (installed) {
            const checked = await this.vault.load(this.descriptor(installed), this.pins())
            await this.ensureRunning(installed, checked)
            // Only authenticated current owner state, readiness and a fresh consumer ack can rebind.
            await this.project(workspace, installed)
          }
        }
      })
      return handle
    } catch {
      workspace.live = false
      const proofs = await Promise.allSettled(
        [...touched].map(([id, entry]) =>
          bounded(async () => {
            for (const installId of entry.ids)
              if ((await sink.revoke(id, installId)) !== true) return pending()
            await sink.reconcile({ pluginId: id, before: entry.before, receipt: null })
            await sink.applied(id, null)
          }),
        ),
      )
      this.workspaces.delete(handle)
      if (proofs.some((one) => one.status !== 'fulfilled')) {
        for (const id of touched.keys()) {
          this.block(id)
          this.cleanup.add(id)
        }
        return pending()
      }
      return refuse()
    }
  }
  async detach(handle: LifecycleWorkspace): Promise<void> {
    const workspace = this.workspace(handle)
    workspace.live = false
    this.registrations.detach(workspace.sink.workspaceId)
    const results = await Promise.allSettled(
      [...workspace.receipts.values()].map((receipt) =>
        bounded(() => workspace.sink.revoke(receipt.pluginId, receipt.installId)),
      ),
    )
    this.workspaces.delete(handle)
    if (results.some((one) => one.status !== 'fulfilled' || one.value !== true)) return pending()
  }
  private async ensureRunning(
    install: Installation,
    checked: VerifiedPluginPackage,
  ): Promise<LifecycleRun> {
    if (checked.manifest.skills.length !== 0) return refuse()
    const prior = this.runs.get(install.pluginId)
    if (prior) {
      if (prior.installId !== install.installId || prior.ended) return pending()
      return prior.run
    }
    pluginNodePolicy(checked)
    this.attempted.add(install.pluginId)
    const run = await this.options.runtime.start({
      package: checked,
      releaseDigest: install.release.archiveSha256,
    })
    const running: Running = { run, installId: install.installId, package: checked, ended: false }
    this.runs.set(install.pluginId, running)
    const ended = (proven: boolean) => {
      if (this.runs.get(install.pluginId) !== running || running.ended) return
      running.ended = true
      // Intentional exits belong to the drain; unexpected exits must also revoke consumers.
      if (this.draining && proven) return
      const token = this.block(install.pluginId)
      this.cleanup.add(install.pluginId)
      running.revocation = this.revoke(install).then(() => {
        if (
          proven &&
          this.runs.get(install.pluginId) === running &&
          this.blocks.get(install.pluginId) === token
        )
          this.cleanup.delete(install.pluginId)
      })
      void running.revocation.catch(() => undefined)
    }
    void run.exited
      .then(
        () => ended(true),
        () => ended(false),
      )
      .catch(() => undefined)
    // On Windows a start first opens the job keeper, which can take two minutes on a cold machine;
    // the host bounds that open and the readiness after it (node-host.ts).
    const connection = await bounded(
      () => run.ready(),
      process.platform === 'win32' ? 150_000 : 20000,
    )
    if (connection.priorityClamped !== undefined)
      running.priorityClamped =
        typeof connection.priorityClamped === 'boolean' ? connection.priorityClamped : null
    return run
  }
  async install(
    handle: LifecycleWorkspace,
    id: string,
    operationId: string = randomUUID(),
  ): Promise<void> {
    return this.installMutation(handle, id, undefined, operationId)
  }
  async installPrepared(
    handle: LifecycleWorkspace,
    id: string,
    prepared: PreparedPluginMutation,
    operationId: string = randomUUID(),
  ): Promise<void> {
    if (!prepared || !this.requiresPreparedMutations())
      throw new PluginSupervisorError('policy-refused')
    return this.installMutation(handle, id, prepared, operationId)
  }
  private async installMutation(
    handle: LifecycleWorkspace,
    id: string,
    prepared: PreparedPluginMutation | undefined,
    operationId: string,
  ): Promise<void> {
    const workspace = this.workspace(handle)
    this.requirePreparation(id, 'install', prepared)
    const expectedReleaseDigest = prepared?.releaseDigest
    const offered = this.catalogue().entries.find((release) => release.id === id)
    if (
      this.requiresPreparedMutations() &&
      (!offered?.authors ||
        (expectedReleaseDigest !== undefined && offered.archive.sha256 !== expectedReleaseDigest))
    )
      return refuse()
    if (!idSchema.safeParse(id).success || !z.uuid().safeParse(operationId).success) return refuse()
    const preflight = this.requiresPreparedMutations() ? await this.mutationPackage(id) : undefined
    let token: symbol | undefined = this.requiresPreparedMutations() ? undefined : this.block(id)
    try {
      await this.mutationFence(async () => {
        this.requirePreparation(id, 'install', prepared)
        if (preflight && this.options.catalogue !== preflight.proof) return refuse()
        if (this.requiresPreparedMutations()) token = this.block(id)
        const prior = this.options.state
          .inspect()
          .operations.find((one) => one.operation.request.operationId === operationId)
        if (prior) {
          if (
            prior.operation.request.consent.action !== 'install' ||
            prior.operation.request.consent.pluginId !== id ||
            prior.status !== 'completed'
          )
            return refuse()
          const installed = this.current(id)
          if (
            expectedReleaseDigest !== undefined &&
            installed?.release.archiveSha256 !== expectedReleaseDigest
          )
            return refuse()
          if (!installed || installed.installId !== prior.operation.next?.installId) return refuse()
          const checked = await this.vault.load(this.descriptor(installed), this.pins())
          await this.ensureRunning(installed, checked)
          await this.project(workspace, installed)
          const effect = await this.effects.read(operationId)
          if (!effect || effect.phase === 'aborted') return refuse()
          if (effect.phase === 'prepared')
            await this.effects.write({ ...effect, phase: 'committed' })
          return
        }
        const catalogue = this.catalogue(),
          release = catalogue.entries.find((one) => one.id === id)
        if (
          !release ||
          !release.platforms.some(
            (one) => one.os === this.options.target.os && one.cpu === this.options.target.cpu,
          )
        )
          return refuse()
        if (
          this.requiresPreparedMutations() &&
          (!release.authors ||
            (expectedReleaseDigest !== undefined &&
              release.archive.sha256 !== expectedReleaseDigest))
        )
          return refuse()
        const bytes = preflight
          ? preflight.bytes
          : await (this.options.download ?? downloadPluginArchive)(
              release,
              AbortSignal.timeout(30000),
            )
        const checked = preflight?.checked ?? catalogue.verifyPackage(id, release.version, bytes!)
        if (checked.manifest.skills.length !== 0) return refuse()
        const state = this.options.state.inspect(),
          before = state.guards.find((one) => one.pluginId === id)
        if (
          before &&
          (before.release.dataSchema < checked.manifest.dataCompatibility.minSchema ||
            before.release.dataSchema > checked.manifest.dataCompatibility.maxSchema)
        )
          return refuse()
        if (!workspace.live) return refuse()
        const cohort = [...this.workspaces.values()].filter((one) => one.live)
        const operation = this.options.state.prepare({
          workspaces: cohort.map((one) => one.sink.workspaceId).sort(),
          operationId,
          snapshot: null,
          consent: {
            action: 'install',
            pluginId: id,
            at: (this.options.now ?? Date.now)(),
            expectedSequence: state.sequence,
            expectedInstallId: before?.installId ?? null,
            release: {
              version: release.version,
              archiveSha256: release.archive.sha256,
              manifestSha256: release.manifestSha256,
              dataSchema: checked.manifest.dataSchema,
            },
          },
        })
        const install = operation.next!
        this.localOperations.add(operationId)
        const effect: Effect = {
          format: 1,
          operationId,
          pluginId: id,
          installId: install.installId,
          action: 'install',
          phase: 'prepared',
          offlineCleanup: false,
          compensates: null,
        }
        try {
          await this.effects.write(effect)
          this.options.fault?.('prepared')
          const staged = bytes
            ? await this.vault.stage(release, bytes, this.options.catalogue, this.pins())
            : checked
          this.options.fault?.('staged')
          await this.ensureRunning(install, staged)
          this.options.fault?.('ready')
          // Every required ack happens behind the pending barrier. The reserved completion
          // publishes activation and these exact workspace receipts in one journal record.
          const receipts = new Map<Workspace, ProjectionReceipt>()
          const projections = await Promise.allSettled(
            cohort.map(async (one) => {
              if (!one.live || !workspace.live) return refuse()
              const receipt = this.options.state.previewProjection(
                operationId,
                one.sink.workspaceId,
              )
              await one.sink.reconcile({
                pluginId: id,
                before: one.receipts.get(id) ?? null,
                receipt,
              })
              await one.sink.applied(id, receipt)
              if (!one.live || !workspace.live) return refuse()
              receipts.set(one, receipt)
            }),
          )
          if (projections.some((one) => one.status !== 'fulfilled')) return refuse()
          this.options.fault?.('receipted')
          await this.effects.write({ ...effect, phase: 'committed' })
          if (!workspace.live || cohort.some((one) => !one.live)) return refuse()
          this.options.state.complete(operationId)
          for (const [one, receipt] of receipts) one.receipts.set(id, receipt)
          this.options.fault?.('activated')
        } catch {
          const committed = this.options.state
            .inspect()
            .operations.find((one) => one.operation.request.operationId === operationId)
          if (
            committed?.status === 'completed' &&
            committed.operation.request.workspaces !== undefined
          ) {
            for (const one of cohort)
              if (one.live) {
                const receipt = this.options.state
                  .projections(one.sink.workspaceId)
                  .find((value) => value.pluginId === id && value.installId === install.installId)
                if (!receipt) return pending()
                one.receipts.set(id, receipt)
              }
            return
          }
          await this.unwind(effect)
          return refuse()
        }
      })
      if (this.blocks.get(id) === token) this.blocks.delete(id)
    } catch (error) {
      if (
        error instanceof PluginSupervisorError &&
        ['policy-refused', 'source-mismatch'].includes(error.code)
      )
        throw error
      if (!this.cleanup.has(id) && !this.options.state.inspect().pending) {
        if (this.blocks.get(id) === token) this.blocks.delete(id)
      }
      return refuse()
    }
  }
  async update(
    handle: LifecycleWorkspace,
    id: string,
    operationId: string = randomUUID(),
  ): Promise<void> {
    return this.updateMutation(handle, id, undefined, operationId)
  }
  async updatePrepared(
    handle: LifecycleWorkspace,
    id: string,
    prepared: PreparedPluginMutation,
    operationId: string = randomUUID(),
  ): Promise<void> {
    if (!prepared || !this.requiresPreparedMutations())
      throw new PluginSupervisorError('policy-refused')
    return this.updateMutation(handle, id, prepared, operationId)
  }
  private async updateMutation(
    handle: LifecycleWorkspace,
    id: string,
    prepared: PreparedPluginMutation | undefined,
    operationId: string,
  ): Promise<void> {
    const workspace = this.workspace(handle)
    this.requirePreparation(id, 'update', prepared)
    if (
      this.requiresPreparedMutations() &&
      !this.catalogue().entries.find((release) => release.id === id)?.authors
    )
      return refuse()
    if (!idSchema.safeParse(id).success || !z.uuid().safeParse(operationId).success) return refuse()
    const preflight = this.requiresPreparedMutations() ? await this.mutationPackage(id) : undefined
    let token: symbol | undefined = this.requiresPreparedMutations() ? undefined : this.block(id)
    try {
      await this.mutationFence(async () => {
        this.requirePreparation(id, 'update', prepared)
        if (preflight && this.options.catalogue !== preflight.proof) return refuse()
        if (this.requiresPreparedMutations()) token = this.block(id)
        const state = this.options.state.inspect()
        const prior = state.operations.find(
          (one) => one.operation.request.operationId === operationId,
        )
        if (prior) {
          if (
            prior.operation.request.consent.action !== 'update' ||
            prior.operation.request.consent.pluginId !== id
          )
            return refuse()
          if (
            prior.status === 'completed' &&
            this.current(id)?.incarnation === prior.operation.next?.incarnation
          )
            return
          if (prior.status !== 'prepared' || state.pending?.request.operationId !== operationId)
            return refuse()
          const effect = await this.effects.read(operationId)
          if (!effect) return pending()
          await this.finishUpdate(effect, prior.operation.next!)
          return
        }
        const before = this.current(id),
          catalogue = this.catalogue()
        const release = catalogue.entries.find((one) => one.id === id)
        if (
          !before ||
          !release ||
          !newerPluginVersion(release.version, before.release.version) ||
          !release.platforms.some(
            (one) => one.os === this.options.target.os && one.cpu === this.options.target.cpu,
          )
        )
          return refuse()
        if (this.requiresPreparedMutations() && !release.authors) return refuse()
        const bytes = preflight
          ? preflight.bytes
          : await (this.options.download ?? downloadPluginArchive)(
              release,
              AbortSignal.timeout(30000),
            )
        const checked = preflight?.checked ?? catalogue.verifyPackage(id, release.version, bytes!)
        if (
          checked.manifest.skills.length ||
          checked.manifest.dataSchema !== before.release.dataSchema ||
          before.release.dataSchema < checked.manifest.dataCompatibility.minSchema ||
          before.release.dataSchema > checked.manifest.dataCompatibility.maxSchema
        )
          return refuse()
        // Cache the verified replacement durably before reserving an update. Recovery needs no download.
        if (bytes) await this.vault.stage(release, bytes, this.options.catalogue, this.pins())
        this.options.fault?.('staged')
        if (!workspace.live) return refuse()
        this.options.state.requireUpdateReader()
        this.options.fault?.('update-fenced')
        const updateState = this.options.state.inspect()
        const operation = this.options.state.prepare({
          operationId,
          snapshot: null,
          workspaces: [...this.workspaces.values()]
            .filter((one) => one.live)
            .map((one) => one.sink.workspaceId)
            .sort(),
          consent: {
            action: 'update',
            pluginId: id,
            at: (this.options.now ?? Date.now)(),
            expectedSequence: updateState.sequence,
            expectedInstallId: before.installId,
            release: {
              version: release.version,
              archiveSha256: release.archive.sha256,
              manifestSha256: release.manifestSha256,
              dataSchema: checked.manifest.dataSchema,
            },
          },
        })
        const effect: Effect = {
          format: 1,
          operationId,
          pluginId: id,
          installId: before.installId,
          action: 'update',
          phase: 'prepared',
          offlineCleanup: false,
          compensates: null,
        }
        this.localOperations.add(operationId)
        await this.effects.write(effect)
        this.options.fault?.('prepared')
        await this.finishUpdate(effect, operation.next!)
      })
      if (this.blocks.get(id) === token) this.blocks.delete(id)
    } catch (error) {
      if (
        error instanceof PluginSupervisorError &&
        ['policy-refused', 'source-mismatch'].includes(error.code)
      )
        throw error
      if (!this.options.state.inspect().pending && this.blocks.get(id) === token)
        this.blocks.delete(id)
      return refuse()
    }
  }
  private async finishUpdate(effect: Effect, install: Installation): Promise<void> {
    const checked = await this.vault.load(this.descriptor(install), this.pins())
    // Revoke consumers and prove the old run stopped before starting the replacement. No logout or data removal.
    const stopped = await Promise.allSettled([
      this.stop(install.pluginId, effect.operationId),
      this.revoke(install),
    ])
    if (stopped.some((one) => one.status !== 'fulfilled')) return pending()
    await this.ensureRunning(install, checked)
    this.options.fault?.('ready')
    const cohort = [...this.workspaces.values()].filter((one) => one.live)
    const receipts = new Map<Workspace, ProjectionReceipt>()
    const applied = await Promise.allSettled(
      cohort.map(async (one) => {
        const receipt = this.options.state.previewProjection(
          effect.operationId,
          one.sink.workspaceId,
        )
        await one.sink.reconcile({ pluginId: install.pluginId, before: null, receipt })
        await one.sink.applied(install.pluginId, receipt)
        if (!one.live) return refuse()
        receipts.set(one, receipt)
      }),
    )
    if (applied.some((one) => one.status !== 'fulfilled')) return pending()
    this.options.fault?.('receipted')
    await this.effects.write({ ...effect, phase: 'committed' })
    this.options.state.complete(effect.operationId)
    for (const [one, receipt] of receipts) one.receipts.set(install.pluginId, receipt)
    this.cleanup.delete(install.pluginId)
    this.options.fault?.('activated')
  }
  private async project(workspace: Workspace, install: Installation): Promise<void> {
    if (!workspace.live) return refuse()
    const before = workspace.receipts.get(install.pluginId) ?? null
    const next = this.options.state.reconcileProjection(
      before,
      workspace.sink.workspaceId,
      install.pluginId,
    )
    await workspace.sink.reconcile({
      pluginId: install.pluginId,
      before,
      receipt: next.receipt,
    })
    await workspace.sink.applied(install.pluginId, next.receipt)
    this.options.state.recordProjection(workspace.sink.workspaceId, install.pluginId, next.receipt)
    if (!workspace.live) return refuse()
    if (!next.receipt) return refuse()
    workspace.receipts.set(install.pluginId, next.receipt)
  }
  private async stop(id: string, operationId: string): Promise<void> {
    const run = this.runs.get(id)
    if (run) {
      run.ended = true
      await bounded(() => run.run.stop())
      // A later Install may have started its own run meanwhile.
      if (this.runs.get(id) === run) {
        this.runs.delete(id)
        this.attempted.delete(id)
      }
      return
    }
    if (this.attempted.has(id)) return pending()
    if (this.localOperations.has(operationId)) return
    if ((await this.options.runtime.previousOwnerClean()) !== true) return pending()
  }
  private async revoke(install: Installation): Promise<void> {
    const results = await Promise.allSettled(
      [...this.workspaces.values()]
        .filter((one) => one.live)
        .map(async (workspace) => {
          workspace.receipts.delete(install.pluginId)
          if (
            (await bounded(() => workspace.sink.revoke(install.pluginId, install.installId))) !==
            true
          )
            return pending()
          await workspace.sink.reconcile({
            pluginId: install.pluginId,
            before: null,
            receipt: null,
          })
          await workspace.sink.applied(install.pluginId, null)
        }),
    )
    if (results.some((one) => one.status !== 'fulfilled')) return pending()
  }
  private async removeFiles(install: Installation, operationId: string): Promise<void> {
    await this.options.runtime.removeCode(install.pluginId, install.release.archiveSha256)
    await this.vault.remove(this.descriptor(install), this.pins(), {
      operationId,
      installId: install.installId,
    })
  }
  /** A running plugin's own clean-up before uninstall, such as logging out of an account. Its failure is not refused:
   * the plugin's data is deleted below either way. */
  private async beforeRemoval(id: string): Promise<PluginRemovalOutcome['logout']> {
    const adapter = pluginAdapter(id),
      running = this.runs.get(id)
    if (!adapter?.uninstall || !running || running.ended) return 'unconfirmed'
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const connection = await Promise.race([
        running.run.ready(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('unavailable')), 5000)
        }),
      ])
      return await adapter.uninstall(connection, new AbortController().signal)
    } catch {
      // Local deletion can finish even when remote removal was not confirmed.
      return 'unconfirmed'
    } finally {
      clearTimeout(timer)
    }
  }
  private async finishRemoval(
    effect: Effect,
    install: Installation,
  ): Promise<PluginRemovalOutcome['logout']> {
    const logout = await this.beforeRemoval(install.pluginId)
    const results = await Promise.allSettled([
      this.stop(install.pluginId, effect.operationId),
      this.revoke(install),
    ])
    if (results.some((one) => one.status !== 'fulfilled')) {
      this.cleanup.add(install.pluginId)
      return pending()
    }
    await this.removeFiles(install, effect.operationId)
    if (pluginAdapter(install.pluginId)?.uninstall) {
      if (!this.options.runtime.removeData) return pending()
      await this.options.runtime.removeData(install.pluginId)
    }
    const state = this.options.state.inspect()
    // The effect is durable first. A crash here still has a pending journal resolution and
    // recovery must finish it; a committed effect alone is never activation/exit authority.
    await this.effects.write({ ...effect, phase: 'committed', offlineCleanup: true })
    if (state.pending?.request.operationId === effect.operationId) {
      try {
        this.options.state.complete(effect.operationId)
      } catch {
        const completed = this.options.state
          .inspect()
          .operations.find((one) => one.operation.request.operationId === effect.operationId)
        if (completed?.status !== 'completed') return pending()
      }
    }
    // Cohort receipts clear in the reserved completion. Any older/offline receipt is only a
    // cleanup obligation: the tombstone already invalidates it, never authority to reactivate.
    this.cleanup.delete(install.pluginId)
    return logout
  }
  private async remove(
    id: string,
    operationId: string,
    compensates: string | null,
  ): Promise<PluginRemovalOutcome['logout']> {
    const state = this.options.state.inspect(),
      before = this.current(id)
    if (!before) return refuse()
    const operation = this.options.state.prepare({
      operationId,
      workspaces: [...this.workspaces.values()]
        .filter((one) => one.live)
        .map((one) => one.sink.workspaceId)
        .sort(),
      snapshot: null,
      consent: {
        action: 'uninstall',
        pluginId: id,
        at: (this.options.now ?? Date.now)(),
        expectedSequence: state.sequence,
        expectedInstallId: before.installId,
        release: null,
      },
    })
    const effect: Effect = {
      format: 1,
      operationId,
      pluginId: id,
      installId: before.installId,
      action: 'uninstall',
      phase: 'prepared',
      offlineCleanup: true,
      compensates,
    }
    await this.effects.write(effect)
    return this.finishRemoval(effect, operation.next!)
  }
  async uninstall(
    handle: LifecycleWorkspace,
    id: string,
    operationId: string = randomUUID(),
  ): Promise<PluginRemovalOutcome | void> {
    this.workspace(handle)
    if (!idSchema.safeParse(id).success || !z.uuid().safeParse(operationId).success) return refuse()
    let absent = false
    let logout: PluginRemovalOutcome['logout'] = 'unconfirmed'
    const token = this.block(id) // Synchronous denial before the queue, tombstone, or any consumer awaits.
    try {
      await this.options.state.withExclusive(async () => {
        const state = this.options.state.inspect()
        const guard = state.guards.find((one) => one.pluginId === id)
        if (!guard) {
          absent = true
          return refuse()
        }
        if (guard.phase === 'removed' && !state.pending && !this.cleanup.has(id)) return
        // A new person retry may resume this same unfinished removal, including after reconnect.
        // Never reuse a completed operation from an earlier installation for a new button press.
        const pendingId =
          state.pending?.request.consent.action === 'uninstall' &&
          state.pending.next?.pluginId === id
            ? state.pending.request.operationId
            : operationId
        const prior =
          state.operations.find((one) => one.operation.request.operationId === operationId) ??
          state.operations.find((one) => one.operation.request.operationId === pendingId)
        if (prior) {
          if (
            prior.operation.request.consent.action !== 'uninstall' ||
            prior.operation.request.consent.pluginId !== id
          )
            return refuse()
          if (prior.status === 'completed') return
          const effect = await this.effects.read(prior.operation.request.operationId)
          if (!effect || !prior.operation.next) return pending()
          logout = await this.finishRemoval(effect, prior.operation.next)
          return
        }
        logout = await this.remove(id, operationId, null)
      })
      if (this.blocks.get(id) === token) this.blocks.delete(id)
      if (pluginAdapter(id)?.uninstall) return { data: 'deleted', logout }
    } catch {
      if (absent) {
        if (!this.cleanup.has(id) && this.blocks.get(id) === token) this.blocks.delete(id)
        return refuse()
      }
      this.cleanup.add(id)
      return pending()
    }
  }
  private async unwind(effect: Effect): Promise<void> {
    const state = this.options.state.inspect(),
      entry = state.guards.find((one) => one.pluginId === effect.pluginId)
    if (!entry || entry.installId !== effect.installId) return pending()
    if (state.pending?.request.operationId === effect.operationId) {
      const results = await Promise.allSettled([
        this.stop(entry.pluginId, effect.operationId),
        this.revoke(entry),
      ])
      if (results.some((one) => one.status !== 'fulfilled')) {
        this.cleanup.add(entry.pluginId)
        return pending()
      }
      await this.removeFiles(entry, effect.operationId)
      this.options.state.abort(effect.operationId)
    } else if (entry.phase === 'active') {
      if (entry.releaseRevision !== 1 || entry.configRevision !== 0) return pending()
      await this.remove(entry.pluginId, randomUUID(), effect.operationId)
    }
    await this.effects.write({ ...effect, phase: 'aborted', offlineCleanup: true })
    this.cleanup.delete(entry.pluginId)
  }
  private async recover(): Promise<void> {
    const state = this.options.state.inspect()
    for (const record of state.operations) {
      const operation = record.operation
      if (operation.request.consent.action === 'global-restore') continue
      const next = operation.next!,
        effect = await this.effects.read(operation.request.operationId)
      if (
        record.status !== 'prepared' &&
        (effect?.phase === 'committed' || effect?.phase === 'aborted')
      )
        continue
      const current = state.guards.find((one) => one.pluginId === next.pluginId)
      if (current?.installId !== next.installId) continue // An old operation cannot undo a reinstall.
      const token = this.block(next.pluginId)
      if (!effect && record.status !== 'prepared') {
        this.cleanup.add(next.pluginId)
        continue
      }
      const pendingEffect: Effect = effect ?? {
        format: 1,
        operationId: operation.request.operationId,
        pluginId: next.pluginId,
        installId: next.installId,
        action: operation.request.consent.action,
        phase: 'prepared',
        offlineCleanup: true,
        compensates: null,
      }
      if ((await this.options.runtime.previousOwnerClean()) !== true) {
        this.cleanup.add(next.pluginId)
        continue
      }
      if (pendingEffect.action === 'install') await this.unwind(pendingEffect)
      else if (pendingEffect.action === 'update') await this.finishUpdate(pendingEffect, next)
      else await this.finishRemoval(pendingEffect, next)
      if (
        !this.cleanup.has(next.pluginId) &&
        !this.options.state.inspect().pending &&
        this.blocks.get(next.pluginId) === token
      )
        this.blocks.delete(next.pluginId)
    }
  }
  /** Page revision is this per-install intent ledger, separate from package configRevision. */
  async profileRevision(
    handle: LifecycleWorkspace,
    id: string,
    installId: string,
    allowLedgerV2 = true,
  ): Promise<number> {
    return this.options.state.withExclusive(async () => {
      const screen = this.screen(handle, id)
      if (!pluginAdapter(id) || screen.installation.installId !== installId) return refuse()
      return new PluginProfileLedger(this.options.root).revision(installId, allowLedgerV2)
    })
  }
  async applyProfile(
    handle: LifecycleWorkspace,
    input: {
      pluginId: string
      installId: string
      incarnation: string
      revision: number
      proposal: unknown
      ledgerFormat?: 1 | 2
    },
  ): Promise<void> {
    const proposal = PluginProposal.parse(input.proposal)
    await this.options.state.withExclusive(async () => {
      const screen = this.screen(handle, input.pluginId)
      const adapter = pluginAdapter(input.pluginId)
      if (
        !adapter ||
        !proposalFor(input.pluginId)?.safeParse(proposal).success ||
        screen.installation.installId !== input.installId ||
        screen.installation.incarnation !== input.incarnation
      )
        return refuse()
      const connection = await screen.connection
      if (!this.admitted(handle, input.pluginId, input.installId)) return refuse()
      // Consume even on an ambiguous HTTP failure; read actual state next time, never replay.
      await new PluginProfileLedger(this.options.root).reserve(
        input.installId,
        input.revision,
        input.pluginId === 'chrome'
          ? chromeProfileIntent(ChromeProposal.parse(proposal))
          : proposal,
        input.ledgerFormat ?? 1,
      )
      const abort = new AbortController()
      this.profileCalls.set(input.pluginId, abort)
      try {
        if (!this.admitted(handle, input.pluginId, input.installId)) return refuse()
        await adapter.apply(connection, proposal, abort.signal)
        if (!this.admitted(handle, input.pluginId, input.installId)) return refuse()
      } finally {
        if (this.profileCalls.get(input.pluginId) === abort)
          this.profileCalls.delete(input.pluginId)
      }
    })
  }
  /** Trusted owner teardown only. Mark intent synchronously before any child can be stopped. */
  drain(): Promise<void> {
    this.draining = true
    this.drainWork ??= bounded(async () => {
      const results = await Promise.allSettled(
        [...this.runs.values()].map(async (running) => {
          const [, exit] = await Promise.allSettled([
            Promise.resolve().then(() => running.run.stop()),
            running.run.exited,
          ])
          if (exit.status !== 'fulfilled') return pending()
          await running.revocation
        }),
      )
      if (results.some((one) => one.status !== 'fulfilled')) return pending()
      // Once nothing holds the state, a removal or install left unfinished stays in the journal.
      await this.options.state.withExclusive(async () => {
        this.drained = true
      })
      if (!this.cleanForShutdown()) return pending()
    })
    return this.drainWork
  }
  /**
   * Never release supervisor ownership while a mutation or unproved consumer cleanup survives.
   * After a drain, the journal's one unfinished removal or install is not one, even when one of
   * its plugin's consumers never acknowledged the revoke: every run's exit is proven, the owner
   * checks again only after closing every person channel and agent route, a consumer's only ways
   * to reach the plugin, and the next owner's start finishes the operation. Any other plugin's
   * cleanup still refuses.
   */
  cleanForShutdown(): boolean {
    const pending = this.options.state.inspect().pending
    const leftover = this.drained ? pending?.next?.pluginId : undefined
    return (
      (pending === null || leftover !== undefined) &&
      [...this.cleanup].every((id) => id === leftover) &&
      (!this.draining || [...this.runs.values()].every((run) => run.ended))
    )
  }
  /** A second consumer must clear stale bindings before sharing an admitted projection. */
  async reconcileConsumer(handle: LifecycleWorkspace, sink: WorkspaceProjection): Promise<void> {
    const workspace = this.workspace(handle)
    if (sink.workspaceId !== workspace.sink.workspaceId) return refuse()
    await this.options.state.withExclusive(async () => {
      const guards = this.options.state.inspect().guards
      const ids = new Set([...guards.map((one) => one.pluginId), ...workspace.receipts.keys()])
      try {
        for (const id of ids) {
          const before = workspace.receipts.get(id) ?? null
          const guard = guards.find((one) => one.pluginId === id)
          for (const installId of new Set(
            [before?.installId, guard?.installId].filter((one): one is string => !!one),
          ))
            if ((await bounded(() => sink.revoke(id, installId))) !== true) return pending()
          const receipt = before && this.admitted(handle, id, before.installId) ? before : null
          await sink.reconcile({ pluginId: id, before: null, receipt })
          await sink.applied(id, receipt)
        }
      } catch {
        for (const id of ids) {
          this.block(id)
          this.cleanup.add(id)
        }
        return pending()
      }
    })
  }

  /** Cleanup follows retained consumer bindings even after their exact plugin run has exited. */
  consumerReceipts(handle: LifecycleWorkspace) {
    return [...this.workspace(handle).receipts.values()].map(({ pluginId, installId }) => ({
      pluginId,
      installId,
    }))
  }

  /** Private supervisor view of already reconciled workspace consumers. No person authority. */
  agentAttachments(workspaceId: string) {
    const handle = [...this.workspaces].find(
      ([, value]) => value.live && value.sink.workspaceId === workspaceId,
    )?.[0]
    if (!handle) return []
    return [...this.runs.keys()].sort().flatMap((id) => {
      try {
        const view = this.screen(handle, id)
        if (
          !view.package.manifest.server ||
          !view.package.compatibility.tools ||
          !pluginContributions(view.package).tools
        )
          return []
        return [{ ...view, current: () => this.admitted(handle, id, view.installation.installId) }]
      } catch {
        return []
      }
    })
  }
  /** Owner-only contribution handle. Every use still proves installation, run and workspace liveness. */
  contributions(handle: LifecycleWorkspace, id: string, switchRevision = 0) {
    const view = this.screen(handle, id)
    const running = this.runs.get(id)!
    const identity = {
      pluginId: id,
      releaseDigest: view.installation.release.archiveSha256,
      installId: view.installation.installId,
      incarnation: view.installation.incarnation,
      runId: running.run.runId,
      workspaceId: view.workspaceId,
      switchRevision,
    }
    return this.registrations.register(
      view.package,
      identity,
      () =>
        this.admitted(handle, id, identity.installId) &&
        this.runs.get(id)?.run.runId === identity.runId &&
        this.current(id)?.incarnation === identity.incarnation,
    )
  }
  screen(handle: LifecycleWorkspace, id: string) {
    const workspace = this.workspace(handle),
      active = this.current(id),
      run = this.runs.get(id)
    if (!active || !run || !this.admitted(handle, id, active.installId)) return refuse()
    return {
      package: run.package,
      connection: run.run.ready(),
      installation: active,
      workspaceId: workspace.sink.workspaceId,
    }
  }
}
