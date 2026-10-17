import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  codexCopyIdentityIn,
  fallbackSignIn,
  isTheSameCodexCopy,
  replaceARefusedCodexCopy,
} from '../src/internal/auth'
import {
  isTheSameFile,
  trustProviderHomeAncestry,
  withProviderHomeLock,
} from '../src/internal/provider-home'

/**
 * A file is told from another by its device and its number on it, compared as the exact integers
 * the system gives. On Windows a file's number is 64 bits wide: above 2^53 two different files can
 * round to one JavaScript number, so a swap compared as numbers would pass for the same file.
 *
 * The numbers are faked: `node:fs` is wrapped so that a look at a named path, or at a descriptor
 * opened on it, reports the number a test sets, as the exact integer when asked for one and as a
 * rounded number otherwise. A name ending in `*` stands for every path that begins with it. A number
 * is the number of the file at that name: once that file is moved away, the name has none, and a
 * new file made there has its own. Every file here is fictional and made by the test.
 */

const fake = vi.hoisted(() => ({
  /** What `lstat` and `stat` of a path report as its number. */
  looked: new Map<string, bigint>(),
  /** What `fstat` of a descriptor opened on a path reports. */
  opened: new Map<string, bigint>(),
  fds: new Map<number, string>(),
  /** Paths that cannot be opened for reading, as a file at mode 0000 cannot. */
  unreadable: new Set<string>(),
  /** Opens follow a link at the path whatever they ask, as on Windows, which has no `O_NOFOLLOW`. */
  followsLinks: false,
  /** There is no `O_NOFOLLOW` at all, as on Windows, so a new file is made as Windows makes it. */
  windowsCreate: false,
}))

/** The value `map` holds for `path`, by its own name or by a `prefix*` name. */
function numberFor(map: ReadonlyMap<string, bigint>, path: string): bigint | undefined {
  const own = map.get(path)
  if (own !== undefined) return own
  for (const [name, value] of map) {
    if (name.endsWith('*') && path.startsWith(name.slice(0, -1))) return value
  }
  return undefined
}

vi.mock('node:fs', async (original) => {
  const real = await original<typeof import('node:fs')>()
  const numbered = <T extends object>(stats: T, ino: bigint | undefined, exact: boolean): T =>
    ino === undefined
      ? stats
      : new Proxy(stats, {
          get(target, key) {
            if (key === 'ino') return exact ? ino : Number(ino)
            const value: unknown = Reflect.get(target, key, target)
            return typeof value === 'function' ? (value as () => unknown).bind(target) : value
          },
        })
  const exactly = (options: unknown): boolean =>
    typeof options === 'object' &&
    options !== null &&
    'bigint' in options &&
    options.bigint === true
  const constants = { ...real.constants }
  Object.defineProperty(constants, 'O_NOFOLLOW', {
    enumerable: true,
    get: () => (fake.windowsCreate ? undefined : real.constants.O_NOFOLLOW),
  })
  return {
    ...real,
    constants,
    openSync: (...args: Parameters<typeof real.openSync>) => {
      const [path, flags] = args
      if (flags === 'r' && [...fake.unreadable].some((name) => String(path).startsWith(name))) {
        throw Object.assign(new Error('fictional: permission denied'), { code: 'EACCES' })
      }
      const nofollow = real.constants.O_NOFOLLOW ?? 0
      if (fake.followsLinks && typeof flags === 'number') args[1] = flags & ~nofollow
      const fd = real.openSync(...args)
      fake.fds.set(fd, String(args[0]))
      return fd
    },
    renameSync: (...args: Parameters<typeof real.renameSync>) => {
      real.renameSync(...args)
      fake.looked.delete(String(args[0]))
      fake.opened.delete(String(args[0]))
    },
    closeSync: (fd: number) => {
      fake.fds.delete(fd)
      real.closeSync(fd)
    },
    lstatSync: (path: string, options?: object) =>
      numbered(
        real.lstatSync(path, options as never) as object,
        numberFor(fake.looked, String(path)),
        exactly(options),
      ),
    statSync: (path: string, options?: object) =>
      numbered(
        real.statSync(path, options as never) as object,
        numberFor(fake.looked, String(path)),
        exactly(options),
      ),
    fstatSync: (fd: number, options?: object) =>
      numbered(
        real.fstatSync(fd, options as never) as object,
        numberFor(fake.opened, fake.fds.get(fd) ?? ''),
        exactly(options),
      ),
  }
})

/** A number past 2^53, and its two neighbours: as JavaScript numbers all three are one. */
const HIGH = 2n ** 60n
const ONE = HIGH + 1n
const ANOTHER = HIGH + 2n

let root: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot-exact-number-')))
  fake.looked.clear()
  fake.opened.clear()
  fake.unreadable.clear()
  fake.followsLinks = false
  fake.windowsCreate = false
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

/** A fictional Codex sign-in, of one account, refreshed at `refreshed`. */
const signIn = (token: string, refreshed: string): string =>
  JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { account_id: 'acct-fictional-a', access_token: token, refresh_token: `r-${token}` },
    last_refresh: refreshed,
  })

