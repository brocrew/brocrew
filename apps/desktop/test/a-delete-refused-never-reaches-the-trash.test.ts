import { spawn, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteVerdict,
  deleteWorkspace,
  whereDeletedFoldersGo,
  type DeleteContext,
} from '../src/main/delete-workspace'
import { whoIsOn } from '../src/main/one-host-gate'
import { pastedImagesRoot } from '../src/main/runtime/pasted-image'
import { readWorkspaceList, rememberWorkspace } from '../src/main/workspaces'

/**
 * 🔴 **W4.154 · F092 — every refusal of a delete, through the DELETE itself, each beside the case one
 * fact over that goes** (`delete-workspace.ts`). `delete-workspace.test.ts` asks most refusals of
 * `deleteVerdict` alone; here each one is asked of `deleteWorkspace` too, and the Trash it is handed
 * says whether it was ever reached.
 *
 *  - §1 · the two never deleted, reached by a link or by macOS's Data-volume spelling, unlisted.
 *  - §2 · open: a live process holding the one-host gate; Chromium's lock naming a live process, a
 *    process of another account, no process; on Windows the gate alone, and its own words.
 *  - §3 · not in the list; listed by more than one spelling — every one leaves the list.
 *  - §4 · not BroBot's: five names and how many more; a link inside is never followed.
 *  - §5 · the anchor, through a link and through the Data-volume spelling.
 *  - §6 · a workspace that holds this window's one, or sits inside it or the Default; a listed one
 *    inside the folder a link lists.
 *  - §7 · what only the delete asks: the folder gone before the move, its pasted pictures changed
 *    or refused by the Trash, a list that cannot be written.
 *
 * ⛔ **The Trash is a FAKE**: a function that records what it was handed and moves nothing. Electron
 * and its `shell` are never imported. ⛔ It refuses — and records — anything outside the test's own
 * `mkdtempSync(tmpdir())` throwaway, so a test that reached one would fail, never move it. Every
 * folder, home and environment is a throwaway one (`env: {}`), and every root is removed after.
 */

const DATA_VOLUME = '/System/Volumes/Data'
const hasDataVolume = process.platform === 'darwin' && existsSync(`${DATA_VOLUME}/private`)
const posix = process.platform !== 'win32'

const OPEN = 'This workspace is open. Quit it first, then delete it.'
const LOCK_UNREADABLE =
  'BroCrew cannot read this workspace’s lock, so it cannot tell whether it is open. If nothing has it open, delete the folder yourself.'
const GATE_CANNOT_SAY =
  'BroCrew cannot tell whether this workspace is open. Quit it if it is, then try again.'

const roots: string[] = []
const children: ChildProcess[] = []

/** A child process gone, waited on for 5 s at most. */
async function gone(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((settle) => {
    const timer = setTimeout(settle, 5_000)
    child.once('exit', () => {
      clearTimeout(timer)
      settle()
    })
    child.kill('SIGKILL')
  })
}

