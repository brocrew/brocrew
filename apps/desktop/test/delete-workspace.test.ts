import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteVerdict,
  deleteWorkspace,
  whereDeletedFoldersGo,
  type DeleteContext,
} from '../src/main/delete-workspace'
import { claimSoleHost, whoIsOn } from '../src/main/one-host-gate'
import { pastedImagesRoot } from '../src/main/runtime/pasted-image'
import { readWorkspaceList, rememberWorkspace } from '../src/main/workspaces'

/**
 * 🔴 **W4.151 · F092 — deleting a workspace: the Trash, never `rm`** (`delete-workspace.ts`).
 *
 *  - §1 · every refusal, in words: the default, this one, an open one, one not listed, one not
 *    BroBot's, one that holds or is inside another workspace, a home, a provider's own folder.
 *  - §2 · a delete: the folder and its pasted pictures to the Trash, its row off the list — also
 *    when the list reaches it through a link, or by macOS's Data-volume spelling.
 *  - §3 · the wiring: `shell.trashItem`, and nothing in the module removes a file.
 *
 * ⛔ **Every folder is a throwaway one**, and the home and environment are a scratch home and `{}`:
 * no test here reads a person's real folders (W4's rule, after `dad19072`).
 */

const here = dirname(fileURLToPath(import.meta.url))
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    // ⚑ A folder a test locked is opened again first, so the throwaway tree can go.
    rmSync(root, { recursive: true, force: true })
  }
})

/** A throwaway root, by its real path (macOS's temporary folder is a link). */
function aRoot(): string {
  const made = realpathSync(mkdtempSync(join(tmpdir(), 'brobot-del-')))
  roots.push(made)
  return made
}

/** A workspace as a launch leaves it: BroBot's files and its browser's. */
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

/** A workspace made and never started: its name, and no sign of a workspace above or in it. */
function aNeverStarted(parent: string, name: string): string {
  const folder = join(parent, name)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'workspace.json'), '{"name":"Never"}')
  return folder
}

