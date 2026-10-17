import { readFileSync, realpathSync, watch } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { LocalZone, RuleDay, ZoneChange, ZoneRule } from '../shared/local-time'

/**
 * # 🔴 D-031 · R1 — the Mac's time zone, read off the file its own clock reads
 *
 * ⚑ **One read, in `main`, and every other reader asks `shared/local-time.ts`**, which this hands
 * the zone to. The file is the zone file `/etc/localtime` links to — macOS's own data, from the same
 * release as the ICU the Claude CLI links (`/var/db/timezone/tz/<release>/`) — parsed for its
 * changes and for the rule that governs every instant after the last of them (RFC 8536). ⛔ Not
 * this runtime's own zone data, which can be older than the Mac's (`local-time.ts` says why).
 *
 * ⚑ **`TZ` is read only as a zone NAME** (`Europe/Paris`, `:Europe/Paris`, `EST5EDT`): the file of
 * that name under `/usr/share/zoneinfo`, and an empty name is UTC — the forms the system's clock and
 * macOS's own ICU, which the Claude CLI links, read alike. A `TZ` this app was launched with is
 * passed on to the provider's process. ⛔ **A POSIX rule that names no zone file, or a path, is
 * refused**: the two read it differently (that ICU keeps the Mac's zone for a rule, and says UTC
 * for a path).
 *
 * ⛔ **Read-only, and refused rather than guessed**: such a `TZ`, or a file this reader does not
 * know whole — not a zone file, version 1, leap seconds, a rule with a day form the Mac's files
 * never use — is not read, and times are then said in this runtime's own zone data, which `main`'s
 * log says once.
 */

/**
 * ⚑ The link the system's clock reads — a change of the Mac's zone, by hand or as it travels,
 * re-points it.
 */
const THE_SYSTEMS_ZONE = '/etc/localtime'

/**
 * ⚑ The link to the release of the Mac's zone data — an update of the data re-points it (as 2026c
 * arrived), and leaves {@link THE_SYSTEMS_ZONE} as it was: that link's file, and every zone NAME,
 * is read through this one.
 */
const THE_SYSTEMS_RELEASE = '/var/db/timezone/zoneinfo'

/** ⚑ Where a zone NAME is a file — the system's own zone files. */
const ZONE_FILES = '/usr/share/zoneinfo'

/** ⚑ A TZif header: the magic, the version and six counts. */
const HEADER_BYTES = 44

/** ⚑ UTC — what an empty `TZ`, or a bare `:`, names. */
const UTC: LocalZone = { before: 0, changes: [], rule: { standard: 0, daylight: null } }

/**
 * 🔴 **Read the Mac's zone now, and again whenever it may have moved** — the reader of the zone
 * held, for `readLocalTimeFrom`, and `moved` after each re-read that found another zone.
 *
 * ⚑ **The trigger is the links themselves**: a watch on the folder that holds each, for its name.
 * The zone's link — a person's change and the Mac's own both re-point it; ⚠️ none when `TZ` is
 * set, as the zone is then this process's environment's. And the release's — an update of the
 * zone data while this app runs. ⛔ No poll, and no watch holds the process open.
 *
 * ⚠️ **Not read: `null`, and times are said in this runtime's own zone data** — said once in the
 * log, never to an agent or on screen. ⚑ A re-read that fails keeps the zone held, and says so once
 * until one succeeds.
 *
 * ⛔ **Called after `ready`, from `start()`**, so a refused second launch reads and watches nothing.
 */
