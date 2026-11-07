import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../../src/main/db/connection'
import { applyMigrations } from '../../src/main/db/migrate'
import { createSessionStore } from '../../src/main/db/session-store'
import { archivedInMemory, type ArchivedConversations } from '../../src/main/archived-file'

/**
 * A fictional workspace at the size a busy person runs, written into a real database through the
 * real migrations, on its own connection, before any store or host under test opens it. The same
 * seed always writes the same rows. Beside the rows it returns two oracles computed from its own
 * inputs, never from a host answer: an identity digest, and what each population must hold.
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../../src/main/db/migrations')

export interface ProfileSize {
  /** Conversations listed and not archived. */
  readonly live: number
  /** Conversations with history only, archived, each holding routed questions. */
  readonly historical: number
  /** Children of the one busy parent, counted inside `live`. */
  readonly children: number
  readonly pieces: number
  /** `question_asked` events, each with its routing. */
  readonly questions: number
  readonly identities: number
  /** Unrelated rows per question event. */
  readonly ballastPerQuestion: number
  /** One ballast row in this many is large enough to overflow its page. */
  readonly overflowEvery: number
}

export const TYPICAL: ProfileSize = {
  live: 700,
  historical: 0,
  children: 300,
  pieces: 3_000,
  questions: 7_000,
  identities: 60,
  ballastPerQuestion: 10,
  overflowEvery: 200,
}

export const EXTREME: ProfileSize = {
  ...TYPICAL,
  historical: 2_500,
  questions: 70_000,
  ballastPerQuestion: 2,
}

/** A smaller copy for fast checks of the generator itself. */
export function scaled(size: ProfileSize, factor: number): ProfileSize {
  const scale = (n: number) => Math.max(n === 0 ? 0 : 1, Math.round(n * factor))
  return {
    ...size,
    live: scale(size.live),
    historical: scale(size.historical),
    children: scale(size.children),
    pieces: scale(size.pieces),
    questions: scale(size.questions),
    identities: scale(size.identities),
  }
}

export const OWNER = 'fictional-owner'

/** What the host's answers must hold, derived from the generator's own choices. */
interface Expectation {
  /** Open pieces per owner. */
  readonly openPieces: ReadonlyMap<string, number>
  /** Open routed requests per asker, by request id, with the recipient. */
  readonly openRoutes: ReadonlyMap<string, ReadonlyMap<string, string>>
  /** Open questions routed to a person, by asker and request id. */
  readonly personQuestions: readonly string[]
  /** Open permission decisions waiting on a person, by asker and request id. */
  readonly decisions: readonly string[]
  /** The conversations holding a copy of each passed-up request. */
  readonly copyHolders: ReadonlyMap<string, readonly string[]>
  /** Unreadable rows planted per kind. */
  readonly malformed: { readonly routes: number; readonly questions: number }
  readonly instructionAsks: number
  readonly mcpRequests: number
  readonly replacements: ReadonlyMap<string, string>
  readonly children: readonly string[]
  readonly archived: readonly string[]
}