/** The facts a delete is checked against — all of them throwaway. */
function aContext(root: string, listed: readonly string[], more: Partial<DeleteContext> = {}) {
  const thisOne = join(root, 'this')
  const defaultFolder = join(root, 'default')
  for (const one of [thisOne, defaultFolder]) {
    if (!existsSync(one)) aWorkspace(root, basename(one))
  }
  for (const one of ['home', 'cwd']) mkdirSync(join(root, one), { recursive: true })
  const context: DeleteContext = {
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
  return context
}

/** A Trash of the test's own: what it was handed, moved into it. */
function aTrash(root: string) {
  const bin = join(root, 'trash')
  mkdirSync(bin, { recursive: true })
  const taken: string[] = []
  return {
    taken,
    trash: async (folder: string) => {
      taken.push(folder)
      // ⛔ Only the test's own throwaway root is ever moved — a mutation run included (W4.167).
      const plain = folder.startsWith('/System/Volumes/Data/')
        ? folder.slice('/System/Volumes/Data'.length)
        : folder
      if (!plain.startsWith(`${root}${sep}`)) {
        throw new Error(`the test's Trash was handed a folder outside its root: ${folder}`)
      }
      renameSync(folder, join(bin, `${String(taken.length)}-${basename(folder)}`))
    },
  }
}

const refusalOf = async (asked: string, context: DeleteContext): Promise<string> => {
  const verdict = await deleteVerdict(asked, context)
  return verdict.ok ? '(may be deleted)' : verdict.refusal
}

describe('§1 · every refusal, in words', () => {
  it('⛔ a folder not in the list', async () => {
    const root = aRoot()
    const stray = aWorkspace(root, 'stray')
    expect(await refusalOf(stray, aContext(root, []))).toBe(
      `This folder is not in the list of workspaces: ${stray}`,
    )
  })

  it('⛔ the workspace this window runs on, and the Default one — however they are spelled', async () => {
    const root = aRoot()
    const context = aContext(root, [])
    expect(await refusalOf(context.thisOne, context)).toBe(
      'This is the workspace this window runs on.',
    )
    expect(await refusalOf(context.defaultFolder, context)).toBe(
      'The Default workspace cannot be deleted.',
    )
    // ⚑ …named first, listed or not: a hidden launch lists neither.
    const unlisted = { ...context, listed: [] }
    expect(await refusalOf(context.thisOne, unlisted)).toBe(
      'This is the workspace this window runs on.',
    )
    expect(await refusalOf(context.defaultFolder, unlisted)).toBe(
      'The Default workspace cannot be deleted.',
    )
    // ⚑ A link to the default folder, listed as a workspace of its own, is still the default.
    const link = join(root, 'link-to-default')
    symlinkSync(context.defaultFolder, link)
    expect(await refusalOf(link, aContext(root, [link]))).toBe(
      'The Default workspace cannot be deleted.',
    )
  })

  it('⛔ an open one: its gate answers', async () => {
    const root = aRoot()
    const open = aWorkspace(root, 'open')
    expect(await refusalOf(open, aContext(root, [open], { ask: async () => 'open' }))).toBe(
      'This workspace is open. Quit it first, then delete it.',
    )
    // ⚑ The real gate, held here as a running BroBot holds it.
    expect(await claimSoleHost(open)).toBe('sole')
    expect(await refusalOf(open, aContext(root, [open], { ask: (one) => whoIsOn(one) }))).toBe(
      'This workspace is open. Quit it first, then delete it.',
    )
  })

  it.skipIf(process.platform === 'win32')(
    '⚑ a gate that cannot say: Chromium’s lock decides, and one nobody can read refuses',
    async () => {
      const root = aRoot()
      const unclear = aWorkspace(root, 'unclear')
      const asUnclear = aContext(root, [unclear], { ask: async () => 'unknown' })
      // No lock: nothing runs on it.
      expect((await deleteVerdict(unclear, asUnclear)).ok).toBe(true)
      // A lock naming a process alive on this computer — this one.
      symlinkSync(`${hostname()}-${String(process.pid)}`, join(unclear, 'SingletonLock'))
      expect(await refusalOf(unclear, asUnclear)).toBe(
        'This workspace is open. Quit it first, then delete it.',
      )
      // ⛔ A gate that says closed is not proof — the gate fails open: a live lock still refuses.
      const asClosed = aContext(root, [unclear], { ask: async () => 'closed' })
      expect(await refusalOf(unclear, asClosed)).toBe(
        'This workspace is open. Quit it first, then delete it.',
      )
      // A lock from another computer: nothing here can say, and the words say what can be done.
      unlinkSync(join(unclear, 'SingletonLock'))
      symlinkSync('another-computer-12345', join(unclear, 'SingletonLock'))
      expect(await refusalOf(unclear, asClosed)).toBe(
        'This workspace was last opened on another computer (another-computer), and BroCrew cannot tell whether it is open there. If it is not, delete the folder yourself.',
      )
      // A lock that is not one (a copy that made the link a file).
      unlinkSync(join(unclear, 'SingletonLock'))
      writeFileSync(join(unclear, 'SingletonLock'), '')
      expect(await refusalOf(unclear, asClosed)).toMatch(
        /^BroCrew cannot read this workspace’s lock/,
      )
      // A gate that cannot say, and no lock at all: nothing runs on it.
      unlinkSync(join(unclear, 'SingletonLock'))
      expect((await deleteVerdict(unclear, asUnclear)).ok).toBe(true)
    },
  )

  it('⛔ a listed folder that is gone: removed from the list instead', async () => {
    const root = aRoot()
    const gone = join(root, 'gone')
    expect(await refusalOf(gone, aContext(root, [gone]))).toBe(
      `Not found — ${gone}. Remove it from the list instead.`,
    )
  })

  it('⛔ a folder that is not BroBot’s: a person’s files at its top, or nothing of BroBot’s', async () => {
    const root = aRoot()
    const mixed = aWorkspace(root, 'mixed')
    writeFileSync(join(mixed, 'letter.txt'), 'dear')
    mkdirSync(join(mixed, 'Photos'))
    expect(await refusalOf(mixed, aContext(root, [mixed]))).toBe(
      'This folder holds files BroCrew did not write: Photos, letter.txt. Move them out first, or delete the folder yourself.',
    )
    const empty = join(root, 'empty')
    mkdirSync(empty)
    writeFileSync(join(empty, '.DS_Store'), '')
    expect(await refusalOf(empty, aContext(root, [empty]))).toBe(
      'This folder holds nothing of BroCrew’s. Remove it from the list instead.',
    )
    // ⚑ One made and never started holds its name only: it is BroBot's, and may go.
    const named = join(root, 'named')
    mkdirSync(named)
    writeFileSync(join(named, 'workspace.json'), '{"name":"Never"}')
    expect((await deleteVerdict(named, aContext(root, [named]))).ok).toBe(true)
  })

  // The macOS Icon carriage-return filename cannot be planted on Windows.
  it.skipIf(process.platform === 'win32')(
    '⚑ what the browser and the system leave is theirs: a crash’s temporary file, macOS’s twins',
    async () => {
      const root = aRoot()
      const left = aWorkspace(root, 'left')
      for (const name of ['.org.chromium.Chromium.a1B2c3', '._Local State', 'Icon\r', 'DIPS-wal']) {
        writeFileSync(join(left, name), '')
      }
      expect((await deleteVerdict(left, aContext(root, [left]))).ok).toBe(true)
    },
  )

  it('⛔ a folder that holds another workspace, or is inside one', async () => {
    const root = aRoot()
    // A folder below it with a sign of a workspace.
    const outer = aWorkspace(root, 'outer')
    const nested = join(outer, 'brobot-workspace', 'projects', 'old')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'brobot2.sqlite'), '')
    expect(await refusalOf(outer, aContext(root, [outer]))).toBe(
      `This folder holds another workspace: ${nested}`,
    )
    // A listed one inside it, and it inside a listed one — by spelling, no listed folder read.
    const holder = aWorkspace(root, 'holder')
    const inner = aWorkspace(join(holder, 'brobot-workspace'), 'inner')
    expect(await refusalOf(holder, aContext(root, [holder, inner]))).toBe(
      `This folder holds the workspace ${inner}.`,
    )
    expect(await refusalOf(inner, aContext(root, [holder, inner]))).toBe(
      `This folder is inside the workspace ${holder}.`,
    )
    // The Default workspace inside it — by what the folders are, before any spelling is read.
    const around = aWorkspace(root, 'around')
    const inside = aWorkspace(around, 'desktop')
    expect(
      await refusalOf(
        around,
        aContext(root, [around], { defaultFolder: inside, listed: [around] }),
      ),
    ).toBe(`This folder holds the Default workspace: ${inside}`)
  })

  it('🔴 W4.155 · a workspace the list holds only by a link: inside it or around it, by where it is', async () => {
    const root = aRoot()
    // ⚑ Farah's case: `real/brobot-workspace/inner`, with only `link → real` listed.
    const outer = aWorkspace(root, 'real')
    const link = join(root, 'link')
    symlinkSync(outer, link)
    const inner = aWorkspace(join(outer, 'brobot-workspace'), 'inner')
    expect(await refusalOf(inner, aContext(root, [link, inner]))).toBe(
      `This folder is inside the workspace ${link}.`,
    )
    const { taken, trash } = aTrash(root)
    const answer = await deleteWorkspace(inner, {
      ...aContext(root, [link, inner]),
      trash,
      listFile: join(root, 'workspaces.json'),
      now: 2,
    })
    expect(answer).toEqual({
      deleted: false,
      refusal: `This folder is inside the workspace ${link}.`,
    })
    expect(taken).toEqual([])
    expect(existsSync(join(inner, 'brobot2.sqlite'))).toBe(true)
    // ⚑ …and where no sign above says so — an outer one made and never started — only where the
    // listed folder IS can.
    const never = aNeverStarted(root, 'never')
    const neverLink = join(root, 'never-link')
    symlinkSync(never, neverLink)
    const below = aWorkspace(join(never, 'notes'), 'below')
    expect(await refusalOf(below, aContext(root, [neverLink, below]))).toBe(
      `This folder is inside the workspace ${neverLink}.`,
    )
    // Around it: the list reaches a workspace inside this one only by a link.
    const around = aWorkspace(root, 'around')
    const held = aNeverStarted(join(around, 'brobot-workspace'), 'held')
    const heldLink = join(root, 'held-link')
    symlinkSync(held, heldLink)
    expect(await refusalOf(around, aContext(root, [around, heldLink]))).toBe(
      `This folder holds the workspace ${heldLink}.`,
    )
  })

  it('🔴 W4.155 · a workspace listed by a link that leads into another one', async () => {
    const root = aRoot()
    const outer = aNeverStarted(root, 'outer')
    const outerLink = join(root, 'outer-link')
    symlinkSync(outer, outerLink)
    const inner = aWorkspace(join(outer, 'notes'), 'inner')
    const innerLink = join(root, 'inner-link')
    symlinkSync(inner, innerLink)
    // Both listed only by links.
    expect(await refusalOf(innerLink, aContext(root, [outerLink, innerLink]))).toBe(
      `This folder is inside the workspace ${outerLink}.`,
    )
    // …and the outer one by its own path.
    expect(await refusalOf(innerLink, aContext(root, [outer, innerLink]))).toBe(
      `This folder is inside the workspace ${outer}.`,
    )
  })

  it('⛔ inside a workspace the list does not hold at all: a sign above it says so', async () => {
    const root = aRoot()
    const outer = aWorkspace(root, 'outer')
    const inner = aWorkspace(join(outer, 'brobot-workspace'), 'inner')
    expect(await refusalOf(inner, aContext(root, [inner]))).toBe(
      `This folder is inside the workspace ${outer}.`,
    )
  })

  it('⚑ a listed folder that is gone blocks nothing; one BroCrew cannot reach refuses', async () => {
    const root = aRoot()
    const target = aWorkspace(root, 'target')
    expect((await deleteVerdict(target, aContext(root, [join(root, 'gone'), target]))).ok).toBe(
      true,
    )
    // ⚑ Nor does one that leads to no folder: a link loop.
    symlinkSync(join(root, 'loop-b'), join(root, 'loop-a'))
    symlinkSync(join(root, 'loop-a'), join(root, 'loop-b'))
    expect((await deleteVerdict(target, aContext(root, [join(root, 'loop-a'), target]))).ok).toBe(
      true,
    )
    if (process.platform === 'win32' || process.getuid?.() === 0) return
    const locked = join(root, 'locked')
    mkdirSync(join(locked, 'w'), { recursive: true })
    chmodSync(locked, 0o000)
    try {
      expect(await refusalOf(target, aContext(root, [join(locked, 'w'), target]))).toBe(
        `BroCrew cannot reach the workspace ${join(locked, 'w')} to make sure this folder is not part of it. If that workspace is gone, remove it from the list, then try again.`,
      )
    } finally {
      chmodSync(locked, 0o700)
    }
  })

  it.skipIf(process.platform !== 'darwin' || !existsSync('/System/Volumes/Data/private'))(
    '🔴 W4.155 · by macOS’s Data-volume spelling, either way round',
    async () => {
      const root = aRoot()
      const outer = aNeverStarted(root, 'outer')
      const inner = aWorkspace(join(outer, 'notes'), 'inner')
      const outerSpelled = `/System/Volumes/Data${outer}`
      const innerSpelled = `/System/Volumes/Data${inner}`
      expect(await refusalOf(inner, aContext(root, [outerSpelled, inner]))).toBe(
        `This folder is inside the workspace ${outerSpelled}.`,
      )
      expect(await refusalOf(innerSpelled, aContext(root, [outer, innerSpelled]))).toBe(
        `This folder is inside the workspace ${outer}.`,
      )
      expect(await refusalOf(outer, aContext(root, [outer, innerSpelled]))).toBe(
        `This folder holds the workspace ${innerSpelled}.`,
      )
    },
  )

  it('⛔ a home, a provider’s own folder, or what holds one — by the reset’s own anchor', async () => {
    const root = aRoot()
    const context = aContext(root, [])
    const home = context.home
    aWorkspace(dirname(home), basename(home))
    expect(await refusalOf(home, { ...context, listed: [home] })).toBe(
      'This folder is your home folder.',
    )
    expect(await refusalOf(root, { ...context, listed: [root] })).toBe(
      `This folder holds your home folder (${home}).`,
    )
    const inClaude = aWorkspace(join(home, '.claude'), 'w')
    expect(await refusalOf(inClaude, { ...context, listed: [inClaude] })).toBe(
      `This folder is inside Claude’s own folder (${join(home, '.claude')}).`,
    )
    // ⚑ A provider folder this environment redirects to — a scratch one.
    const redirected = join(root, 'redirected')
    const inRedirected = aWorkspace(redirected, 'w')
    expect(
      await refusalOf(inRedirected, {
        ...context,
        env: { CLAUDE_CONFIG_DIR: redirected },
        listed: [inRedirected],
      }),
    ).toBe(`This folder is inside the folder Claude is set to keep its files in (${redirected}).`)
    // ⚑ The directory this app runs from.
    aWorkspace(dirname(context.cwd), basename(context.cwd))
    expect(await refusalOf(context.cwd, { ...context, listed: [context.cwd] })).toBe(
      'This folder is, or holds, the folder BroCrew runs from.',
    )
  })

  it.skipIf(process.platform !== 'darwin' || !existsSync('/System/Volumes/Data/private'))(
    '⛔ a home by macOS’s Data-volume spelling is still a home',
    async () => {
      const root = aRoot()
      const context = aContext(root, [])
      aWorkspace(dirname(context.home), basename(context.home))
      const spelled = `/System/Volumes/Data${context.home}`
      expect(await refusalOf(spelled, { ...context, listed: [spelled] })).toBe(
        'This folder is your home folder.',
      )
    },
  )

  it('⛔ a hidden launch’s folder out of its reach', async () => {
    const root = aRoot()
    const away = aWorkspace(root, 'away')
    expect(
      await refusalOf(away, aContext(root, [away], { outOfReach: () => 'Not this one.' })),
    ).toBe('Not this one.')
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    '⛔ a part it cannot read',
    async () => {
      const root = aRoot()
      const locked = aWorkspace(root, 'locked')
      const part = join(locked, 'brobot-workspace', 'private')
      mkdirSync(part)
      chmodSync(part, 0o000)
      try {
        expect(await refusalOf(locked, aContext(root, [locked]))).toBe(
          `BroCrew cannot read part of this folder: ${part}`,
        )
      } finally {
        chmodSync(part, 0o700)
      }
    },
  )
})

