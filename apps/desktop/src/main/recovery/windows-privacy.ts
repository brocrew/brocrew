import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { retrying } from './files'

/**
 * Makes a folder BroBot made readable by this user alone on Windows, as mode 0700 does elsewhere.
 *
 * A folder's access on Windows is its access-control list, which a new folder inherits from its
 * parent: under the usual data folder, inside the user's profile, that is this user, SYSTEM and the
 * Administrators group; under a folder elsewhere it can include every user. So after making a
 * workspace's folder, `backups/` or `recovery/`, its list is read, and when anyone else may read it,
 * the list is replaced by those three alone, which what is made inside then inherits. When that
 * cannot be done, the caller is told why and decides (`data-folder-privacy.ts`).
 *
 * The list is read as SDDL, whose accounts are SIDs or fixed two-letter aliases in every language,
 * from Windows' own `whoami.exe` and `icacls.exe`. A list it cannot read to its end counts as one
 * that lets anyone in.
 */

/** SYSTEM and the Administrators group, who may read every folder on the computer anyway. */
export const SYSTEM_SID = 'S-1-5-18'
export const ADMINISTRATORS_SID = 'S-1-5-32-544'

/**
 * The SDDL aliases whose SID is the same on every computer. The others name an account or group of
 * a domain or of this computer: `LA` and `LG` (this computer's own Administrator and Guest) are
 * resolved from this computer's SID ({@link accessEntries}); the domain's groups (`DA`, `DU`, …) are
 * never this user, and stay unresolved, which counts them as someone else.
 */
const ALIASES: Readonly<Record<string, string>> = {
  SY: SYSTEM_SID,
  BA: ADMINISTRATORS_SID,
  BU: 'S-1-5-32-545',
  BG: 'S-1-5-32-546',
  PU: 'S-1-5-32-547',
  WD: 'S-1-1-0',
  AU: 'S-1-5-11',
  AN: 'S-1-5-7',
  IU: 'S-1-5-4',
  NU: 'S-1-5-2',
  LS: 'S-1-5-19',
  NS: 'S-1-5-20',
  CO: 'S-1-3-0',
  CG: 'S-1-3-1',
  OW: 'S-1-3-4',
  AC: 'S-1-15-2-1',
  PS: 'S-1-5-10',
  RC: 'S-1-5-12',
  WR: 'S-1-5-33',
  SU: 'S-1-5-6',
  ED: 'S-1-5-9',
  PO: 'S-1-5-32-550',
  SO: 'S-1-5-32-549',
  BO: 'S-1-5-32-551',
  RE: 'S-1-5-32-552',
  RU: 'S-1-5-32-554',
  RD: 'S-1-5-32-555',
  NO: 'S-1-5-32-556',
  MU: 'S-1-5-32-558',
  LU: 'S-1-5-32-559',
  IS: 'S-1-5-32-568',
  CY: 'S-1-5-32-569',
  ER: 'S-1-5-32-573',
  CD: 'S-1-5-32-574',
  AA: 'S-1-5-32-579',
  AO: 'S-1-5-32-548',
  AS: 'S-1-18-1',
  ES: 'S-1-5-32-576',
  HA: 'S-1-5-32-578',
  MS: 'S-1-5-32-577',
  RA: 'S-1-5-32-575',
  RM: 'S-1-5-32-580',
  SS: 'S-1-18-2',
  UD: 'S-1-5-84-0-0-0-0-0',
}

/** The aliases of this computer's own accounts, by the RID they add to this computer's SID. */
const THIS_COMPUTERS: Readonly<Record<string, string>> = { LA: '500', LG: '501' }

/** Everyone, which a list with no entries at all (a NULL DACL) lets in. */
const EVERYONE_SID = 'S-1-1-0'

/** One entry of a folder's access-control list. */
export interface AccessEntry {
  readonly allows: boolean
  /** A SID, or `alias:XX` for an alias that could not be resolved to one. */
  readonly sid: string
}

/**
 * Whether `sddl` holds no DACL at all, as a drive that keeps no access lists (FAT, exFAT) answers:
 * everyone may do anything, and nothing can be limited.
 */
export function hasNoAccessList(sddl: string): boolean {
  return /D:[A-Z_]*NO_ACCESS_CONTROL/.test(sddl)
}

