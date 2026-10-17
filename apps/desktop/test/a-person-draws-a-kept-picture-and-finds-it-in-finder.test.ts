import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import {
  executeRuntimeCommand,
  refusedDuringAQuit,
  runtimeCommandSchema,
} from '../src/main/runtime/ipc'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { resourcesRoot } from '../src/main/resources/resources'
import type { ResourceDrawing, ResourceReveal } from '../src/shared/runtime-ipc'

/**
 * 🔴 D-032 · the two doors a person's window opens on a kept file — `drawResource` (its bytes, typed
 * by main, for a viewer) and `revealResource` (Finder, by its id) — driven on a REAL host over a REAL
 * SQLite ledger, with files kept through the one door a resource is kept by (`replyToParent`).
 *
 * The pure readers are pinned in `what-a-kept-picture-is-read-off-its-own-bytes.test.ts`; this file
 * pins what the host and the wire add around them: the reasons a window is told (with the numbers
 * `too-large` and `too-many-pixels` carry), that Finder is handed a path and the window never is,
 * that the wire takes the id alone, that a quit refuses both, and that no agent tool reaches them.
 *
 * ⚑ The person's door is not scoped to a piece (HO-005, `readResourceForAPerson`'s reading): any id
 * this app kept is drawn, and an id it never kept is `no-such-resource`.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const SIXTEEN_MIB = 16 * 1024 * 1024

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

/** A PNG's signature and IHDR, saying `width` × `height`. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'latin1')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  bytes[24] = 8
  bytes[25] = 6
  return bytes
}

/** Prose stripped before anything is searched: a docblock naming a verb is not a tool. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('D-032 · a person draws a kept picture or PDF, and finds any kept file in Finder', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let counter: number
  let window: Window
  let clock: number
  let revealed: string[]
  const tick = (): number => clock++

  const hostOver = (withResources: boolean): RuntimeHost => {
    const sessions = new FakeProviderSessions()
    return new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      ...(withResources ? { resourcesRoot: () => resourcesRoot(userData) } : {}),
      revealPath: (path: string) => void revealed.push(path),
      createRuntime: () => new FakeRuntime('claude', { sessions }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d032-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-d032-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_800_000_000_000
    store = createSessionStore(db, tick)
    counter = 0
    revealed = []
    host = hostOver(true)
    window = new Window('webContents:1')
  })

  afterEach(async () => {
    if (!host.closing) await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: 'default', cwd: work, approvalMode: 'auto' },
      window,
    )
    return sessionId
  }

  const wrote = (name: string, body: string | Buffer): string => {
    const path = join(work, name)
    writeFileSync(path, body)
    return path
  }

  /** One file, kept on a piece of its own through `replyToParent`, and the id it was given. */
  const mustKeep = async (name: string, body: string | Buffer): Promise<string> => {
    const giver = await personOpens()
    const given = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'default',
        title: 'Draw the chart',
        brief: 'draw the chart',
      },
      { ownerId: agentCallerId(giver) },
    )
    if (!given.ok) throw new Error(`expected a give, got ${given.refusal.rail}`)
    const done = await host.replyToParent(
      {
        piece: given.label,
        outcome: 'done',
        summary: 'done it',
        resourcePaths: [wrote(name, body)],
        needsUserAction: false,
      },
      { ownerId: agentCallerId(given.owner) },
    )
    if (!done.ok) throw new Error(`refused: ${done.refusal.rail}`)
    const [resource] = done.resources
    if (resource === undefined) throw new Error('the reply kept no resource')
    return resource
  }

  const whereItIs = (resource: string): string => {
    const row = store.resource(resource)
    if (row === null) throw new Error(`no row for ${resource}`)
    return join(resourcesRoot(userData), row.sha256, row.name)
  }

  const reasonOf = (answer: ResourceDrawing | ResourceReveal): string =>
    answer.ok ? 'ok' : answer.reason

  describe('drawResourceForAPerson', () => {
    it('⚑ hands over the kept bytes, the type their opening says, the id and the name — and no path', async () => {
      const body = png(2, 3)
      const resource = await mustKeep('chart.jpg', body)
      const drawn = host.drawResourceForAPerson(resource)
      expect(drawn.ok, JSON.stringify(drawn)).toBe(true)
      if (!drawn.ok) return
      expect(drawn.resourceId).toBe(resource)
      expect(drawn.name).toBe('chart.jpg')
      // ⛔ A PNG saved as `.jpg` is drawn as what it is, never as what its name says.
      expect(drawn.drawnAs).toBe('image/png')
      expect(drawn.bytes).toEqual(new Uint8Array(body))
      expect(Object.keys(drawn).sort()).toEqual(['bytes', 'drawnAs', 'name', 'ok', 'resourceId'])
      expect(JSON.stringify({ ...drawn, bytes: null })).not.toContain(userData)
    })

    it('⛔ a page renamed `.png` is not handed over to be drawn, and a report is not drawn at all', async () => {
      const page = await mustKeep('page.png', '<!doctype html><script>parent.api</script>\n')
      expect(host.drawResourceForAPerson(page)).toEqual({
        ok: false,
        reason: 'not-what-its-name-says',
      })
      const report = await mustKeep('report.md', '# the answer\n')
      expect(host.drawResourceForAPerson(report)).toEqual({
        ok: false,
        reason: 'not-a-picture-or-pdf',
      })
      // The control: a kept PDF is drawn as one.
      const pdf = await mustKeep('report.pdf', Buffer.from('%PDF-1.7\n%%EOF\n', 'latin1'))
      const drawn = host.drawResourceForAPerson(pdf)
      expect(drawn.ok && drawn.drawnAs).toBe('application/pdf')
    })

    it('⚠️ `too-large` carries the row’s size and the bound, at one byte past 16 MiB — and not at 16 MiB', async () => {
      const resource = await mustKeep('big.png', png(1, 1))
      const setBytes = (bytes: number): void =>
        void db.prepare('UPDATE work_resource SET bytes = ? WHERE id = ?').run(bytes, resource)
      setBytes(SIXTEEN_MIB + 1)
      expect(host.drawResourceForAPerson(resource)).toEqual({
        ok: false,
        reason: 'too-large',
        bytes: SIXTEEN_MIB + 1,
        mostBytes: SIXTEEN_MIB,
      })
      setBytes(SIXTEEN_MIB)
      expect(reasonOf(host.drawResourceForAPerson(resource))).toBe('ok')
    })

    it('⚠️ `too-many-pixels` carries the width, the height and the bound — past 8192 × 8192 only', async () => {
      const over = await mustKeep('bomb.png', png(8193, 8192))
      expect(host.drawResourceForAPerson(over)).toEqual({
        ok: false,
        reason: 'too-many-pixels',
        width: 8193,
        height: 8192,
        mostPixels: 8192 * 8192,
      })
      const at = await mustKeep('edge.png', png(8192, 8192))
      expect(reasonOf(host.drawResourceForAPerson(at))).toBe('ok')
    })

    it('⚑ bytes that changed are `changed`, and a file that is gone is `unreadable`', async () => {
      const changed = await mustKeep('changed.png', png(4, 4))
      writeFileSync(whereItIs(changed), png(5, 5))
      expect(host.drawResourceForAPerson(changed)).toEqual({ ok: false, reason: 'changed' })
      const gone = await mustKeep('gone.png', png(6, 6))
      rmSync(whereItIs(gone))
      expect(host.drawResourceForAPerson(gone)).toEqual({ ok: false, reason: 'unreadable' })
    })

    it('⛔ an id this app never kept is `no-such-resource`; a host with no folder is `no-store`', async () => {
      await mustKeep('real.png', png(1, 1))
      expect(host.drawResourceForAPerson('res_nothing-kept-this')).toEqual({
        ok: false,
        reason: 'no-such-resource',
      })
      const rootless = hostOver(false)
      try {
        expect(rootless.drawResourceForAPerson('res_anything')).toEqual({
          ok: false,
          reason: 'no-store',
        })
        expect(rootless.revealResource('res_anything')).toEqual({ ok: false, reason: 'no-store' })
      } finally {
        await rootless.closeAll()
      }
      expect(revealed).toEqual([])
    })
  })

  describe('revealResource', () => {
    it('⚑ hands Finder the kept file’s own place, and the window only `ok` and `changed`', async () => {
      const resource = await mustKeep('notes.md', '# any kept file, not only a picture\n')
      const shown = host.revealResource(resource)
      expect(shown).toEqual({ ok: true, changed: false })
      expect(revealed).toEqual([whereItIs(resource)])
      expect(JSON.stringify(shown)).not.toContain(userData)
    })

    it('🔴 a file whose bytes changed is still shown, and the answer says so', async () => {
      const resource = await mustKeep('chart.png', png(1, 1))
      writeFileSync(whereItIs(resource), 'somebody edited it\n')
      expect(host.revealResource(resource)).toEqual({ ok: true, changed: true })
      expect(revealed).toEqual([whereItIs(resource)])
    })

    it('⛔ a file that is gone, or a folder at its place, is not shown — and Finder is not asked', async () => {
      const gone = await mustKeep('gone.png', png(1, 1))
      rmSync(whereItIs(gone))
      expect(host.revealResource(gone)).toEqual({ ok: false, reason: 'gone' })
      const folder = await mustKeep('folder.png', png(2, 2))
      rmSync(whereItIs(folder))
      mkdirSync(whereItIs(folder))
      expect(host.revealResource(folder)).toEqual({ ok: false, reason: 'unreadable' })
      expect(host.revealResource('res_nothing-kept-this')).toEqual({
        ok: false,
        reason: 'no-such-resource',
      })
      expect(revealed).toEqual([])
    })
  })

  describe('the wire: `drawResource` and `revealResource`', () => {
    it('⚑ each command reaches its own door', async () => {
      const resource = await mustKeep('chart.png', png(3, 2))
      const drawn = (await executeRuntimeCommand(host, window, {
        kind: 'drawResource',
        resourceId: resource,
      })) as ResourceDrawing
      expect(drawn.ok && drawn.drawnAs).toBe('image/png')
      expect(revealed, 'drawing a file does not show it in Finder').toEqual([])
      const shown = (await executeRuntimeCommand(host, window, {
        kind: 'revealResource',
        resourceId: resource,
      })) as ResourceReveal
      expect(shown).toEqual({ ok: true, changed: false })
      expect(revealed).toEqual([whereItIs(resource)])
    })

    it('⛔ strict: the id alone — a type, a path or an empty or overlong id is refused before any door', async () => {
      const resource = await mustKeep('chart.png', png(1, 1))
      for (const kind of ['drawResource', 'revealResource'] as const) {
        expect(runtimeCommandSchema.safeParse({ kind, resourceId: resource }).success).toBe(true)
        expect(runtimeCommandSchema.safeParse({ kind, resourceId: 'r'.repeat(200) }).success).toBe(
          true,
        )
        for (const refused of [
          { kind, resourceId: resource, drawnAs: 'text/html' },
          { kind, resourceId: resource, path: '/etc/hosts' },
          { kind, resourceId: resource, sessionId: 'sess_1' },
          { kind, resourceId: '' },
          { kind, resourceId: 'r'.repeat(201) },
          { kind, resourceId: 7 },
          { kind },
        ]) {
          await expect(
            executeRuntimeCommand(host, window, refused),
            JSON.stringify(refused),
          ).rejects.toThrow(/invalid runtime command/)
        }
      }
      expect(revealed).toEqual([])
    })

    it('⛔ refused during a quit, on a real host, and Finder is not asked', async () => {
      const resource = await mustKeep('chart.png', png(1, 1))
      // The control: answered while the app runs.
      const before = (await executeRuntimeCommand(host, window, {
        kind: 'drawResource',
        resourceId: resource,
      })) as ResourceDrawing
      expect(before.ok).toBe(true)
      await host.closeAll()
      expect(host.closing).toBe(true)
      for (const kind of ['drawResource', 'revealResource'] as const) {
        await expect(
          executeRuntimeCommand(host, window, { kind, resourceId: resource }),
        ).rejects.toThrow(refusedDuringAQuit(kind))
      }
      expect(revealed).toEqual([])
    })

    it('⛔ no agent tool reaches either door', () => {
      const tools = code(readFileSync(join(here, '../src/main/runtime/agent-tools.ts'), 'utf8'))
      // The positive: this is the file the toolset is written in.
      expect(tools).toContain('give_work')
      for (const name of [
        'drawResource',
        'revealResource',
        'draw_resource',
        'reveal_resource',
        'keptPictureOrPdf',
        'keptFileToShow',
      ]) {
        expect(tools.toLowerCase(), `an agent tool names ${name}`).not.toContain(name.toLowerCase())
      }
    })
  })
})
