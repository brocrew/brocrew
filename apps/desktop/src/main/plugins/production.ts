import {
  pluginStartupTrace,
  PluginStartupError,
  pluginStartupReason,
  pluginStartupDiagnostic,
  recordPluginStartupFailure,
} from './startup-failure'
import { pluginAdapter } from './lifecycle/adapters'
import { ManagedPluginFailure } from '@brobot2/runtime/plugin-failure'
import { join } from 'node:path'
import { lstat } from 'node:fs/promises'
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
import { installedChromeOnWindows } from './windows-chrome'
import { pluginWorkspaceIdentity, type PluginSupervisorAttachment } from './supervisor/client'
import { PluginSupervisorError } from './supervisor/protocol'
import type {
  PluginCard,
  PluginUnavailableReason,
  PluginStartupDiagnostic,
} from '../../shared/plugin-settings'
import { thisMachine, type PluginTarget } from './package-schema'
import type { SharedDataOwner } from './shared-data'

export function productionPluginController() {
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
    pluginStartupTrace.failure(reason, error)
    failure = pluginStartupReason(error, reason)
    startupDiagnostic = pluginStartupDiagnostic(error)
    const root = diagnosticRoot,
      reasonToKeep = failure
    diagnosticWrite = diagnosticWrite.then(() =>
      recordPluginStartupFailure(root, reasonToKeep, error),
    )
  }
  let connected: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
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
  // Reconnect only after the owner stops or detaches the lost consumer.
  let cleanupUncertain = false
  let supervisor: PluginSupervisorAttachment | undefined
  let initialRetries: number | undefined
  let recovery: ReturnType<typeof setTimeout> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let refresh: Promise<void> | undefined
  let observeInstallations: () => ReturnType<
    typeof GlobalPluginState.observeInstallations
  > | null = () => null
  const unavailableCards = (
    listed: readonly { id: string; name?: string }[] = entries ?? [],
  ): PluginCard[] => {
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
      uninstallDeletesData: Boolean(pluginAdapter(entry.id)?.uninstall),
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
  // Count first-list freshness from the verified load.
  const startupCatalogueFreshMs = 30_000
  let catalogueLoadedAt: number | undefined
  let startupCatalogueVerifiedAt: number | undefined
  let firstSettingsList = true
  let frozenCatalogue: typeof catalogueEntries | undefined
  let sourceVersion: 1 | 2 = 1
  const fail = (): never => {
    throw new PluginSupervisorError('unavailable')
  }
  let names: Readonly<Record<string, string>> = {}
  let loadCatalogue: (() => Promise<typeof catalogueEntries>) | undefined
  const markUnavailable = () => {
    startupCatalogueVerifiedAt = undefined
    entries =
      entries?.map((one) => ({
        ...one,
        state: 'Unavailable',
        toolHealth: 'unavailable',
        service: null,
      })) ?? null
    clearInterval(timer)
  }
  const recover = (): boolean => {
    if (!cleanupUncertain || ended || transition || !supervisor) return false
    if (!supervisor.stoppedCleanly() && !supervisor.holdsLease()) return false
    cleanupUncertain = false
    peer = undefined
    return true
  }
  const watchForCleanStop = (delay = 1000) => {
    initialRetries = undefined
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
    const next = Promise.resolve()
      .then(async () => {
        if (reconnect && peer && !(await detach(peer))) return false
        if (ended || cleanupUncertain) return false
        return initialize!()
      })
      .then((attached) => {
        if (attached) {
          clearTimeout(recovery)
          initialRetries = undefined
        } else if (!ended && initialRetries !== undefined && initialRetries < 3) {
          clearTimeout(recovery)
          recovery = setTimeout(
            () => {
              initialRetries!++
              void enter()
            },
            1000 * 2 ** initialRetries,
          )
          recovery.unref()
        }
        return attached
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
    let stage: 'rpc' | 'composition' = 'rpc'
    try {
      const admittedCards = await connection.catalogue()
      stage = 'composition'
      if (ended || connected !== connection) return fail()
      if (!catalogueEntries)
        throw new ManagedPluginFailure('catalogue-composition', 'invalid-reply')
      const releases = catalogueEntries.releases
      if (connection.refreshCatalogue && !refreshFailed) {
        if (releases.some((release) => !admittedCards.some((card) => card.id === release.id)))
          throw new ManagedPluginFailure('catalogue-composition', 'invalid-reply')
      }
      let hints: PluginCard[] | undefined
      const offered =
        !connection.refreshCatalogue || refreshFailed
          ? admittedCards
          : [
              ...catalogueEntries.entries.filter((entry) =>
                releases.some((release) => release.id === entry.id),
              ),
              ...admittedCards.filter(
                (card) => card.installed && !releases.some((release) => release.id === card.id),
              ),
            ]
      const pendingPlugin = observeInstallations()?.pending
      const cards: PluginCard[] = offered.map((entry) => {
        const card = admittedCards.find((one) => one.id === entry.id)
        if (card && (card.state !== 'Unavailable' || card.installed === true)) {
          const { updateVersion, ...installed } = card
          const release = releases.find((one) => one.id === card.id)
          return {
            ...installed,
            ...(card.state === 'Unavailable'
              ? {
                  unavailableReason:
                    card.unavailableReason ??
                    (pendingPlugin === card.id ? ('operation-pending' as const) : undefined),
                }
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
            pendingPlugin === entry.id
              ? 'operation-pending'
              : hint.installed !== false || releases.some((one) => one.id === entry.id)
                ? card?.unavailableReason
                : 'unsupported',
        }
      })
      entries = cards.map((card) => ({
        id: card.id,
        name: names[card.id] ?? card.id,
        description: catalogueEntries!.entries.find((one) => one.id === card.id)?.description,
        state: card.state,
        // An absent installation has no tools; other tool access stays unknown.
        tools: card.installed === false ? 'none' : 'unknown',
        toolHealth: card.state === 'Running' && !card.toolsUnavailable ? 'ready' : 'unavailable',
        ...(card.toolsCause ? { toolsCause: card.toolsCause } : {}),
        service: card.state === 'Running' ? (names[card.id] ?? card.id) : null,
      }))
      return cards
    } catch (error) {
      if (ended || connected !== connection) return fail()
      startupCatalogueVerifiedAt = undefined
      const diagnostic = new PluginStartupError(
        pluginStartupReason(error, 'catalogue-response'),
        error,
        error instanceof PluginStartupError ? (error.catalogueStage ?? stage) : stage,
      )
      failed('catalogue-response', diagnostic)
      entries =
        entries?.map((one) => ({
          ...one,
          state: 'Unavailable',
          toolHealth: 'unavailable',
          service: null,
        })) ?? null
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
    if (transition) await transition
    else if (
      !connected &&
      initialize &&
      initialRetries === undefined &&
      (!cleanupUncertain || recover())
    )
      await enter()
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
        firstSettingsList &&
        startupStillFresh() &&
        !refreshFailed &&
        (catalogueEntries.format !== 2 || connected.mutationStatus?.() === null)
      if (refreshList) firstSettingsList = false
      if (refreshList && !reuseStartup) {
        refreshFailed = false
        const connection = current()
        if (loadCatalogue && connection.refreshCatalogue) {
          try {
            const next = await loadCatalogue()
            if (next.format === 2)
              await connection.refreshCatalogue(next.sha256, {
                bytes: next.bytes,
              })
            else await connection.refreshCatalogue(next.sha256)
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
        refreshList &&
        reuseStartup &&
        (!startupStillFresh() ||
          (catalogueEntries.format === 2 && connected?.mutationStatus?.() !== null))
      ) {
        // Consume the allowance once even when the authenticated read outlasts it.
        return await catalogue(true)
      }
      return cards
    } catch (error) {
      if (ended) return fail()
      if (error instanceof PluginListError) throw error
      return unavailableCards()
    }
  }
  const facade: PluginSettingsController & PluginInstructionSource = {
    onReviewInvalidated(listener) {
      reviewListeners.add(listener)
      return () => {
        reviewListeners.delete(listener)
      }
    },
    cancelPreparations() {
      connected?.cancelPreparations?.()
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
      return ended ? null : entries
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
      firstSettingsList = false
      startupCatalogueVerifiedAt = undefined
      // Keep an older list's promise separate from the successor refresh.
      catalogueRefresh = undefined
      if (initialRetries !== undefined) clearTimeout(recovery)
      initialRetries = undefined
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
    async restartChrome() {
      const connection = current()
      if (!connection.restartChrome) return fail()
      await connection.restartChrome()
      await update()
    },
    async update(id, consent) {
      const connection = current()
      if (catalogueEntries?.format === 2 || connection.mutationRequired?.()) {
        if (!consent?.displayedDetailsHash) throw new PluginSupervisorError('policy-refused')
      } else if (consent) return fail()
      if (!connection.update || !catalogueEntries?.releases.some((release) => release.id === id))
        return fail()
      await (consent ? connection.update(id, consent) : connection.update(id))
      await update()
    },
    async install(id, consent) {
      const connection = current()
      if (catalogueEntries?.format === 2 || connection.mutationRequired?.()) {
        if (!consent?.displayedDetailsHash) throw new PluginSupervisorError('policy-refused')
      } else if (consent) return fail()
      if (!catalogueEntries?.releases.some((release) => release.id === id)) return fail()
      await (consent ? connection.install(id, consent) : connection.install(id))
      await update()
    },
    async uninstall(id) {
      const outcome = await current().uninstall(id)
      await update()
      return outcome
    },
    screen(id) {
      return current().screen(id)
    },
  }
  return Object.assign(facade, {
    start(options: {
      root: string
      workspaceRoot: string
      resourcesRoot: string
      browserExecutable?: string
      build: string
      appVersion: string
      fixtureSource?: string
      devSource?: DevPluginSource
      supervisor: PluginSupervisorAttachment
      target?: PluginTarget
      sharedDataOwner?: SharedDataOwner
    }): void {
      if (ended || started) return
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
        pluginStartupTrace.attempt()
        const admission = pluginStartupTrace.begin('controller-admission')
        startupCatalogueVerifiedAt = undefined
        let phase: PluginUnavailableReason = 'storage'
        let attempt: Peer | undefined
        let storage: SupervisorStorage | undefined
        try {
          storage = new SupervisorStorage(options.root, [options.workspaceRoot], true)
          diagnosticRoot = options.root
          pluginStartupTrace.destination(options.root)
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
            })
            catalogueLoadedAt = performance.now()
            return next
          }
          if (!catalogueEntries || !options.supervisor.holdsLease()) {
            try {
              const fetched = pluginStartupTrace.begin('catalogue')
              catalogueEntries = await loadCatalogue()
              fetched()
              if (sourceVersion === 1) frozenCatalogue = catalogueEntries
              listFailure = undefined
            } catch (error) {
              failed('catalogue', error)
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
              tools: 'unknown',
              toolHealth: 'unavailable',
              service: null,
            }))
          if (!catalogueEntries.releases.length) {
            const existing = await lstat(join(options.root, 'state')).then(
              (stat) => stat.isDirectory(),
              (error: NodeJS.ErrnoException) => {
                if (error.code === 'ENOENT') return false
                throw error
              },
            )
            if (!existing) return false
            const saved = observeInstallations()
            if (saved && saved.installed.length === 0 && saved.pending === null) return false
          }
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
            browserExecutable:
              options.browserExecutable ??
              (process.platform === 'win32'
                ? (installedChromeOnWindows() ?? undefined)
                : undefined),
            lifecycleForNewOwner:
              options.fixtureSource || devSource
                ? undefined
                : async () => {
                    const fetched = pluginStartupTrace.begin('catalogue-new-owner')
                    let next
                    try {
                      next = await loadRepoPluginList({
                        root: options.root,
                        appVersion: options.appVersion,
                        target: options.target ?? thisMachine(),
                        signal: lifetime.signal,
                        sourceVersion: 2,
                      })
                      fetched()
                    } catch (error) {
                      fetched(error)
                      throw error
                    }
                    if (!frozenCatalogue) return fail()
                    return {
                      source: 'repo-list',
                      sourceVersion: 2,
                      appVersion: options.appVersion,
                      catalogue: next.catalogue,
                      catalogueSha256: next.sha256,
                      repoList: next.repoList,
                      legacyRepoList: frozenCatalogue.repoList,
                      personKey,
                      names: Object.fromEntries(
                        next.entries.map((entry) => [entry.id, entry.name]),
                      ),
                    }
                  },
            lifecycle: {
              source: 'repo-list',
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
            else if (!ended) initialRetries ??= 0
            return false
          }
          phase = 'catalogue'
          if (
            !options.fixtureSource &&
            !devSource &&
            options.supervisor.supports?.('contributions-v1')
          ) {
            sourceVersion = 2
            const fetched = pluginStartupTrace.begin('catalogue-modern')
            catalogueEntries = await loadCatalogue()
            fetched()
            names = Object.fromEntries(
              catalogueEntries.entries.map((entry) => [entry.id, entry.name]),
            )
          }
          phase = 'connection'
          let connectionError: unknown
          const until = performance.now() + (process.platform === 'win32' ? 60_000 : 5000)
          do {
            try {
              const candidate: Peer = { detaching: false, lost: false }
              attempt = candidate
              peer = candidate
              const connection = await connectPluginSettings({
                path: join(options.root, 'person-control/person.sock'),
                personKey,
                root: options.root,
                repoCatalogueSha256: catalogueEntries.sha256,
                target: options.target ?? thisMachine(),
                catalogue: {
                  bytes: catalogueEntries.bytes,
                },
                projection: {
                  workspaceId: pluginWorkspaceIdentity(options.workspaceRoot),
                  async applied() {},
                  async reconcile() {},
                  async revoke() {
                    return true
                  },
                },
                propose: () => {},
                signal: personLifetime.signal,
                lost() {
                  candidate.lost = true
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
          else if (!ended && phase === 'service-start') initialRetries ??= 0
          if (!entries)
            listFailure =
              error instanceof PluginListError
                ? error
                : new PluginListError('fetch-error', 'supervisor-unavailable')
          markUnavailable()
          if (attempt?.connection) await detach(attempt)
          return false
        } finally {
          admission()
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
          if (peer) await detach(peer)
        } finally {
          await diagnosticWrite
          await pluginStartupTrace.flush()
          personLifetime.abort()
          connected = undefined
          entries = null
        }
      })()
      return closing
    },
  })
}