/** File and directory rights that can change a parent or entries below it. */
function changesDirectory(rights: string): boolean {
  const bits: Readonly<Record<string, number>> = {
    CC: 1,
    DC: 2,
    LC: 4,
    SW: 8,
    RP: 16,
    WP: 32,
    DT: 64,
    LO: 128,
    CR: 256,
    SD: 0x10000,
    RC: 0x20000,
    WD: 0x40000,
    WO: 0x80000,
    GA: 0x10000000,
    GX: 0x20000000,
    GW: 0x40000000,
    GR: 0x80000000,
    FA: 0x1f01ff,
    FR: 0x120089,
    FW: 0x120116,
    FX: 0x1200a0,
    KA: 0xf003f,
    KR: 0x20019,
    KW: 0x20006,
    KX: 0x20019,
  }
  let mask = 0
  if (/^(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(rights)) {
    mask = Number(rights)
    if (!Number.isSafeInteger(mask) || mask > 0xffffffff) throw new Error('unreadable rights mask')
  } else {
    for (const token of rights.match(/../g) ?? []) mask |= bits[token] ?? 0
  }
  return (mask & 0x500d0156) !== 0
}

/**
 * The entries of `sddl`'s DACL, in order, each naming its account by SID. `machine` is this
 * computer's SID, which `LA` and `LG` are resolved from; without it they stay unresolved. Throws when
 * the DACL is not one this reads to its end.
 */
export function accessEntries(
  sddl: string,
  machine: string | null = null,
  options: { includeInheritOnly?: boolean; mutationOnly?: boolean } = {},
): AccessEntry[] {
  const start = sddl.indexOf('D:')
  if (start < 0) throw new Error('the access list has no DACL')
  const flags = /^[A-Z_]*/.exec(sddl.slice(start + 2))?.[0] ?? ''
  // No DACL at all: everyone may do anything.
  if (flags.includes('NO_ACCESS_CONTROL')) return [{ allows: true, sid: EVERYONE_SID }]
  const entries: AccessEntry[] = []
  let at = start + 2 + flags.length
  while (sddl[at] === '(') {
    // An entry ends at the parenthesis that closes it; a condition inside one has its own.
    let depth = 0
    let end = at
    for (; end < sddl.length; end += 1) {
      if (sddl[end] === '(') depth += 1
      if (sddl[end] === ')') depth -= 1
      if (depth === 0) break
    }
    if (depth !== 0) throw new Error('the access list ends inside an entry')
    const fields = sddl.slice(at + 1, end).split(';')
    const rights = fields[2] ?? ''
    if (
      fields.length < 6 ||
      !fields[5] ||
      (rights !== '' &&
        !/^(?:0[xX][0-9a-fA-F]+|[0-9]+|(?:CC|DC|LC|SW|RP|WP|DT|LO|CR|SD|RC|WD|WO|GA|GX|GW|GR|FA|FR|FW|FX|KA|KR|KW|KX)+)$/.test(
          rights,
        ))
    )
      throw new Error('the access list holds an unreadable entry')
    const grantsRights =
      rights !== '' &&
      !/^(?:0[xX])?0+$/.test(rights) &&
      (!options.mutationOnly || changesDirectory(rights))
    const appliesHere = options.includeInheritOnly || !(fields[1] ?? '').includes('IO')
    const account = fields[5] ?? ''
    entries.push({
      allows: Boolean(appliesHere && grantsRights && !/^(D|OD|XD)$/.test(fields[0] ?? '')),
      sid: account.startsWith('S-') ? account : sidOf(account, machine),
    })
    at = end + 1
  }
  const rest = sddl.slice(at)
  if (rest !== '' && !rest.startsWith('S:')) {
    throw new Error('the access list holds something BroCrew does not read')
  }
  return entries
}

function sidOf(alias: string, machine: string | null): string {
  const fixed = ALIASES[alias]
  if (fixed !== undefined) return fixed
  const rid = THIS_COMPUTERS[alias]
  if (rid !== undefined && machine !== null) return `${machine}-${rid}`
  return `alias:${alias}`
}

/** The accounts besides `user`, SYSTEM and Administrators that an entry lets in, each once. */
export function othersLetIn(entries: readonly AccessEntry[], user: string): string[] {
  const trusted = new Set([user, SYSTEM_SID, ADMINISTRATORS_SID])
  return [
    ...new Set(
      entries.filter(({ allows, sid }) => allows && !trusted.has(sid)).map(({ sid }) => sid),
    ),
  ]
}

/** What reading and changing a folder's list takes. */
export interface AccessLists {
  /** This user's SID. */
  userSid(): Promise<string>
  /** This computer's own SID, when this user is one of its local accounts; null otherwise. */
  machineSid(): Promise<string | null>
  /** The folder's security descriptor, as SDDL. */
  read(folder: string): Promise<string>
  /** Lets in only `user`, SYSTEM and Administrators, and stops inheriting from the parent. */
  restrict(folder: string, user: string, others: readonly string[]): Promise<void>
}

/** A folder's access list and its owner, checked separately from its grants. */
export interface OwnedAccessLists extends AccessLists {
  ownerSid(folder: string): Promise<string>
}

/** What reading and limiting one file's list takes. */
export interface FileAccessLists {
  /** This user's SID. */
  userSid(): Promise<string>
  /** This computer's own SID, when this user is one of its local accounts; null otherwise. */
  machineSid(): Promise<string | null>
  /** The file's security descriptor, as SDDL. */
  read(file: string): Promise<string>
  /** Gives the file entries of its own for `user`, SYSTEM and Administrators, inheriting none. */
  restrictFile(file: string, user: string): Promise<void>
}

const TIME_LIMIT_MS = 15_000

function system32(program: string): string {
  return join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', program)
}

function run(program: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      system32(program),
      args,
      { timeout: TIME_LIMIT_MS, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
  })
}