export function keepTheSystemZone(moved: (zone: LocalZone) => void): () => LocalZone | null {
  let held: LocalZone | null = null
  let said = false
  const read = (): LocalZone | null => {
    try {
      const zone = readTheSystemZone()
      said = false
      return zone
    } catch (error) {
      if (!said) {
        console.warn(
          held === null
            ? `the system's time zone could not be read (${errorMessage(error)}), so times are said in this app's own zone data`
            : `the system's time zone could not be read again (${errorMessage(error)}), so times are said in the zone it read before`,
        )
      }
      said = true
      return null
    }
  }
  held = read()
  const readAgain = (): void => {
    const zone = read()
    if (zone === null || (held !== null && sameZone(zone, held))) return
    held = zone
    moved(zone)
  }
  if (process.env.TZ === undefined)
    watchTheLink(THE_SYSTEMS_ZONE, "the system's time zone", readAgain)
  watchTheLink(THE_SYSTEMS_RELEASE, "the system's time-zone data", readAgain)
  return () => held
}

/**
 * The computer's zone read once, with nothing watched: for a window that only shows times, which
 * reads it again when it asks again. Null when it cannot be read.
 */
export function readTheSystemZoneNow(): LocalZone | null {
  try {
    return readTheSystemZone()
  } catch {
    return null
  }
}

/**
 * ⚑ **One watch on the folder that holds a link**, for the link's name — FSEvents reports a
 * re-pointed link as its name renamed. ⚠️ A watch that cannot start, or fails, leaves the zone it
 * last read, and says so once.
 */
function watchTheLink(link: string, what: string, changed: () => void): void {
  const name = basename(link)
  try {
    const watcher = watch(realpathSync(dirname(link)), { persistent: false }, (_kind, file) => {
      if (file === name) changed()
    })
    watcher.on('error', (error) => {
      console.warn(
        `${what} is no longer watched, so a change to it is read at the next launch at the latest (${errorMessage(error)})`,
      )
      watcher.close()
    })
  } catch (error) {
    console.warn(
      `${what} cannot be watched, so a change to it is read at the next launch at the latest (${errorMessage(error)})`,
    )
  }
}

/**
 * ⚑ Two reads of one zone — a watch reports a re-pointed link more than once, and a new release of
 * the data mostly leaves the Mac's zone as it was.
 */
function sameZone(a: LocalZone, b: LocalZone): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * ⚑ The zone the system's clock reads — `TZ`'s NAME, else the link's. Throws why not: a name that
 * is no zone file under {@link ZONE_FILES}, and ⛔ a path — absolute, or one that climbs out of it.
 */
function readTheSystemZone(): LocalZone {
  const tz = process.env.TZ
  if (tz === undefined) return zoneOfFile(readFileSync(THE_SYSTEMS_ZONE))
  const name = tz.startsWith(':') ? tz.slice(1) : tz
  if (name === '') return UTC
  if (isAbsolute(name) || name.split('/').includes('..')) {
    throw new Error(`a TZ that is not a zone name: ${tz}`)
  }
  return zoneOfFile(readFileSync(join(ZONE_FILES, name)))
}

/** ⚑ The six counts a TZif header carries. */
interface Counts {
  readonly utc: number
  readonly std: number
  readonly leap: number
  readonly times: number
  readonly types: number
  readonly chars: number
}

/** ⚑ The TZif header at `at`. Throws when there is none. */
function countsAt(bytes: Buffer, at: number): Counts {
  if (bytes.length < at + HEADER_BYTES || bytes.toString('latin1', at, at + 4) !== 'TZif') {
    throw new Error('not a zone file')
  }
  return {
    utc: bytes.readUInt32BE(at + 20),
    std: bytes.readUInt32BE(at + 24),
    leap: bytes.readUInt32BE(at + 28),
    times: bytes.readUInt32BE(at + 32),
    types: bytes.readUInt32BE(at + 36),
    chars: bytes.readUInt32BE(at + 40),
  }
}

/**
 * ⚑ **A TZif file of version 2 or 3** (RFC 8536): its 64-bit block's changes, each with the offset
 * of the type it selects, type 0's offset before the first, and its footer's rule after the last.
 */