afterEach(async () => {
  for (const child of children.splice(0)) await gone(child)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A throwaway root, by its real path; short, so a gate's socket path inside it fits. */
function aRoot(): string {
  const made = realpathSync(mkdtempSync(join(tmpdir(), 'bbdel-')))
  roots.push(made)
  return made
}

/** A workspace as a launch leaves it: BroBot's files and its browser's (`delete-workspace.test.ts`'s). */
function aWorkspace(parent: string, name: string): string {
  const folder = join(parent, name)
  mkdirSync(join(folder, 'provider-homes', 'default', 'brobot', 'claude'), { recursive: true })
  mkdirSync(join(folder, 'brobot-workspace'), { recursive: true })
  mkdirSync(join(folder, 'Cache'), { recursive: true })
  writeFileSync(join(folder, 'brobot2.sqlite'), 'x'.repeat(100))
  writeFileSync(join(folder, 'provider-homes', 'default', 'brobot', 'claude', 'a.json'), '{}')
  writeFileSync(join(folder, 'brobot-workspace', 'CLAUDE.md'), 'hello')
  writeFileSync(join(folder, 'Cache', 'data_0'), 'y'.repeat(50))
  writeFileSync(join(folder, 'Local State'), '{}')
  writeFileSync(join(folder, 'workspace.json'), '{"name":"Try"}')
  return folder
}

/** The facts a delete is checked against — all of them throwaway; the default and this one listed. */
function aContext(
  root: string,
  listed: readonly string[],
  more: Partial<DeleteContext> = {},
): DeleteContext {
  const thisOne = join(root, 'this')
  const defaultFolder = join(root, 'default')
  for (const one of [thisOne, defaultFolder]) {
    if (!existsSync(one)) aWorkspace(root, basename(one))
  }
  for (const one of ['home', 'cwd']) mkdirSync(join(root, one), { recursive: true })
  return {
    listed: [defaultFolder, thisOne, ...listed],
    thisOne,
    defaultFolder,
    home: join(root, 'home'),
    env: {},
    cwd: join(root, 'cwd'),
    platform: process.platform,
    ask: async () => 'closed',
    outOfReach: () => null,
    ...more,
  }
}

/**
 * ⛔ **The fake Trash**: it records what it is handed and moves nothing. A folder outside `root` (in
 * either of macOS's spellings) is recorded and refused, so no test can pass having reached one.
 * `hook` runs on each call, after it is recorded, and may throw to play a Trash that refuses.
 */
function aFakeTrash(root: string, hook: (folder: string, call: number) => void = () => {}) {
  const taken: string[] = []
  const trash = async (folder: string): Promise<void> => {
    taken.push(folder)
    const plain = folder.startsWith(`${DATA_VOLUME}/`) ? folder.slice(DATA_VOLUME.length) : folder
    if (!plain.startsWith(`${root}${sep}`)) {
      throw new Error(`the fake Trash was handed a folder outside the throwaway root: ${folder}`)
    }
    hook(folder, taken.length)
  }
  return { taken, trash }
}

/** A delete, with the fake Trash and a list file of the throwaway root's own. */
async function aDelete(
  asked: string,
  context: DeleteContext,
  root: string,
  options: { listFile?: string; hook?: (folder: string, call: number) => void } = {},
) {
  const { taken, trash } = aFakeTrash(root, options.hook)
  const listFile = options.listFile ?? join(root, 'workspaces.json')
  const answer = await deleteWorkspace(asked, { ...context, trash, listFile, now: 2 })
  return { answer, taken, listFile }
}

/** ⛔ Refused in these words by the check AND by the delete — and the Trash never handed anything. */
async function refusedBoth(
  asked: string,
  context: DeleteContext,
  root: string,
  words: string,
): Promise<void> {
  expect(await deleteVerdict(asked, context), asked).toEqual({ ok: false, refusal: words })
  const { answer, taken } = await aDelete(asked, context, root)
  expect(answer, asked).toEqual({ deleted: false, refusal: words })
  expect(taken, asked).toEqual([])
}

/** ⚑ The pair: the check says it may go, and the delete hands the Trash exactly `path`, once. */
async function goesToTheTrash(
  asked: string,
  context: DeleteContext,
  root: string,
  path: string,
): Promise<void> {
  expect(await deleteVerdict(asked, context), asked).toMatchObject({ ok: true, path })
  const { answer, taken } = await aDelete(asked, context, root)
  expect(answer, asked).toEqual({ deleted: true, trashed: [path], warning: null })
  expect(taken, asked).toEqual([path])
}

/** A node process of the test's own, alive until it is killed; `script` prints `ready` once set. */
async function aLiveProcess(script: string, ...args: string[]): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['-e', script, ...args], {
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, NODE_OPTIONS: '' },
  })
  children.push(child)
  await new Promise<void>((settle, fail) => {
    const timer = setTimeout(() => fail(new Error('the process was not ready in 10 s')), 10_000)
    child.stdout?.once('data', () => {
      clearTimeout(timer)
      settle()
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      fail(new Error(`the process ended before it was ready (${String(code)})`))
    })
  })
  return child
}

/** ⚑ A live process answering at `folder`'s one-host gate, as a running BroBot answers. */
const aGateHolder = (folder: string): Promise<ChildProcess> =>
  aLiveProcess(
    "const s = require('node:net').createServer((c) => c.end('held-by-a-test')); s.listen(process.argv[1], () => process.stdout.write('ready\\n'))",
    join(folder, 'one-host.sock'),
  )

