import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import {
  FakeRuntime,
  FakeProviderSessions,
  type ResumeOptions,
  type SessionHandle,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'

for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: skill reminders follow the catalogue receipt and survive its absence and reopen`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'fictional-skill-reminders-'))
    const db = openDatabase(join(root, 'records.sqlite'))
    applyMigrations(db, join(import.meta.dirname, '../src/main/db/migrations'))
    const store = createSessionStore(db)
    const sent: string[] = []
    const sessions = new FakeProviderSessions()
    let handle: SessionHandle | undefined
    let confirmed = false
    let serial = 0
    const observe = <T extends SessionHandle>(opened: T): T => {
      handle = opened
      confirmed = false
      opened.builtInSkillsConfirmed = () => confirmed
      const send = opened.send.bind(opened)
      opened.send = (text, provenance) => {
        sent.push(text)
        return send(text, provenance)
      }
      return opened
    }
    class ObservedRuntime extends FakeRuntime {
      override async start(options: StartOptions) {
        return observe(await super.start(options))
      }
      override async resume(ref: SessionRef, options: ResumeOptions) {
        return observe(await super.resume(ref, options))
      }
    }
    const sink: RuntimeEventSink = {
      ownerId: 'fictional-window',
      aPersonIsBehindIt: true,
      alive: true,
      send() {},
      sendLiveness() {},
    }
    const reminder = 'fictional-guide — Read a fictional guide.'
    const host = new RuntimeHost({
      store,
      createRuntime: (kind) => new ObservedRuntime(kind, { sessions }),
      newSessionId: () => `fictional-session-${++serial}`,
      prepareProviderHome: (kind, profile) => {
        const home = join(root, profile, kind)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (kind, profile) => join(root, profile, kind),
      sharedSkillsRoot: async () => join(root, 'shared'),
      prepareBuiltInSkills: async () => ({
        context: { root: join(root, 'skills'), skills: [] },
        reminder,
        version: 'fictional-v1',
        isCurrent: () => true,
      }),
      readProviderConfig: (_kind, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fictional-model',
        authNote: null,
        files: [],
      }),
      resolveCwd: (_id, requested) => requested ?? root,
      exportDirectory: () => join(root, 'exports'),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
    })
    try {
      const { sessionId } = await host.createSession(
        { provider, profileId: 'fictional-reader', cwd: root, approvalMode: 'auto' },
        sink,
      )
      const turn = async (text: string) => {
        await vi.waitFor(() => expect(handle?.status()).toBe('idle'))
        await host.send(sessionId, text, sink)
        await vi.waitFor(() => expect(handle?.status()).toBe('idle'))
        const words = sent.at(-1)!
        expect(words).toContain(`Shared skills: ${join(root, 'shared')}`)
        return words
      }
      expect(await turn('Read the first fictional guide.')).toContain(reminder)
      confirmed = true
      expect((await turn('Read after catalogue confirmation.')).includes(reminder)).toBe(
        provider === 'codex',
      )
      if (handle) delete handle.builtInSkillsConfirmed
      expect(await turn('Read without a catalogue receipt.')).toContain(reminder)
      await host.close(sessionId, sink)
      await host.resumeSession(sessionId, sink)
      expect(await turn('Read after reopening.')).toContain(reminder)
      confirmed = true
      expect((await turn('Read after the new confirmation.')).includes(reminder)).toBe(
        provider === 'codex',
      )
    } finally {
      await host.closeAll()
      db.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
}