describe('the numbers themselves', () => {
  it('🔴 two files whose numbers differ only past 2^53 are two files', () => {
    expect(Number(ONE)).toBe(Number(ANOTHER))
    expect(isTheSameFile({ dev: 7n, ino: ONE }, { dev: 7n, ino: ANOTHER })).toBe(false)
  })

  it('the same number on the same device is the same file, and another device is not', () => {
    expect(isTheSameFile({ dev: 7n, ino: ONE }, { dev: 7n, ino: ONE })).toBe(true)
    expect(isTheSameFile({ dev: 7n, ino: ONE }, { dev: 8n, ino: ONE })).toBe(false)
  })
})

describe('the numbers this computer gives its files', () => {
  it('a file put at a name another file was moved from has another number, read either way', () => {
    const path = join(root, 'swapped.json')
    writeFileSync(path, '{"fictional":1}')
    const before = lstatSync(path, { bigint: true })
    renameSync(path, `${path}.looked-at`)
    writeFileSync(path, '{"fictional":2}')
    const after = lstatSync(path, { bigint: true })
    const fd = openSync(path, 'r')
    let opened
    try {
      opened = fstatSync(fd, { bigint: true })
    } finally {
      closeSync(fd)
    }
    const said = `before ${String(before.dev)}:${String(before.ino)}, after ${String(after.dev)}:${String(after.ino)}, opened ${String(opened.dev)}:${String(opened.ino)}`
    expect(before.ino, `this disk keeps no file numbers (${said})`).not.toBe(0n)
    expect(isTheSameFile(before, after), `the new file has the old number (${said})`).toBe(false)
    expect(isTheSameFile(after, opened), `a look and an open disagree (${said})`).toBe(true)
  })
})

describe('BroBot’s own Codex sign-in, read only if it is the file that was looked at', () => {
  function anOwnSignIn(): string {
    const home = join(root, 'homes', 'brobot', 'codex')
    mkdirSync(home, { recursive: true })
    const path = join(home, 'auth.json')
    writeFileSync(path, signIn('OWN', '2026-10-09T02:35:11Z'))
    return path
  }

  it('🔴 a file opened under another number than the one looked at is not read', () => {
    const path = anOwnSignIn()
    fake.looked.set(path, ONE)
    fake.opened.set(path, ANOTHER)
    expect(() => fallbackSignIn({ path, managedRoot: root })).toThrow(
      /^BroBot's own Codex sign-in moved while it was read/,
    )
  })

  it('🔴 where an open follows links (Windows), the sign-in replaced by a link to itself is not read', () => {
    const path = anOwnSignIn()
    fake.followsLinks = true
    const aLinkToItself = () => {
      renameSync(path, `${path}-moved`)
      symlinkSync(`${path}-moved`, path)
    }
    expect(() => fallbackSignIn({ path, managedRoot: root }, aLinkToItself, 'win32')).toThrow(
      /^BroBot's own Codex sign-in could not be read/,
    )
  })

  it('…and the same open is what refuses it elsewhere, as it always did', (ctx) => {
    ctx.skip(process.platform === 'win32', 'this system’s own open follows links')
    const path = anOwnSignIn()
    const aLinkToItself = () => {
      renameSync(path, `${path}-moved`)
      symlinkSync(`${path}-moved`, path)
    }
    expect(() => fallbackSignIn({ path, managedRoot: root }, aLinkToItself, 'linux')).toThrow(
      /^BroBot's own Codex sign-in could not be read/,
    )
  })

  it('where an open follows links, the file left as it was is read', () => {
    const path = anOwnSignIn()
    fake.followsLinks = true
    expect(
      fallbackSignIn({ path, managedRoot: root }, () => {}, 'win32')?.toString('utf8'),
    ).toContain('OWN')
  })

  it('the same number at both looks is read', () => {
    const path = anOwnSignIn()
    fake.looked.set(path, ONE)
    fake.opened.set(path, ONE)
    expect(fallbackSignIn({ path, managedRoot: root })?.toString('utf8')).toContain('OWN')
  })
})