/** A live process that only waits. */
const aSleeper = (): Promise<ChildProcess> =>
  aLiveProcess("setInterval(() => {}, 1000); process.stdout.write('ready\\n')")

/** Chromium's lock, naming `host` and `pid`. */
function aLock(folder: string, said: string): void {
  const lock = join(folder, 'SingletonLock')
  // ⚑ The lock is a link that usually dangles: unlink the link itself (rmSync follows it).
  try {
    unlinkSync(lock)
  } catch {
    // none there yet
  }
  symlinkSync(said, lock)
}

describe('§1 · the two never deleted, by what they are — however they are reached', () => {
  it('⛔ a link nobody listed to this window’s workspace, or to the Default: refused, the Trash never reached; a link to another workspace goes', async () => {
    const root = aRoot()
    const context = aContext(root, [])
    // ⚑ A hidden launch lists neither: they are named by what they are, before the list is read.
    const unlisted = { ...context, listed: [] }
    const toThis = join(root, 'to-this')
    const toDefault = join(root, 'to-default')
    symlinkSync(context.thisOne, toThis)
    symlinkSync(context.defaultFolder, toDefault)
    await refusedBoth(toThis, unlisted, root, 'This is the workspace this window runs on.')
    await refusedBoth(toDefault, unlisted, root, 'The Default workspace cannot be deleted.')
    // ⚑ The pair: a link to a workspace that is neither — the folder goes, never the link.
    const other = aWorkspace(root, 'other')
    const toOther = join(root, 'to-other')
    symlinkSync(other, toOther)
    await goesToTheTrash(toOther, aContext(root, [toOther]), root, other)
  })

  it.skipIf(!hasDataVolume)(
    '⛔ this window’s workspace and the Default by macOS’s Data-volume spelling, unlisted: refused; another workspace so spelled goes, as the list spells it',
    async () => {
      const root = aRoot()
      const context = aContext(root, [])
      const unlisted = { ...context, listed: [] }
      await refusedBoth(
        `${DATA_VOLUME}${context.thisOne}`,
        unlisted,
        root,
        'This is the workspace this window runs on.',
      )
      await refusedBoth(
        `${DATA_VOLUME}${context.defaultFolder}`,
        unlisted,
        root,
        'The Default workspace cannot be deleted.',
      )
      const other = aWorkspace(root, 'other')
      await goesToTheTrash(`${DATA_VOLUME}${other}`, aContext(root, [other]), root, other)
    },
  )
})

describe('§2 · open', () => {
  it.skipIf(!posix)(
    '⛔ a live process holds its one-host gate: refused by the check and the delete; that process gone, the same folder goes',
    async () => {
      const root = aRoot()
      const folder = aWorkspace(root, 'g')
      const context = aContext(root, [folder], { ask: (one) => whoIsOn(one) })
      const holder = await aGateHolder(folder)
      expect(await whoIsOn(folder)).toBe('open')
      await refusedBoth(folder, context, root, OPEN)
      // ⚑ The kernel is the release: its socket's path stays, and nothing answers there.
      await gone(holder)
      expect(await whoIsOn(folder)).toBe('closed')
      await goesToTheTrash(folder, context, root, folder)
    },
  )

  it.skipIf(!posix)(
    '⛔ a silent gate, and Chromium’s lock naming a live process here: refused; the same lock once that process has exited: it goes',
    async () => {
      const root = aRoot()
      const folder = aWorkspace(root, 'locked')
      const context = aContext(root, [folder])
      const sleeper = await aSleeper()
      aLock(folder, `${hostname()}-${String(sleeper.pid)}`)
      await refusedBoth(folder, context, root, OPEN)
      await gone(sleeper)
      await goesToTheTrash(folder, context, root, folder)
    },
  )

  it.skipIf(!posix)(
    '⛔ a lock naming a process it may not signal (pid 1) is open; a lock naming pid 0 cannot be read; no lock: it goes',
    async () => {
      const root = aRoot()
      const folder = aWorkspace(root, 'pid')
      const context = aContext(root, [folder])
      // ⚑ pid 1 is alive on every system: EPERM for an account that may not signal it, and alive for
      // one that may — open either way, and never taken as a process that has gone.
      aLock(folder, `${hostname()}-1`)
      await refusedBoth(folder, context, root, OPEN)
      aLock(folder, `${hostname()}-0`)
      await refusedBoth(folder, context, root, LOCK_UNREADABLE)
      unlinkSync(join(folder, 'SingletonLock'))
      await goesToTheTrash(folder, context, root, folder)
    },
  )

  it('⛔ on Windows the gate alone decides: one that cannot say is refused in its own words, and one that says closed lets it go, whatever a lock says', async () => {
    const root = aRoot()
    const folder = aWorkspace(root, 'win')
    const unclear = aContext(root, [folder], { platform: 'win32', ask: async () => 'unknown' })
    await refusedBoth(folder, unclear, root, GATE_CANNOT_SAY)
    // ⚑ The lock is not read on Windows: one naming this live process changes nothing there.
    if (posix) aLock(folder, `${hostname()}-${String(process.pid)}`)
    const closed = aContext(root, [folder], { platform: 'win32', ask: async () => 'closed' })
    await goesToTheTrash(folder, closed, root, folder)
  })

  it('⚑ open is said before what it holds: an open workspace with a person’s file at its top is told it is open', async () => {
    const root = aRoot()
    const folder = aWorkspace(root, 'busy')
    writeFileSync(join(folder, 'letter.txt'), 'dear')
    await refusedBoth(folder, aContext(root, [folder], { ask: async () => 'open' }), root, OPEN)
  })
})