/** This user's account, asked once a process: its SID, and the domain whoami names it in. */
let thisUser: { readonly sid: string; readonly domain: string } | null = null
/** This computer's SID, or null, asked once a process. */
let thisComputer: string | null | undefined

async function whoAmI(): Promise<{ readonly sid: string; readonly domain: string }> {
  if (thisUser !== null) return thisUser
  const said = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'])
  const line = /"([^"\\]*)\\[^"]*","(S-1-[0-9-]+)"/.exec(said)
  const sid = line?.[2] ?? /"(S-1-[0-9-]+)"/.exec(said)?.[1]
  if (sid === undefined) throw new Error('whoami named no SID for this user')
  thisUser = { sid, domain: line?.[1] ?? '' }
  return thisUser
}

/**
 * This computer's SID when this user is one of its local accounts: the user's SID without its last
 * part. A local account's token holds `S-1-5-113`, and whoami names it in the computer's own name.
 */
export function machineSidOf(
  user: string,
  groups: string,
  domain: string,
  computer: string | undefined,
): string | null {
  const local =
    groups.includes('"S-1-5-113"') ||
    (computer !== undefined && computer !== '' && domain.toLowerCase() === computer.toLowerCase())
  return local && /^S-1-5-21-\d+-\d+-\d+-\d+$/.test(user) ? user.replace(/-\d+$/, '') : null
}

/** Windows' own programs. */
export const windowsAccessLists: OwnedAccessLists & FileAccessLists = {
  async userSid() {
    return (await whoAmI()).sid
  },
  async machineSid() {
    if (thisComputer !== undefined) return thisComputer
    const { sid, domain } = await whoAmI()
    const groups = await run('whoami.exe', ['/groups', '/fo', 'csv', '/nh'])
    thisComputer = machineSidOf(sid, groups, domain, process.env['COMPUTERNAME'])
    return thisComputer
  },
  async ownerSid(folder) {
    const encoded = Buffer.from(folder, 'utf8').toString('base64')
    const script = `$ErrorActionPreference='Stop'; $path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); [IO.Directory]::GetAccessControl($path).GetOwner([Security.Principal.SecurityIdentifier]).Value`
    const sid = (
      await run('WindowsPowerShell\\v1.0\\powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
      ])
    ).trim()
    if (!/^S-1-[0-9]+(?:-[0-9]+)+$/.test(sid)) throw new Error('unreadable folder owner')
    return sid
  },
  async read(folder) {
    // `/save` writes the list as SDDL, in UTF-16; its second line is the descriptor.
    const saved = join(tmpdir(), `brobot2-acl-${randomBytes(6).toString('hex')}.txt`)
    try {
      await run('icacls.exe', [folder, '/save', saved, '/Q'])
      const text = (await readFile(saved)).toString('utf16le').replace(/^\uFEFF/, '')
      const sddl = text.split(/\r?\n/)[1]?.trim() ?? ''
      if (!sddl.includes('D:')) throw new Error('icacls saved no access list')
      return sddl
    } finally {
      // A scanner may hold the file a moment; one left behind in the temporary folder holds no data.
      await retrying(() => rm(saved, { force: true })).catch(() => undefined)
    }
  },
  async restrict(folder, user, others) {
    const full = (sid: string): string => `*${sid}:(OI)(CI)F`
    // The three are granted first, so the folder is never without them, then what it inherits goes.
    await run('icacls.exe', [
      folder,
      '/grant:r',
      full(user),
      full(SYSTEM_SID),
      full(ADMINISTRATORS_SID),
      '/Q',
    ])
    await run('icacls.exe', [folder, '/inheritance:r', '/Q'])
    // An entry the folder holds of its own, rather than inherited, stays until it is removed.
    const named = others.filter((sid) => sid.startsWith('S-'))
    if (named.length > 0) {
      await run('icacls.exe', [folder, '/remove:g', ...named.map((sid) => `*${sid}`), '/Q'])
    }
  },
  async restrictFile(file, user) {
    await run('icacls.exe', [
      file,
      '/grant:r',
      `*${user}:F`,
      `*${SYSTEM_SID}:F`,
      `*${ADMINISTRATORS_SID}:F`,
      '/Q',
    ])
    await run('icacls.exe', [file, '/inheritance:r', '/Q'])
  },
}