export interface RealisticProfile {
  readonly file: string
  readonly live: readonly string[]
  /** The archive a host over this file is given: the historical conversations, archived. */
  archive(): ArchivedConversations
  readonly digest: string
  readonly counts: Readonly<Record<string, number>>
  readonly expected: Expectation
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const AT = 1_800_000_000_000
const CWD = '/fictional/work'
const INLINE = JSON.stringify({ type: 'text', text: 'fictional history '.repeat(80) })
const OVERFLOW = JSON.stringify({ type: 'text', text: 'fictional long output '.repeat(3_000) })

export function aRealisticProfile(file: string, size: ProfileSize, seed = 1): RealisticProfile {
  const random = mulberry32(seed)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!
  const db = openDatabase(file)
  applyMigrations(db, migrations)
  const store = createSessionStore(db, () => AT, undefined, mulberry32(seed + 1))
  const next = new Map<string, number>()
  const ordinal = (session: string) => {
    const n = next.get(session) ?? 0
    next.set(session, n + 1)
    return n
  }
  const insert = db.prepare(
    'INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)',
  )
  let rowId = 0
  const row = (session: string, type: string, payload: object | string) =>
    insert.run(
      `fixture-${String(++rowId)}`,
      session,
      ordinal(session),
      type,
      typeof payload === 'string' ? payload : JSON.stringify(payload),
      AT + rowId,
    )

  const openPieces = new Map<string, number>()
  const openRoutes = new Map<string, Map<string, string>>()
  const personQuestions: string[] = []
  const decisions: string[] = []
  const copyHolders = new Map<string, string[]>()
  const replacements = new Map<string, string>()
  const malformed = { routes: 0, questions: 0 }
  const children: string[] = []
  const archived: string[] = []
  const live: string[] = []
  const asks = Math.max(1, Math.round(size.live / 35))

  db.transaction(() => {
    const slugs: string[] = []
    for (let n = 0; n < size.identities; n++) {
      const slug = `fictional-role-${String(n + 1)}`
      store.createAgentIdentity(
        { slug, displayName: `Fictional ${String(n + 1)}`, provider: 'codex' },
        { by: 'a-person' },
      )
      slugs.push(slug)
    }
    const conversation = (id: string, parent?: string) => {
      store.create({
        id,
        provider: 'codex',
        cwd: CWD,
        approvalMode: 'ask',
        profileId: pick(slugs),
        ...(parent === undefined ? {} : { parentSessionId: parent }),
      })
      // Through the store, which records the provider's reference: the row is resumable.
      store.append(
        id,
        ordinal(id),
        {
          type: 'session',
          state: 'started',
          ref: { provider: 'codex', sessionId: `thread-${id}`, cwd: CWD, rotation: 0 },
        },
        AT,
      )
    }
    conversation(OWNER)
    live.push(OWNER)
    for (let n = 0; n < size.children; n++) {
      const id = `fictional-child-${String(n + 1)}`
      conversation(id, OWNER)
      children.push(id)
      live.push(id)
    }
    for (let n = live.length; n < size.live; n++) {
      const id = `fictional-other-${String(n + 1)}`
      conversation(id)
      live.push(id)
    }
    for (let n = 0; n < size.historical; n++) {
      const id = `fictional-past-${String(n + 1)}`
      conversation(id)
      archived.push(id)
    }
    const roots = live.filter((id) => !id.startsWith('fictional-child-'))

    for (let n = 0; n < size.pieces; n++) {
      const giver = n < size.children ? OWNER : pick(roots)
      const owner = n < size.children ? children[n]! : pick(live.filter((id) => id !== giver))
      const root = store.rootOf(giver)!
      const number = store.numberUnder(root.piece)
      const piece = `work_fictional_${String(n + 1)}`
      const given = {
        type: 'work_given' as const,
        piece,
        label: `${root.label}.${String(number)}`,
        parent: root.piece,
        givenBy: giver,
        title: `Fictional piece ${String(n + 1)}`,
        brief: 'Fictional brief.',
      }
      store.recordGive(
        {
          piece,
          parent: root.piece,
          number,
          owner,
          givenBy: giver,
          title: given.title,
          brief: given.brief,
          folder: null,
          inputs: [],
        },
        ordinal(owner),
        given,
        AT + n,
      )
      const fate = random()
      if (fate < 0.25)
        row(owner, 'work_replied', {
          type: 'work_replied',
          piece,
          outcome: 'done',
          summary: 'Done.',
          resources: [],
        })
      else if (fate < 0.4) row(owner, 'work_closed', { type: 'work_closed', piece, by: giver })
      else openPieces.set(owner, (openPieces.get(owner) ?? 0) + 1)
    }

    const askers = [...live, ...archived]
    const routedToAgents: { asker: string; requestId: string; to: string }[] = []
    for (let n = 0; n < size.questions; n++) {
      const asker = n < archived.length * 2 ? archived[n % archived.length]! : pick(askers)
      const requestId = `request-fictional-${String(n + 1)}`
      const kind = random()
      if (kind < 0.03) {
        row(asker, 'question_asked', '{not json')
        row(asker, 'request_routed', '{not json')
        malformed.questions++
        malformed.routes++
        continue
      }
      const copyOf = kind < 0.13 && routedToAgents.length > 0 ? pick(routedToAgents) : null
      const passer = copyOf === null ? asker : copyOf.to
      row(passer, 'question_asked', {
        type: 'question_asked',
        requestId,
        prompt: 'Which fictional option?',
        questions: [],
        ...(copyOf === null ? {} : { passedUpFrom: copyOf.requestId }),
      })
      if (copyOf !== null) {
        const holders = copyHolders.get(copyOf.requestId) ?? []
        if (!holders.includes(passer)) holders.push(passer)
        copyHolders.set(copyOf.requestId, holders)
      }
      const toPerson = kind >= 0.13 && kind < 0.2
      const recipient = pick(live.filter((id) => id !== passer))
      row(
        passer,
        'request_routed',
        toPerson
          ? { type: 'request_routed', requestId, to: 'a-person' }
          : { type: 'request_routed', requestId, to: 'the-parent', parent: recipient },
      )
      if (!toPerson) routedToAgents.push({ asker: passer, requestId, to: recipient })
      if (random() < 0.5) {
        row(passer, 'user_decision', { type: 'user_decision', requestId, outcome: 'answered' })
        continue
      }
      if (toPerson) {
        personQuestions.push(`${passer} ${requestId}`)
      } else {
        const open = openRoutes.get(passer) ?? new Map<string, string>()
        open.set(requestId, recipient)
        openRoutes.set(passer, open)
      }
    }

    for (let n = 0; n < Math.round(size.questions / 140); n++) {
      const asker = pick(live)
      const requestId = `permission-fictional-${String(n + 1)}`
      row(asker, 'permission_request', {
        type: 'permission_request',
        id: requestId,
        kind: 'command',
        action: 'Run a fictional command',
        detail: 'fictional',
      })
      row(asker, 'request_routed', {
        type: 'request_routed',
        requestId,
        to: 'a-person',
        because: 'a-permission-decision',
      })
      decisions.push(`${asker} ${requestId}`)
    }

    for (let n = 0; n < asks; n++) {
      const asker = pick(live)
      row(asker, 'instruction_proposed', {
        type: 'instruction_proposed',
        askId: `ask-fictional-${String(n + 1)}`,
        ask: 'propose',
        about: pick(slugs),
        proposedBy: pick(slugs),
        text: 'Fictional rules.',
        why: 'Fictional reason.',
      })
      row(asker, 'mcp_server_requested', {
        type: 'mcp_server_requested',
        requestId: `mcp-fictional-${String(n + 1)}`,
        name: `fictional-${String(n + 1)}`,
        url: 'https://fictional.invalid/mcp',
        reaches: 'Fictional data.',
        whoGetsIt: 'everyone',
        requestedBy: pick(slugs),
      })
    }

    const others = live.filter((id) => id.startsWith('fictional-other-'))
    for (let n = 0; n + 1 < others.length && n < 20; n += 2) {
      row(others[n]!, 'replaced_by', { type: 'replaced_by', sessionId: others[n + 1]! })
      replacements.set(others[n]!, others[n + 1]!)
    }

    const ballast = size.questions * size.ballastPerQuestion
    for (let n = 0; n < ballast; n++)
      row(pick(askers), 'text', n % size.overflowEvery === 0 ? OVERFLOW : INLINE)
  })()

  const counts = Object.fromEntries(
    (
      db.prepare('SELECT type, count(*) AS n FROM events GROUP BY type ORDER BY type').all() as {
        type: string
        n: number
      }[]
    ).map((one) => [one.type, one.n]),
  )
  // Store-minted event and work ids are random, so rows are identified by where they sit.
  const ids = (
    db
      .prepare('SELECT session_id, generation, ordinal, type FROM events ORDER BY 1, 2, 3')
      .raw()
      .all() as unknown[][]
  )
    .map((one) => one.join(' '))
    .join('\n')
  const digest = createHash('sha256').update(JSON.stringify(counts)).update(ids).digest('hex')
  db.close()
  return {
    file,
    live,
    archive() {
      const kept = archivedInMemory()
      if (archived.length > 0) kept.add(archived, AT)
      return kept
    },
    digest,
    counts,
    expected: {
      openPieces,
      openRoutes,
      personQuestions: personQuestions.sort(),
      decisions: decisions.sort(),
      copyHolders,
      malformed,
      instructionAsks: asks,
      mcpRequests: asks,
      replacements,
      children,
      archived,
    },
  }
}
