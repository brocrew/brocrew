import { pluginAdapter } from './lifecycle/adapters'
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
import { keepPluginRootPrivate } from './private-files'
import { installedChromeOnWindows } from './windows-chrome'
import { pluginWorkspaceIdentity, type PluginSupervisorAttachment } from './supervisor/client'
import { PluginSupervisorError } from './supervisor/protocol'
import type { PluginCard } from '../../shared/plugin-settings'
import { thisMachine, type PluginTarget } from './package-schema'

/** Stable Settings/discovery facade. Repo fetch and plugin startup never block normal agents. */
export function productionPluginController() {
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
    return listed.map((entry) => ({
      id: entry.id,
      name: entry.name ?? entry.id,
      state: 'Unavailable',
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
  let frozenCatalogue: typeof catalogueEntries | undefined
  let sourceVersion: 1 | 2 = 1
  const fail = (): never => {
    throw new PluginSupervisorError('unavailable')
  }
  let names: Readonly<Record<string, string>> = {}
  let loadCatalogue: (() => Promise<typeof catalogueEntries>) | undefined
  const markUnavailable = () => {
    entries =
      entries?.map((one) => ({ ...one, state: 'Unavailable', tools: 'none', service: null })) ??
      null
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
      if (ended || connected) return
      if (cleanupUncertain && !recover()) return watchForCleanStop(next)
      void enter().then((attached) => {
        if (!attached && !ended) watchForCleanStop(next)
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
        if (
          releases.some((release) => !admittedCards.some((card) => card.id === release.id)) ||
          admittedCards.some(
            (card) => !card.installed && !releases.some((release) => release.id === card.id),
          )
        )
          return fail()
      }
      // Installed cards come from the authenticated owner, independently of today's offers.
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
      const cards: PluginCard[] = offered.map((entry) => {
        const card = admittedCards.find((one) => one.id === entry.id)
        if (card && (card.state !== 'Unavailable' || card.installed === true)) {
          const { updateVersion, ...installed } = card
          const release = releases.find((one) => one.id === card.id)
          return {
            ...installed,
            ...(card.installed === true && !release ? { updatesUnavailable: true as const } : {}),
            ...(updateVersion && release?.version === updateVersion ? { updateVersion } : {}),
          }
        }
        hints ??= unavailableCards(offered)
        return hints.find((one) => one.id === entry.id)!
      })
      entries = cards.map((card) => ({
        id: card.id,
        name: names[card.id] ?? card.id,
        description: catalogueEntries!.entries.find((one) => one.id === card.id)?.description,
        state: card.state,
        tools: card.state === 'Running' ? 'all agents' : 'none',
        service: card.state === 'Running' ? (names[card.id] ?? card.id) : null,
      }))
      return cards
    } catch {
      if (ended || connected !== connection) return fail()
      // Preserve a still-live channel for explicit retry/quit to detach with its acknowledgments.
      entries =
        entries?.map((one) => ({ ...one, state: 'Unavailable', tools: 'none', service: null })) ??
        null
      return fail()
    }
  }
  const current = () => {
    if (!connected || ended || cleanupUncertain || transition || !entries) return fail()
    return connected
  }
  const facade: PluginSettingsController & PluginInstructionSource = {
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
    async catalogue(refreshList = false): Promise<PluginCard[]> {
      if (ended) return fail()
      // Lists join a detach/reconnect already in flight; they never create a competing peer.
      if (transition) await transition
      else if (!connected && initialize && (!cleanupUncertain || recover())) await enter()
      if (listFailure) throw listFailure
      if (ended || !entries) return fail()
      if (!connected || cleanupUncertain) return unavailableCards()
      try {
        if (refreshList) {
          refreshFailed = false
          const connection = current()
          if (loadCatalogue && connection.refreshCatalogue) {
            try {
              const next = await loadCatalogue()
              if (next.format === 2)
                await connection.refreshCatalogue(next.sha256, {
                  bytes: next.bytes,
                  signature: new Uint8Array(),
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
        return (await update())!
      } catch (error) {
        if (ended) return fail()
        if (error instanceof PluginListError) throw error
        return unavailableCards()
      }
    },
    async retry(id) {
      if (ended || !entries?.some((entry) => entry.id === id)) return fail()
      recover()
      await enter(true)
      if (ended || !entries) return fail()
      if (!connected || cleanupUncertain) return unavailableCards()
      try {
        return await update()
      } catch {
        return unavailableCards()
      }
    },
    async update(id) {
      const connection = current()
      if (catalogueEntries?.format === 2 || connection.mutationRequired?.()) return fail()
      if (!connection.update || !catalogueEntries?.releases.some((release) => release.id === id))
        return fail()
      await connection.update(id)
      await update()
    },
    async install(id) {
      const connection = current()
      if (catalogueEntries?.format === 2 || connection.mutationRequired?.()) return fail()
      if (!catalogueEntries?.releases.some((release) => release.id === id)) return fail()
      await connection.install(id)
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
      /** Explicit inert-browser scratch proof only; the app never supplies it. */
      browserExecutable?: string
      build: string
      appVersion: string
      /** Explicit scratch fixture only; never passed by index.ts. */
      fixtureSource?: string
      devSource?: DevPluginSource
      supervisor: PluginSupervisorAttachment
      target?: PluginTarget
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
        let attempt: Peer | undefined
        let storage: SupervisorStorage | undefined
        try {
          // Parent/root ownership, workspace exclusion and main-thread refusal before provisioning.
          await keepPluginRootPrivate(options.root)
          storage = new SupervisorStorage(options.root, [options.workspaceRoot], true)
          const devSource = await devPluginSource(options.devSource)
          loadCatalogue = () =>
            loadRepoPluginList({
              root: options.root,
              appVersion: options.appVersion,
              fixtureSource: options.fixtureSource,
              devSource,
              target: options.target ?? thisMachine(),
              signal: lifetime.signal,
              sourceVersion,
            })
          if (!catalogueEntries || !options.supervisor.holdsLease()) {
            try {
              catalogueEntries = await loadCatalogue()
              if (sourceVersion === 1) frozenCatalogue = catalogueEntries
              listFailure = undefined
            } catch (error) {
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
              tools: 'none',
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
          const personKey = await pluginPersonCapability(options.root)
          storage.check()
          options.supervisor.start({
            root: options.root,
            workspaceRoot: options.workspaceRoot,
            build: options.build,
            // The owner has already revoked what this lease held; wait for its clean stop.
            onLost() {
              if (ended) return
              cleanupUncertain = true
              connected = undefined
              markUnavailable()
              watchForCleanStop()
            },
            launch: createPluginSupervisorLauncher({
              root: options.root,
              workspaceRoots: [options.workspaceRoot],
              resourcesRoot: options.resourcesRoot,
              // Windows names no Chrome a plugin process could find by itself (see windows-chrome.ts).
              browserExecutable:
                options.browserExecutable ??
                (process.platform === 'win32'
                  ? (installedChromeOnWindows() ?? undefined)
                  : undefined),
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
                      })
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
            }),
          })
          if (!(await options.supervisor.ready()) || ended) return false
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
                propose: () => {},
                signal: personLifetime.signal,
                lost() {
                  candidate.lost = true
                  // The notification belongs to this exact peer, even after its successor attaches.
                  if (peer !== candidate || candidate.detaching) return
                  cleanupUncertain = true
                  connected = undefined
                  markUnavailable()
                  watchForCleanStop()
                },
              })
              candidate.connection = connection
              if (candidate.lost || cleanupUncertain || ended) {
                await detach(candidate)
                return false
              }
              connected = connection
              break
            } catch {
              if (cleanupUncertain || ended) return false
              if (peer === attempt) peer = undefined
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
          } while (!ended && performance.now() < until)
          if (!connected || ended) {
            if (attempt?.connection) await detach(attempt)
            return false
          }
          await update()
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
        } catch {
          console.warn('[plugins] plugin-initialization-failed')
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
        lifetime.abort() // Cancel catalogue I/O without destroying the attached person channel.
        if (!peer) personLifetime.abort() // No attached channel needs reverse acknowledgments.
        clearInterval(timer)
        clearTimeout(recovery)
        try {
          await transition
          // The transition may have installed a successor; close only that tracked peer.
          if (peer) await detach(peer)
        } finally {
          personLifetime.abort()
          connected = undefined
          entries = null
        }
      })()
      return closing
    },
  })
}