describe('§3 · the list', () => {
  it('⛔ a folder not in the list: refused, the Trash never reached; the same folder listed goes', async () => {
    const root = aRoot()
    const folder = aWorkspace(root, 'stray')
    await refusedBoth(
      folder,
      aContext(root, []),
      root,
      `This folder is not in the list of workspaces: ${folder}`,
    )
    await goesToTheTrash(folder, aContext(root, [folder]), root, folder)
  })

  it.skipIf(!posix)(
    '🔴 asked by a link while the list holds the folder first and the link after: the folder goes, and both rows leave the list',
    async () => {
      const root = aRoot()
      const real = aWorkspace(root, 'real')
      const link = join(root, 'link')
      symlinkSync(real, link)
      const listFile = join(root, 'workspaces.json')
      rememberWorkspace(listFile, link, 1)
      rememberWorkspace(listFile, real, 1)
      // ⚑ The list's own spelling is the folder's (listed first); the one asked is the link.
      const { answer, taken } = await aDelete(link, aContext(root, [real, link]), root, {
        listFile,
      })
      expect(answer).toEqual({ deleted: true, trashed: [real], warning: null })
      expect(taken).toEqual([real])
      expect(readWorkspaceList(listFile)).toEqual([])
    },
  )
})

describe('§4 · not BroBot’s', () => {
  it('⛔ a person’s files at its top: five named, then how many more — the Trash never reached; moved out, it goes', async () => {
    const root = aRoot()
    const folder = aWorkspace(root, 'mixed')
    const theirs = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'f.txt', 'g.txt']
    for (const name of theirs) writeFileSync(join(folder, name), name)
    const context = aContext(root, [folder])
    await refusedBoth(
      folder,
      context,
      root,
      'This folder holds files BroCrew did not write: a.txt, b.txt, c.txt, d.txt, e.txt, and 2 more. Move them out first, or delete the folder yourself.',
    )
    for (const name of theirs) rmSync(join(folder, name))
    await goesToTheTrash(folder, context, root, folder)
  })

  it.skipIf(!posix)(
    '⚑ a link inside it is not followed: the workspace it names, elsewhere, is never handed to the Trash',
    async () => {
      const root = aRoot()
      const elsewhere = aWorkspace(root, 'elsewhere')
      const folder = aWorkspace(root, 'doomed')
      symlinkSync(elsewhere, join(folder, 'brobot-workspace', 'shortcut'))
      await goesToTheTrash(folder, aContext(root, [folder]), root, folder)
      expect(existsSync(join(elsewhere, 'brobot2.sqlite'))).toBe(true)
    },
  )
})

