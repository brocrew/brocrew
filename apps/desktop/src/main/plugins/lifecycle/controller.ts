import {
  observeAdmission,
  type AdmissionObserver,
  type AdmissionFailure,
} from '../route-admission-trace'
import { PluginStateError } from '../state/format'
import {
  pluginStartupDiagnostic,
  pluginFailureCause,
  pluginStartupStderr,
} from '../startup-failure'
import type { PluginStartupDiagnostic } from '../../../shared/plugin-settings'
import { PluginVerificationError } from '../verification-error'
import {
  PluginDownloadError,
  downloadPluginBytes,
  pluginDownloadFailure,
} from '../catalogue/download'
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
import { bounded, PluginWorkQueue } from './plugin-work'
import { PluginPackageVault } from './vault'
import type {
  LifecycleOptions,
  LifecycleRun,
  LifecycleWorkspace,
  WorkspaceProjection,
  Installation,
  PluginArchiveTransfer,
} from './types'
import type { PluginCard, PluginRemovalOutcome } from '../../../shared/plugin-settings'

const refuse = (): never => {
  throw new PluginSupervisorError('unavailable')
}
const pending = (): never => {
  throw new PluginSupervisorError('cleanup-pending')
}
const idSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
/** A cause the launch line may name: fixed-vocabulary words, never an error body. */
const TOOLS_CAUSE = /^[a-z][a-z0-9-]{0,63}(?:: [a-z][a-z0-9-]{0,63})?$/
const toolsCause = (value: unknown): value is string =>
  typeof value === 'string' && TOOLS_CAUSE.test(value)