describe('§2 · a delete: the Trash, and the row off the list', () => {
  it('🔴 the folder and its pasted pictures to the Trash, its row off the list, and what it held said first', async () => {
    const root = aRoot()
    const doomed = aWorkspace(root, 'Try')
    const pasted = pastedImagesRoot(doomed)
    mkdirSync(pasted)
    writeFileSync(join(pasted, `pasted-${'a'.repeat(32)}.png`), 'png')
    const listFile = join(root, 'workspaces.json')
    const context = aContext(root, [doomed])
    for (const one of context.listed) rememberWorkspace(listFile, one, 1)

    expect(await deleteVerdict(doomed, context)).toEqual({
      ok: true,
      path: doomed,
      // ⚑ Its pasted picture's three bytes and one file included.
      bytes: 100 + 2 + 5 + 50 + 2 + 14 + 3,
      files: 7,
      workingFiles: 0,
      exports: 0,
      pastedImages: pasted,
      warning: null,
    })
    const { taken, trash } = aTrash(root)
    const answer = await deleteWorkspace(doomed, { ...context, trash, listFile, now: 2 })
    expect(answer).toEqual({ deleted: true, trashed: [doomed, pasted], warning: null })
    expect(taken).toEqual([doomed, pasted])
    expect(existsSync(doomed) || existsSync(pasted)).toBe(false)
    expect(readWorkspaceList(listFile).map((one) => one.path)).toEqual([
      context.thisOne,
      context.defaultFolder,
    ])
  })

  it('⚑ the confirmation is told what the person’s conversations made, and the exports', async () => {
    const root = aRoot()
    const used = aWorkspace(root, 'used')
    writeFileSync(join(used, 'brobot-workspace', 'AGENTS.md'), 'hi')
    mkdirSync(join(used, 'brobot-workspace', 'notes'))
    writeFileSync(join(used, 'brobot-workspace', 'notes', 'plan.md'), 'plan')
    writeFileSync(join(used, 'brobot-workspace', 'draft.txt'), 'draft')
    mkdirSync(join(used, 'exports'))
    writeFileSync(join(used, 'exports', 'a.brobot-session.json'), '{}')
    const verdict = await deleteVerdict(used, aContext(root, [used]))
    expect(verdict).toMatchObject({ ok: true, workingFiles: 2, exports: 1 })
  })

  it('⚑ a pasted pictures’ folder holding something else stays, and says so', async () => {
    const root = aRoot()
    const doomed = aWorkspace(root, 'Try')
    const pasted = pastedImagesRoot(doomed)
    mkdirSync(pasted)
    writeFileSync(join(pasted, 'holiday.png'), 'png')
    const context = aContext(root, [doomed])
    const { taken, trash } = aTrash(root)
    const answer = await deleteWorkspace(doomed, {
      ...context,
      trash,
      listFile: join(root, 'workspaces.json'),
      now: 2,
    })
    expect(answer).toEqual({
      deleted: true,
      trashed: [doomed],
      warning: `Its pasted pictures’ folder holds something else, so it stays: ${pasted}`,
    })
    expect(taken).toEqual([doomed])
    expect(existsSync(join(pasted, 'holiday.png'))).toBe(true)
  })

  it('⚑ the place a deleted folder goes is named as its system names it', () => {
    expect(whereDeletedFoldersGo('darwin')).toBe('the Trash')
    expect(whereDeletedFoldersGo('linux')).toBe('the Trash')
    expect(whereDeletedFoldersGo('win32')).toBe('the Recycle Bin')
  })

  it('⛔ a folder the Trash will not take stays where it is, and stays in the list', async () => {
    const root = aRoot()
    const kept = aWorkspace(root, 'kept')
    const listFile = join(root, 'workspaces.json')
    rememberWorkspace(listFile, kept, 1)
    const answer = await deleteWorkspace(kept, {
      ...aContext(root, [kept]),
      trash: async () => {
        throw new Error('this disk has no Trash')
      },
      listFile,
      now: 2,
    })
    expect(answer).toEqual({
      deleted: false,
      refusal: `BroCrew could not move this folder to ${whereDeletedFoldersGo(process.platform)}, so nothing was deleted: this disk has no Trash`,
    })
    expect(existsSync(join(kept, 'brobot2.sqlite'))).toBe(true)
    expect(readWorkspaceList(listFile).map((one) => one.path)).toContain(kept)
  })

  it('🔴 on Windows the same refusal names the Recycle Bin', async () => {
    const root = aRoot()
    const kept = aWorkspace(root, 'kept')
    const listFile = join(root, 'workspaces.json')
    rememberWorkspace(listFile, kept, 1)
    const answer = await deleteWorkspace(kept, {
      ...aContext(root, [kept], { platform: 'win32' }),
      trash: async () => {
        throw new Error('it is full')
      },
      listFile,
      now: 2,
    })
    expect(answer).toEqual({
      deleted: false,
      refusal:
        'BroCrew could not move this folder to the Recycle Bin, so nothing was deleted: it is full',
    })
  })

  it('⛔ the gate is asked again just before: one that opened since is not deleted', async () => {
    const root = aRoot()
    const racing = aWorkspace(root, 'racing')
    let asked = 0
    const { taken, trash } = aTrash(root)
    const answer = await deleteWorkspace(racing, {
      ...aContext(root, [racing], {
        ask: async () => {
          asked += 1
          return asked === 1 ? 'closed' : 'open'
        },
      }),
      trash,
      listFile: join(root, 'workspaces.json'),
      now: 2,
    })
    expect(answer).toEqual({
      deleted: false,
      refusal: 'This workspace is open. Quit it first, then delete it.',
    })
    expect(taken).toEqual([])
  })

  it('⛔ a folder swapped for another while it was checked is not deleted', async () => {
    const root = aRoot()
    const swapped = aWorkspace(root, 'swapped')
    let asked = 0
    const { taken, trash } = aTrash(root)
    const answer = await deleteWorkspace(swapped, {
      ...aContext(root, [swapped], {
        ask: async () => {
          asked += 1
          if (asked === 2) {
            renameSync(swapped, join(root, 'moved-away'))
            aWorkspace(root, 'swapped')
          }
          return 'closed'
        },
      }),
      trash,
      listFile: join(root, 'workspaces.json'),
      now: 2,
    })
    expect(answer).toEqual({
      deleted: false,
      refusal: 'This folder changed while BroCrew checked it. Try again.',
    })
    expect(taken).toEqual([])
  })

  it('⚑ every row that is this folder by another spelling is asked if it is open, and leaves the list', async () => {
    const root = aRoot()
    const real = aWorkspace(root, 'real')
    const link = join(root, 'link')
    symlinkSync(real, link)
    const listFile = join(root, 'workspaces.json')
    rememberWorkspace(listFile, link, 1)
    rememberWorkspace(listFile, real, 2)
    // Open by the other spelling: the delete asks it too.
    const openByLink = aContext(root, [real, link], {
      ask: async (folder) => (folder === link ? 'open' : 'closed'),
    })
    expect(await refusalOf(real, openByLink)).toBe(
      'This workspace is open. Quit it first, then delete it.',
    )
    const { trash } = aTrash(root)
    const answer = await deleteWorkspace(real, {
      ...aContext(root, [real, link]),
      trash,
      listFile,
      now: 3,
    })
    expect(answer).toEqual({ deleted: true, trashed: [real], warning: null })
    expect(readWorkspaceList(listFile)).toEqual([])
  })

  it('🔴 a workspace the list reaches through a link: the folder goes, not just the link', async () => {
    const root = aRoot()
    const real = aWorkspace(root, 'real')
    const link = join(root, 'link')
    symlinkSync(real, link)
    const listFile = join(root, 'workspaces.json')
    // ⚑ Listed by both spellings: neither stays behind as a missing row.
    rememberWorkspace(listFile, real, 1)
    rememberWorkspace(listFile, link, 1)
    const { taken, trash } = aTrash(root)
    const answer = await deleteWorkspace(link, {
      ...aContext(root, [link]),
      trash,
      listFile,
      now: 2,
    })
    expect(answer).toEqual({ deleted: true, trashed: [real], warning: null })
    expect(taken).toEqual([real])
    expect(existsSync(real)).toBe(false)
    expect(readWorkspaceList(listFile)).toEqual([])
  })

  it.skipIf(process.platform !== 'darwin' || !existsSync('/System/Volumes/Data/private'))(
    '🔴 a workspace listed by macOS’s Data-volume spelling: that folder goes',
    async () => {
      const root = aRoot()
      const folder = aWorkspace(root, 'spelled')
      const spelled = `/System/Volumes/Data${folder}`
      const listFile = join(root, 'workspaces.json')
      rememberWorkspace(listFile, spelled, 1)
      const { taken, trash } = aTrash(root)
      const answer = await deleteWorkspace(spelled, {
        ...aContext(root, [spelled]),
        trash,
        listFile,
        now: 2,
      })
      expect(answer).toEqual({ deleted: true, trashed: [spelled], warning: null })
      expect(taken).toEqual([spelled])
      expect(existsSync(folder)).toBe(false)
      expect(readWorkspaceList(listFile)).toEqual([])
      // ⚑ …and asked for by the other spelling, it is the same listed folder.
      const again = aWorkspace(root, 'again')
      const asListed = `/System/Volumes/Data${again}`
      expect((await deleteVerdict(again, aContext(root, [asListed]))).ok).toBe(true)
    },
  )
})

