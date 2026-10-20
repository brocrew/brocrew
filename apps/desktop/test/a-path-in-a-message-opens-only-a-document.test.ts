import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import {
  messagePathOf,
  openMessagePath,
  OPENS_IN_ITS_APP,
  resolveMessagePaths,
  revealMessagePath,
  THIS_COMPUTER,
  type MessagePathPlace,
} from '../src/main/message-paths'
import { readProviderConfig } from '../src/main/runtime/provider-config'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { ClosableHistoryReader } from '../src/main/recovery/history-reader'
import { createRecoveryCalls } from '../src/main/recovery/window-calls'
import {
  RECOVERY_CHANNELS,
  type HistoryOnlyGate,
  type StartupVerdict,
} from '../src/shared/recovery'
import { createFakeRecoveryService } from './recovery/lib/fake-recovery-service'

/**
 * A path a message wrote: main resolves it, and a press opens it only when it is a document on the
 * allowlist; a folder, a program, a script, a shortcut or an app bundle is only shown. Real files in
 * a scratch folder, and a scratch home; nothing is opened or shown for real.
 */

let root: string
let work: string
let home: string
let place: MessagePathPlace

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-message-paths-')))
  work = join(root, 'work')
  home = join(root, 'home')
  mkdirSync(join(work, 'reports'), { recursive: true })
  mkdirSync(home, { recursive: true })
  place = { ...THIS_COMPUTER, home }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const file = (at: string, text = 'x'): string => {
  mkdirSync(dirname(at), { recursive: true })
  writeFileSync(at, text)
  return at
}

/** A press, with both doors recorded. */
async function press(text: string, folder: string | null, failsWith = '') {
  const opened: string[] = []
  const shown: string[] = []
  const did = await openMessagePath(text, folder, place, {
    open: async (real) => {
      opened.push(real)
      return failsWith
    },
    reveal: (absolute) => shown.push(absolute),
  })
  return { did, opened, shown }
}

