import type { PluginInterface, PluginPackageCard } from '../../shared/plugin-contract'
import type { PluginHostSnapshot } from '../../shared/plugin-host'
import { PackageRefSchema, type PackageRef } from '../../shared/plugin-package'
import type { AnyPluginManifest } from './package-schema'
import type { PluginMutationConsent } from '../../shared/plugin-settings'
import {
  PluginStartupError,
  pluginStartupReason,
  pluginStartupDiagnostic,
  recordPluginStartupFailure,
} from './startup-failure'
import { join } from 'node:path'
import { PluginListError } from './catalogue/list-error'
import { GlobalPluginState } from './state/store'
import type { PluginSettingsController } from './settings'
import type { PluginInstructionSource, PluginInstructionEntry } from './instructions'
import { loadRepoPluginList } from './catalogue/repo-list'
import { devPluginSource, type DevPluginSource } from './catalogue/dev-source'
import { pluginPersonCapability } from './catalogue/capability'
import { connectPluginSettings } from './lifecycle/settings-client'
import { createPluginSupervisorLauncher } from './supervisor/launcher'
import { SupervisorStorage } from './supervisor/storage'
import { keepPluginRootPrivate } from './private-files'
import { pluginWorkspaceIdentity, type PluginSupervisorAttachment } from './supervisor/client'
import { PluginSupervisorError } from './supervisor/protocol'
import type {
  PluginCard,
  PluginUnavailableReason,
  PluginStartupDiagnostic,
} from '../../shared/plugin-settings'
import { thisMachine, type PluginTarget } from './package-schema'
import type { SharedDataOwner } from './shared-data'