describe('§5 · the anchor, through a link and through the Data-volume spelling', () => {
  it.skipIf(!posix)(
    '⛔ a listed link whose folder is the home, or inside Claude’s own folder: refused by what it is, the Trash never reached; a link to a plain workspace goes',
    async () => {
      const root = aRoot()
      const context = aContext(root, [])
      const home = context.home
      aWorkspace(dirname(home), basename(home))
      const inClaude = aWorkspace(join(home, '.claude'), 'w')
      const toHome = join(root, 'to-home')
      const toClaude = join(root, 'to-claude')
      symlinkSync(home, toHome)
      symlinkSync(inClaude, toClaude)
      await refusedBoth(
        toHome,
        { ...context, listed: [toHome] },
        root,
        'This folder is your home folder.',
      )
      await refusedBoth(
        toClaude,
        { ...context, listed: [toClaude] },
        root,
        `This folder is inside Claude’s own folder (${join(home, '.claude')}).`,
      )
      const plain = aWorkspace(root, 'plain')
      const toPlain = join(root, 'to-plain')
      symlinkSync(plain, toPlain)
      await goesToTheTrash(toPlain, { ...context, listed: [toPlain] }, root, plain)
    },
  )

  it.skipIf(!hasDataVolume)(
    '⛔ a folder inside Claude’s own folder, listed by the Data-volume spelling: refused; a plain workspace so listed goes, and the Trash is handed that spelling',
    async () => {
      const root = aRoot()
      const context = aContext(root, [])
      const inClaude = aWorkspace(join(context.home, '.claude'), 'w')
      const spelled = `${DATA_VOLUME}${inClaude}`
      await refusedBoth(
        spelled,
        { ...context, listed: [spelled] },
        root,
        `This folder is inside Claude’s own folder (${join(context.home, '.claude')}).`,
      )
      const plain = aWorkspace(root, 'plain')
      const plainSpelled = `${DATA_VOLUME}${plain}`
      await goesToTheTrash(plainSpelled, { ...context, listed: [plainSpelled] }, root, plainSpelled)
    },
  )
})

describe('§6 · a workspace that holds another, or sits inside one', () => {
  it('⛔ one that holds this window’s workspace, which nobody listed: refused by what the folders are, the Trash never reached', async () => {
    const root = aRoot()
    const around = aWorkspace(root, 'around')
    const inner = aWorkspace(join(around, 'brobot-workspace'), 'this')
    const context = { ...aContext(root, [], { thisOne: inner }), listed: [around] }
    await refusedBoth(
      around,
      context,
      root,
      `This folder holds the workspace this window runs on: ${inner}`,
    )
  })

  it('⛔ one inside this window’s workspace, or inside the Default: refused; one beside them with a name that starts the same goes', async () => {
    const root = aRoot()
    const context = aContext(root, [])
    const inThis = aWorkspace(join(context.thisOne, 'brobot-workspace'), 'inner')
    const inDefault = aWorkspace(join(context.defaultFolder, 'brobot-workspace'), 'inner')
    await refusedBoth(
      inThis,
      { ...context, listed: [inThis] },
      root,
      `This folder is inside the workspace this window runs on: ${context.thisOne}`,
    )
    await refusedBoth(
      inDefault,
      { ...context, listed: [inDefault] },
      root,
      `This folder is inside the Default workspace: ${context.defaultFolder}`,
    )
    const beside = aWorkspace(root, 'this-2')
    await goesToTheTrash(beside, aContext(root, [beside]), root, beside)
  })

  it.skipIf(!posix)(
    '⛔ a listed workspace inside the folder a link lists — by the folder’s own spelling: refused in the list’s words; without it listed, the nested one is still found',
    async () => {
      const root = aRoot()
      const real = aWorkspace(root, 'real')
      const link = join(root, 'link')
      symlinkSync(real, link)
      const inner = aWorkspace(join(real, 'brobot-workspace'), 'inner')
      await refusedBoth(
        link,
        aContext(root, [link, inner]),
        root,
        `This folder holds the workspace ${inner}.`,
      )
      // ⚑ The control one fact over: not listed, it is found by its signs as the folder is read.
      await refusedBoth(
        link,
        aContext(root, [link]),
        root,
        `This folder holds another workspace: ${inner}`,
      )
    },
  )

  it.skipIf(!posix)(
    '⛔ 3024 M5 · a listed workspace that is gone from disk, inside the folder a link leads to: refused by the folder’s real spelling, since its identity cannot be read; one listed elsewhere lets it go',
    async () => {
      const root = aRoot()
      const real = aWorkspace(root, 'real')
      const link = join(root, 'link')
      symlinkSync(real, link)
      // ⚑ Listed, and gone: nothing on disk for the identity comparison to follow.
      const gone = join(real, 'gone')
      await refusedBoth(
        link,
        aContext(root, [link, gone]),
        root,
        `This folder holds the workspace ${gone}.`,
      )
      // ⚑ The control one fact over: a gone row that is not inside it does not stop the delete.
      await goesToTheTrash(link, aContext(root, [link, join(root, 'elsewhere-gone')]), root, real)
    },
  )
})