function zoneOfFile(bytes: Buffer): LocalZone {
  const first = countsAt(bytes, 0)
  const version = bytes.toString('latin1', 4, 5)
  if (version !== '2' && version !== '3') {
    throw new Error('a zone file of a version other than 2 or 3')
  }
  const second =
    HEADER_BYTES +
    first.times * 5 +
    first.types * 6 +
    first.chars +
    first.leap * 8 +
    first.std +
    first.utc
  const { utc, std, leap, times, types, chars } = countsAt(bytes, second)
  if (leap > 0) throw new Error('a zone file that counts leap seconds')
  if (types === 0) throw new Error('a zone file with no local time')
  const timesAt = second + HEADER_BYTES
  const kindsAt = timesAt + times * 8
  const typesAt = kindsAt + times
  const footerAt = typesAt + types * 6 + chars + std + utc
  if (bytes.length <= footerAt || bytes[footerAt] !== 0x0a) throw new Error('a zone file cut short')
  const offsetOf = (type: number): number => {
    if (type >= types) throw new Error('a zone file that names a local time it does not hold')
    return bytes.readInt32BE(typesAt + type * 6) * 1000
  }
  const changes: ZoneChange[] = []
  for (let each = 0; each < times; each += 1) {
    const at = Number(bytes.readBigInt64BE(timesAt + each * 8)) * 1000
    if (at <= (changes[changes.length - 1]?.at ?? Number.NEGATIVE_INFINITY)) {
      throw new Error('a zone file whose changes are out of order')
    }
    changes.push({ at, offset: offsetOf(bytes[kindsAt + each] ?? types) })
  }
  const footerEnd = bytes.indexOf(0x0a, footerAt + 1)
  if (footerEnd < 0) throw new Error('a zone file cut short')
  const footer = bytes.toString('latin1', footerAt + 1, footerEnd)
  return { before: offsetOf(0), changes, rule: footer === '' ? null : ruleOf(footer) }
}

/**
 * ⚑ **A zone file's footer, a POSIX zone rule** — `std offset [dst [offset],start[/time],end[/time]]`, its names plain
 * (`CET`) or quoted (`<+00>`), with TZif's own widening of the times to ±167 hours. ⚠️ POSIX counts
 * an offset WEST of UTC; this answers east. ⛔ Only the `Mm.w.d` day form — the one the Mac's zone
 * files use — and a daylight time with no rule of its own is refused, not guessed.
 */
function ruleOf(text: string): ZoneRule {
  let at = 0
  const refused = (): Error => new Error(`a zone rule this app does not read: ${text}`)
  const name = (): void => {
    if (text[at] === '<') {
      const close = text.indexOf('>', at)
      if (close < 0) throw refused()
      at = close + 1
      return
    }
    const letters = /^[A-Za-z]{3,}/.exec(text.slice(at))
    if (letters === null) throw refused()
    at += letters[0].length
  }
  const duration = (hoursAtMost: number): number => {
    const read = /^([+-]?)(\d{1,3})(?::(\d{1,2}))?(?::(\d{1,2}))?/.exec(text.slice(at))
    if (read === null || Number(read[2]) > hoursAtMost) throw refused()
    at += read[0].length
    const seconds = (Number(read[2]) * 60 + Number(read[3] ?? 0)) * 60 + Number(read[4] ?? 0)
    return (read[1] === '-' ? -seconds : seconds) * 1000
  }
  const day = (): RuleDay => {
    const read = /^,M(\d{1,2})\.([1-5])\.([0-6])/.exec(text.slice(at))
    const month = Number(read?.[1])
    if (read === null || month < 1 || month > 12) throw refused()
    at += read[0].length
    let time = 2 * 3_600_000
    if (text[at] === '/') {
      at += 1
      time = duration(167)
    }
    return { month, week: Number(read[2]), weekday: Number(read[3]), time }
  }
  name()
  const standard = 0 - duration(24)
  if (at === text.length) return { standard, daylight: null }
  name()
  const offset = text[at] === ',' ? standard + 3_600_000 : 0 - duration(24)
  const starts = day()
  const ends = day()
  if (at !== text.length) throw refused()
  return { standard, daylight: { offset, starts, ends } }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
