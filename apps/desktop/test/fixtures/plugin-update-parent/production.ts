import { join } from 'node:path'
import { GlobalPluginState } from './state-store'
import type { PluginSettingsController } from '../../../src/main/plugins/settings'
import type { PluginInstructionSource, PluginInstructionEntry } from '../../../src/main/plugins/instructions'
import { loadRepoPluginList } from '../../../src/main/plugins/catalogue/repo-list'
import { devPluginSource, type DevPluginSource } from '../../../src/main/plugins/catalogue/dev-source'
import { pluginPersonCapability } from '../../../src/main/plugins/catalogue/capability'
import { connectPluginSettings } from './lifecycle-settings-client'
import { createPluginSupervisorLauncher } from '../../../src/main/plugins/supervisor/launcher'
import { SupervisorStorage } from '../../../src/main/plugins/supervisor/storage'
import { pluginWorkspaceIdentity, type PluginSupervisorAttachment } from '../../../src/main/plugins/supervisor/client'
import { PluginSupervisorError } from '../../../src/main/plugins/supervisor/protocol'
import type { PluginCard } from '../../../src/shared/plugin-settings'
import type { PluginTarget } from '../../../src/main/plugins/package-schema'

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
  const unavailableCards = (): PluginCard[] => {
    // One fresh, non-mutating snapshot per fallback response; never retain presence across mutations.
    const evidence = observeInstallations()
    return (entries ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name ?? entry.id,
      state: 'Unavailable',
      installed: evidence
        ? evidence.installed.includes(entry.id)
          ? true
          : evidence.pending === entry.id
            ? null
            : false
        : null,
    }))
  }
  let catalogueEntries: Awaited<ReturnType<typeof loadRepoPluginList>>
  const fail = (): never => {
    throw new PluginSupervisorError('unavailable')
  }
  let names: Readonly<Record<string, string>> = {}
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
      if (
        !catalogueEntries ||
        admittedCards.length !== catalogueEntries.releases.length ||
        admittedCards.some((card) => !catalogueEntries!.releases.some((one) => one.id === card.id))
      )
        return fail()
      // An unadmitted peer cannot prove absence: its false bit also covers pending cleanup.
      let hints: PluginCard[] | undefined
      const cards: PluginCard[] = catalogueEntries.entries.map((entry) => {
        const card = admittedCards.find((one) => one.id === entry.id)
        if (card && (card.state !== 'Unavailable' || card.installed === true)) return card
        hints ??= unavailableCards()
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
    async catalogue(): Promise<PluginCard[]> {
      if (ended) return fail()
      // Lists join a detach/reconnect already in flight; they never create a competing peer.
      if (transition) await transition
      else if (!connected && initialize && (!cleanupUncertain || recover())) await enter()
      if (ended || !entries) return fail()
      if (!connected || cleanupUncertain) return unavailableCards()
      try {
        return (await update())!
      } catch {
        if (ended) return fail()
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
    async install(id) {
      await current().install(id)
      await update()
    },
    async uninstall(id) {
      await current().uninstall(id)
      await update()
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
          // Parent/root ownership, workspace exclusion and main-thread/POSIX refusal before provisioning.
          storage = new SupervisorStorage(options.root, [options.workspaceRoot], true)
          const devSource = await devPluginSource(options.devSource)
          // An owner that still accepts this lease admits only the list it was started with.
          if (!catalogueEntries || !options.supervisor.holdsLease())
            catalogueEntries = await loadRepoPluginList({
              root: options.root,
              appVersion: options.appVersion,
              fixtureSource: options.fixtureSource,
              devSource,
              target: options.target ?? {
                os: process.platform as 'darwin' | 'linux',
                cpu: process.arch as 'arm64' | 'x64',
              },
              signal: lifetime.signal,
            })
          if (ended) return false
          names = Object.fromEntries(catalogueEntries.entries.map((one) => [one.id, one.name]))
          entries = catalogueEntries.entries.map((one) => ({
            id: one.id,
            name: one.name,
            description: one.description,
            state: 'Unavailable',
            tools: 'none',
            service: null,
          }))
          if (!catalogueEntries.releases.length) return false
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
              browserExecutable: options.browserExecutable,
              lifecycle: {
                source: 'repo-list',
                catalogue: catalogueEntries.catalogue,
                catalogueSha256: catalogueEntries.sha256,
                personKey,
                names,
                fixtureSource: options.fixtureSource,
                devSource,
              },
            }),
          })
          if (!(await options.supervisor.ready()) || ended) return false
          const until = performance.now() + 5000
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
                target: options.target ?? {
                  os: process.platform as 'darwin' | 'linux',
                  cpu: process.arch as 'arm64' | 'x64',
                },
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