describe('§7 · what only the delete asks, just before the move', () => {
  it('⛔ the folder gone between the check and the move: it cannot be reached, and the Trash is never handed it', async () => {
    const root = aRoot()
    const folder = aWorkspace(root, 'leaving')
    let asked = 0
    const context = aContext(root, [folder], {
      ask: async () => {
        asked += 1
        // ⚑ Moved away — within the throwaway root — as the delete asks the gate again.
        if (asked === 2) renameSync(folder, join(root, 'moved-away'))
        return 'closed'
      },
    })
    const { answer, taken } = await aDelete(folder, context, root)
    expect(answer).toEqual({
      deleted: false,
      refusal: 'BroCrew cannot reach this folder now. Try again.',
    })
    expect(taken).toEqual([])
    expect(asked).toBe(2)
  })

  it('⚑ its pasted pictures’ folder gained a file of the person’s before it went: it stays, and the answer says so', async () => {
    const root = aRoot()
    const doomed = aWorkspace(root, 'Try')
    const pasted = pastedImagesRoot(doomed)
    mkdirSync(pasted)
    writeFileSync(join(pasted, `pasted-${'a'.repeat(32)}.png`), 'png')
    const context = aContext(root, [doomed])
    expect(await deleteVerdict(doomed, context)).toMatchObject({ ok: true, pastedImages: pasted })
    const { answer, taken } = await aDelete(doomed, context, root, {
      // ⚑ As the folder goes, a person drops a picture of their own beside BroBot's.
      hook: (folder) => {
        if (folder === doomed) writeFileSync(join(pasted, 'holiday.png'), 'png')
      },
    })
    expect(answer).toEqual({
      deleted: true,
      trashed: [doomed],
      warning: `Its pasted pictures’ folder changed, so it stays: ${pasted}`,
    })
    expect(taken).toEqual([doomed])
  })

  it('⚑ the Trash refuses its pasted pictures’ folder: the workspace is gone, the pictures stay, and the answer says why', async () => {
    const root = aRoot()
    const doomed = aWorkspace(root, 'Try')
    const pasted = pastedImagesRoot(doomed)
    mkdirSync(pasted)
    writeFileSync(join(pasted, `pasted-${'b'.repeat(32)}.png`), 'png')
    const { answer, taken } = await aDelete(doomed, aContext(root, [doomed]), root, {
      hook: (_folder, call) => {
        if (call === 2) throw new Error('the Trash is full')
      },
    })
    expect(answer).toEqual({
      deleted: true,
      trashed: [doomed],
      warning: `Its pasted pictures’ folder stays: ${pasted} (the Trash is full)`,
    })
    expect(taken).toEqual([doomed, pasted])
  })

  it('⚑ a list that cannot be written: it is in the Trash, and the answer says its row stayed', async () => {
    const root = aRoot()
    const doomed = aWorkspace(root, 'Try')
    // ⚑ A folder where the list file would be: it cannot be read or written as one.
    const listFile = join(root, 'not-a-file')
    mkdirSync(listFile)
    const { answer, taken } = await aDelete(doomed, aContext(root, [doomed]), root, { listFile })
    expect(answer).toMatchObject({ deleted: true, trashed: [doomed] })
    expect(
      String(answer.deleted && answer.warning).startsWith(
        `It is in ${whereDeletedFoldersGo(process.platform)}, but BroCrew could not take it off its list: `,
      ),
    ).toBe(true)
    expect(taken).toEqual([doomed])
  })
})