describe('a profile’s copy of a Codex sign-in, told from another', () => {
  let helper: string
  let computers: string
  beforeEach(() => {
    helper = join(root, 'homes', 'farah', 'codex')
    mkdirSync(helper, { recursive: true })
    writeFileSync(join(helper, 'auth.json'), signIn('DEAD', '2026-10-08T22:00:00Z'))
    computers = join(root, 'the-computers.json')
    writeFileSync(computers, signIn('FRESH', '2026-10-09T02:35:11Z'))
  })
  const theCopy = () => join(helper, 'auth.json')
  const replace = (refused: NonNullable<ReturnType<typeof codexCopyIdentityIn>>) =>
    replaceARefusedCodexCopy(helper, {
      managedRoot: root,
      refused,
      stillWanted: () => true,
      candidates: [{ from: 'the-computers', sourceAuthPath: computers }],
    })

  it('🔴 a copy whose number moved past 2^53 is another copy', () => {
    fake.looked.set(theCopy(), ONE)
    const before = codexCopyIdentityIn(helper)
    fake.looked.set(theCopy(), ANOTHER)
    expect(isTheSameCodexCopy(before, codexCopyIdentityIn(helper))).toBe(false)
  })

  it('the same copy, looked at twice, is the same', () => {
    fake.looked.set(theCopy(), ONE)
    expect(isTheSameCodexCopy(codexCopyIdentityIn(helper), codexCopyIdentityIn(helper))).toBe(true)
  })

  it('🔴 a refused copy that is another file by now is left alone', async () => {
    fake.looked.set(theCopy(), ONE)
    const refused = codexCopyIdentityIn(helper)!
    fake.looked.set(theCopy(), ANOTHER)
    expect(await replace(refused)).toBe('not-tried')
  })

  it('a refused copy that is still that file is replaced', async () => {
    fake.looked.set(theCopy(), ONE)
    expect(await replace(codexCopyIdentityIn(helper)!)).toBe('the-computers')
  })
})

describe('a provider home’s folders and its lock', () => {
  it('🔴 a folder whose number moved past 2^53 after it was checked is refused', () => {
    const home = join(root, 'homes', 'farah', 'codex')
    mkdirSync(home, { recursive: true })
    fake.looked.set(home, ONE)
    fake.opened.set(home, ONE)
    const ancestry = trustProviderHomeAncestry(root, home, { includeLeaf: true })
    try {
      ancestry.verify()
      fake.looked.set(home, ANOTHER)
      expect(() => ancestry.verify()).toThrow(/replaced after it was checked/)
    } finally {
      ancestry.release()
    }
  })

  it('🔴 a lock that is another file by its release is left where it is', async () => {
    const home = join(root, 'homes', 'farah', 'codex')
    mkdirSync(home, { recursive: true })
    const lock = `${home}.lock`
    await withProviderHomeLock(home, () => {
      fake.opened.set(lock, ONE)
      fake.looked.set(lock, ANOTHER)
    })
    expect(existsSync(lock)).toBe(true)
  })

  it('our own lock is removed at its release', async () => {
    const home = join(root, 'homes', 'farah', 'codex')
    mkdirSync(home, { recursive: true })
    const lock = `${home}.lock`
    await withProviderHomeLock(home, () => {
      fake.opened.set(lock, ONE)
      fake.looked.set(lock, ONE)
    })
    expect(existsSync(lock)).toBe(false)
  })
})

describe('a stale lock, judged and then broken', () => {
  // The home is taken again with a new file at the lock's name, made as Windows makes one.
  beforeEach(() => {
    fake.windowsCreate = true
  })

  /** An empty lock nobody stamped, an hour old: a corpse by its age. */
  function aStaleLock(): { home: string; lock: string } {
    const home = join(root, 'homes', 'farah', 'codex')
    mkdirSync(home, { recursive: true })
    const lock = `${home}.lock`
    writeFileSync(lock, '')
    const anHourAgo = new Date(Date.now() - 3_600_000)
    utimesSync(lock, anHourAgo, anHourAgo)
    return { home, lock }
  }
  /** Where a break moves the lock it judged: `<lock>.stale-<pid>-<n>`. */
  const stolen = (lock: string) => `${lock}.stale-*`
  const leftovers = (lock: string) =>
    readdirSync(join(lock, '..')).filter((name) => name.includes('.stale-'))

  for (const read of ['through a descriptor', 'by its entry alone'] as const) {
    const numbers = read === 'through a descriptor' ? fake.opened : fake.looked
    const unopened = (lock: string) => {
      if (read === 'by its entry alone') fake.unreadable.add(lock)
    }

    it(`🔴 ${read}: a lock that is another file by the break, numbers past 2^53 apart, is put back`, async () => {
      const { home, lock } = aStaleLock()
      unopened(lock)
      numbers.set(lock, ONE)
      // What the break moved: the same size, time and bytes, and another number.
      numbers.set(stolen(lock), ANOTHER)
      let ran = false
      await expect(
        withProviderHomeLock(home, () => (ran = true), { timeoutMs: 300, pollMs: 20 }),
      ).rejects.toThrow(/timed out acquiring provisioning lock/)
      expect(ran).toBe(false)
      expect(existsSync(lock), 'the moved lock was not put back').toBe(true)
      expect(leftovers(lock)).toEqual([])
    })

    it(`${read}: the lock it judged, the same number at the break, is broken and the home is taken`, async () => {
      const { home, lock } = aStaleLock()
      unopened(lock)
      numbers.set(lock, ONE)
      numbers.set(stolen(lock), ONE)
      let ran = false
      await withProviderHomeLock(
        home,
        () => {
          // The home's own lock from here on is a real file with its real numbers.
          fake.looked.clear()
          fake.opened.clear()
          fake.unreadable.clear()
          ran = true
        },
        { timeoutMs: 2_000, pollMs: 20 },
      )
      expect(ran).toBe(true)
      expect(existsSync(lock)).toBe(false)
      expect(leftovers(lock)).toEqual([])
    })
  }
})