describe('what a message’s text names', () => {
  it('a relative path from the conversation’s folder, ~ from the home, and an absolute one', async () => {
    file(join(work, 'reports', 'notes.md'))
    file(join(home, 'todo.txt'))
    const outside = file(join(root, 'elsewhere', 'plan.pdf'))
    const read = await resolveMessagePaths(
      ['reports/notes.md', '~/todo.txt', outside, 'reports'],
      work,
      place,
      { mayOpen: true },
    )
    expect(read).toEqual([
      {
        text: 'reports/notes.md',
        found: true,
        absolute: join(work, 'reports', 'notes.md'),
        name: 'notes.md',
        kind: 'file',
        opens: true,
      },
      {
        text: '~/todo.txt',
        found: true,
        absolute: join(home, 'todo.txt'),
        name: 'todo.txt',
        kind: 'file',
        opens: true,
      },
      // Outside the working folder still resolves: a person may open any file of theirs.
      {
        text: outside,
        found: true,
        absolute: outside,
        name: 'plan.pdf',
        kind: 'file',
        opens: true,
      },
      {
        text: 'reports',
        found: true,
        absolute: join(work, 'reports'),
        name: 'reports',
        kind: 'folder',
        opens: false,
      },
    ])
  })

  it('a missing file, a relative path with no folder, ~user and empty text name nothing', async () => {
    file(join(work, 'here.md'))
    const read = await resolveMessagePaths(
      ['reports/missing.md', '~root/x.md', '   '],
      work,
      place,
      { mayOpen: true },
    )
    expect(read.map((one) => one.found)).toEqual([false, false, false])
    const noFolder = await resolveMessagePaths(['here.md'], null, place, { mayOpen: true })
    expect(noFolder).toEqual([{ text: 'here.md', found: false }])
    expect(await press('reports/missing.md', work)).toMatchObject({
      did: { ok: false, reason: 'gone' },
      opened: [],
      shown: [],
    })
    expect(await press('~root/x.md', work)).toMatchObject({ did: { ok: false, reason: 'no-path' } })
  })

  it('Windows paths: a drive, ~\\ and a relative path from the folder; never a share or a device', () => {
    const windows = { home: 'C:\\Users\\ada', platform: 'win32' as const }
    expect(messagePathOf('C:\\Users\\ada\\notes.md', null, windows)).toBe(
      'C:\\Users\\ada\\notes.md',
    )
    expect(messagePathOf('D:/reports/plan.pdf', null, windows)).toBe('D:\\reports\\plan.pdf')
    expect(messagePathOf('~\\Documents\\notes.md', null, windows)).toBe(
      'C:\\Users\\ada\\Documents\\notes.md',
    )
    expect(messagePathOf('reports\\notes.md', 'C:\\work', windows)).toBe(
      'C:\\work\\reports\\notes.md',
    )
    // Reading these to draw a message would reach the network or a device before any press; a
    // path without its drive's root, or with a stream after a colon, names no file of the folder's.
    for (const text of [
      '\\\\server\\share\\plan.pdf',
      '//server/share/plan.pdf',
      '\\\\?\\C:\\work\\notes.md',
      '\\\\?\\UNC\\server\\share\\notes.md',
      '\\\\.\\pipe\\brobot',
      '\\notes.md',
      'C:notes.md',
      'C:\\work\\run.bat:.md',
      'notes.txt:x.md',
      '~\\notes.txt:x.md',
      'file:notes.md',
    ]) {
      expect(messagePathOf(text, 'C:\\work', windows), text).toBeNull()
    }
    // …and a Windows path on a Mac is no path there.
    expect(
      messagePathOf('C:\\Users\\ada\\notes.md', null, { ...place, platform: 'darwin' }),
    ).toBeNull()
  })

  it('Windows: a program or script is only shown, a document opens', async () => {
    const kinds: Record<string, 'file' | 'folder'> = {
      'C:\\work\\run.exe': 'file',
      'C:\\work\\run.bat': 'file',
      'C:\\work\\run.ps1': 'file',
      'C:\\work\\plan.docx': 'file',
      'C:\\work\\Docs': 'folder',
    }
    const windows: MessagePathPlace = {
      home: 'C:\\Users\\ada',
      platform: 'win32',
      fs: {
        lstat: async (at) => {
          const kind = kinds[at]
          if (kind === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
          return {
            isFile: () => kind === 'file',
            isDirectory: () => kind === 'folder',
            mode: 0o755,
          }
        },
        realpath: async (at) => at,
      },
    }
    const read = await resolveMessagePaths(
      ['run.exe', 'run.bat', 'run.ps1', 'plan.docx', 'Docs', 'gone.md'],
      'C:\\work',
      windows,
      { mayOpen: true },
    )
    expect(read.map((one) => (one.found ? one.opens : 'missing'))).toEqual([
      false,
      false,
      false,
      true,
      false,
      'missing',
    ])
  })
})

describe('what a press does', () => {
  it('opens a document on the allowlist, by the path it was judged by', async () => {
    file(join(work, 'reports', 'notes.md'))
    expect(await press('reports/notes.md', work)).toEqual({
      did: { ok: true, did: 'opened' },
      opened: [join(work, 'reports', 'notes.md')],
      shown: [],
    })
    // The computer refusing to open it is said as such.
    expect((await press('reports/notes.md', work, 'no app for it')).did).toEqual({
      ok: false,
      reason: 'failed',
    })
  })

  it('only shows a program, a script, a shortcut, a web page, an SVG and an app bundle', async () => {
    const names = ['run.command', 'run.sh', 'run.exe', 'run.bat', 'run.ps1', 'link.webloc']
    for (const name of [...names, 'page.html', 'picture.svg']) file(join(work, name))
    mkdirSync(join(work, 'Thing.app', 'Contents'), { recursive: true })
    for (const name of [...names, 'page.html', 'picture.svg', 'Thing.app']) {
      const read = await resolveMessagePaths([name], work, place, { mayOpen: true })
      expect(read[0], name).toMatchObject({ found: true, opens: false })
      expect(await press(name, work), name).toEqual({
        did: { ok: true, did: 'shown' },
        opened: [],
        shown: [join(work, name)],
      })
    }
    for (const type of [
      'command',
      'sh',
      'exe',
      'bat',
      'ps1',
      'app',
      'webloc',
      'html',
      'svg',
      'doc',
      'xls',
      'ppt',
      'rtf',
    ]) {
      expect(OPENS_IN_ITS_APP.has(type), type).toBe(false)
    }
  })

  it('a link is judged by where it leads: a document name over a program is only shown', async () => {
    const program = file(join(work, 'run.command'), '#!/bin/sh\n')
    symlinkSync(program, join(work, 'notes.md'))
    expect(
      (await resolveMessagePaths(['notes.md'], work, place, { mayOpen: true }))[0],
    ).toMatchObject({ found: true, kind: 'file', opens: false })
    expect(await press('notes.md', work)).toEqual({
      did: { ok: true, did: 'shown' },
      opened: [],
      shown: [join(work, 'notes.md')],
    })
    // …and a program's name over a document opens the document it leads to, not the link.
    const doc = file(join(work, 'real.md'))
    symlinkSync(doc, join(work, 'script.command'))
    expect(await press('script.command', work)).toEqual({
      did: { ok: true, did: 'opened' },
      opened: [doc],
      shown: [],
    })
  })

  // Windows does not use POSIX execute bits to decide whether a document can run.
  it.skipIf(process.platform === 'win32')(
    'a document someone may run is only shown: the app that opens it can be set on the file',
    async () => {
      const notes = file(join(work, 'notes.md'))
      chmodSync(notes, 0o755)
      expect(
        (await resolveMessagePaths(['notes.md'], work, place, { mayOpen: true }))[0],
      ).toMatchObject({ found: true, kind: 'file', opens: false })
      expect(await press('notes.md', work)).toEqual({
        did: { ok: true, did: 'shown' },
        opened: [],
        shown: [notes],
      })
    },
  )

  it('is judged again at the press: a document swapped for a program since is only shown', async () => {
    const notes = file(join(work, 'notes.md'))
    expect(
      (await resolveMessagePaths(['notes.md'], work, place, { mayOpen: true }))[0],
    ).toMatchObject({ opens: true })
    rmSync(notes)
    symlinkSync(file(join(work, 'run.sh')), notes)
    expect((await press('notes.md', work)).opened).toEqual([])
  })

  it('show is always only a show, of the path as written', async () => {
    file(join(work, 'notes.md'))
    const shown: string[] = []
    expect(await revealMessagePath('notes.md', work, place, (at) => shown.push(at))).toEqual({
      ok: true,
      path: join(work, 'notes.md'),
    })
    expect(shown).toEqual([join(work, 'notes.md')])
    expect(await revealMessagePath('missing.md', work, place, (at) => shown.push(at))).toEqual({
      ok: false,
      reason: 'gone',
    })
    expect(await revealMessagePath('~nobody', work, place, (at) => shown.push(at))).toEqual({
      ok: false,
      reason: 'no-path',
    })
  })

  it('where a window may only show, nothing opens', async () => {
    file(join(work, 'notes.md'))
    expect(
      (await resolveMessagePaths(['notes.md'], work, place, { mayOpen: false }))[0],
    ).toMatchObject({ found: true, opens: false })
  })
})

describe('through the host: a relative path is read from that conversation’s own folder', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  const shown: string[] = []
  const opened: string[] = []

  class NullSink implements RuntimeEventSink {
    readonly aPersonIsBehindIt = false
    readonly ownerId = 'owner:1'
    readonly alive = true
    send(): void {}
    sendLiveness(): void {}
  }

  beforeEach(() => {
    userData = join(root, 'user-data')
    const providerHome = join(userData, 'provider-homes', 'codex')
    mkdirSync(providerHome, { recursive: true })
    shown.length = 0
    opened.length = 0
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
    let counter = 0
    host = new RuntimeHost({
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: () => providerHome,
      providerHomePath: () => providerHome,
      resolveCwd: (_sessionId, requested) => requested ?? work,
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig,
      revealPath: (at) => shown.push(at),
      openPath: async (at) => {
        opened.push(at)
        return ''
      },
      messagePathPlace: place,
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
  })

  it('a live conversation and an ended one both read their own folder; no conversation reads none', async () => {
    file(join(work, 'reports', 'notes.md'))
    const sink = new NullSink()
    const created = await host.createSession({ provider: 'codex', cwd: work }, sink)
    const ask = { sessionId: created.sessionId, texts: ['reports/notes.md'] }
    expect((await host.resolveMessagePaths(ask))[0]).toMatchObject({ found: true, opens: true })
    await host.close(created.sessionId, sink)
    expect((await host.resolveMessagePaths(ask))[0]).toMatchObject({ found: true, opens: true })
    expect(
      await host.openMessagePath({ sessionId: created.sessionId, text: 'reports/notes.md' }),
    ).toEqual({ ok: true, did: 'opened' })
    expect(opened).toEqual([join(work, 'reports', 'notes.md')])
    expect(await host.revealMessagePath({ sessionId: created.sessionId, text: 'reports' })).toEqual(
      { ok: true, path: join(work, 'reports') },
    )
    expect(shown).toEqual([join(work, 'reports')])
    expect(
      (await host.resolveMessagePaths({ sessionId: null, texts: ['reports/notes.md'] }))[0],
    ).toEqual({ text: 'reports/notes.md', found: false })
    expect(
      (
        await host.resolveMessagePaths({ sessionId: 'sess_nobody', texts: ['reports/notes.md'] })
      )[0],
    ).toEqual({ text: 'reports/notes.md', found: false })
  })
})

describe('the recovery window: a restored copy’s paths are read and shown, never opened', () => {
  const GATE: HistoryOnlyGate = {
    format: 'brobot-history-only',
    version: 1,
    restoreId: '6a3e3c1d-55c8-4e36-9c40-0e9b7a0d7b21',
    checkpointId: '0b5f0a3e-1c1a-4d55-9a54-6f3a8e1f2c11',
    checkpointCreatedAt: '2026-10-05T09:00:00.000Z',
    installed: [{ live: 'brobot2.sqlite', present: true, sha256: 'a'.repeat(64) }],
    preserved: 'recovery/preserved/6a3e3c1d-55c8-4e36-9c40-0e9b7a0d7b21',
    preservedFiles: [{ live: 'brobot2.sqlite', present: true, sha256: 'b'.repeat(64) }],
  }
  const NEWER: StartupVerdict = {
    kind: 'newer',
    workspace: '/data',
    newer: { inTheDatabase: 8, inTheBuild: 7, madeBy: { appVersion: '0.2.0' } },
    offers: { id: GATE.checkpointId, createdAt: GATE.checkpointCreatedAt, bytes: 4096 },
  }
  const HISTORY_ONLY: StartupVerdict = {
    kind: 'history-only',
    gate: GATE,
    database: '/data/brobot2.sqlite',
  }

  function calls(verdict: StartupVerdict, shown: string[]) {
    return createRecoveryCalls({
      service: createFakeRecoveryService({ inspect: verdict }),
      verdict,
      openReader: (): ClosableHistoryReader => ({
        conversations: () => Promise.resolve([]),
        transcript: () => Promise.resolve([]),
        workingFolder: (id) => Promise.resolve(id === 'conversation-1' ? work : null),
        close: () => {},
      }),
      zone: () => null,
      sendVerdict: () => {},
      sendProgress: () => {},
      quit: () => {},
      relaunch: () => {},
      reveal: (at) => shown.push(at),
      place,
    })
  }

  it('reads from the conversation’s folder in the copy, and every answer is show-only', async () => {
    file(join(work, 'reports', 'notes.md'))
    const shown: string[] = []
    const window = calls(HISTORY_ONLY, shown)
    expect(
      await window.answer(RECOVERY_CHANNELS.messagePaths, [
        { sessionId: 'conversation-1', texts: ['reports/notes.md', 'reports'] },
      ]),
    ).toEqual([
      {
        text: 'reports/notes.md',
        found: true,
        absolute: join(work, 'reports', 'notes.md'),
        name: 'notes.md',
        kind: 'file',
        opens: false,
      },
      {
        text: 'reports',
        found: true,
        absolute: join(work, 'reports'),
        name: 'reports',
        kind: 'folder',
        opens: false,
      },
    ])
    expect(
      await window.answer(RECOVERY_CHANNELS.revealMessagePath, [
        { sessionId: 'conversation-1', text: 'reports/notes.md' },
      ]),
    ).toEqual({ ok: true, path: join(work, 'reports', 'notes.md') })
    expect(shown).toEqual([join(work, 'reports', 'notes.md')])
  })

  it('answers only while a restored copy is open, and refuses what is not a message’s path', async () => {
    const shown: string[] = []
    await expect(
      calls(NEWER, shown).answer(RECOVERY_CHANNELS.messagePaths, [
        { sessionId: null, texts: ['/tmp'] },
      ]),
    ).rejects.toThrow('There is no restored copy to read now.')
    const window = calls(HISTORY_ONLY, shown)
    for (const ask of [
      undefined,
      { sessionId: null, texts: 'notes.md' },
      { sessionId: null, texts: Array.from({ length: 51 }, () => 'a.md') },
      { sessionId: null, texts: ['x'.repeat(1025)] },
      { sessionId: 42, texts: ['a.md'] },
    ]) {
      await expect(window.answer(RECOVERY_CHANNELS.messagePaths, [ask])).rejects.toThrow(
        'That is not a path from a message.',
      )
    }
    await expect(
      window.answer(RECOVERY_CHANNELS.revealMessagePath, [{ sessionId: null, text: '' }]),
    ).rejects.toThrow('That is not a path from a message.')
    expect(shown).toEqual([])
  })
})