interface Workspace {
  sink: WorkspaceProjection
  /** The installs this workspace was given, so its consumers hear of a detach, update or removal. */
  installs: Map<string, string>
  live: boolean
}
type WorkspaceAdmission = ReturnType<LifecycleOptions['state']['readWorkspaceAdmission']>
/** The journal's pending operation, including one whose writer is still working. */
interface Unfinished {
  install: Installation
  operationId: string
}
interface Running {
  installId: string
  run: LifecycleRun
  package: VerifiedPluginPackage
  ended: boolean
  exitProven?: boolean
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
  private readonly pluginWork = new PluginWorkQueue(() => this.draining && pending())
  private readonly attachmentChecks = new WeakMap<
    object,
    (workspaceId: string, read: WorkspaceAdmission) => boolean
  >()
  private toolRestarts = new Map<string, { runId: string | undefined; work: Promise<void> }>()
  private toolRestartBlocks = new Map<string, symbol>()
  private readonly attempted = new Set<string>()
  private readonly localOperations = new Set<string>()
  private readonly admittedCatalogues = new Map<string, readonly string[]>()
  private readonly cleanup = new Set<string>()
  /** Why an installed plugin could not start at attach, as `stage: cause`, until it next starts. */
  private readonly startFailures = new Map<string, string>()
  private readonly startDiagnostics = new Map<string, PluginStartupDiagnostic>()
  private preparedMutationPolicy?: Readonly<{ revision: number; required: boolean }>
  private get catalogueRevision(): number {
    return this.preparedMutationPolicy?.revision ?? 0
  }
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
  private withPlugin<T>(id: string, work: () => Promise<T>): Promise<T> {
    return this.pluginWork.run(id, work)
  }
  static async open(options: LifecycleOptions): Promise<PluginLifecycleController> {
    try {
      const state = options.state.inspect()
      const controller = new PluginLifecycleController(
        options,
        await LifecycleEffects.open(options.root, state.guards.length === 0),
        new PluginPackageVault(options.root, options.target),
      )
      const catalogue = controller.catalogue() // Complete verification before retaining provenance.
      controller.preparedMutationPolicy = Object.freeze({
        revision: 0,
        required:
          catalogue.format === 2 || catalogue.entries.some((entry) => entry.authors !== undefined),
      })
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
    if (!expected || pluginSha256(source.bytes) !== source.sha256) return refuse()
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
    if (pluginSha256(source.bytes) !== source.sha256) return refuse()
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
      if (
        next.repoCatalogueSha256 !== undefined &&
        pluginSha256(next.catalogue.bytes) !== next.repoCatalogueSha256
      )
        return refuse()
      const verified = createRepoAwarePluginVerifier({
        target: this.options.target,
      }).verifyCatalogue(next.catalogue.bytes)
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
      this.preparedMutationPolicy = Object.freeze({
        revision: this.catalogueRevision + 1,
        required:
          verified.format === 2 || verified.entries.some((entry) => entry.authors !== undefined),
      })
      this.options.catalogue = next.catalogue
      this.options.repoCatalogueSha256 = next.repoCatalogueSha256
      this.options.repoList = next.repoList
      this.options.legacyRepoList = next.legacyRepoList
      this.options.names = next.names
    })
  }
  private catalogue() {
    if (
      this.options.repoCatalogueSha256 !== undefined &&
      pluginSha256(this.options.catalogue.bytes) !== this.options.repoCatalogueSha256
    )
      return refuse()
    return createRepoAwarePluginVerifier({
      target: this.options.target,
    }).verifyCatalogue(this.options.catalogue.bytes)
  }
  /** Verify author identity before revoking or changing any installation authority. */
  private async mutationPackage(id: string, transfer?: PluginArchiveTransfer) {
    const proof = this.options.catalogue,
      catalogue = this.catalogue()
    const release = catalogue.entries.find((entry) => entry.id === id)
    if (!release?.authors) throw new PluginSupervisorError('policy-refused')
    let bytes: Uint8Array | undefined
    const checked = await this.vault
      .load(release, catalogue)
      .catch(async () => {
        bytes = await (
          this.options.download ??
          ((entry, signal, onProgress) =>
            downloadPluginBytes({
              url: entry.archive.url,
              maximum: PLUGIN_LIMITS.archiveBytes,
              size: entry.archive.size,
              sha256: entry.archive.sha256,
              signal,
              onProgress,
            }))
        )(release, transfer?.signal ?? new AbortController().signal, (receivedBytes) =>
          transfer?.onProgress({
            phase: 'downloading',
            receivedBytes,
            totalBytes: release.archive.size,
          }),
        )
        transfer?.signal.throwIfAborted()
        transfer?.onProgress({
          phase: 'checking',
          receivedBytes: bytes.length,
          totalBytes: release.archive.size,
        })
        return catalogue.verifyPackage(id, release.version, bytes)
      })
      .catch((error) => {
        if (error instanceof PluginVerificationError || error instanceof PluginDownloadError)
          throw new PluginSupervisorError(pluginDownloadFailure(error), { cause: error })
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
  private mutationPreflight(id: string, operationId: string, transfer?: PluginArchiveTransfer) {
    if (!idSchema.safeParse(id).success || !z.uuid().safeParse(operationId).success) return refuse()
    return this.requiresPreparedMutations() ? this.mutationPackage(id, transfer) : undefined
  }
  /** Policy is a normal refusal, never a storage exception. Leave real disk errors to the fence. */
  private async mutationFence<T>(work: () => Promise<T>, id?: string): Promise<T> {
    const locked = () =>
      this.options.state.withExclusive(async () => {
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
    const outcome = await (id === undefined ? locked() : this.withPlugin(id, locked))
    if (!outcome.ok) throw outcome.error
    return outcome.value
  }
  /** Read-only capability advertisement: never joins or reads the state fence. */
  preparedMutationFeature(): boolean {
    if (!this.preparedMutationPolicy) throw new PluginSupervisorError('incompatible')
    return this.preparedMutationPolicy.required
  }
  requiresPreparedMutations(): boolean {
    const catalogue = this.catalogue()
    const required =
      catalogue.format === 2 || catalogue.entries.some((entry) => entry.authors !== undefined)
    if (!this.preparedMutationPolicy || this.preparedMutationPolicy.required !== required)
      throw new PluginSupervisorError('source-mismatch')
    return required
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
    transfer?: PluginArchiveTransfer,
  ): Promise<PreparedPluginMutation> {
    this.workspace(handle)
    this.requireMutationSource(catalogueDigest)
    if (this.catalogue().entries.find((e) => e.id === id)?.archive.sha256 !== releaseDigest)
      throw new PluginSupervisorError('policy-refused')
    const checked = await this.mutationPackage(id, transfer)
    if (checked.release.archive.sha256 !== releaseDigest || !checked.release.authors)
      throw new PluginSupervisorError('policy-refused')
    return this.mutationFence(async () => {
      transfer?.signal.throwIfAborted()
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
    this.agentScopeChanged()
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
  /** Another plugin's pending operation leaves this one as committed. */
  private current(id: string): Installation | undefined {
    return this.options.state
      .readWorkspaceAdmission()
      .installations.find((one) => one.pluginId === id)
  }
  admitted(
    handle: LifecycleWorkspace,
    id: string,
    installId: string,
    observer?: AdmissionObserver,
  ): boolean {
    try {
      const workspace = this.workspace(handle)
      return this.admittedIn(
        workspace,
        id,
        installId,
        this.options.state.readWorkspaceAdmission(),
        observer,
      )
    } catch (error) {
      const code = error instanceof PluginStateError ? error.code : undefined
      observeAdmission(observer, {
        condition: 'admission-error',
        error: code
          ? `state-${code}`
          : error instanceof PluginSupervisorError && error.code === 'unavailable'
            ? 'supervisor-unavailable'
            : 'unknown',
      })
      return false
    }
  }
  private admittedIn(
    workspace: Workspace,
    id: string,
    installId: string,
    read: WorkspaceAdmission,
    observer?: AdmissionObserver,
  ) {
    const active = read.installations.find((one) => one.pluginId === id),
      run = this.runs.get(id)
    // The committed installations already leave out a plugin whose operation is pending.
    let condition: AdmissionFailure['condition'] | undefined
    if (!workspace.live) condition = 'workspace-ended'
    else if (this.blocks.has(id)) condition = 'plugin-blocked'
    else if (active?.installId !== installId) condition = 'installation-replaced'
    else if (run?.installId !== installId) condition = 'run-installation-replaced'
    else if (run.ended) condition = 'run-ended'
    if (condition) observeAdmission(observer, { condition })
    return condition === undefined
  }
  async action(id: string) {
    const install = this.current(id)
    if (!install) return undefined
    try {
      const pkg = this.runs.get(id)?.package ?? (await this.vault.load(this.descriptor(install)))
      return pkg.manifest.action
    } catch {
      return undefined
    }
  }
  async status(): Promise<{ cards: PluginCard[]; cleanupPending: string[] }> {
    let unfinished: Unfinished | undefined
    const read = this.options.state.withWorkspaceAdmission((state) => {
      const releases = this.catalogue().entries
      if (state.pending?.next)
        unfinished = { install: state.pending.next, operationId: state.pending.request.operationId }
      const activations = state.installations
      const names = new Set([...releases.map((one) => one.id), ...state.guardIds])
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
            ...(!this.cleanup.has(id) &&
            !this.blocks.has(id) &&
            this.runs.has(id) &&
            !this.runs.get(id)!.ended &&
            (this.options.toolsUnavailable?.(id) || this.options.toolsPending?.(id))
              ? {
                  ...(this.options.toolsUnavailable?.(id)
                    ? { toolsUnavailable: true as const }
                    : {}),
                  ...(toolsCause(this.options.toolsPending?.(id))
                    ? { toolsPending: this.options.toolsPending!(id) }
                    : {}),
                  ...(toolsCause(this.options.toolsCause?.(id))
                    ? { toolsCause: this.options.toolsCause!(id) }
                    : {}),
                }
              : {}),
            // An installed plugin that failed to start says why on the agents' plugin line.
            ...(active &&
            !this.runs.has(id) &&
            !this.cleanup.has(id) &&
            !this.blocks.has(id) &&
            this.startFailures.has(id)
              ? { toolsCause: this.startFailures.get(id)! }
              : {}),
            ...(state.pending?.next?.pluginId === id
              ? { unavailableReason: 'operation-pending' }
              : this.startFailures.has(id) || this.startDiagnostics.has(id)
                ? {
                    unavailableReason: 'plugin-start',
                    startupDiagnostic: this.startDiagnostics.get(id),
                  }
                : this.cleanup.has(id) || this.blocks.has(id)
                  ? { unavailableReason: 'cleanup-pending' }
                  : {}),
            installed:
              !!active ||
              (['uninstall', 'update'].includes(state.pending?.request.consent.action ?? '') &&
                state.pending?.next?.pluginId === id),
            state:
              this.cleanup.has(id) || this.blocks.has(id) || this.startFailures.has(id)
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
    this.retrying = this.withPlugin(install.pluginId, async () => {
      const run = this.runs.get(install.pluginId)
      if (run?.ended && run.installId === install.installId)
        await this.stop(install.pluginId, operationId)
      if (this.draining) return
      await this.options.state.withExclusive(async () => {
        if (this.options.state.inspect().pending?.request.operationId === operationId)
          await this.recover(install.pluginId)
      })
    })
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
    const workspace: Workspace = { sink, installs: new Map(), live: true }
    this.workspaces.set(handle, workspace)
    try {
      // Attaching writes nothing; a plugin with a pending operation never starts its old release.
      await Promise.all(
        this.options.state.readWorkspaceAdmission().installations.map((installed) =>
          this.withPlugin(installed.pluginId, async () => {
            const moved = () =>
              this.blocks.has(installed.pluginId) ||
              this.current(installed.pluginId)?.incarnation !== installed.incarnation
            if (moved()) return
            workspace.installs.set(installed.pluginId, installed.installId)
            let stage = 'vault-load'
            try {
              const checked = await this.vault.load(this.descriptor(installed))
              if (moved()) return
              stage = 'start'
              await this.ensureRunning(installed, checked)
              this.startFailures.delete(installed.pluginId)
              this.startDiagnostics.delete(installed.pluginId)
            } catch (error) {
              // One plugin that cannot start never hides the others. Its stage and cause reach
              // the agents' plugin line; the real message goes to the person's log.
              const code = (error as { code?: unknown } | null)?.code
              const cause =
                typeof code === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(code) ? code : 'unknown'
              this.startFailures.set(installed.pluginId, `${stage}: ${cause}`)
              this.startDiagnostics.set(
                installed.pluginId,
                pluginStartupDiagnostic(error) ??
                  this.runs.get(installed.pluginId)?.run.startupDiagnostic?.() ??
                  this.startDiagnostics.get(installed.pluginId) ?? {
                    exitCode: null,
                    signal: null,
                    stderr: pluginStartupStderr(pluginFailureCause(error)),
                  },
              )
              console.error(
                `[plugins] attach could not start ${installed.pluginId} (${stage})`,
                error,
              )
            }
          }),
        ),
      )
      this.agentScopeChanged()
      return handle
    } catch {
      workspace.live = false
      this.workspaces.delete(handle)
      return refuse()
    }
  }
  async detach(handle: LifecycleWorkspace): Promise<void> {
    const workspace = this.workspace(handle)
    workspace.live = false
    this.registrations.detach(workspace.sink.workspaceId)
    // The leaving workspace is told; its answers are a notice and never refuse the detach.
    const results = await Promise.allSettled(
      [...workspace.installs].map(([pluginId, installId]) =>
        bounded(() => workspace.sink.revoke(pluginId, installId)),
      ),
    )
    this.workspaces.delete(handle)
    const ids = [...workspace.installs.keys()]
    results.forEach((one, index) => {
      if (one.status !== 'fulfilled' || one.value !== true)
        console.warn(
          `[plugins] ${ids[index]}: workspace ${workspace.sink.workspaceId} was still winding down at detach`,
          one.status === 'rejected' ? one.reason : '',
        )
    })
  }
  private async ensureRunning(
    install: Installation,
    checked: VerifiedPluginPackage,
  ): Promise<LifecycleRun> {
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
    this.agentScopeChanged()
    const ended = (proven: boolean) => {
      if (this.runs.get(install.pluginId) !== running) return
      if (proven) running.exitProven = true
      if (running.ended) return
      running.ended = true
      const diagnostic = run.startupDiagnostic?.()
      if (diagnostic) this.startDiagnostics.set(install.pluginId, diagnostic)
      // Intentional exits belong to the drain; unexpected exits must also revoke consumers.
      if (this.draining && proven) return
      const repairable =
        !this.blocks.has(install.pluginId) ||
        this.blocks.get(install.pluginId) === this.toolRestartBlocks.get(install.pluginId)
      const token = this.block(install.pluginId)
      if (repairable) this.toolRestartBlocks.set(install.pluginId, token)
      this.cleanup.add(install.pluginId)
      if (proven) {
        try {
          this.options.onHostExit?.(install.pluginId, run.runId)
        } catch {
          /* Wakeup is not authority. */
        }
      }
      // Consumers are told; only the run's proven exit ends the cleanup, never their answers.
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
    transfer?: PluginArchiveTransfer,
  ): Promise<void> {
    if (!prepared || !this.requiresPreparedMutations())
      throw new PluginSupervisorError('policy-refused')
    return this.installMutation(handle, id, prepared, operationId, transfer)
  }
  private async installMutation(
    handle: LifecycleWorkspace,
    id: string,
    prepared: PreparedPluginMutation | undefined,
    operationId: string,
    transfer?: PluginArchiveTransfer,
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
    const checking = this.mutationPreflight(id, operationId, transfer)
    const preflight = checking ? await checking : undefined
    let token: symbol | undefined = this.requiresPreparedMutations() ? undefined : this.block(id)
    try {
      await this.mutationFence(async () => {
        transfer?.signal.throwIfAborted()
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
          const checked = await this.vault.load(this.descriptor(installed))
          await this.ensureRunning(installed, checked)
          this.given(installed)
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
              new AbortController().signal,
            )
        const checked = preflight?.checked ?? catalogue.verifyPackage(id, release.version, bytes!)
        const state = this.options.state.inspect(),
          before = state.guards.find((one) => one.pluginId === id)
        if (
          before &&
          (before.release.dataSchema < checked.manifest.dataCompatibility.minSchema ||
            before.release.dataSchema > checked.manifest.dataCompatibility.maxSchema)
        )
          return refuse()
        if (!workspace.live) return refuse()
        const operation = this.options.state.prepare({
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
            ? await this.vault.stage(release, bytes, this.options.catalogue)
            : checked
          this.options.fault?.('staged')
          await this.ensureRunning(install, staged)
          this.options.fault?.('ready')
          // Staged code and a ready run complete the install; no window or consumer acknowledges it.
          await this.effects.write({ ...effect, phase: 'committed' })
          this.options.state.complete(operationId)
          this.given(install)
          this.options.fault?.('activated')
        } catch {
          const committed = this.options.state
            .inspect()
            .operations.find((one) => one.operation.request.operationId === operationId)
          if (committed?.status === 'completed') {
            this.given(install)
            return
          }
          await this.unwind(effect)
          return refuse()
        }
      }, id)
      if (this.blocks.get(id) === token) this.blocks.delete(id)
      this.agentScopeChanged()
    } catch (error) {
      if (
        error instanceof PluginSupervisorError &&
        ['policy-refused', 'source-mismatch'].includes(error.code)
      )
        throw error
      if (!this.cleanup.has(id) && !this.options.state.inspect().pending) {
        if (this.blocks.get(id) === token) this.blocks.delete(id)
        this.agentScopeChanged()
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
    transfer?: PluginArchiveTransfer,
  ): Promise<void> {
    if (!prepared || !this.requiresPreparedMutations())
      throw new PluginSupervisorError('policy-refused')
    return this.updateMutation(handle, id, prepared, operationId, transfer)
  }
  private async updateMutation(
    handle: LifecycleWorkspace,
    id: string,
    prepared: PreparedPluginMutation | undefined,
    operationId: string,
    transfer?: PluginArchiveTransfer,
  ): Promise<void> {
    const workspace = this.workspace(handle)
    this.requirePreparation(id, 'update', prepared)
    if (
      this.requiresPreparedMutations() &&
      !this.catalogue().entries.find((release) => release.id === id)?.authors
    )
      return refuse()
    const checking = this.mutationPreflight(id, operationId, transfer)
    const preflight = checking ? await checking : undefined
    let token: symbol | undefined = this.requiresPreparedMutations() ? undefined : this.block(id)
    try {
      await this.mutationFence(async () => {
        transfer?.signal.throwIfAborted()
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
              new AbortController().signal,
            )
        const checked = preflight?.checked ?? catalogue.verifyPackage(id, release.version, bytes!)
        if (
          checked.manifest.dataSchema !== before.release.dataSchema ||
          before.release.dataSchema < checked.manifest.dataCompatibility.minSchema ||
          before.release.dataSchema > checked.manifest.dataCompatibility.maxSchema
        )
          return refuse()
        // Cache the verified replacement durably before reserving an update. Recovery needs no download.
        if (bytes) await this.vault.stage(release, bytes, this.options.catalogue)
        this.options.fault?.('staged')
        if (!workspace.live) return refuse()
        this.options.state.requireUpdateReader()
        this.options.fault?.('update-fenced')
        const updateState = this.options.state.inspect()
        const operation = this.options.state.prepare({
          operationId,
          snapshot: null,
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
      }, id)
      if (this.blocks.get(id) === token) this.blocks.delete(id)
      this.agentScopeChanged()
    } catch (error) {
      if (
        error instanceof PluginSupervisorError &&
        ['policy-refused', 'source-mismatch'].includes(error.code)
      )
        throw error
      if (!this.options.state.inspect().pending && this.blocks.get(id) === token)
        this.blocks.delete(id)
      this.agentScopeChanged()
      return refuse()
    }
  }
  private async finishUpdate(effect: Effect, install: Installation): Promise<void> {
    const checked = await this.vault.load(this.descriptor(install))
    // Revoke consumers and prove the old run stopped before starting the replacement. No logout or data removal.
    const stopped = await Promise.allSettled([
      this.stop(install.pluginId, effect.operationId),
      this.revoke(install),
    ])
    if (stopped.some((one) => one.status !== 'fulfilled')) return pending()
    await this.ensureRunning(install, checked)
    this.options.fault?.('ready')
    await this.effects.write({ ...effect, phase: 'committed' })
    this.options.state.complete(effect.operationId)
    this.given(install)
    this.cleanup.delete(install.pluginId)
    this.options.fault?.('activated')
  }
  /** Every live workspace now has this install; its consumers hear of a later detach or removal. */
  private given(install: Installation): void {
    this.startFailures.delete(install.pluginId)
    this.startDiagnostics.delete(install.pluginId)
    for (const one of this.workspaces.values())
      if (one.live) one.installs.set(install.pluginId, install.installId)
    this.agentScopeChanged()
  }
  /** Supervisor-only plugin repair. It does not mutate installations, profiles or other leases.
   * The callback belongs to the retained broker for runId; it runs only after exact physical exit. */
  restartPluginTools(id: string, runId: string | undefined, stopped: () => void): Promise<void> {
    const prior = this.toolRestarts.get(id)
    if (prior) {
      if (runId !== undefined && prior.runId !== runId)
        return Promise.reject(new PluginSupervisorError('unavailable'))
      return prior.work.then(stopped)
    }
    const work = this.withPlugin(id, async () => {
      const install = this.current(id),
        running = this.runs.get(id)
      if (
        !install ||
        (runId !== undefined && running?.run.runId !== runId) ||
        (running && running.installId !== install.installId) ||
        (this.blocks.has(id) && this.blocks.get(id) !== this.toolRestartBlocks.get(id))
      )
        return refuse()
      const token = this.block(id)
      this.toolRestartBlocks.set(id, token)
      this.cleanup.add(id)
      // Prevent the intentional exit watcher from starting a competing revocation.
      if (running) running.ended = true
      if (running && !running.exitProven) {
        try {
          // Either exact stop or the retained positive exit witness is sufficient.
          // A rejected exit witness cannot turn a still-pending stop into success.
          const exited = running.run.exited.catch(() => new Promise<void>(() => {}))
          await bounded(() =>
            Promise.race([Promise.resolve().then(() => running.run.stop()), exited]),
          )
        } catch (error) {
          // Keep the exact identity after a timeout. A later positive witness is
          // a wakeup only; the bridge and this method recheck every admission fence.
          void running.run.exited
            .then(() => {
              if (
                !this.draining &&
                this.runs.get(id) === running &&
                this.current(id)?.installId === install.installId &&
                this.blocks.get(id) === token
              )
                this.options.onHostExit?.(id, running.run.runId)
            })
            .catch(() => undefined)
          throw error
        }
        running.exitProven = true
      }
      stopped()
      // Exact host/descendant exit can now discharge the retained broker's execution barrier.
      await this.revoke(install)
      if (this.draining || this.runs.get(id) !== running || this.blocks.get(id) !== token)
        return pending()
      this.runs.delete(id)
      this.agentScopeChanged()
      this.attempted.delete(id)
      await this.ensureRunning(
        install,
        running?.package ?? (await this.vault.load(this.descriptor(install))),
      )
      if (this.draining || this.blocks.get(id) !== token) return pending()
      this.given(install)
      this.cleanup.delete(id)
      if (this.blocks.get(id) === token) this.blocks.delete(id)
      this.agentScopeChanged()
      if (this.toolRestartBlocks.get(id) === token) this.toolRestartBlocks.delete(id)
    }).finally(() => {
      if (this.toolRestarts.get(id)?.work === work) this.toolRestarts.delete(id)
    })
    this.toolRestarts.set(id, { runId, work })
    return work
  }
  private async stop(id: string, operationId: string): Promise<void> {
    const run = this.runs.get(id)
    if (run) {
      run.ended = true
      await bounded(() => run.run.stop())
      // A later Install may have started its own run meanwhile.
      if (this.runs.get(id) === run) {
        this.runs.delete(id)
        this.agentScopeChanged()
        this.attempted.delete(id)
      }
      return
    }
    if (this.attempted.has(id)) return pending()
    if (this.localOperations.has(operationId)) return
    if ((await this.options.runtime.previousOwnerClean()) !== true) return pending()
  }
  /**
   * Tells every live workspace that this install is gone. It is a notice: a consumer that says
   * it is still winding down, or never answers, is logged and never holds anything up. Only the
   * run's proven exit (stop() or a proven crash) decides cleanup.
   */
  private async revoke(install: Installation): Promise<void> {
    await Promise.all(
      [...this.workspaces.values()]
        .filter((one) => one.live)
        .map(async (workspace) => {
          workspace.installs.delete(install.pluginId)
          this.agentScopeChanged()
          try {
            const answer = await bounded(() =>
              workspace.sink.revoke(install.pluginId, install.installId),
            )
            if (answer !== true)
              console.warn(
                `[plugins] ${install.pluginId}: workspace ${workspace.sink.workspaceId} is still winding down after revoke`,
              )
          } catch (error) {
            console.warn(
              `[plugins] ${install.pluginId}: workspace ${workspace.sink.workspaceId} did not answer revoke`,
              error,
            )
          }
        }),
    )
  }
  private async removeFiles(install: Installation, operationId: string): Promise<void> {
    await this.options.runtime.removeCode(install.pluginId, install.release.archiveSha256)
    await this.vault.remove(this.descriptor(install), {
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
    this.cleanup.delete(install.pluginId)
    this.startFailures.delete(install.pluginId)
    this.startDiagnostics.delete(install.pluginId)
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
      await this.withPlugin(id, () =>
        this.options.state.withExclusive(async () => {
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
        }),
      )
      if (this.blocks.get(id) === token) this.blocks.delete(id)
      this.agentScopeChanged()
      if (pluginAdapter(id)?.uninstall) return { data: 'deleted', logout }
    } catch {
      if (absent) {
        if (!this.cleanup.has(id) && this.blocks.get(id) === token) this.blocks.delete(id)
        this.agentScopeChanged()
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
  private async recover(id?: string): Promise<void> {
    const state = this.options.state.inspect()
    for (const record of state.operations) {
      const operation = record.operation
      if (operation.request.consent.action === 'global-restore') continue
      if (id !== undefined && operation.next?.pluginId !== id) continue
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
      this.agentScopeChanged()
    }
  }
  /** Page revision is this per-install intent ledger, separate from package configRevision. */
  async profileRevision(
    handle: LifecycleWorkspace,
    id: string,
    installId: string,
    allowLedgerV2 = true,
  ): Promise<number> {
    return this.withPlugin(id, async () => {
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
    await this.withPlugin(input.pluginId, async () => {
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
    for (const call of this.profileCalls.values()) call.abort()
    // The supervisor bounds its caller's wait while retaining this exact cleanup barrier.
    this.drainWork ??= (async () => {
      const stopping = new Map<Running, Promise<void>>()
      const stopRuns = () => {
        for (const running of this.runs.values()) {
          if (stopping.has(running)) continue
          const stopped = (async () => {
            const [, exit] = await Promise.allSettled([
              Promise.resolve().then(() => running.run.stop()),
              running.run.exited,
            ])
            if (exit.status !== 'fulfilled')
              throw new PluginSupervisorError('cleanup-pending', {
                cause: new Error(`${running.package.manifest.id}: its exit was not proven`, {
                  cause: exit.reason,
                }),
              })
            await running.revocation
          })()
          void stopped.catch(() => undefined)
          stopping.set(running, stopped)
        }
      }
      stopRuns()
      await this.pluginWork.settled()
      stopRuns()
      const results = await Promise.allSettled(stopping.values())
      const failed = results.filter((one) => one.status === 'rejected')
      if (failed.length)
        throw new PluginSupervisorError('cleanup-pending', {
          cause:
            failed.length === 1
              ? failed[0]!.reason
              : new AggregateError(
                  failed.map((one) => one.reason),
                  'plugin runs did not stop',
                ),
        })
      // Once nothing holds the state, a removal or install left unfinished stays in the journal.
      await this.options.state.withExclusive(async () => {
        this.drained = true
      })
      const blockers = this.shutdownBlockers()
      if (blockers.length)
        throw new PluginSupervisorError('cleanup-pending', {
          cause: new Error(`plugins can't shut down cleanly: ${blockers.join('; ')}`),
        })
    })()
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
    return this.shutdownBlockers().length === 0
  }
  /** What stops a clean shutdown, in plain words, so a refused drain names its cause. */
  shutdownBlockers(): string[] {
    const pending = this.options.state.inspect().pending
    const leftover = this.drained ? pending?.next?.pluginId : undefined
    const blockers: string[] = []
    for (const id of this.pluginWork.ids())
      blockers.push(`${id} has a lifecycle operation in progress`)
    if (pending !== null && leftover === undefined) {
      const { action, pluginId } = pending.request.consent
      blockers.push(`an unfinished ${action} of ${pluginId ?? 'plugins'}`)
    }
    for (const id of this.cleanup)
      if (id !== leftover) blockers.push(`${id} has not proven its cleanup`)
    if (this.draining)
      for (const [id, run] of this.runs) if (!run.ended) blockers.push(`${id} is still running`)
    return blockers
  }
  /** The installs a consumer of this workspace may hold, for its detach notice. */
  consumerInstalls(handle: LifecycleWorkspace) {
    return [...this.workspace(handle).installs].map(([pluginId, installId]) => ({
      pluginId,
      installId,
    }))
  }

  private readonly agentListeners = new Set<(workspaceId: string) => void>()
  onHostChanged(listener: (workspaceId: string) => void): () => void {
    this.agentListeners.add(listener)
    return () => {
      this.agentListeners.delete(listener)
    }
  }
  private agentScopeChanged(): void {
    for (const workspace of this.workspaces.values())
      if (workspace.live)
        for (const listener of this.agentListeners) {
          try {
            listener(workspace.sink.workspaceId)
          } catch {
            /* Wakeups grant no authority. */
          }
        }
  }
  /** Committed absence is distinct from a run still starting or an unreadable state. */
  agentScope(workspaceId: string): { entries: readonly AgentScopeEntry[] } {
    if (this.draining) return pending()
    return this.withAgentScope(workspaceId, (scope) => scope)
  }
  /** Internal synchronous route planning. The checker is revoked before this operation returns. */
  withAgentScope<T>(
    workspaceId: string,
    decide: (
      scope: { entries: readonly AgentScopeEntry[] },
      current: (view: AgentAttachmentView) => boolean,
    ) => T extends PromiseLike<unknown> ? never : T,
  ): T {
    if (this.draining) return pending()
    return this.options.state.withWorkspaceAdmission((state) => {
      // A global restore changes every plugin; one plugin's operation leaves the others readable.
      if (state.pendingPlugin === '*') return pending()
      const active = state.installations
      const consumers = [...this.workspaces.values()].filter(
        (one) => one.live && one.sink.workspaceId === workspaceId,
      )
      if (!consumers.length) return refuse()
      const views = this.attachmentViews(workspaceId, state)
      const ids = new Set([
        ...(this.admittedCatalogues.get(this.catalogueIdentity()) ?? []),
        ...state.guardIds,
        ...this.runs.keys(),
        ...consumers.flatMap((one) => [...one.installs.keys()]),
      ])
      const entries = [...ids].sort().map((pluginId): AgentScopeEntry => {
        const installed = active.find((one) => one.pluginId === pluginId)
        const run = this.runs.get(pluginId)
        if (this.blocks.has(pluginId) || pluginId === state.pendingPlugin)
          return { pluginId, is: 'pending' }
        if (!installed) return { pluginId, is: 'off' }
        // A plugin that failed to start is not starting: agents don't wait for it.
        if (!run && this.startFailures.has(pluginId)) return { pluginId, is: 'off' }
        if (
          run?.installId === installed.installId &&
          (!run.package.manifest.server || !pluginContributions(run.package).tools)
        )
          return { pluginId, is: 'off' }
        const view = views.find((one) => one.installation.pluginId === pluginId)
        return view ? { pluginId, is: 'admitted', view } : { pluginId, is: 'pending' }
      })
      let live = true
      const current = (view: AgentAttachmentView) =>
        live && !this.draining && this.attachmentChecks.get(view)?.(workspaceId, state) === true
      try {
        return decide({ entries }, current)
      } finally {
        live = false
      }
    })
  }
  /** Private supervisor view of this workspace's admitted plugin runs. No person authority. */
  agentAttachments(workspaceId: string) {
    if (
      ![...this.workspaces.values()].some((one) => one.live && one.sink.workspaceId === workspaceId)
    )
      return []
    try {
      return this.options.state.withWorkspaceAdmission((read) =>
        this.attachmentViews(workspaceId, read),
      )
    } catch {
      return []
    }
  }
  private attachmentViews(workspaceId: string, read: WorkspaceAdmission) {
    const handle = [...this.workspaces].find(
      ([, value]) => value.live && value.sink.workspaceId === workspaceId,
    )?.[0]
    if (!handle) return []
    return [...this.runs.keys()].sort().flatMap((id) => {
      try {
        const view = this.screenIn(handle, id, read)
        if (
          !view.package.manifest.server ||
          !view.package.compatibility.tools ||
          !pluginContributions(view.package).tools
        )
          return []
        const run = this.runs.get(id)!
        const attachment = {
          ...view,
          runId: run.run.runId,
          exited: run.run.exited,
          current: (observer?: AdmissionObserver) => {
            if (this.runs.get(id) !== run) {
              observeAdmission(observer, { condition: 'run-replaced' })
              return false
            }
            return this.admitted(handle, id, view.installation.installId, observer)
          },
        }
        this.attachmentChecks.set(attachment, (workspaceId, read) => {
          const workspace = this.workspaces.get(handle)
          return (
            workspace?.live === true &&
            workspace.sink.workspaceId === workspaceId &&
            this.runs.get(id) === run &&
            this.admittedIn(workspace, id, view.installation.installId, read)
          )
        })
        return [attachment]
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
    return this.screenIn(handle, id, this.options.state.readWorkspaceAdmission())
  }
  private screenIn(handle: LifecycleWorkspace, id: string, read: WorkspaceAdmission) {
    const workspace = this.workspace(handle),
      active = read.installations.find((one) => one.pluginId === id),
      run = this.runs.get(id)
    if (!active || !run || !this.admittedIn(workspace, id, active.installId, read)) return refuse()
    return {
      package: run.package,
      connection: run.run.ready(),
      installation: active,
      workspaceId: workspace.sink.workspaceId,
    }
  }
}

export type AgentAttachmentView = ReturnType<PluginLifecycleController['agentAttachments']>[number]
export type AgentScopeEntry =
  | { readonly pluginId: string; readonly is: 'admitted'; readonly view: AgentAttachmentView }
  | { readonly pluginId: string; readonly is: 'pending' | 'off' }
