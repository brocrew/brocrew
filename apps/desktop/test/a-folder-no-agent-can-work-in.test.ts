import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  RuntimeHost,
  type RuntimeEventSink,
  type CallerIdentity,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { fixtureProviderConfig, syntheticProviderHome, neutralHostDeps } from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

describe('590 · a folder approved that no agent can work in', () => {
  class PersonSink implements RuntimeEventSink {
    readonly aPersonIsBehindIt = true
    readonly messages: RuntimeEventMessage[] = []
    alive = true
    constructor(readonly ownerId: string) {}
    send(message: RuntimeEventMessage): void {
      this.messages.push(message)
    }
    sendLiveness(): void {}
    events(): TranscriptEvent[] {
      return this.messages.map((message) => message.event)
    }
  }

  let userData: string
  let workspace: string
  let repo: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let window: PersonSink
  let counter: number
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-590-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-590-ws-'))
    repo = mkdtempSync(join(tmpdir(), 'brobot2-590-repo-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 4_000_000
    store = createSessionStore(db, tick)
    counter = 0
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    window = new PersonSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: workspace, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  const aBroBotThatCanStaff = async (): Promise<string> => {
    await bringIdentityIntoBeing('pm')
    return personOpens(DEFAULT_PROFILE_ID)
  }

  const cwdOf = (sessionId: string): string | undefined => store.find(sessionId)?.cwd

  describe('⚑ §1 · a spawn that names no folder starts in its parent’s', () => {
    it('⛔ the child of a parent that names no folder lands in the parent’s OWN folder', async () => {
      const brobot = await aBroBotThatCanStaff()
      const staffed = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'no folder named',
          brief: 'no folder named',
        },
        speakingAs(brobot),
      )
      if (!staffed.ok) throw new Error(`the give was refused: ${staffed.refusal.rail}`)
      expect(staffed.runsOn.how).toBe('started')
      expect(cwdOf(staffed.owner)).toBe(workspace)
      expect(cwdOf(staffed.owner)).not.toBe(repo)
    })
  })

  describe('⛔ §2 · a folder is asked only whether it can be used', () => {
    it('🔴 726 · R92 — a cwd outside the parent’s folder is admitted: the child starts where it asked', async () => {
      const brobot = await aBroBotThatCanStaff()
      const elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-590-elsewhere-'))
      try {
        const missing = join(elsewhere, 'not-here')
        const refused = await host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'pm',
            title: 'a folder nobody made',
            brief: 'a folder nobody made',
            folder: missing,
          },
          speakingAs(brobot),
        )
        if (refused.ok) throw new Error(`the give was allowed: ${refused.owner}`)
        expect(refused.refusal.rail).toBe('folder-unusable')
        expect((refused.refusal.detail as { folderReason?: string }).folderReason).toContain(
          missing,
        )

        const placed = await host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'pm',
            title: 'somewhere else entirely',
            brief: 'somewhere else entirely',
            folder: elsewhere,
          },
          speakingAs(brobot),
        )
        if (!placed.ok) throw new Error(`the give was refused: ${placed.refusal.rail}`)
        expect(cwdOf(placed.owner)).toBe(elsewhere)
        expect(cwdOf(placed.owner)).not.toBe(workspace)
      } finally {
        rmSync(elsewhere, { recursive: true, force: true })
      }
    })
  })

  describe('⚑ §3 · one level down, the default is where the child stands', () => {
    it('🔴 the child’s own children start where the child stands — not where its parent does', async () => {
      const brobot = await aBroBotThatCanStaff()
      const inside = join(repo, 'docs')
      mkdirSync(inside)
      const child = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'the docs PM',
          brief: 'the docs PM',
          folder: inside,
        },
        speakingAs(brobot),
      )
      if (!child.ok) throw new Error(`the give was refused: ${child.refusal.rail}`)
      expect(cwdOf(child.owner)).toBe(inside)

      const grandchild = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'one level down',
          brief: 'one level down',
        },
        speakingAs(child.owner),
      )
      if (!grandchild.ok) throw new Error(`the give was refused: ${grandchild.refusal.rail}`)
      expect(grandchild.runsOn.how).toBe('started')
      expect(cwdOf(grandchild.owner)).toBe(inside)
      expect(cwdOf(grandchild.owner)).not.toBe(repo)
      expect(cwdOf(grandchild.owner)).not.toBe(workspace)
    })
  })

  describe('⛔ §7 · the sweep, asserted rather than promised', () => {
    const sourceOf = (relative: string): string => readFileSync(join(srcRoot, relative), 'utf8')

    it('⛔ `give_work.folder` does not say the bound is only ever your own folder', () => {
      const tools = sourceOf('main/runtime/agent-tools.ts')
      expect(tools).not.toContain('Defaults to your own, and may only ever be your own folder')
      expect(tools).not.toContain('It may only ever be that folder or one inside it')
      expect(tools).toContain("A conversation this starts works in the piece's folder")
    })

    it('⛔ `reply_to_parent.resource_paths` does not tell a caller a file must be inside its folder', () => {
      const tools = sourceOf('main/runtime/agent-tools.ts')
      expect(tools).not.toContain('A Markdown file inside your own working directory')
      expect(tools).toContain('— ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere;')
    })
  })
})