/**
 * A folder that could not be made readable by this user alone: `message` refuses it, and `reason`
 * says why in a few words, for a caller that goes on without it.
 */
export class NotKeptToThisUser extends Error {
  constructor(
    message: string,
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'NotKeptToThisUser'
  }
}

/**
 * On Windows, makes `folder` readable by this user, SYSTEM and Administrators alone, or throws
 * {@link NotKeptToThisUser} saying why it could not; elsewhere, does nothing (its mode does that).
 * Asked every time a folder is made, since a folder removed and made again takes its parent's list
 * again.
 */
export async function keepToThisUser(
  folder: string,
  lists: AccessLists = windowsAccessLists,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== 'win32') return
  const said = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  const check = (error: unknown): never => {
    throw new NotKeptToThisUser(
      `BroCrew could not check who may read ${folder}, so it did not use it: ${said(error)}`,
      `BroCrew could not check who may read it: ${said(error)}`,
      { cause: error },
    )
  }
  const othersNow = async (user: string): Promise<string[]> => {
    const machine = await lists.machineSid().catch(() => null)
    const sddl = await lists.read(folder)
    if (hasNoAccessList(sddl)) {
      throw new NotKeptToThisUser(
        `BroCrew could not make ${folder} readable by you alone: its drive keeps no access lists ` +
          '(FAT or exFAT), so it did not use it.',
        'its drive keeps no access lists (FAT or exFAT)',
      )
    }
    return othersLetIn(accessEntries(sddl, machine), user)
  }
  const user = await lists.userSid().catch(check)
  const passOn = (error: unknown): never => {
    if (error instanceof NotKeptToThisUser) throw error
    return check(error)
  }
  let others = await othersNow(user).catch(passOn)
  if (others.length > 0) {
    await lists.restrict(folder, user, others).catch((error: unknown): never => {
      throw new NotKeptToThisUser(
        `BroCrew could not make ${folder} readable by you alone, so it did not use it: ${said(error)}`,
        said(error),
        { cause: error },
      )
    })
    others = await othersNow(user).catch(passOn)
  }
  if (others.length > 0) {
    const stillOpen = `${String(others.length)} other account${others.length === 1 ? '' : 's'} may still read it`
    throw new NotKeptToThisUser(
      `BroCrew could not make ${folder} readable by you alone: ${stillOpen}, so it did not use it.`,
      stillOpen,
    )
  }
}

/**
 * On Windows, gives `file` a list of its own that lets in this user, SYSTEM and Administrators alone,
 * inheriting nothing from its folder, and checks it; throws {@link NotKeptToThisUser} when it could
 * not. A file made to take another's place takes its folder's list, which can let in accounts the
 * file it replaces did not. Elsewhere, does nothing.
 */
export async function keepFileToThisUser(
  file: string,
  lists: FileAccessLists = windowsAccessLists,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== 'win32') return
  const said = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  try {
    const user = await lists.userSid()
    await lists.restrictFile(file, user)
    await verifyFileToThisUser(file, lists, platform)
  } catch (error) {
    throw new NotKeptToThisUser(
      `BroCrew could not make ${file} readable by you alone: ${said(error)}`,
      said(error),
      { cause: error },
    )
  }
}

/** Checks the inherited file ACL without changing it or granting access to an existing handle. */
export async function verifyFileToThisUser(
  file: string,
  lists: Pick<FileAccessLists, 'userSid' | 'machineSid' | 'read'> = windowsAccessLists,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== 'win32') return
  const user = await lists.userSid()
  const machine = await lists.machineSid().catch(() => null)
  const sddl = await lists.read(file)
  if (hasNoAccessList(sddl)) throw new Error('its drive keeps no access lists (FAT or exFAT)')
  const others = othersLetIn(accessEntries(sddl, machine), user)
  if (others.length > 0) {
    throw new Error(
      `${String(others.length)} other account${others.length === 1 ? '' : 's'} may still read it`,
    )
  }
}
