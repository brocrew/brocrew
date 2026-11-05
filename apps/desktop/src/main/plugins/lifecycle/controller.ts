import type { PackageRef } from '../../../shared/plugin-package'
import { inspectPluginPackage } from '../package-source'
import type { InstanceToolScope, PluginToolCall, PluginToolService } from '../tool-broker'
import { createContributionRegistry, pluginContributions } from '../contributions'
import { pluginNodePolicy } from '../node-policy'
import { parseRepoPluginList } from '../catalogue/repo-list'
import { PluginProfileLedger } from './profile-ledger'
import { chromeProfileIntent, ChromeProposal } from './chrome-apply'
import { pluginAdapter } from './adapters'
import { PluginProposal, proposalFor } from './proposals'
import { pluginSha256 } from '../package-digests'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { createRepoAwarePluginVerifier, type VerifiedPluginPackage } from '../package-verifier'
import { PluginSupervisorError } from '../supervisor/protocol'
import { downloadPluginArchive } from './download'
import { LifecycleEffects, type Effect } from './files'
import { PluginEffectQueue } from './effect-queue'
import { equalState, OperationRequest } from '../state/format'
import { PluginPackageVault } from './vault'
import type {
  LifecycleOptions,
  LifecycleRun,
  LifecycleWorkspace,
  WorkspaceProjection,
  ProjectionReceipt,
  Installation,
} from './types'
import type { PluginCard, PluginRemovalOutcome } from '../../../shared/plugin-settings'
import { PluginHost, type PluginHostOwner, type PluginHostEnvelope } from '../host-methods'
import { pluginToolCallResult } from '../tool-result'
import type {
  PluginBeforeTurnInput,
  PluginHostResult,
  PluginMcpToolResult,
} from '../../../shared/plugin-contract'
import type { PluginHostUiRequest } from '../../../shared/plugin-host'
import type { PluginPageCall, PluginPageCancel } from '../host-wire'

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
const idSchema = z.string()
type StateReadView = ReturnType<LifecycleOptions['state']['readView']>
interface Workspace {
  sink: WorkspaceProjection
  receipts: Map<string, ProjectionReceipt>
  consumerBlocks: Set<string>
  consumerRevisions: Map<string, number>
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
  private genericTools?: PluginToolService
  /** The supervisor injects its one forwarding path after constructing the controller. */
  bindGenericTools(tools: PluginToolService): void {
    this.genericTools = tools
  }
  genericListTools(scope: InstanceToolScope, signal?: AbortSignal) {
    if (!this.genericTools)
      return Promise.reject(new Error('Plugin MCP connection is unavailable.'))
    return this.genericTools.listTools(scope, signal)
  }
  genericCallTool(input: InstanceToolScope & Omit<PluginToolCall, 'workspaceId'>) {
    if (!this.genericTools)
      return Promise.reject(new Error('Plugin MCP connection is unavailable.'))
    return this.genericTools.callTool(input)
  }
  genericCancelTool(input: InstanceToolScope & { requestId: string | number }) {
    if (!this.genericTools)
      return Promise.reject(new Error('Plugin MCP connection is unavailable.'))
    return this.genericTools.cancelTool(input)
  }
  private readonly hostRegistry: PluginHost
  private readonly hostOwners = new Map<
    string,
    { owner: PluginHostOwner; package: VerifiedPluginPackage }
  >()
  private readonly hostScopes = new Set<string>()
  private readonly workspaces = new Map<LifecycleWorkspace, Workspace>()
  private readonly blocks = new Map<string, symbol>()
  private readonly runs = new Map<string, Running>()
  private readonly toolRestarts = new Map<
    string,
    { runId: string | undefined; work: Promise<void> }
  >()
  private readonly toolRestartBlocks = new Map<string, symbol>()
  private readonly packageNames = new Map<string, string>()
  private readonly attempted = new Set<string>()
  private readonly localOperations = new Set<string>()
  private readonly admittedCatalogues = new Map<string, readonly string[]>()
  private readonly cleanup = new Set<string>()
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
  private readonly effectQueue: PluginEffectQueue
  private readonly profileCalls = new Map<string, AbortController>()
  private constructor(
    private readonly options: LifecycleOptions,
    private readonly effects: LifecycleEffects,
    private readonly vault: PluginPackageVault,
  ) {
    this.effectQueue = options.effectQueue ?? new PluginEffectQueue()
    this.hostRegistry = new PluginHost({
      callTool: async (input) => ({
        status: 'result',
        result: (await this.genericCallTool(input)) as PluginMcpToolResult,
      }),
      cancelTool: (input) => this.genericCancelTool(input),
    })
  }
  onHostChanged(listener: (workspaceId: string) => void): () => void {
    return this.hostRegistry.onChanged(listener)
  }
  hostWorkspace(handle: LifecycleWorkspace): string {
    return this.workspace(handle).sink.workspaceId
  }
  private invalidateHost(id: string, runId?: string): void {
    const current = this.hostOwners.get(id)
    if (!current || (runId !== undefined && current.owner.runId !== runId)) return
    this.hostOwners.delete(id)
    this.hostRegistry.detach(current.owner)
    for (const key of this.hostScopes)
      if ((JSON.parse(key) as string[])[0] === id) this.hostScopes.delete(key)
  }
  private syncHostWorkspace(workspace: Workspace, read = this.options.state.readView()): void {
    const workspaceId = workspace.sink.workspaceId
    for (const [id, { owner }] of this.hostOwners) {
      const preference = read.getEnabled(workspaceId, id)
      const titles = read.getTitlesEnabled(workspaceId, id)
      const handle = [...this.workspaces].find(([, value]) => value === workspace)?.[0]
      const install = this.current(id, read)
      this.hostRegistry.setEnabled(
        workspaceId,
        id,
        Boolean(
          handle &&
          install &&
          this.runs.get(id)?.run.runId === owner.runId &&
          this.admitted(handle, id, install.installId, read) &&
          preference.enabled,
        ),
        preference.revision,
      )
      this.hostRegistry.setTitlesEnabled(workspaceId, id, titles.enabled, titles.revision)
    }
  }
  private async attachHostOwner(
    owner: PluginHostOwner,
    checked: VerifiedPluginPackage,
  ): Promise<void> {
    this.hostOwners.set(owner.pluginId, { owner, package: checked })
    this.hostRegistry.attach(owner)
    for (const workspace of this.workspaces.values())
      if (workspace.live) {
        this.syncHostWorkspace(workspace)
        await this.declareHostScope(workspace, owner, checked)
      }
  }
  private async declareHostScope(
    workspace: Workspace,
    owner: PluginHostOwner,
    checked: VerifiedPluginPackage,
  ): Promise<void> {
    const key = JSON.stringify([owner.pluginId, owner.runId, workspace.sink.workspaceId])
    if (this.hostScopes.has(key)) return
    this.hostScopes.add(key)
    await this.hostRegistry.registerManifest(owner, workspace.sink.workspaceId, checked.manifest)
  }
  async handleHostRequest(
    owner: PluginHostOwner,
    envelope: PluginHostEnvelope,
    signal: AbortSignal,
  ): Promise<PluginHostResult<unknown>> {
    const attached = this.hostOwners.get(owner.pluginId)
    const workspace = [...this.workspaces.values()].find(
      (one) => one.live && one.sink.workspaceId === envelope.workspaceId,
    )
    if (!workspace || attached?.owner.runId !== owner.runId) return { error: { code: 'not-found' } }
    this.syncHostWorkspace(workspace)
    return this.hostRegistry.request(owner, envelope, signal)
  }
  hostSnapshot(handle: LifecycleWorkspace) {
    const workspace = this.workspace(handle)
    const read = this.options.state.readView()
    this.syncHostWorkspace(workspace, read)
    return {
      ...this.hostRegistry.snapshot(workspace.sink.workspaceId),
      plugins: read.currentInstallations().map((install) => ({
        pluginId: install.pluginId,
        name:
          this.packageNames.get(install.pluginId) ??
          this.options.names[install.pluginId] ??
          install.pluginId,
        enabled: read.getEnabled(workspace.sink.workspaceId, install.pluginId).enabled,
      })),
    }
  }
  async setEnabled(handle: LifecycleWorkspace, id: string, enabled: boolean) {
    const workspace = this.workspace(handle)
    if (this.effectQueue.signal.aborted) return pending()
    const value = this.options.state.setEnabled(workspace.sink.workspaceId, id, enabled)
    this.workspace(handle)
    this.syncHostWorkspace(workspace)
    if (!this.hostOwners.has(id))
      this.hostRegistry.setEnabled(workspace.sink.workspaceId, id, value.enabled, value.revision)
    return value
  }
  async setTitlesEnabled(handle: LifecycleWorkspace, id: string, enabled: boolean) {
    const workspace = this.workspace(handle)
    if (this.effectQueue.signal.aborted) return pending()
    const value = this.options.state.setTitlesEnabled(workspace.sink.workspaceId, id, enabled)
    this.workspace(handle)
    this.syncHostWorkspace(workspace)
    if (!this.hostOwners.has(id))
      this.hostRegistry.setTitlesEnabled(
        workspace.sink.workspaceId,
        id,
        value.enabled,
        value.revision,
      )
    return value
  }
  async hostUi(
    handle: LifecycleWorkspace,
    input: PluginHostUiRequest,
  ): Promise<PluginHostResult<unknown>> {
    const workspace = this.workspace(handle)
    this.syncHostWorkspace(workspace)
    const id = workspace.sink.workspaceId
    if (input.kind === 'snapshot') return { value: this.hostSnapshot(handle) }
    if (input.kind === 'enabled' || input.kind === 'titles-enabled') {
      return {
        value:
          input.kind === 'enabled'
            ? await this.setEnabled(handle, input.pluginId, input.enabled)
            : await this.setTitlesEnabled(handle, input.pluginId, input.enabled),
      }
    }
    if (input.kind === 'activate') return this.hostRegistry.activate(id, input.handle)
    if (input.kind === 'notification-action')
      return this.hostRegistry.notificationAction(id, input.handle, input.actionId)
    if (input.kind === 'notification-dismiss')
      return this.hostRegistry.dismissNotification(id, input.handle)
    if (input.kind === 'settings-open') return this.hostRegistry.openSettings(id, input.handle)
    return this.hostRegistry.closeSettings(id, input.viewId)
  }
  hostBeforeTurn(handle: LifecycleWorkspace, input: Omit<PluginBeforeTurnInput, 'workspaceId'>) {
    const workspace = this.workspace(handle)
    this.syncHostWorkspace(workspace)
    return this.hostRegistry.beforeTurn({ ...input, workspaceId: workspace.sink.workspaceId })
  }
  async hostScreen(handle: LifecycleWorkspace, id: string, viewId?: string) {
    const workspace = this.workspace(handle)
    this.syncHostWorkspace(workspace)
    if (!viewId) {
      const contribution = this.hostRegistry
        .snapshot(workspace.sink.workspaceId)
        .contributions.find(
          (one) => one.pluginId === id && one.kind === 'settings.page' && one.state === 'active',
        )
      if (!contribution) return refuse()
      const opened = await this.hostRegistry.openSettings(
        workspace.sink.workspaceId,
        contribution.handle,
      )
      if (!('value' in opened)) return refuse()
      viewId = (opened.value as { viewId: string }).viewId
    }
    const page = this.hostRegistry.settingsPage(workspace.sink.workspaceId, viewId)
    if (!page || page.pluginId !== id) return refuse()
    const screen = this.screen(handle, id)
    return {
      installation: screen.installation,
      instanceId: page.instanceId,
      viewId,
      contributionHandle: page.handle,
      page: page.page,
    }
  }
  async hostPageTool(handle: LifecycleWorkspace, input: z.infer<typeof PluginPageCall>) {
    const workspace = this.workspace(handle)
    this.syncHostWorkspace(workspace)
    const page = this.hostRegistry.settingsPage(workspace.sink.workspaceId, input.viewId)
    if (
      !page ||
      page.pluginId !== input.pluginId ||
      page.instanceId !== input.instanceId ||
      page.handle !== input.contributionHandle
    )
      return { status: 'disabled' as const }
    const revision = this.options.state.getEnabled(
      workspace.sink.workspaceId,
      input.pluginId,
    ).revision
    const answer = await pluginToolCallResult(async () => ({
      status: 'result',
      result: (await this.genericCallTool({
        workspaceId: workspace.sink.workspaceId,
        pluginId: input.pluginId,
        instanceId: input.instanceId,
        name: input.name,
        arguments: input.arguments,
        requestId: input.requestId,
        origin: 'settings.page',
      })) as PluginMcpToolResult,
    }))
    if (!workspace.live) return { status: 'disabled' as const }
    this.syncHostWorkspace(workspace)
    const latest = this.hostRegistry.settingsPage(workspace.sink.workspaceId, input.viewId)
    if (
      !latest ||
      latest.instanceId !== input.instanceId ||
      latest.handle !== input.contributionHandle ||
      this.options.state.getEnabled(workspace.sink.workspaceId, input.pluginId).revision !==
        revision
    )
      return { status: 'disabled' as const }
    return answer
  }
  hostPageCancel(handle: LifecycleWorkspace, input: z.infer<typeof PluginPageCancel>) {
    return this.genericCancelTool({
      ...input,
      workspaceId: this.workspace(handle).sink.workspaceId,
    })
  }
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
          options.appVersion ?? options.repoList?.appVersion ?? '',
        ),
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
      controller.retainRepoList(options.repoList)
      controller.retainLegacyRepoList(options.legacyRepoList)
      await controller.effectQueue.mutate('*', randomUUID(), 'recover', () => controller.recover())
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
    this.admittedCatalogues.set(digest, Object.freeze([...new Set(ids)].sort()))
  }
  private retainRepoList(source: LifecycleOptions['repoList']): void {
    if (!source) return
    if (pluginSha256(source.bytes) !== source.sha256) return refuse()
    const parsed = parseRepoPluginList(source.bytes, this.options.target, source.appVersion)
    const fresh = parsed.legacyCatalogues.filter((one) => !this.admittedCatalogues.has(one.sha256))
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
    for (const view of fresh)
      this.retainCatalogue(
        view.bytes,
        view.releases.map((release) => release.id),
      )
  }
  /** Only sources actually verified and admitted by this owner identify a legacy client's IDs. */
  legacyCatalogueIds(digest: string): readonly string[] {
    const ids = this.admittedCatalogues.get(digest)
    return ids ?? this.catalogue().entries.map((entry) => entry.id)
  }
  async refreshCatalogue(expectedDigest: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(expectedDigest) || !this.options.refreshCatalogue) return refuse()
    await this.mutationFence(async () => {
      const next = await this.options.refreshCatalogue!()
      const verified = createRepoAwarePluginVerifier({
        pinnedPublicKey: this.options.pinnedPublicKey,
        repoCatalogueSha256: next.repoCatalogueSha256,
        target: this.options.target,
        appVersion: this.options.appVersion ?? this.options.repoList?.appVersion,
      }).verifyCatalogue(next.catalogue.bytes, next.catalogue.signature)
      this.retainRepoList(next.repoList)
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
    return createRepoAwarePluginVerifier({
      pinnedPublicKey: this.options.pinnedPublicKey,
      repoCatalogueSha256: this.options.repoCatalogueSha256,
      target: this.options.target,
      appVersion: this.options.appVersion ?? this.options.repoList?.appVersion,
    }).verifyCatalogue(this.options.catalogue.bytes, this.options.catalogue.signature)
  }
  private async mutationFence<T>(work: () => Promise<T>): Promise<T> {
    return work()
  }
  /** Read-only capability advertisement: never joins or reads the state fence. */
  preparedMutationFeature(): boolean {
    if (!this.preparedMutationPolicy) throw new PluginSupervisorError('incompatible')
    return false
  }
  requiresPreparedMutations(): boolean {
    return false
  }
  mutationCatalogueDigest(): string {
    return pluginSha256(this.options.catalogue.bytes)
  }
  requireMutationSource(digest: string): void {
    void digest
  }
  async prepareMutation(
    handle: LifecycleWorkspace,
    action: 'install' | 'update',
    id: string,
    releaseDigest: string,
    catalogueDigest: string,
  ): Promise<PreparedPluginMutation> {
    this.workspace(handle)
    return {
      action,
      pluginId: id,
      releaseDigest,
      catalogueDigest,
      sequence: this.options.state.inspect().sequence,
      catalogueRevision: this.catalogueRevision,
      installId: this.current(id)?.installId ?? null,
    }
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
    this.invalidateHost(id)
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
  private current(id: string, view = this.options.state.readView()): Installation | undefined {
    return view.currentInstallation(id) ?? undefined
  }
  admitted(
    handle: LifecycleWorkspace,
    id: string,
    installId: string,
    view?: StateReadView,
  ): boolean {
    try {
      if (this.draining || this.effectQueue.signal.aborted) return false
      const committed = view ?? this.options.state.readView()
      const workspace = this.workspace(handle)
      return (
        !workspace.consumerBlocks.has(id) &&
        this.admittedProjection(workspace, id, installId, committed)
      )
    } catch {
      return false
    }
  }
  private admittedProjection(
    workspace: Workspace,
    id: string,
    installId: string,
    committed: StateReadView,
  ): boolean {
    const active = this.current(id, committed),
      run = this.runs.get(id)
    return (
      committed.getEnabled(workspace.sink.workspaceId, id).enabled &&
      !this.blocks.has(id) &&
      active?.installId === installId &&
      run?.installId === installId &&
      !run.ended &&
      committed.matchesProjection(workspace.receipts.get(id), workspace.sink.workspaceId)
    )
  }
  async status(): Promise<{ cards: PluginCard[]; cleanupPending: string[] }> {
    let unfinished: Unfinished | undefined
    const read = await Promise.resolve().then(async () => {
      const releases = this.catalogue().entries
      const committed = this.options.state.readView()
      const state = committed.inspect()
      if (state.pending?.next)
        unfinished = { install: state.pending.next, operationId: state.pending.request.operationId }
      const activations = committed.currentInstallations()
      const names = new Set([
        ...releases.map((one) => one.id),
        ...state.guards.map((one) => one.pluginId),
      ])
      return {
        cards: [...names].sort().map((id) => {
          const active = activations.find((one) => one.pluginId === id),
            release = releases.find((one) => one.id === id)
          const name = this.packageNames.get(id) ?? this.options.names[id] ?? id
          if (typeof name !== 'string') return refuse()
          return {
            id,
            name,
            uninstallDeletesData:
              this.runs.get(id)?.package.manifest.format === 3
                ? this.runs.get(id)!.package.contract.lifecycle.dataOnRemove === 'remove'
                : Boolean(pluginAdapter(id)?.uninstall),
            ...(active ? { installedVersion: active.release.version } : {}),
            ...(active &&
            release &&
            release.archive.sha256 !== active.release.archiveSha256 &&
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
            this.options.toolsUnavailable?.(id)
              ? { toolsUnavailable: true as const }
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
    this.retrying = this.effectQueue
      .mutate(install.pluginId, operationId, this.operationIdentity(operationId), async () => {
        const run = this.runs.get(install.pluginId)
        if (run?.ended && run.installId === install.installId)
          await this.stop(install.pluginId, operationId)
        if (this.draining) return
        if (this.options.state.inspect().pending?.request.operationId === operationId)
          return this.recover(install.pluginId)
      })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.retrying = undefined
        this.retryDelay = Math.min(this.retryDelay * 2, 60_000)
        this.retryAt = 0
      })
  }
  async attach(sink: WorkspaceProjection): Promise<LifecycleWorkspace> {
    if (
      this.draining ||
      this.effectQueue.signal.aborted ||
      !z.uuid().safeParse(sink.workspaceId).success ||
      [...this.workspaces.values()].some(
        (one) => one.live && one.sink.workspaceId === sink.workspaceId,
      )
    )
      return refuse()
    const handle = Object.freeze({}) as LifecycleWorkspace
    const workspace: Workspace = {
      sink,
      receipts: new Map(),
      consumerBlocks: new Set(),
      consumerRevisions: new Map(),
      live: true,
    }
    this.workspaces.set(handle, workspace)
    const touched = new Map<string, { before: ProjectionReceipt | null; ids: Set<string> }>()
    try {
      await Promise.resolve().then(async () => {
        const before = this.options.state.projections(sink.workspaceId)
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
            if (
              (await bounded(() => this.effectQueue.consumer(() => sink.revoke(id, installId)))) !==
              true
            )
              return pending()
          }
          await this.effectQueue.consumer(() =>
            sink.reconcile({ pluginId: id, before: old, receipt: null }),
          )
          await this.effectQueue.consumer(() => sink.applied(id, null))
          if (this.effectQueue.signal.aborted) return pending()
          const pendingOperation = this.options.state.inspect().pending
          if (
            !pendingOperation ||
            (pendingOperation.request.consent.action !== 'global-restore' &&
              pendingOperation.request.consent.pluginId !== id)
          )
            this.options.state.recordProjection(sink.workspaceId, id, null)
          workspace.receipts.delete(id)
          const installed = this.current(id)
          if (installed) {
            const checked = await this.vault.load(this.descriptor(installed), [])
            await this.ensureRunning(installed, checked)
            // Bind only the current selection and ready run after this consumer acknowledges it.
            await this.project(workspace, installed)
          }
        }
      })
      for (const { owner, package: checked } of this.hostOwners.values())
        await this.declareHostScope(workspace, owner, checked)
      this.syncHostWorkspace(workspace)
      return handle
    } catch {
      workspace.live = false
      const proofs = await Promise.allSettled(
        [...touched].map(([id, entry]) =>
          bounded(async () => {
            for (const installId of entry.ids)
              if ((await this.effectQueue.consumer(() => sink.revoke(id, installId))) !== true)
                return pending()
            await this.effectQueue.consumer(() =>
              sink.reconcile({ pluginId: id, before: entry.before, receipt: null }),
            )
            await this.effectQueue.consumer(() => sink.applied(id, null))
          }),
        ),
      )
      this.workspaces.delete(handle)
      this.hostRegistry.detachWorkspace(sink.workspaceId)
      for (const key of this.hostScopes)
        if ((JSON.parse(key) as string[])[2] === sink.workspaceId) this.hostScopes.delete(key)
      this.registrations.detach(sink.workspaceId)
      if (proofs.some((one) => one.status !== 'fulfilled')) return pending()
      return refuse()
    }
  }
  async detach(handle: LifecycleWorkspace): Promise<void> {
    const workspace = this.workspace(handle)
    workspace.live = false
    this.hostRegistry.detachWorkspace(workspace.sink.workspaceId)
    for (const key of this.hostScopes)
      if ((JSON.parse(key) as string[])[2] === workspace.sink.workspaceId)
        this.hostScopes.delete(key)
    this.registrations.detach(workspace.sink.workspaceId)
    const results = await Promise.allSettled(
      [...workspace.receipts.values()].map((receipt) =>
        bounded(() =>
          this.effectQueue.consumer(() =>
            workspace.sink.revoke(receipt.pluginId, receipt.installId),
          ),
        ),
      ),
    )
    this.workspaces.delete(handle)
    if (results.some((one) => one.status !== 'fulfilled' || one.value !== true)) return pending()
  }
  private async ensureRunning(
    install: Installation,
    checked: VerifiedPluginPackage,
    previous?: Pick<Effect, 'previousVersion' | 'previousDataSchema'>,
  ): Promise<LifecycleRun> {
    const prior = this.runs.get(install.pluginId)
    if (this.draining || this.effectQueue.signal.aborted) return pending()
    this.assertInstallation(install)
    if (prior) {
      if (prior.installId !== install.installId || prior.ended) return pending()
      return prior.run
    }
    this.packageNames.set(install.pluginId, checked.contract.name)
    pluginNodePolicy(checked)
    this.attempted.add(install.pluginId)
    let startedOwner: PluginHostOwner | undefined
    const run = await this.options.runtime
      .start({
        package: checked,
        releaseDigest: install.release.archiveSha256,
        legacyConfiguration: {
          directory: join(
            this.options.root,
            'profile-apply',
            pluginSha256(Buffer.from(install.installId)),
          ),
          floor: join(this.options.root, 'profile-apply', install.installId + '.floor'),
        },
        ...previous,
        onStarted: async (owner) => {
          startedOwner = owner
          await this.attachHostOwner(owner, checked)
        },
        hostRequest: (owner, envelope, signal) => this.handleHostRequest(owner, envelope, signal),
      })
      .catch((error) => {
        if (startedOwner) this.invalidateHost(startedOwner.pluginId, startedOwner.runId)
        throw error
      })
    if (this.hostOwners.get(install.pluginId)?.owner.runId !== run.runId)
      await this.attachHostOwner({ pluginId: install.pluginId, runId: run.runId }, checked)
    const running: Running = { run, installId: install.installId, package: checked, ended: false }
    this.runs.set(install.pluginId, running)
    const ended = (proven: boolean) => {
      if (this.runs.get(install.pluginId) !== running) return
      if (proven) running.exitProven = true
      if (running.ended) return
      running.ended = true
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
      () => this.effectQueue.consumer(() => run.ready()),
      process.platform === 'win32' ? 150_000 : 20000,
    )
    this.assertInstallation(install)
    if (this.draining || this.runs.get(install.pluginId) !== running) return pending()
    if (connection.priorityClamped !== undefined)
      running.priorityClamped =
        typeof connection.priorityClamped === 'boolean' ? connection.priorityClamped : null
    return run
  }
  async installPackage(
    handle: LifecycleWorkspace,
    ref: PackageRef,
    action: 'install' | 'update',
    operationId: string = randomUUID(),
  ): Promise<void> {
    this.workspace(handle)
    const cached = await this.vault.selection(ref.sha256).catch(() => undefined)
    if (cached && ref.bytes !== cached.archive.length)
      throw new Error('The selected package byte count does not match its archive.')
    const selected = cached
      ? { ...cached, ref }
      : await inspectPluginPackage(ref, {
          target: this.options.target,
          appVersion: this.options.appVersion ?? this.options.repoList?.appVersion ?? '',
        })
    this.packageNames.set(selected.release.id, selected.package.contract.name)
    await this.effectQueue.stage(() =>
      this.vault.stage(
        selected.release,
        selected.archive,
        { bytes: Buffer.alloc(0), signature: Buffer.alloc(0) },
        [],
      ),
    )
    if (action === 'install')
      return this.installMutation(handle, selected.release.id, operationId, selected)
    return this.updateMutation(handle, selected.release.id, operationId, selected)
  }
  async install(
    handle: LifecycleWorkspace,
    id: string,
    operationId: string = randomUUID(),
  ): Promise<void> {
    return this.installMutation(handle, id, operationId)
  }
  async installPrepared(
    handle: LifecycleWorkspace,
    id: string,
    prepared: PreparedPluginMutation,
    operationId: string = randomUUID(),
  ): Promise<void> {
    void prepared
    return this.installMutation(handle, id, operationId)
  }
  private prepareStateOperation(request: OperationRequest) {
    const prior = this.options.state.operation(request.operationId)
    if (prior?.status === 'prepared' && !this.options.state.inspect().pending) {
      const original = prior.operation.request
      const retry = OperationRequest.parse({
        ...request,
        consent: {
          ...request.consent,
          at: original.consent.at,
          expectedSequence: original.consent.expectedSequence,
        },
      })
      if (!equalState(retry, original)) return refuse()
      return this.effectQueue.commit(request.consent.pluginId ?? '*', () =>
        this.options.state.prepare(original),
      )
    }
    return this.effectQueue.commit(request.consent.pluginId ?? '*', () =>
      this.options.state.prepare(request),
    )
  }
  private installMutation(
    handle: LifecycleWorkspace,
    id: string,
    operationId: string,
    selected?: Awaited<ReturnType<typeof inspectPluginPackage>>,
  ): Promise<void> {
    this.workspace(handle)
    if (!idSchema.safeParse(id).success || !z.uuid().safeParse(operationId).success) return refuse()
    let token: symbol | undefined
    const digest =
      selected?.release.archive.sha256 ??
      this.catalogue().entries.find((entry) => entry.id === id)?.archive.sha256
    return this.effectQueue.mutate(
      id,
      operationId,
      JSON.stringify(['install', digest]),
      () => this.performInstall(handle, id, operationId, token, selected),
      () => {
        token = this.requiresPreparedMutations() ? undefined : this.block(id)
      },
    )
  }
  private async performInstall(
    handle: LifecycleWorkspace,
    id: string,
    operationId: string,
    enqueuedToken: symbol | undefined,
    selected?: Awaited<ReturnType<typeof inspectPluginPackage>>,
  ): Promise<void> {
    const workspace = this.workspace(handle)
    const expectedReleaseDigest = selected?.release.archive.sha256
    if (!idSchema.safeParse(id).success || !z.uuid().safeParse(operationId).success) return refuse()
    const preflight = selected
      ? { checked: selected.package, bytes: selected.archive, proof: this.options.catalogue }
      : undefined
    let token = enqueuedToken
    try {
      await this.mutationFence(async () => {
        if (!selected && preflight && this.options.catalogue !== preflight.proof) return refuse()
        if (this.requiresPreparedMutations()) token = this.block(id)
        const prior = this.options.state.operation(operationId)
        if (prior && !(prior.status === 'prepared' && !this.options.state.inspect().pending)) {
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
          const checked = await this.vault.load(this.descriptor(installed), [])
          await this.ensureRunning(installed, checked)
          await this.project(workspace, installed)
          const effect = await this.effects.read(operationId)
          if (!effect || effect.phase === 'aborted') return refuse()
          if (effect.phase === 'prepared') await this.writeEffect({ ...effect, phase: 'committed' })
          return
        }
        const catalogue = this.catalogue(),
          release = selected?.release ?? catalogue.entries.find((one) => one.id === id)
        if (
          !release ||
          !release.platforms.some(
            (one) => one.os === this.options.target.os && one.cpu === this.options.target.cpu,
          )
        )
          return refuse()
        const bytes = preflight
          ? preflight.bytes
          : await this.effectQueue.consumer(() =>
              (this.options.download ?? downloadPluginArchive)(
                release,
                AbortSignal.any([this.effectQueue.signal, AbortSignal.timeout(30000)]),
              ),
            )
        const checked = preflight?.checked ?? catalogue.verifyPackage(id, release.version, bytes!)
        const state = this.options.state.inspect(),
          before = state.guards.find((one) => one.pluginId === id)
        if (!workspace.live || this.draining) return refuse()
        const cohort = [...this.workspaces.values()].filter((one) => one.live)
        const operation = this.prepareStateOperation({
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
              dataSchema: checked.contract.data.schema,
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
          await this.writeEffect(effect)
          this.options.fault?.('prepared')
          const staged = bytes
            ? await this.effectQueue.effect(id, () =>
                this.vault.stage(release, bytes, this.options.catalogue, []),
              )
            : checked
          this.options.fault?.('staged')
          const run = await this.ensureRunning(install, staged)
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
              await this.effectQueue.consumer(() =>
                one.sink.reconcile({
                  pluginId: id,
                  before: one.receipts.get(id) ?? null,
                  receipt,
                }),
              )
              this.assertOperation(effect, install)
              await this.effectQueue.consumer(() => one.sink.applied(id, receipt))
              if (!one.live || !workspace.live) return refuse()
              receipts.set(one, receipt)
            }),
          )
          if (projections.some((one) => one.status !== 'fulfilled')) return refuse()
          this.options.fault?.('receipted')
          await this.writeEffect({ ...effect, phase: 'committed' })
          if (!workspace.live || cohort.some((one) => !one.live)) return refuse()
          this.assertOperation(effect, install)
          if (this.runs.get(id)?.run !== run || this.runs.get(id)?.ended) return pending()
          this.effectQueue.commit(id, () => this.options.state.complete(operationId))
          for (const [one, receipt] of receipts) one.receipts.set(id, receipt)
          this.options.fault?.('activated')
        } catch (error) {
          const committed = this.options.state.operation(operationId)
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
          if (selected) throw error
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
      if (selected) throw error
      return refuse()
    }
  }
  async update(
    handle: LifecycleWorkspace,
    id: string,
    operationId: string = randomUUID(),
  ): Promise<void> {
    return this.updateMutation(handle, id, operationId)
  }
  async updatePrepared(
    handle: LifecycleWorkspace,
    id: string,
    prepared: PreparedPluginMutation,
    operationId: string = randomUUID(),
  ): Promise<void> {
    void prepared
    return this.updateMutation(handle, id, operationId)
  }
  private updateMutation(
    handle: LifecycleWorkspace,
    id: string,
    operationId: string,
    selected?: Awaited<ReturnType<typeof inspectPluginPackage>>,
  ): Promise<void> {
    this.workspace(handle)
    if (!idSchema.safeParse(id).success || !z.uuid().safeParse(operationId).success) return refuse()
    let token: symbol | undefined
    const digest =
      selected?.release.archive.sha256 ??
      this.catalogue().entries.find((entry) => entry.id === id)?.archive.sha256
    return this.effectQueue.mutate(
      id,
      operationId,
      JSON.stringify(['update', digest]),
      () => this.performUpdate(handle, id, operationId, token, selected),
      () => {
        token = this.requiresPreparedMutations() ? undefined : this.block(id)
      },
    )
  }
  private async performUpdate(
    handle: LifecycleWorkspace,
    id: string,
    operationId: string,
    enqueuedToken: symbol | undefined,
    selected?: Awaited<ReturnType<typeof inspectPluginPackage>>,
  ): Promise<void> {
    const workspace = this.workspace(handle)

    if (!idSchema.safeParse(id).success || !z.uuid().safeParse(operationId).success) return refuse()
    const preflight = selected
      ? { checked: selected.package, bytes: selected.archive, proof: this.options.catalogue }
      : undefined
    let token = enqueuedToken
    try {
      await this.mutationFence(async () => {
        if (!selected && preflight && this.options.catalogue !== preflight.proof) return refuse()
        if (this.requiresPreparedMutations()) token = this.block(id)
        const state = this.options.state.inspect()
        const prior = this.options.state.operation(operationId)
        if (prior && !(prior.status === 'prepared' && !state.pending)) {
          if (
            prior.operation.request.consent.action !== 'update' ||
            prior.operation.request.consent.pluginId !== id
          )
            return refuse()
          if (
            selected &&
            prior.operation.request.consent.release?.archiveSha256 !==
              selected.release.archive.sha256
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
        const release = selected?.release ?? catalogue.entries.find((one) => one.id === id)
        if (
          !before ||
          !release ||
          !release.platforms.some(
            (one) => one.os === this.options.target.os && one.cpu === this.options.target.cpu,
          )
        )
          return refuse()
        const bytes = preflight
          ? preflight.bytes
          : await this.effectQueue.consumer(() =>
              (this.options.download ?? downloadPluginArchive)(
                release,
                AbortSignal.any([this.effectQueue.signal, AbortSignal.timeout(30000)]),
              ),
            )
        const checked = preflight?.checked ?? catalogue.verifyPackage(id, release.version, bytes!)
        // Cache the verified replacement durably before reserving an update. Recovery needs no download.
        if (bytes)
          await this.effectQueue.effect(id, () =>
            this.vault.stage(release, bytes, this.options.catalogue, []),
          )
        this.options.fault?.('staged')
        if (!workspace.live || this.draining) return refuse()
        this.options.state.requireUpdateReader()
        this.options.fault?.('update-fenced')
        this.assertInstallation(before)
        const updateState = this.options.state.inspect()
        const operation = this.prepareStateOperation({
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
              dataSchema: checked.contract.data.schema,
            },
          },
        })
        const effect: Effect = {
          format: 1,
          operationId,
          pluginId: id,
          installId: before.installId,
          action: 'update',
          previousVersion: before.release.version,
          previousDataSchema: before.release.dataSchema,
          phase: 'prepared',
          offlineCleanup: false,
          compensates: null,
        }
        this.localOperations.add(operationId)
        await this.writeEffect(effect)
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
      if (selected) throw error
      return refuse()
    }
  }
  private async finishUpdate(effect: Effect, install: Installation): Promise<void> {
    this.assertOperation(effect, install)
    const checked = await this.vault.load(this.descriptor(install), [])
    // Revoke consumers and prove the old run stopped before starting the replacement. No logout or data removal.
    const stopped = await Promise.allSettled([
      this.stop(install.pluginId, effect.operationId),
      this.revoke(install),
    ])
    if (stopped.some((one) => one.status !== 'fulfilled')) return pending()
    const run = await this.ensureRunning(install, checked, {
      previousVersion: effect.previousVersion,
      previousDataSchema: effect.previousDataSchema,
    })
    this.options.fault?.('ready')
    this.assertOperation(effect, install)
    const cohort = [...this.workspaces.values()].filter((one) => one.live)
    const receipts = new Map<Workspace, ProjectionReceipt>()
    const applied = await Promise.allSettled(
      cohort.map(async (one) => {
        const receipt = this.options.state.previewProjection(
          effect.operationId,
          one.sink.workspaceId,
        )
        await this.effectQueue.consumer(() =>
          one.sink.reconcile({ pluginId: install.pluginId, before: null, receipt }),
        )
        this.assertOperation(effect, install)
        await this.effectQueue.consumer(() => one.sink.applied(install.pluginId, receipt))
        if (!one.live) return refuse()
        receipts.set(one, receipt)
      }),
    )
    if (applied.some((one) => one.status !== 'fulfilled')) return pending()
    this.options.fault?.('receipted')
    await this.writeEffect({ ...effect, phase: 'committed' })
    this.assertOperation(effect, install)
    if (this.runs.get(install.pluginId)?.run !== run || this.runs.get(install.pluginId)?.ended)
      return pending()
    this.effectQueue.commit(effect.pluginId, () => this.options.state.complete(effect.operationId))
    for (const [one, receipt] of receipts) one.receipts.set(install.pluginId, receipt)
    for (const one of this.workspaces.values()) if (one.live) this.syncHostWorkspace(one)
    this.cleanup.delete(install.pluginId)
    this.options.fault?.('activated')
  }
  private async project(workspace: Workspace, install: Installation): Promise<void> {
    if (!workspace.live) return refuse()
    const running = this.runs.get(install.pluginId)
    this.assertInstallation(install)
    const before = workspace.receipts.get(install.pluginId) ?? null
    const next = this.options.state.reconcileProjection(
      before,
      workspace.sink.workspaceId,
      install.pluginId,
    )
    await this.effectQueue.consumer(() =>
      workspace.sink.reconcile({
        pluginId: install.pluginId,
        before,
        receipt: next.receipt,
      }),
    )
    if (!workspace.live || this.runs.get(install.pluginId) !== running || running?.ended)
      return pending()
    this.assertInstallation(install)
    await this.effectQueue.consumer(() => workspace.sink.applied(install.pluginId, next.receipt))
    if (!workspace.live || this.runs.get(install.pluginId) !== running || running?.ended)
      return pending()
    this.assertInstallation(install)
    this.options.state.recordProjection(workspace.sink.workspaceId, install.pluginId, next.receipt)
    if (!workspace.live) return refuse()
    if (!next.receipt) return refuse()
    workspace.receipts.set(install.pluginId, next.receipt)
    workspace.consumerBlocks.delete(install.pluginId)
    const owner = this.hostOwners.get(install.pluginId)
    if (owner) await this.declareHostScope(workspace, owner.owner, owner.package)
    this.syncHostWorkspace(workspace)
  }
  /** Restarts the selected package using its retained process and verified declaration. */
  restartPluginTools(id: string, runId: string | undefined, stopped: () => void): Promise<void> {
    const prior = this.toolRestarts.get(id)
    if (prior) {
      if (runId !== undefined && prior.runId !== runId)
        return Promise.reject(new PluginSupervisorError('unavailable'))
      return prior.work.then(stopped)
    }
    const work = this.effectQueue
      .restart(id, randomUUID(), async () => {
        const install = this.current(id),
          running = this.runs.get(id)
        if (
          this.draining ||
          !install ||
          !running ||
          (runId !== undefined && running.run.runId !== runId) ||
          running.installId !== install.installId
        )
          return refuse()
        const token = this.block(id)
        this.toolRestartBlocks.set(id, token)
        this.cleanup.add(id)
        running.ended = true
        if (!running.exitProven) {
          try {
            const exited = running.run.exited.catch(() => new Promise<void>(() => {}))
            await bounded(() =>
              Promise.race([Promise.resolve().then(() => running.run.stop()), exited]),
            )
          } catch (error) {
            void running.run.exited
              .then(() => {
                if (
                  !this.draining &&
                  this.runs.get(id) === running &&
                  this.current(id)?.installId === install.installId
                )
                  this.options.onHostExit?.(id, running.run.runId)
              })
              .catch(() => undefined)
            throw error
          }
          running.exitProven = true
        }
        stopped()
        // Consumer cleanup is attempted, but an acknowledgement is not process admission.
        await this.revoke(install).catch(() => undefined)
        if (
          this.draining ||
          this.runs.get(id) !== running ||
          this.current(id)?.installId !== install.installId
        )
          return pending()
        this.runs.delete(id)
        this.attempted.delete(id)
        await this.ensureRunning(install, running.package)
        if (this.draining || this.blocks.get(id) !== token) return pending()
        await Promise.resolve().then(async () => {
          await Promise.all(
            [...this.workspaces.values()]
              .filter((one) => one.live)
              .map((one) => this.project(one, install)),
          )
        })
        this.cleanup.delete(id)
        if (this.blocks.get(id) === token) this.blocks.delete(id)
        if (this.toolRestartBlocks.get(id) === token) this.toolRestartBlocks.delete(id)
      })
      .finally(() => {
        if (this.toolRestarts.get(id)?.work === work) this.toolRestarts.delete(id)
      })
    this.toolRestarts.set(id, { runId, work })
    return work
  }
  private async stop(id: string, operationId: string): Promise<void> {
    this.invalidateHost(id)
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
            (await bounded(() =>
              this.effectQueue.consumer(() =>
                workspace.sink.revoke(install.pluginId, install.installId),
              ),
            )) !== true
          )
            return pending()
          await this.effectQueue.consumer(() =>
            workspace.sink.reconcile({
              pluginId: install.pluginId,
              before: null,
              receipt: null,
            }),
          )
          await this.effectQueue.consumer(() => workspace.sink.applied(install.pluginId, null))
        }),
    )
    if (results.some((one) => one.status !== 'fulfilled')) return pending()
  }
  private assertInstallation(install: Installation): void {
    if (this.draining || this.effectQueue.signal.aborted) return pending()
    const guard = this.options.state
      .inspect()
      .guards.find((entry) => entry.pluginId === install.pluginId)
    if (
      !guard ||
      guard.installId !== install.installId ||
      guard.incarnation !== install.incarnation ||
      guard.lifecycleSequence !== install.lifecycleSequence ||
      guard.configRevision !== install.configRevision ||
      guard.releaseRevision !== install.releaseRevision ||
      guard.release.archiveSha256 !== install.release.archiveSha256 ||
      guard.release.manifestSha256 !== install.release.manifestSha256
    )
      return refuse()
  }
  private assertOperation(
    effect: Pick<Effect, 'pluginId' | 'operationId' | 'action'>,
    install: Installation,
  ): void {
    this.effectQueue.assertEffect(effect.pluginId)
    this.assertInstallation(install)
    const state = this.options.state.inspect()
    if (state.pending && state.pending.request.operationId !== effect.operationId) return pending()
    const operation = state.pending ?? this.options.state.operation(effect.operationId)?.operation
    if (
      !operation ||
      operation.request.consent.action !== effect.action ||
      operation.next?.installId !== install.installId ||
      operation.next.incarnation !== install.incarnation ||
      operation.next.lifecycleSequence !== install.lifecycleSequence
    )
      return pending()
  }
  private operationIdentity(id: string): string {
    const request = this.options.state.operation(id)?.operation.request
    if (!request) return 'recover'
    return request.consent.action === 'uninstall'
      ? 'uninstall'
      : JSON.stringify([request.consent.action, request.consent.release?.archiveSha256])
  }
  private writeEffect(effect: Effect): Promise<void> {
    this.effectQueue.assertEffect(effect.pluginId)
    return this.effectQueue.effect(effect.pluginId, () => this.effects.write(effect))
  }
  beginDrain(): void {
    this.draining = true
    this.effectQueue.beginClose()
  }
  private async removeFiles(install: Installation, operationId: string): Promise<void> {
    const operation = this.options.state.operation(operationId)?.operation
    if (!operation || operation.request.consent.action === 'global-restore') return pending()
    const effect = {
      pluginId: install.pluginId,
      operationId,
      action: operation.request.consent.action,
    }
    this.assertOperation(effect, install)
    await this.effectQueue.effect(install.pluginId, () =>
      this.options.runtime.removeCode(install.pluginId, install.release.archiveSha256),
    )
    this.assertOperation(effect, install)
    await this.effectQueue.effect(install.pluginId, () =>
      this.vault.remove(this.descriptor(install), [], {
        operationId,
        installId: install.installId,
      }),
    )
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
        this.effectQueue.consumer(() => running.run.ready()),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('unavailable')), 5000)
        }),
      ])
      return await this.effectQueue.effect(id, () =>
        adapter.uninstall!(connection, this.effectQueue.signal),
      )
    } catch {
      // Local deletion can finish even when remote removal was not confirmed.
      return 'unconfirmed'
    } finally {
      clearTimeout(timer)
    }
  }
  /** A consumed lifecycle callback is never replayed after an ambiguous reply or owner crash. */
  private async genericBeforeRemoval(
    effect: Effect,
    pkg: VerifiedPluginPackage,
  ): Promise<'not-requested' | 'completed' | 'unconfirmed'> {
    const manifest = pkg.manifest
    if (
      manifest.format !== 3 ||
      !manifest.lifecycle.beforeRemove ||
      effect.explicitRemoval !== true
    )
      return 'not-requested'
    if (effect.cleanupAttempted) return effect.cleanupResult ?? 'unconfirmed'
    effect.cleanupAttempted = true
    effect.cleanupResult = 'unconfirmed'
    await this.writeEffect(effect)
    const running = this.runs.get(effect.pluginId)
    if (!running || running.ended || running.installId !== effect.installId || !effect.workspaceId)
      return 'unconfirmed'
    try {
      const connection = await this.effectQueue.consumer(() => running.run.ready())
      this.assertOperation(
        effect,
        this.options.state.inspect().guards.find((one) => one.pluginId === effect.pluginId) ??
          pending(),
      )
      if (this.runs.get(effect.pluginId) !== running || running.ended || !connection.client)
        return 'unconfirmed'
      const binding = manifest.lifecycle.beforeRemove
      const result = await this.effectQueue.effect(effect.pluginId, () =>
        connection.client!.callTool(
          {
            name: binding.tool,
            arguments: binding.arguments ?? {},
            _meta: {
              workspaceId: effect.workspaceId,
              origin: 'lifecycle.beforeRemove',
              requestId: effect.operationId,
            },
          },
          undefined,
          { signal: this.effectQueue.signal },
        ),
      )
      if (this.runs.get(effect.pluginId) !== running || running.ended) return 'unconfirmed'
      effect.cleanupReply = result
      effect.cleanupResult = result.isError ? 'unconfirmed' : 'completed'
      await this.writeEffect(effect)
      return effect.cleanupResult
    } catch {
      return 'unconfirmed'
    }
  }
  private async finishRemoval(
    effect: Effect,
    install: Installation,
  ): Promise<PluginRemovalOutcome | void> {
    this.assertOperation(effect, install)
    // Persist the selected package's removal facts before retiring its archive/code. Recovery
    // can then complete after those files are already gone without loading them or replaying I/O.
    const legacyResolved = effect.legacyRemovalOutcome !== undefined
    const pkg =
      effect.removalOutcome || legacyResolved
        ? undefined
        : (this.runs.get(install.pluginId)?.package ??
          (await this.vault.load(this.descriptor(install), [])))
    const generic = effect.removalOutcome !== undefined || pkg?.manifest.format === 3
    let outcome = effect.removalOutcome
    if (generic && !outcome) {
      this.assertOperation(effect, install)
      const cleanup = await this.genericBeforeRemoval(effect, pkg!)
      outcome = {
        data:
          pkg!.contract.lifecycle.dataOnRemove === 'remove' && effect.explicitRemoval === true
            ? 'deleted'
            : 'kept',
        cleanup,
        ...(effect.cleanupReply === undefined ? {} : { result: effect.cleanupReply }),
      }
      effect.removalOutcome = outcome
      await this.writeEffect(effect)
    }
    const logout = legacyResolved
      ? effect.legacyRemovalOutcome?.logout
      : generic || effect.explicitRemoval !== true
        ? undefined
        : await this.beforeRemoval(install.pluginId)
    const deleteData = generic
      ? outcome!.data === 'deleted'
      : legacyResolved
        ? effect.legacyRemovalOutcome?.data === 'deleted'
        : effect.explicitRemoval === true && Boolean(pluginAdapter(install.pluginId)?.uninstall)
    if (!generic && !legacyResolved) {
      effect.legacyRemovalOutcome = deleteData
        ? { data: 'deleted', logout: logout ?? 'unconfirmed' }
        : null
      await this.writeEffect(effect)
    }
    this.assertOperation(effect, install)
    const results = await Promise.allSettled([
      this.stop(install.pluginId, effect.operationId),
      this.revoke(install),
    ])
    if (results.some((one) => one.status !== 'fulfilled')) {
      this.cleanup.add(install.pluginId)
      return pending()
    }
    this.assertOperation(effect, install)
    await this.removeFiles(install, effect.operationId)
    if (deleteData) {
      if (!this.options.runtime.removeData) return pending()
      this.assertOperation(effect, install)
      await this.effectQueue.effect(install.pluginId, () =>
        this.options.runtime.removeData!(install.pluginId),
      )
    }
    const state = this.options.state.inspect()
    // The effect is durable first. A crash here still has a pending journal resolution and
    // recovery must finish it; a committed effect alone is never activation/exit authority.
    await this.writeEffect({ ...effect, phase: 'committed', offlineCleanup: true })
    if (state.pending?.request.operationId === effect.operationId) {
      try {
        this.assertOperation(effect, install)
        this.effectQueue.commit(effect.pluginId, () =>
          this.options.state.complete(effect.operationId),
        )
      } catch {
        const completed = this.options.state.operation(effect.operationId)
        if (completed?.status !== 'completed') return pending()
      }
    }
    // Cohort receipts clear in the reserved completion. Any older/offline receipt is only a
    // cleanup obligation: the tombstone already invalidates it, never authority to reactivate.
    this.cleanup.delete(install.pluginId)
    if (generic) return outcome!
    if (deleteData) return { data: 'deleted', logout: logout ?? 'unconfirmed' }
  }
  private async remove(
    id: string,
    operationId: string,
    compensates: string | null,
    workspaceId?: string,
  ): Promise<PluginRemovalOutcome | void> {
    const before = this.current(id)
    if (!before) return refuse()
    const effect: Effect = {
      format: 1,
      operationId,
      pluginId: id,
      installId: before.installId,
      action: 'uninstall',
      phase: 'prepared',
      offlineCleanup: true,
      compensates,
      explicitRemoval: compensates === null,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    }
    await this.writeEffect(effect)
    // Record whether removal was requested by the person before publishing its pending operation.
    if (this.draining) return pending()
    this.assertInstallation(before)
    const state = this.options.state.inspect()
    const operation = this.prepareStateOperation({
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
    return this.finishRemoval(effect, operation.next!)
  }
  async uninstall(
    handle: LifecycleWorkspace,
    id: string,
    operationId: string = randomUUID(),
  ): Promise<PluginRemovalOutcome | void> {
    this.workspace(handle)
    if (!idSchema.safeParse(id).success || !z.uuid().safeParse(operationId).success) return refuse()
    let token: symbol | undefined
    return this.effectQueue.mutate(
      id,
      operationId,
      'uninstall',
      () => this.performRemoval(handle, id, operationId, token),
      () => {
        token = this.block(id)
      },
    )
  }
  private async performRemoval(
    handle: LifecycleWorkspace,
    id: string,
    operationId: string,
    token: symbol | undefined,
  ): Promise<PluginRemovalOutcome | void> {
    const workspace = this.workspace(handle)
    if (!idSchema.safeParse(id).success || !z.uuid().safeParse(operationId).success) return refuse()
    let absent = false
    let outcome: PluginRemovalOutcome | void = undefined
    if (!token) return refuse()
    try {
      await Promise.resolve().then(async () => {
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
          this.options.state.operation(operationId) ?? this.options.state.operation(pendingId)
        if (prior && !(prior.status === 'prepared' && !state.pending)) {
          if (
            prior.operation.request.consent.action !== 'uninstall' ||
            prior.operation.request.consent.pluginId !== id
          )
            return refuse()
          if (prior.status === 'completed') {
            if (prior.operation.next?.installId !== guard.installId) return refuse()
            return
          }
          const effect = await this.effects.read(prior.operation.request.operationId)
          if (!effect || !prior.operation.next) return pending()
          outcome = await this.finishRemoval(effect, prior.operation.next)
          return
        }
        outcome = await this.remove(id, operationId, null, workspace.sink.workspaceId)
      })
      if (this.blocks.get(id) === token) this.blocks.delete(id)
      return outcome
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
    if (this.draining) return pending()
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
      this.assertOperation(effect, entry)
      this.effectQueue.commit(effect.pluginId, () => this.options.state.abort(effect.operationId))
    } else if (entry.phase === 'active') {
      if (entry.releaseRevision !== 1 || entry.configRevision !== 0) return pending()
      await this.remove(entry.pluginId, randomUUID(), effect.operationId)
    }
    await this.writeEffect({ ...effect, phase: 'aborted', offlineCleanup: true })
    this.cleanup.delete(entry.pluginId)
  }
  private async recover(target?: string): Promise<PluginRemovalOutcome | void> {
    let outcome: PluginRemovalOutcome | void = undefined

    const state = this.options.state.inspect()
    for (const record of this.options.state.recoveryOperations()) {
      const operation = record.operation
      if (target !== undefined && operation.next?.pluginId !== target) continue
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
      else outcome = await this.finishRemoval(pendingEffect, next)
      if (
        !this.cleanup.has(next.pluginId) &&
        !this.options.state.inspect().pending &&
        this.blocks.get(next.pluginId) === token
      )
        this.blocks.delete(next.pluginId)
    }
    return outcome
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
    this.beginDrain()
    // The supervisor bounds its caller's wait while retaining this exact cleanup barrier.
    this.drainWork ??= (async () => {
      const results = await Promise.allSettled(
        [...this.runs.values()].map(async (running) => {
          const [, exit] = await Promise.allSettled([
            Promise.resolve().then(() => running.run.stop()),
            running.run.exited,
          ])
          if (exit.status !== 'fulfilled') return pending()
          // Consumer acknowledgements cannot retain an exited process owner's lease.
        }),
      )
      await this.effectQueue.settled()
      if (results.some((one) => one.status !== 'fulfilled')) return pending()
      // Once nothing holds the state, a removal or install left unfinished stays in the journal.
      this.drained = true
      if (!this.cleanForShutdown()) return pending()
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
    const pending = this.options.state.inspect().pending
    const leftover = this.drained ? pending?.next?.pluginId : undefined
    return (
      this.effectQueue.idle &&
      (pending === null || leftover !== undefined) &&
      [...this.cleanup].every((id) => id === leftover) &&
      (!this.draining || [...this.runs.values()].every((run) => run.ended))
    )
  }
  /** A second consumer must clear stale bindings before sharing an admitted projection. */
  async reconcileConsumer(handle: LifecycleWorkspace, sink: WorkspaceProjection): Promise<void> {
    const workspace = this.workspace(handle)
    if (this.effectQueue.signal.aborted) return pending()
    if (sink.workspaceId !== workspace.sink.workspaceId) return refuse()
    await (async () => {
      const guards = this.options.state.inspect().guards
      const ids = new Set([...guards.map((one) => one.pluginId), ...workspace.receipts.keys()])
      for (const id of ids) {
        try {
          const before = workspace.receipts.get(id) ?? null
          const guard = guards.find((one) => one.pluginId === id)
          for (const installId of new Set(
            [before?.installId, guard?.installId].filter((one): one is string => !!one),
          ))
            if (
              (await bounded(() => this.effectQueue.consumer(() => sink.revoke(id, installId)))) !==
              true
            )
              return pending()
          const receipt =
            before &&
            this.admittedProjection(workspace, id, before.installId, this.options.state.readView())
              ? before
              : null
          await this.effectQueue.consumer(() =>
            sink.reconcile({ pluginId: id, before: null, receipt }),
          )
          await this.effectQueue.consumer(() => sink.applied(id, receipt))
          workspace.consumerBlocks.delete(id)
        } catch {
          workspace.consumerBlocks.add(id)
          workspace.consumerRevisions.set(id, (workspace.consumerRevisions.get(id) ?? 0) + 1)
          this.syncHostWorkspace(workspace)
          return pending()
        }
      }
    })()
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
    let read: StateReadView
    try {
      read = this.options.state.readView()
    } catch {
      return []
    }
    return [...this.runs.keys()].sort().flatMap((id) => {
      try {
        const view = this.screen(handle, id, read)
        const contributions = pluginContributions(view.package)
        if (!contributions.tools || !contributions.mcp) return []
        const run = this.runs.get(id)!
        const choice = read.getEnabled(workspaceId, id)
        const consumerRevision = this.workspace(handle).consumerRevisions.get(id) ?? 0
        return [
          {
            ...view,
            runId: run.run.runId,
            exited: run.run.exited,
            current: () => {
              const latest = this.options.state.readView()
              return (
                (this.workspaces.get(handle)?.consumerRevisions.get(id) ?? 0) ===
                  consumerRevision &&
                latest.getEnabled(workspaceId, id).revision === choice.revision &&
                this.runs.get(id) === run &&
                this.admitted(handle, id, view.installation.installId, latest)
              )
            },
          },
        ]
      } catch {
        return []
      }
    })
  }
  /** Owner-only contribution handle. Every use still proves installation, run and workspace liveness. */
  contributions(handle: LifecycleWorkspace, id: string, switchRevision = 0) {
    const read = this.options.state.readView()
    const view = this.screen(handle, id, read)
    const running = this.runs.get(id)!
    const choice = read.getEnabled(view.workspaceId, id)
    const consumerRevision = this.workspace(handle).consumerRevisions.get(id) ?? 0
    const identity = {
      pluginId: id,
      releaseDigest: view.installation.release.archiveSha256,
      installId: view.installation.installId,
      incarnation: view.installation.incarnation,
      runId: running.run.runId,
      workspaceId: view.workspaceId,
      switchRevision,
    }
    return this.registrations.register(view.package, identity, () => {
      const latest = this.options.state.readView()
      return (
        (this.workspaces.get(handle)?.consumerRevisions.get(id) ?? 0) === consumerRevision &&
        latest.getEnabled(view.workspaceId, id).revision === choice.revision &&
        this.admitted(handle, id, identity.installId, latest) &&
        this.runs.get(id)?.run.runId === identity.runId &&
        this.current(id, latest)?.incarnation === identity.incarnation
      )
    })
  }
  screen(handle: LifecycleWorkspace, id: string, view = this.options.state.readView()) {
    const workspace = this.workspace(handle),
      active = this.current(id, view),
      run = this.runs.get(id)
    if (!active || !run || !this.admitted(handle, id, active.installId, view)) return refuse()
    return {
      package: run.package,
      connection: run.run.ready(),
      installation: active,
      workspaceId: workspace.sink.workspaceId,
    }
  }
}