/** Stable Settings/discovery facade. Repo fetch and plugin startup never block normal agents. */
export function productionPluginController() {
  let discoveryError: PluginListError | undefined
  let failure: PluginUnavailableReason = 'service-start'
  let startupDiagnostic: PluginStartupDiagnostic | undefined
  let diagnosticRoot: string | undefined
  let diagnosticWrite = Promise.resolve()
  let acceptingBusy:
    { identity: string; since: number; observedAt: number; automaticFailures: number } | undefined
  const failed = (reason: PluginUnavailableReason, error?: unknown) => {
    let observed = error
    let identity: string | undefined
    for (let depth = 0; depth < 6 && observed && typeof observed === 'object'; depth++) {
      if (
        observed instanceof PluginSupervisorError &&
        observed.code === 'busy' &&
        observed.diagnostic?.phase === 'accepting' &&
        observed.diagnostic.stage === 'hello' &&
        observed.diagnostic.probe === 'live' &&
        observed.ownerIdentity
      ) {
        identity = observed.ownerIdentity
        break
      }
      observed = (observed as { cause?: unknown }).cause
    }
    if (!identity) acceptingBusy = undefined
    else {
      const now = performance.now()
      if (acceptingBusy?.identity !== identity || now < acceptingBusy.observedAt)
        acceptingBusy = { identity, since: now, observedAt: now, automaticFailures: 0 }
      else acceptingBusy.observedAt = now
    }
    lastFailure = { error, at: new Date().toISOString() }
    failure = pluginStartupReason(error, reason)
    startupDiagnostic = pluginStartupDiagnostic(error)
    const root = diagnosticRoot,
      reasonToKeep = failure
    diagnosticWrite = diagnosticWrite.then(() =>
      recordPluginStartupFailure(root, reasonToKeep, error),
    )
  }
  let connected: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
  let workspaceId: string | undefined
  let hostSnapshot: PluginHostSnapshot = { contributions: [], notifications: [], plugins: [] }
  const hostListeners = new Set<() => void>()
  let hostGeneration = 0
  let hostNeedsNotification = false
  /** Whether {@link hostSnapshot} is a reading the owner gave, so its settings may be stated. */
  let hostSettingsKnown = false
  const hostChanged = () => {
    for (const listener of hostListeners) listener()
  }
  const clearHost = () => {
    hostGeneration++
    hostNeedsNotification = false
    hostSnapshot = { contributions: [], notifications: [], plugins: [] }
    hostSettingsKnown = false
    hostChanged()
  }
  async function refreshHost(notify = false): Promise<PluginHostSnapshot> {
    hostNeedsNotification ||= notify
    const connection = connected,
      generation = ++hostGeneration
    if (!connection || ended || cleanupUncertain)
      return { contributions: [], notifications: [], plugins: [] }
    const current = () =>
      connected === connection && hostGeneration === generation && !ended && !cleanupUncertain
    let read: PluginHostSnapshot | undefined
    try {
      read = await connection?.host?.snapshot()
    } catch (error) {
      // The newest reading failed: the settings it would have carried are not known.
      if (current()) hostSettingsKnown = false
      throw error
    }
    const snapshot = read ?? { contributions: [], notifications: [], plugins: [] }
    if (current()) {
      hostSnapshot = snapshot
      hostSettingsKnown = read !== undefined && Array.isArray(read.plugins)
      if (hostNeedsNotification) {
        hostNeedsNotification = false
        hostChanged()
      }
    }
    return hostSnapshot
  }
  let entries: readonly PluginInstructionEntry[] | null = null
  let ready: Promise<boolean> = Promise.resolve(false)
  let ended = false
  let started = false
  let initialize: (() => Promise<boolean>) | undefined
  const lifetime = new AbortController()
  const personLifetime = new AbortController()
  let closing: Promise<void> | undefined
  type Peer = {
    connection?: Awaited<ReturnType<typeof connectPluginSettings>>
    detaching: boolean
    lost: boolean
    closing?: Promise<boolean>
  }
  const reviewListeners = new Set<() => void>()
  const reviewInvalidated = () => {
    for (const listener of reviewListeners) listener()
  }
  let peer: Peer | undefined
  let transition: Promise<boolean> | undefined
  // A lost peer or a failed detach may leave a retained consumer in the owner. No entry point may
  // reconnect until the owner proves its clean stop, which ends every consumer it held, or still
  // accepts this app's lease, and so detaches the lost channel's consumer by itself.
  let cleanupUncertain = false
  let supervisor: PluginSupervisorAttachment | undefined
  let recovery: ReturnType<typeof setTimeout> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let refresh: Promise<void> | undefined
  let observeInstallations: () => ReturnType<
    typeof GlobalPluginState.observeInstallations
  > | null = () => null
  const unavailableCards = (
    listed: readonly { id: string; name?: string }[] = entries ?? [],
  ): PluginCard[] => {
    // One fresh, non-mutating snapshot per fallback response; never retain presence across mutations.
    const evidence = observeInstallations()
    const conditionalWindowAdvice =
      acceptingBusy &&
      acceptingBusy.automaticFailures >= 6 &&
      acceptingBusy.observedAt - acceptingBusy.since >= 120_000
    const specific = conditionalWindowAdvice
      ? 'owner-window-open'
      : failure === 'restart-required' || failure === 'previous-service-stopping'
        ? failure
        : undefined
    return listed.map((entry) => ({
      id: entry.id,
      name: entry.name ?? entry.id,
      state: 'Unavailable',
      unavailableReason: specific ?? (cleanupUncertain ? 'cleanup-pending' : failure),
      ...(startupDiagnostic && (!cleanupUncertain || specific) ? { startupDiagnostic } : {}),
      installed: evidence
        ? evidence.installed.includes(entry.id)
          ? true
          : evidence.pending === entry.id
            ? null
            : false
        : null,
    }))
  }
  let refreshFailed = false
  let listFailure: PluginListError | undefined
  let catalogueEntries: Awaited<ReturnType<typeof loadRepoPluginList>>
  // A one-use first-Settings allowance, never a disk cache or a new mutation authority.
  // Count freshness from the verified load, including time spent finishing startup.
  const startupCatalogueFreshMs = 30_000
  let catalogueLoadedAt: number | undefined
  let startupCatalogueVerifiedAt: number | undefined
  let firstSettingsList = true
  let sourceVersion: 1 | 2 = 1
  let selectedCatalogueSource: string | undefined
  // The last real startup or connection failure since the last successful connect. A later
  // refusal shows it beside itself, never as its own cause: classifiers walk only `cause`.
  let lastFailure: { error: unknown; at: string } | undefined
  const fail = (): never => {
    const refusal = new PluginSupervisorError('unavailable')
    if (lastFailure)
      Object.assign(refusal, { earlierFailure: lastFailure.error, earlierAt: lastFailure.at })
    throw refusal
  }
  let names: Readonly<Record<string, string>> = {}
  let loadCatalogue: (() => Promise<typeof catalogueEntries>) | undefined
  const markUnavailable = () => {
    clearHost()
    startupCatalogueVerifiedAt = undefined
    entries = entries?.map((one) => ({ ...one, state: 'Unavailable', service: null })) ?? null
    clearInterval(timer)
  }
  const recover = (): boolean => {
    if (!cleanupUncertain || ended || transition || !supervisor) return false
    if (!supervisor.stoppedCleanly() && !supervisor.holdsLease()) return false
    cleanupUncertain = false
    peer = undefined
    return true
  }
  // After a loss, keep trying with a bounded backoff until a successor is attached.
  const watchForCleanStop = (delay = 1000) => {
    clearTimeout(recovery)
    const next = Math.min(delay * 2, 60_000)
    recovery = setTimeout(() => {
      void (async () => {
        if (ended || connected) return
        if (cleanupUncertain && !recover()) {
          if (!(await supervisor?.recover?.()) || !recover()) {
            if (supervisor?.lastStartError) failed('cleanup-pending', supervisor.lastStartError)
            else acceptingBusy = undefined
            if (acceptingBusy) acceptingBusy.automaticFailures++
            if (!ended) watchForCleanStop(next)
            return
          }
        }
        const attached = await enter()
        if (!attached && acceptingBusy) acceptingBusy.automaticFailures++
        if (!attached && !ended) watchForCleanStop(next)
      })().catch(() => {
        acceptingBusy = undefined
        if (!ended) watchForCleanStop(next)
      })
    }, delay)
    recovery.unref()
  }
  const detach = (previous: Peer): Promise<boolean> => {
    previous.detaching = true
    if (peer === previous) {
      connected = undefined
      markUnavailable()
    }
    previous.closing ??= Promise.resolve().then(async () => {
      try {
        await previous.connection?.close()
        if (peer === previous) peer = undefined
        return true
      } catch {
        cleanupUncertain = true
        markUnavailable()
        if (!ended) watchForCleanStop()
        return false
      }
    })
    return previous.closing
  }
  const enter = (reconnect = false): Promise<boolean> => {
    if (transition) return transition
    if (ended || cleanupUncertain || !initialize) return Promise.resolve(false)
    // Set the fence before any await, including the old peer's detach acknowledgment.
    const next = Promise.resolve()
      .then(async () => {
        if (reconnect && peer && !(await detach(peer))) return false
        if (ended || cleanupUncertain) return false
        return initialize!()
      })
      .finally(() => {
        if (transition === next) transition = undefined
      })
    transition = next
    ready = next
    return next
  }
  const update = async () => {
    if (!connected || ended || cleanupUncertain) return fail()
    const connection = connected
    try {
      const admittedCards = await connection.catalogue()
      if (ended || connected !== connection) return fail()
      if (!catalogueEntries) return fail()
      const releases = catalogueEntries.releases
      if (connection.refreshCatalogue && !refreshFailed) {
        if (releases.some((release) => !admittedCards.some((card) => card.id === release.id)))
          return fail()
      }
      // Installed cards come from the authenticated owner, independently of today's offers.
      let hints: PluginCard[] | undefined
      const legacyInstalled = admittedCards.some(
        (card) => !card.installed && card.state === 'Unavailable',
      )
        ? (observeInstallations()?.installed ?? [])
        : []
      const offered =
        !connection.refreshCatalogue || refreshFailed
          ? admittedCards.filter(
              (card) =>
                card.installed ||
                releases.some((release) => release.id === card.id) ||
                (card.state === 'Unavailable' && legacyInstalled.includes(card.id)),
            )
          : [
              ...catalogueEntries.entries.filter((entry) =>
                releases.some((release) => release.id === entry.id),
              ),
              ...admittedCards.filter(
                (card) => card.installed && !releases.some((release) => release.id === card.id),
              ),
            ]
      const cards: PluginCard[] = offered.map((entry) => {
        const card = admittedCards.find((one) => one.id === entry.id)
        if (card && (card.state !== 'Unavailable' || card.installed === true)) {
          const { updateVersion, ...installed } = card
          const release = releases.find((one) => one.id === card.id)
          return {
            ...installed,
            ...(card.state === 'Unavailable'
              ? { unavailableReason: 'operation-pending' as const }
              : {}),
            ...(card.installed === true && !release ? { updatesUnavailable: true as const } : {}),
            ...(updateVersion && release?.version === updateVersion ? { updateVersion } : {}),
          }
        }
        hints ??= unavailableCards(offered)
        const hint = hints.find((one) => one.id === entry.id)!
        return {
          ...hint,
          unavailableReason:
            hint.installed !== false || releases.some((one) => one.id === entry.id)
              ? 'operation-pending'
              : 'unsupported',
        }
      })
      entries = cards.map((card) => ({
        id: card.id,
        name: names[card.id] ?? card.id,
        description: catalogueEntries!.entries.find((one) => one.id === card.id)?.description,
        state: card.state,
        service: card.state === 'Running' ? (names[card.id] ?? card.id) : null,
      }))
      return cards
    } catch (error) {
      if (ended || connected !== connection) return fail()
      startupCatalogueVerifiedAt = undefined
      failed('catalogue-response', error)
      // Preserve a still-live channel for explicit retry/quit to detach with its acknowledgments.
      entries = entries?.map((one) => ({ ...one, state: 'Unavailable', service: null })) ?? null
      throw new PluginStartupError(failure, error)
    }
  }
  const current = () => {
    if (!connected || ended || cleanupUncertain || transition || !entries) return fail()
    return connected
  }
  let catalogueRefresh: Promise<PluginCard[]> | undefined
  const catalogue = async (refreshList: boolean): Promise<PluginCard[]> => {
    if (ended) return fail()
    // Lists join a detach/reconnect already in flight; they never create a competing peer.
    if (transition) await transition
    else if (!connected && initialize && (!cleanupUncertain || recover())) await enter()
    if (listFailure) throw listFailure
    if (ended || !entries) return fail()
    if (!connected || cleanupUncertain) return unavailableCards()
    try {
      const startupStillFresh = () => {
        const now = performance.now()
        return (
          startupCatalogueVerifiedAt !== undefined &&
          now >= startupCatalogueVerifiedAt &&
          now - startupCatalogueVerifiedAt < startupCatalogueFreshMs
        )
      }
      const reuseStartup =
        firstSettingsList && !discoveryError && startupStillFresh() && !refreshFailed
      if (refreshList) firstSettingsList = false
      if (refreshList && !reuseStartup) {
        refreshFailed = false
        const connection = current()
        if (loadCatalogue && connection.refreshCatalogue) {
          try {
            const next = await loadCatalogue()
            if (next.discoveryError) throw next.discoveryError
            await connection.refreshCatalogue(next.sha256, {
              bytes: next.bytes,
              signature: new Uint8Array(),
            })
            if (ended || connected !== connection) return fail()
            catalogueEntries = next
            names = Object.fromEntries(next.entries.map((one) => [one.id, one.name]))
          } catch {
            if (ended || connected !== connection) return fail()
            refreshFailed = true
          }
        }
      }
      const cards = (await update())!
      if (
        discoveryError &&
        !catalogueEntries.releases.length &&
        !cards.some((card) => card.installed)
      )
        throw discoveryError
      if (refreshList && reuseStartup && !startupStillFresh()) {
        // The authenticated read can outlast freshness or invalidate source status. The allowance is
        // already consumed, so this takes the normal refresh/failure path exactly once.
        return await catalogue(true)
      }
      return cards
    } catch (error) {
      if (ended) return fail()
      if (error instanceof PluginListError) throw error
      return unavailableCards()
    }
  }
  type SourceInterface = Pick<
    PluginInterface<AnyPluginManifest>,
    'list' | 'inspect' | 'install' | 'update' | 'setEnabled'
  >
  async function installSelected(
    ref: PackageRef,
  ): Promise<{ pluginId: string; version: string; state: string }>
  async function installSelected(id: string, consent?: PluginMutationConsent): Promise<void>
  async function installSelected(
    input: PackageRef | string,
    consent?: PluginMutationConsent,
  ): Promise<void | { pluginId: string; version: string; state: string }> {
    const connection = current()
    if (typeof input === 'string') {
      if (!catalogueEntries.releases.some((release) => release.id === input))
        throw new Error('No package is selected for this plugin.')
      if (consent) await connection.install(input, consent)
      else await connection.install(input)
      await update()
      return
    }
    if (!connection.inspectPackage || !connection.applyPackage) return fail()
    const inspected = await connection.inspectPackage(input)
    await connection.applyPackage(input, 'install')
    const cards = await update()
    return {
      pluginId: inspected.id,
      version: inspected.details.version,
      state: cards?.find((card) => card.id === inspected.id)?.state ?? 'Installed',
    }
  }
  async function updateSelected(
    id: string,
    ref: PackageRef,
  ): Promise<{ version: string; state: string }>
  async function updateSelected(id: string, consent?: PluginMutationConsent): Promise<void>
  async function updateSelected(
    id: string,
    selection?: PackageRef | PluginMutationConsent,
  ): Promise<void | { version: string; state: string }> {
    const connection = current()
    if (selection && typeof selection === 'object' && 'source' in selection)
      PackageRefSchema.parse(selection)
    const parsed = PackageRefSchema.safeParse(selection)
    if (!parsed.success) {
      if (!connection.update) return fail()
      if (!catalogueEntries.releases.some((release) => release.id === id))
        throw new Error('No update package is selected for this plugin.')
      if (selection) await connection.update(id, selection as PluginMutationConsent)
      else await connection.update(id)
      await update()
      return
    }
    if (!connection.inspectPackage || !connection.applyPackage) return fail()
    const inspected = await connection.inspectPackage(parsed.data)
    if (inspected.id !== id) throw new Error('The selected update belongs to a different plugin.')
    await connection.applyPackage(parsed.data, 'update')
    const cards = await update()
    return {
      version: inspected.details.version,
      state: cards?.find((card) => card.id === id)?.state ?? 'Installed',
    }
  }
  const facade: PluginSettingsController & PluginInstructionSource & SourceInterface = {
    host: {
      snapshot: refreshHost,
      async request(input) {
        if (input.kind === 'snapshot') return { value: await refreshHost() }
        if (!connected?.host || ended || cleanupUncertain || transition)
          return { error: { code: 'disabled' } }
        const answer = await connected.host.request(input)
        await refreshHost(true).catch(() => {})
        return answer
      },
      beforeTurn: (input) =>
        !ended && !cleanupUncertain && !transition
          ? (connected?.host?.beforeTurn(input) ?? Promise.resolve({ pointers: [] }))
          : Promise.resolve({ pointers: [] }),
      onChanged(listener) {
        hostListeners.add(listener)
        return () => {
          hostListeners.delete(listener)
        }
      },
    },
    async setEnabled(workspace, id, enabled) {
      if (workspace !== workspaceId || !connected?.host) return fail()
      const answer = await facade.host!.request({ kind: 'enabled', pluginId: id, enabled })
      if ('error' in answer) return fail()
      const choice = answer.value as { enabled?: unknown; revision?: unknown } | undefined
      if (typeof choice?.enabled !== 'boolean' || typeof choice.revision !== 'number') return fail()
      return { enabled: choice.enabled, revision: choice.revision }
    },
    install: installSelected,
    update: updateSelected,
    async list(source) {
      const cards = source ? await facade.selectCatalogue!(source) : await facade.catalogue()
      return Promise.all(
        cards.map(async (card): Promise<PluginPackageCard> => {
          const inspected = await facade.inspectPackage!(card.id)
          return {
            id: card.id,
            name: inspected.name,
            version: inspected.details.version,
            authors: inspected.details.authors ?? [],
            permissions: inspected.details.permissions,
            installed: card.installed === true,
            state: card.state,
          }
        }),
      )
    },
    async inspect(ref) {
      const inspected = await facade.inspectPackage!(ref)
      return {
        manifest: inspected.manifest as AnyPluginManifest,
        authors: inspected.details.authors ?? [],
        permissions: inspected.details.permissions,
        intact: true,
      }
    },
    onReviewInvalidated(listener) {
      reviewListeners.add(listener)
      return () => {
        reviewListeners.delete(listener)
      }
    },
    cancelPreparations() {
      connected?.cancelPreparations?.()
    },
    async selectCatalogue(source) {
      if (!loadCatalogue) return fail()
      const previous = selectedCatalogueSource
      selectedCatalogueSource = source
      try {
        const next = await loadCatalogue()
        await current().refreshCatalogue?.(next.sha256, {
          bytes: next.bytes,
          signature: Buffer.alloc(0),
        })
        discoveryError = next.discoveryError
        refreshFailed = Boolean(discoveryError)
        catalogueEntries = next
        names = Object.fromEntries(next.entries.map((entry) => [entry.id, entry.name]))
        return (await update()) ?? []
      } catch (error) {
        selectedCatalogueSource = previous
        throw error
      }
    },
    async inspectPackage(input) {
      const connection = current()
      if (!connection.inspectPackage) return fail()
      return connection.inspectPackage(input)
    },
    async applyPackage(ref, action) {
      if (action === 'install') {
        await installSelected(ref)
        return
      }
      const inspected = await facade.inspectPackage!(ref)
      await updateSelected(inspected.id, ref)
    },
    async reviewMutation(action, id) {
      const connection = current()
      if (catalogueEntries?.format !== 2 || !connection.reviewMutation)
        throw new PluginSupervisorError('incompatible')
      return connection.reviewMutation(action, id)
    },
    available: () => started && !ended,
    ready: async () => {
      await ready
      return started && !ended
    },
    instructionCatalogue() {
      if (cleanupUncertain && recover()) void enter()
      if (connected && !ended && !transition && !cleanupUncertain && !refresh)
        refresh = update()
          .then(
            () => undefined,
            () => undefined,
          )
          .finally(() => {
            refresh = undefined
          })
      if (ended || entries === null) return null
      // The person's setting for this workspace, as the owner last gave it; unknown says nothing.
      const settings = hostSettingsKnown
        ? new Map((hostSnapshot.plugins ?? []).map((one) => [one.pluginId, one.enabled]))
        : new Map<string, boolean>()
      return entries.map((entry): PluginInstructionEntry => {
        const rest: Omit<PluginInstructionEntry, 'tools'> & {
          tools?: PluginInstructionEntry['tools']
        } = { ...entry }
        delete rest.tools
        const enabled = settings.get(entry.id)
        return enabled === undefined ? rest : { ...rest, tools: enabled ? 'all agents' : 'none' }
      })
    },
    refreshFailed: () => refreshFailed,
    catalogue(refreshList = false): Promise<PluginCard[]> {
      if (!refreshList) return catalogue(false)
      if (catalogueRefresh) return catalogueRefresh
      const work = catalogue(true).finally(() => {
        if (catalogueRefresh === work) catalogueRefresh = undefined
      })
      catalogueRefresh = work
      return work
    },
    async retry(id) {
      if (ended || !entries?.some((entry) => entry.id === id)) return fail()
      // A person's Try again must never spend the first-list allowance.
      firstSettingsList = false
      startupCatalogueVerifiedAt = undefined
      // An older list may still be awaiting the peer we are about to detach.
      // Its promise must not become the successor's explicit refresh.
      catalogueRefresh = undefined
      recover()
      await enter(true)
      if (ended || !entries) return fail()
      if (!connected || cleanupUncertain) return unavailableCards()
      try {
        return await facade.catalogue(true)
      } catch {
        return unavailableCards()
      }
    },
    async restartPlugin(pluginId) {
      const connection = current()
      if (!connection.restartPlugin) return fail()
      await connection.restartPlugin(pluginId)
      await update()
    },
    async uninstall(id) {
      const outcome = await current().uninstall(id)
      await update()
      return outcome
    },
    screen(id, viewId) {
      return viewId === undefined ? current().screen(id) : current().screen(id, viewId)
    },
  }
  return Object.assign(facade, {
    pluginContext: {
      active: () =>
        Boolean(
          connected &&
          !ended &&
          !cleanupUncertain &&
          !transition &&
          hostSnapshot.contributions.some(
            (item) =>
              item.kind === 'turn.context.titles' && item.state === 'active' && item.titlesEnabled,
          ),
        ),
      beforeTurn: (
        input: Parameters<NonNullable<PluginSettingsController['host']>['beforeTurn']>[0],
      ) => facade.host!.beforeTurn(input),
    },
    start(options: {
      root: string
      workspaceRoot: string
      resourcesRoot: string
      /** Explicit inert-browser scratch proof only; the app never supplies it. */
      browserExecutable?: string
      build: string
      appVersion: string
      /** Explicit scratch fixture only; never passed by index.ts. */
      fixtureSource?: string
      devSource?: DevPluginSource
      supervisor: PluginSupervisorAttachment
      target?: PluginTarget
      sharedDataOwner?: SharedDataOwner
    }): void {
      if (ended || started) return
      workspaceId = pluginWorkspaceIdentity(options.workspaceRoot)
      started = true
      supervisor = options.supervisor
      observeInstallations = () => {
        try {
          return GlobalPluginState.observeInstallations({
            root: join(options.root, 'state'),
            workspaceRoots: [options.workspaceRoot],
          })
        } catch {
          return null
        }
      }
      initialize = async () => {
        startupCatalogueVerifiedAt = undefined
        let phase: PluginUnavailableReason = 'storage'
        let attempt: Peer | undefined
        let storage: SupervisorStorage | undefined
        try {
          await keepPluginRootPrivate(options.root)
          storage = new SupervisorStorage(options.root, [options.workspaceRoot], true)
          diagnosticRoot = options.root
          phase = 'catalogue'
          const devSource = await devPluginSource(options.devSource)
          loadCatalogue = async () => {
            const next = await loadRepoPluginList({
              root: options.root,
              appVersion: options.appVersion,
              fixtureSource: options.fixtureSource,
              devSource,
              target: options.target ?? thisMachine(),
              signal: lifetime.signal,
              sourceVersion,
              offlineEmpty: !selectedCatalogueSource,
              source: selectedCatalogueSource,
            })
            discoveryError = next.discoveryError
            refreshFailed = Boolean(discoveryError)
            catalogueLoadedAt = performance.now()
            return next
          }
          if (!catalogueEntries || !options.supervisor.holdsLease()) {
            try {
              catalogueEntries = await loadCatalogue()
              listFailure = undefined
            } catch (error) {
              failed('catalogue', error)
              // List discovery does not imply a broken supervisor or plugin.
              listFailure =
                error instanceof PluginListError ? error : new PluginListError('fetch-error')
              return false
            }
          }
          if (ended) return false
          names = Object.fromEntries(catalogueEntries.entries.map((one) => [one.id, one.name]))
          entries = catalogueEntries.entries
            .filter((entry) => catalogueEntries.releases.some((release) => release.id === entry.id))
            .map((one) => ({
              id: one.id,
              name: one.name,
              description: one.description,
              state: 'Unavailable',
              service: null,
            }))
          phase = 'storage'
          const personKey = await pluginPersonCapability(options.root)
          storage.check()
          phase = 'service-start'
          const launch = createPluginSupervisorLauncher({
            root: options.root,
            workspaceRoots: [options.workspaceRoot],
            resourcesRoot: options.resourcesRoot,
            sharedDataOwner:
              options.fixtureSource || devSource ? undefined : options.sharedDataOwner,
            browserExecutable: options.browserExecutable,
            lifecycleForNewOwner:
              options.fixtureSource || devSource
                ? undefined
                : async () => {
                    const next = await loadRepoPluginList({
                      root: options.root,
                      appVersion: options.appVersion,
                      target: options.target ?? thisMachine(),
                      signal: lifetime.signal,
                      sourceVersion: 2,
                      offlineEmpty: true,
                    })
                    return {
                      source: 'repo-list',
                      sourceVersion: 2,
                      appVersion: options.appVersion,
                      catalogue: next.catalogue,
                      catalogueSha256: next.sha256,
                      repoList: next.repoList,
                      personKey,
                      names: Object.fromEntries(
                        next.entries.map((entry) => [entry.id, entry.name]),
                      ),
                    }
                  },
            lifecycle: {
              source: 'repo-list',
              // The version these entries were loaded with, so the owner's refresh asks for the same.
              sourceVersion,
              appVersion: options.appVersion,
              catalogue: catalogueEntries.catalogue,
              catalogueSha256: catalogueEntries.sha256,
              repoList: catalogueEntries.repoList,
              personKey,
              names,
              fixtureSource: options.fixtureSource,
              devSource,
            },
          })
          options.supervisor.start({
            root: options.root,
            workspaceRoot: options.workspaceRoot,
            build: options.build,
            // The owner has already revoked what this lease held; wait for its clean stop.
            onLost() {
              if (ended) return
              failed('connection-lost')
              cleanupUncertain = true
              connected = undefined
              markUnavailable()
              watchForCleanStop()
            },
            launch,
          })
          if (!(await options.supervisor.ready()) || ended) {
            if (!ended)
              failed(
                'service-start',
                new PluginStartupError(
                  pluginStartupReason(options.supervisor.lastStartError, 'service-start'),
                  launch.diagnostic(options.supervisor.lastStartError) ??
                    options.supervisor.lastStartError,
                ),
              )
            if (
              !ended &&
              ['cleanup-pending', 'restart-required'].includes(
                pluginStartupReason(options.supervisor.lastStartError, 'service-start'),
              )
            )
              watchForCleanStop()
            return false
          }
          phase = 'catalogue'
          if (
            !options.fixtureSource &&
            !devSource &&
            options.supervisor.supports?.('contributions-v1')
          ) {
            sourceVersion = 2
            catalogueEntries = await loadCatalogue()
            names = Object.fromEntries(
              catalogueEntries.entries.map((entry) => [entry.id, entry.name]),
            )
          }
          // The lifecycle's person control comes up after the supervisor; slower on Windows.
          phase = 'connection'
          let connectionError: unknown
          const until = performance.now() + (process.platform === 'win32' ? 60_000 : 5000)
          do {
            try {
              const candidate: Peer = { detaching: false, lost: false }
              attempt = candidate
              peer = candidate
              const connection = await connectPluginSettings({
                appVersion: options.appVersion,
                path: join(options.root, 'person-control/person.sock'),
                personKey,
                root: options.root,
                pinnedPublicKey: null,
                repoCatalogueSha256: catalogueEntries.sha256,
                target: options.target ?? thisMachine(),
                catalogue: {
                  bytes: catalogueEntries.bytes,
                  signature: Buffer.alloc(0),
                },
                projection: {
                  workspaceId: pluginWorkspaceIdentity(options.workspaceRoot),
                  async applied() {},
                  async reconcile() {},
                  async revoke() {
                    return true
                  },
                },
                signal: personLifetime.signal,
                lost() {
                  candidate.lost = true
                  // The notification belongs to this exact peer, even after its successor attaches.
                  if (peer !== candidate || candidate.detaching) return
                  failed('connection-lost')
                  cleanupUncertain = true
                  connected = undefined
                  markUnavailable()
                  watchForCleanStop()
                },
              })
              connection.onReviewInvalidated?.(reviewInvalidated)
              candidate.connection = connection
              if (candidate.lost || cleanupUncertain || ended) {
                await detach(candidate)
                return false
              }
              connected = connection
              lastFailure = undefined
              connection.host?.onChanged(() => {
                const generation = hostGeneration + 1
                void refreshHost(true).catch(() => {
                  // Only the newest reading's failure clears; an older one cannot erase a newer.
                  if (connected === connection && hostGeneration === generation) clearHost()
                })
              })
              await refreshHost(true)
              break
            } catch (error) {
              connectionError = error
              if (cleanupUncertain || ended) return false
              if (peer === attempt) peer = undefined
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
          } while (!ended && performance.now() < until)
          if (!connected || ended) {
            if (!ended) failed('connection', launch.diagnostic(connectionError) ?? connectionError)
            if (attempt?.connection) await detach(attempt)
            return false
          }
          await update()
          startupCatalogueVerifiedAt = catalogueLoadedAt
          acceptingBusy = undefined
          timer = setInterval(() => {
            if (!refresh)
              refresh = update()
                .then(
                  () => undefined,
                  () => undefined,
                )
                .finally(() => {
                  refresh = undefined
                })
          }, 5000)
          timer.unref()
          return true
        } catch (error) {
          failed(phase, error)
          if (
            !ended &&
            ['cleanup-pending', 'restart-required'].includes(pluginStartupReason(error, phase))
          )
            watchForCleanStop()
          if (!entries)
            listFailure =
              error instanceof PluginListError
                ? error
                : new PluginListError('fetch-error', 'supervisor-unavailable')
          markUnavailable()
          if (attempt?.connection) await detach(attempt)
          return false
        } finally {
          storage?.close()
        }
      }
      void enter()
    },
    close() {
      closing ??= (async () => {
        ended = true // Refuse new Settings/discovery calls before waiting for consumer cleanup.
        acceptingBusy = undefined
        lifetime.abort() // Cancel catalogue I/O without destroying the attached person channel.
        if (!peer) personLifetime.abort() // No attached channel needs reverse acknowledgments.
        clearInterval(timer)
        clearTimeout(recovery)
        try {
          await transition
          // The transition may have installed a successor; close only that tracked peer.
          if (peer) await detach(peer)
        } finally {
          await diagnosticWrite
          personLifetime.abort()
          connected = undefined
          entries = null
        }
      })()
      return closing
    },
  })
}
