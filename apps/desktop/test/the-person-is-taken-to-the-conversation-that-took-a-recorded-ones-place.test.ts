import {
  fixtureProviderConfig,
  neutralHostDeps,
  syntheticProviderHome,
  waitFor,
} from './lib/host-fixture'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore as createLedger, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { createSessionStore, type FirstMessageCameTo } from '../src/renderer/src/lib/session-store'
import { LAUNCHER, useSurface, type Surface } from '../src/renderer/src/composables/useSurface'
import { FixtureRuntimeWindow as AWindow } from './lib/runtime-command-bridge'
import { recordHistoricalReplacement } from './lib/historical-replacement'

/**
 * D-017b, 701 M6 · the person is taken to the conversation that took a recorded one's place.
 *
 * A message sent from a recorded conversation's view continues it in one act (`store.startAndSend`).
 * When the record names an earlier replacement, the host starts that conversation and the store
 * names it (`tookItsPlace`). `RuntimeScreen.continueIt` then puts THAT
 * conversation on screen, unless the reader moved while the start was in the air: the view is read
 * before the await and handed to `showConversation` after it. When it is left out, the words are
 * sent and answered in a conversation the person is never shown, and the view they are looking at
 * is the old one that stopped taking messages.
 *
 * Nothing in this repository mounts `RuntimeScreen`, so the part that has to be read is read: a
 * census over the source of `continueIt`, comments blanked. Everything it stands for is driven:
 * a real host over a real SQLite ledger and migrations, the real dispatcher and the wire's clone,
 * the real renderer session store and the real `useSurface`. The only double is the provider.
 * Every negative assertion sits beside a positive one read off the same reader.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('the person is taken to the conversation that took a recorded one’s place', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let ledger: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let window: AWindow
  let windows: AWindow[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  const stops: (() => void)[] = []
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store: ledger,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      announce: (change) => {
        for (const one of windows) one.announce(change)
      },
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d017b-place-'))
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-d017b-place-root-')))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_700_000
    ledger = createLedger(db, tick)
    counter = 0
    hosts = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new AWindow('webContents:1', () => host)
    windows = [window]
  })

  afterEach(async () => {
    for (const stop of stops.splice(0)) stop()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const openWindow = (): ReturnType<typeof createSessionStore> => {
    const store = createSessionStore(window.bridge())
    stops.push(() => store.dispose())
    return store
  }

  const turnsOf = (sessionId: string): string[] =>
    ledger
      .events(sessionId)
      .flatMap(({ event }) => (event.type === 'user_turn' ? [event.text] : []))

  /** A person's conversation, said something in, and left stopped when the app quit. */
  const leftOpenByTheQuit = async (
    recordedReplacement = false,
  ): Promise<{ id: string; replacement: string | null }> => {
    const before = openWindow()
    const id = await before.create({ provider: 'claude', cwd: root })
    if (id === null) throw new Error('the conversation did not start')
    expect(await before.send(id, 'said before the quit')).toBe(true)
    await waitFor(
      () => turnsOf(id).includes('said before the quit'),
      'the words before the quit to be recorded',
    )
    const replacement = recordedReplacement
      ? await before.create({ provider: 'claude', cwd: root })
      : null
    if (recordedReplacement && replacement === null) throw new Error('no replacement record')
    await host.closeAll()
    for (const stop of stops.splice(0)) stop()
    if (replacement !== null) recordHistoricalReplacement(ledger, id, replacement, tick())
    ledger = createLedger(db, tick)
    host = buildHost()
    window = new AWindow('webContents:2', () => host)
    windows = [window]
    return { id, replacement }
  }

  /** The reader has the recorded conversation open: drawn by a look, on a real surface. */
  const readingIt = async (
    store: ReturnType<typeof createSessionStore>,
    id: string,
  ): Promise<Surface> => {
    const surface = useSurface(store)
    await nextTick()
    expect(await store.look(id)).toBe(id)
    // The screen's `openConversation`: the view read before the look, handed to the surface after.
    surface.showConversation(id, surface.view())
    await nextTick()
    expect(surface.activeId.value, 'the premise: the reader is on it').toBe(id)
    expect(surface.surface.value, 'the premise: and it is drawn').toBe('conversation')
    expect(store.get(id)?.phase).toBe('recorded')
    return surface
  }

  /**
   * `RuntimeScreen.continueIt`'s ending, as written on the screen: the view is read before the
   * await, and the conversation that took the place is put on screen after it. The census below
   * pins that the screen says this.
   */
  const continueIt = async (
    store: ReturnType<typeof createSessionStore>,
    surface: Surface,
    sessionId: string,
    text: string,
  ): Promise<FirstMessageCameTo | null> => {
    const from = surface.view()
    const came = await store.startAndSend(sessionId, text, [])
    if (came?.tookItsPlace !== undefined && came.openHere) {
      surface.showConversation(came.tookItsPlace, from)
    }
    return came
  }

  it('a message from a recorded view follows its historical replacement and takes the reader there', async () => {
    const { id, replacement } = await leftOpenByTheQuit(true)
    const store = openWindow()
    const surface = await readingIt(store, id)

    const came = await continueIt(store, surface, id, 'are you there')

    const next = came?.sent ? came.tookItsPlace : undefined
    if (next === undefined) throw new Error(`nothing took its place: ${JSON.stringify(came)}`)
    expect(next).toBe(replacement)
    expect(next).not.toBe(id)
    // The words went to the conversation in its place, not to the one the reader was on.
    await waitFor(() => turnsOf(next).includes('are you there'), 'the words in its place')
    expect(turnsOf(id)).toEqual(['said before the quit'])
    // And the reader is on it: selected, drawn, and no destination in the way.
    expect(surface.activeId.value).toBe(next)
    expect(surface.place.value).toBeNull()
    expect(surface.surface.value).toBe('conversation')
    expect(store.isLive(next)).toBe(true)
    expect(surface.active.value?.sessionId).toBe(next)
  })

  it('…and when it can be reopened, nothing took its place and the reader stays on it', async () => {
    // The control, one fact over: the history is there, everything else the same.
    const { id } = await leftOpenByTheQuit()
    const store = openWindow()
    const surface = await readingIt(store, id)

    const came = await continueIt(store, surface, id, 'are you there')

    expect(came).toEqual({ sent: true, openHere: true })
    expect(came).not.toHaveProperty('tookItsPlace')
    await waitFor(() => turnsOf(id).includes('are you there'), 'the words in it')
    expect(surface.activeId.value).toBe(id)
    expect(surface.surface.value).toBe('conversation')
    expect(store.isLive(id)).toBe(true)
  })

  it('…and a reader who moved to the launcher while it started is not pulled back onto it', async () => {
    // The view is read before the await, so the answer that lands late loses to the reader. The
    // control is the first arm above: the same start, nobody moving, and the reader is taken.
    const { id, replacement } = await leftOpenByTheQuit(true)
    const store = openWindow()
    const surface = await readingIt(store, id)

    const pending = continueIt(store, surface, id, 'are you there')
    // `continueIt` has read its view and is waiting on the start: the reader presses New.
    surface.place.value = LAUNCHER
    const came = await pending

    const next = came?.sent ? came.tookItsPlace : undefined
    if (next === undefined) throw new Error(`nothing took its place: ${JSON.stringify(came)}`)
    expect(next).toBe(replacement)
    await waitFor(() => turnsOf(next).includes('are you there'), 'the words in its place')
    await nextTick()
    expect(surface.place.value).toBe(LAUNCHER)
    expect(surface.surface.value).toBe('launcher')
    expect(surface.activeId.value).toBe(id)
    // It is still reachable: the store holds it, fed here, for the rail to list.
    expect(store.isLive(next)).toBe(true)
  })
})