describe('§3 · the wiring: the Trash, never `rm`', () => {
  it('⛔ nothing in the delete removes a file; the app hands it the system’s Trash', () => {
    const core = readFileSync(join(here, '../src/main/delete-workspace.ts'), 'utf8')
    expect(core).not.toMatch(/\b(rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|removeChecked)\s*\(/)
    expect(core).toContain("from '../../../../scripts/lib/safe-remove.mjs'")
    const wired = readFileSync(join(here, '../src/main/workspaces-in-the-app.ts'), 'utf8')
    expect(wired).toContain('trash: (one) => shell.trashItem(one),')
    // ⚑ The home and environment it guards are the account's own, and a hidden launch's reach holds.
    expect(wired).toContain(
      '    home: options.hidden ? homedir() : home,\n    env: options.hidden ? {} : process.env,\n    cwd: process.cwd(),',
    )
    // ⚑ A folder this window started a BroBot on moments ago is open: it has no gate yet.
    expect(wired).toContain(
      "ask: async (folder) => (startingHere(folder) ? 'open' : whoIsOn(folder)),",
    )
    // ⚑ One delete at a time, and nothing started on or renamed in the folder it deletes.
    expect(wired.match(/beingDeleted\(/g)).toHaveLength(2)
    expect(wired).toContain('      if (deletingNow !== null) {')
    expect(wired).toContain('    outOfReach,\n  })')
  })
})
