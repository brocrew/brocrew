import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'
import { AN_AGENT_THIS_APP_CANNOT_NAME } from '../src/main/runtime/reply-rails'
import { resourceTitle, resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { DocumentForm } from '../src/shared/documents'
import type {
  FilesKept,
  KeptFile,
  RuntimeEventMessage,
  RuntimeStatesMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'

/**
 * # D-026 · a kept file is titled by its bytes, and one door lists the files a window draws
 *
 * D-026 gave a window one door to list the files this app keeps (`filesKept`: a conversation's
 * tree, one conversation, one piece), titled every file once as it is kept, and pushed each kept
 * file to every window on `runtime:states`. This file measures those three, and the rule that does
 * the titling, from the two ends a landing can reach:
 *
 *  - **§1 · the rule** (`resourceTitle`), read straight with no host: a Markdown file's first
 *    level-1 heading outside a fenced code block, a page's first `<title>` a browser would use, and
 *    the file's name for everything else — the headings that only look like one, the fences, the
 *    byte-level reading, the entities decoded once, the cap, and the forms with no text to read.
 *  - **§2 · the doors that write a title** — over a real `RuntimeHost`, a real ledger and the real
 *    toolsets (Fake provider only): a give's inputs, `update_work`'s files and a reply's files each
 *    keep the title their own bytes give, and `list_tasks {made}` says it only where it differs
 *    from the name.
 *  - **§3 · the door a window lists by** — one forest of four conversations and seven files, read
 *    by piece (a label or an id), by tree and by conversation: the rows, their order (a tenth
 *    sibling after a second), a conversation standing in for a replaced one, the words for a scope
 *    that names nothing, a piece's title as it stands now, the rows an old build left, and the wire
 *    that carries the command.
 *  - **§4 · the push** — every kept file reaches every window on `runtime:states` as the row the
 *    door answers, once its row is down: a reply's, `update_work`'s and a give's, never a call that
 *    kept nothing, and never costing the states, nor one piece's files another's.
 *
 * ⚑ Two rules of the file: **the bounds are literals** (200, 199, 198), so a changed constant is
 * read as a change and not followed; and **a negative is paired with a positive from the same
 * reader**, every presence asserted before an order or a text. ⚠️ The bytes handed to the rule are
 * always a `Buffer`: the rule decodes them itself, and a string would hide how it does.
 *
 * ⚑ Every file is kept by ONE `update_work` call so each takes its own `tick` timestamp (resource
 * ids are random: a shared timestamp would tie-break at random).
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

const shaOf = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the rule
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** What the rule answers for `content` kept under `name` as `form`. */
const titled = (name: string, form: DocumentForm, content: string | Buffer): string =>
  resourceTitle({
    name,
    form,
    bytes: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
  })

/** One text, and the title the rule must give it; every row names its case. */
type Case = readonly [what: string, text: string, expected: string]

/**
 * Every row of the table under one name. ⚑ The table must hold BOTH answers — a row the name
 * answers and a row a title found answers — so a function that returns the name for everything, or
 * never returns it, is not what passed.
 */
const readTable = (name: string, form: DocumentForm, table: readonly Case[]): void => {
  expect(
    table.some(([, , expected]) => expected === name),
    `${name}: the table holds a row answered by the name`,
  ).toBe(true)
  expect(
    table.some(([, , expected]) => expected !== name),
    `${name}: the table holds a row answered by a title found`,
  ).toBe(true)
  for (const [what, text, expected] of table) {
    expect(titled(name, form, text), `${name} · ${what}`).toBe(expected)
  }
}

/** Whether a string holds no lone surrogate. */
const hasALoneSurrogate = (text: string): boolean =>
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text)

describe('D-026 · the rule: a file is titled by what its own bytes say', () => {
  it('a Markdown file is titled by its first level-1 heading, and by its name when it has none or the first is empty', () => {
    const NAME = 'notes.md'
    const BOM = Buffer.from([0xef, 0xbb, 0xbf])
    readTable(NAME, 'markdown', [
      // ⚑ The positives first: each answers a heading, so the name below is the text's and not a
      // reader that never looks.
      ['a level-1 heading answers at all', '# Quarterly report\n\nbody\n', 'Quarterly report'],
      ['three spaces in is still a heading', '   # three spaces in\n', 'three spaces in'],
      ['the first of two headings', '# One\n# Two\n', 'One'],
      ['trimmed, inline Markdown kept as written', '#   **Bold** `code`  \n', '**Bold** `code`'],
      // ⚑ The closing run: dropped only when a space stands before it.
      ['a closing run is dropped', '# Title ##\n', 'Title'],
      ['a `#` that ends a word is kept', '# Learn C#\n', 'Learn C#'],
      ['a closing run after a word that ends in `#`', '# C# ##\n', 'C#'],
      // ⚑ Line ends: CRLF and a lone CR break a line like LF does.
      ['CRLF line ends', '# T\r\nbody', 'T'],
      ['a lone CR line end', '# T\rbody', 'T'],
      // ⛔ What only looks like a heading is not one: each is the name.
      ['`#Title` has no space after the `#`', '#Title\n', NAME],
      ['`## Sub` is level 2', '## Sub\n', NAME],
      ['four spaces in is code', '    # four spaces is code\n', NAME],
      ['plain words', 'plain words\n', NAME],
      // ⚑ An EMPTY first heading titles nothing, and a second is never looked for.
      ['a bare `#`, then a second heading', '#\n\n# Second\n', NAME],
      ['a `#` and a space, then a second heading', '# \n# Second\n', NAME],
    ])

    // ⚑ A leading byte order mark does not hide the first `#`; the twin with none is the same text.
    expect(titled(NAME, 'markdown', Buffer.concat([BOM, Buffer.from('# Titled\n')]))).toBe('Titled')
    expect(titled(NAME, 'markdown', '# Titled\n'), 'the same heading with no mark').toBe('Titled')
  })

  it('a heading inside a fenced code block is not the title: backtick and tilde fences, closed only by a run as long, and the first heading outside one is', () => {
    const NAME = 'notes.md'
    // ⚑ The paired positive: with the fence removed, the same line IS the heading.
    expect(titled(NAME, 'markdown', '# install\n'), 'the line with no fence').toBe('install')
    readTable(NAME, 'markdown', [
      ['a backtick fence holds the heading', '```sh\n# install\n```\n# Real\n', 'Real'],
      ['a tilde fence holds the heading', '~~~\n# tilde\n~~~\n# Real2\n', 'Real2'],
      [
        'a 4-backtick fence is not closed by a 3-backtick line',
        '````\n```\n# inside\n````\n# After\n',
        'After',
      ],
      ['a tilde line does not close a backtick fence', '```\n~~~\n# inside\n```\n# Out\n', 'Out'],
      ['an unclosed fence runs to the end', '```\n# never\n', NAME],
      ['a three-space-indented fence is a fence', '   ```\n# in\n   ```\n# Out\n', 'Out'],
      ['four spaces in is code, no fence', '    ```\n# Not in a fence\n', 'Not in a fence'],
      [
        'a backtick in a backtick fence’s info string opens none',
        '```js`x\n# Heading\n',
        'Heading',
      ],
    ])
  })

  it('a page is titled by the first title a browser would use: comments, script, style, svg and math are passed over and what is left unclosed gives none', () => {
    const NAME = 'p.html'
    readTable(NAME, 'page', [
      [
        'a plain page, whitespace collapsed and an entity decoded',
        '<!doctype html><title>Sales  &amp;\n  Costs</title>',
        'Sales & Costs',
      ],
      ['the tag in capitals, with an attribute', '<TITLE lang="en">Upper</TITLE>', 'Upper'],
      // ⚑ Each construct below is passed over, and the real <title> after it is what comes back.
      ['a <title> inside a comment', '<!-- <title>Old</title> --><title>Real</title>', 'Real'],
      ['`<!-->` is a whole comment', '<!--><title>After</title>', 'After'],
      [
        'a <title> in a script’s text',
        '<script>var t="<title>Fake</title>";</script><title>Real</title>',
        'Real',
      ],
      [
        'a <title> in a style’s text',
        '<style>/* <title>Fake</title> */</style><title>Real</title>',
        'Real',
      ],
      [
        'an <svg> tooltip',
        '<svg viewBox="0 0 1 1"><title>Tooltip</title></svg><title>Real</title>',
        'Real',
      ],
      [
        'an <svg> nested in an <svg>',
        '<svg><svg></svg><title>Inner</title></svg><title>Real</title>',
        'Real',
      ],
      ['a self-closed <svg/> holds nothing', '<svg/><title>Real</title>', 'Real'],
      ['a <math>', '<math><title>m</title></math><title>Real</title>', 'Real'],
      ['`<titles>` is not a title', '<titles>x</titles><title>Real</title>', 'Real'],
      // ⚠️ No title at all, and what is left unclosed, give the name.
      ['no title at all', '<p>x</p>', NAME],
      ['an empty <title>', '<title>  </title>', NAME],
      ['an unclosed <title>', '<title>Never', NAME],
      ['an unclosed comment', '<!-- <title>Hidden</title>', NAME],
      ['an unclosed <script>', '<script><title>x</title>', NAME],
      ['an unclosed <svg>', '<svg><title>x</title>', NAME],
    ])
  })

  it('a title is decoded in one pass, and what names no character stays as written', () => {
    const NAME = 'p.html'
    const page = (text: string): string => `<title>${text}</title>`
    readTable(NAME, 'page', [
      // ⚑ The positive of every refusal below: an entity that names a character is decoded.
      ['a named entity', page('Tom &amp; Jerry'), 'Tom & Jerry'],
      ['one pass: `&amp;lt;` stops at `&lt;`', page('&amp;lt;b&amp;gt;'), '&lt;b&gt;'],
      [
        'the common named entities',
        page('&lt;b&gt; &quot;q&quot; &apos;a&apos; &mdash; &hellip; &copy;'),
        '<b> "q" \'a\' — … ©',
      ],
      [
        'decimal, hex and capital-X hex, and an astral value',
        page('&#65;&#x42;&#X43;&#x1F600;'),
        'ABC😀',
      ],
      // ⚠️ What names no scalar value stays as written.
      ['zero', page('&#0;'), '&#0;'],
      ['a surrogate', page('&#xD800;'), '&#xD800;'],
      ['a value above 0x10FFFF', page('&#x110000;'), '&#x110000;'],
      ['an unknown name', page('&nosuch;'), '&nosuch;'],
      ['no semicolon', page('&amp'), '&amp'],
      ['a bare ampersand in a word', page('AT&T'), 'AT&T'],
      // ⚑ And what is left of a title with nothing in it is the name.
      ['an empty title', page(''), NAME],
    ])
  })

  it('a title found is cut at 200 characters ending in an ellipsis and never inside a surrogate pair, and a name is kept whole', () => {
    // ⚑ 200 whole beside 201 cut: the same heading, one character longer.
    const whole = titled('notes.md', 'markdown', `# ${'a'.repeat(200)}`)
    expect(whole, '200 characters').toBe('a'.repeat(200))
    expect(whole.endsWith('…'), '200 characters are not cut').toBe(false)
    const cut = titled('notes.md', 'markdown', `# ${'a'.repeat(201)}`)
    expect(cut, '201 characters').toBe(`${'a'.repeat(199)}…`)
    expect(cut.length, '201 characters, counted').toBe(200)

    // ⚠️ A pair that straddles the cut is dropped whole, and no lone surrogate is left. The
    // instrument first: it tells half a pair from a whole one.
    expect(hasALoneSurrogate('x😀'), 'a whole pair').toBe(false)
    expect(hasALoneSurrogate('x\ud83d'), 'half a pair').toBe(true)
    const straddling = titled('notes.md', 'markdown', `# ${'a'.repeat(198)}😀tail`)
    expect(straddling).toBe(`${'a'.repeat(198)}…`)
    expect(hasALoneSurrogate(straddling)).toBe(false)

    // …a page’s <title> is cut the same way, beside one that fits.
    expect(titled('p.html', 'page', `<title>${'p'.repeat(200)}</title>`)).toBe('p'.repeat(200))
    expect(titled('p.html', 'page', `<title>${'p'.repeat(300)}</title>`)).toBe(
      `${'p'.repeat(199)}…`,
    )

    // ⚑ A name, the fallback, is kept whole: 250 characters and an extension.
    const longName = `${'n'.repeat(250)}.md`
    expect(longName.length).toBe(253)
    expect(titled(longName, 'markdown', 'no heading\n')).toBe(longName)
  })

  it('an image or a PDF is titled by its name whatever its bytes say', () => {
    // ⚑ The same bytes, one fact over: where the FORM has text to look in the bytes answer, and
    // where it has none the name does.
    expect(titled('chart.html', 'page', '<title>Chart</title>')).toBe('Chart')
    expect(titled('chart.svg', 'image', '<title>Chart</title>')).toBe('chart.svg')
    expect(titled('pic.md', 'markdown', '# not a heading')).toBe('not a heading')
    expect(titled('pic.png', 'image', '# not a heading')).toBe('pic.png')
    expect(titled('paper.md', 'markdown', '%PDF-1.4\n# Not a title\n')).toBe('Not a title')
    expect(titled('paper.pdf', 'pdf', '%PDF-1.4\n# Not a title\n')).toBe('paper.pdf')
    // ⚠️ A drawing in a PAGE is a tooltip and not the page’s title — the very bytes of the .svg.
    expect(titled('chart.html', 'page', '<svg><title>Chart</title></svg>')).toBe('chart.html')
    expect(titled('chart.svg', 'image', '<svg><title>Chart</title></svg>')).toBe('chart.svg')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The rig: a real host, a real ledger, the real toolsets, the Fake provider only
// ─────────────────────────────────────────────────────────────────────────────────────────────

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/**
 * A stretch of the event loop long enough for everything a provider row starts to have run: five
 * turns of `setImmediate` (each pump, and the flush a mark arms, run there) and a short timer.
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}

type Answered = { structured: Record<string, unknown>; text: string }

/** One kept file as the tests know it: what was written, and the row the store gave it. */
interface Kept {
  readonly id: string
  readonly name: string
  readonly content: string
}

/** The forest every §3 test reads: who holds what, and the seven files kept on it. */
interface Forest {
  readonly carol: string
  readonly pm: string
  readonly aliKid: string
  readonly bobKid: string
  /** The PM's root label, read off the ledger — never hard-coded: every opened conversation takes a number. */
  readonly R: string
  /** Labels. */
  readonly label: { root: string; p1: string; p11: string; p2: string; p10: string }
  /** `work_…` ids. */
  readonly piece: { root: string; p1: string; p11: string; p2: string; p10: string }
  readonly file: {
    plan: Kept
    in1: Kept
    out1: Kept
    leaf: Kept
    out2: Kept
    out10: Kept
    carols: Kept
  }
}

describe('D-026 · one door lists the kept files, and every door that keeps one titles it', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let gate: ResumeGate
  /** Every message the host pushed on `runtime:states`, in order. */
  let pushed: RuntimeStatesMessage[]
  /** A fault the store the host reads through raises on a call, when a test arms one. */
  let fault: ((name: string, args: readonly unknown[]) => void) | null
  let pairs: number
  const tick = (): number => clock++

  /** The store the host is handed: the real one, every member passing through the armed fault. */
  const faultingStore = (real: SessionStore): SessionStore => {
    const wrapped: Record<string, unknown> = {}
    for (const [name, member] of Object.entries(real)) {
      if (typeof member !== 'function') {
        wrapped[name] = member
        continue
      }
      wrapped[name] = (...args: unknown[]): unknown => {
        fault?.(name, args)
        return Reflect.apply(member as (...given: unknown[]) => unknown, real, args)
      }
    }
    return wrapped as unknown as SessionStore
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d026-door-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d026-door-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_260_000
    store = createSessionStore(db, tick)
    counter = 0
    pairs = 0
    handles = []
    pushed = []
    fault = null
    issued = new FakeProviderSessions()
    gate = anOpenGate()
    window = new RecordingSink('webContents:1')
    host = new RuntimeHost({
      store: faultingStore(store),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued, gate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      resourcesRoot: () => resourcesRoot(userData),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      // ⚑ **The dep the push is measured through** — what main hands every window.
      statesMoved: (message) => {
        pushed.push(message)
      },
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // The helpers
  // ───────────────────────────────────────────────────────────────────────────────────────────

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /**
   * A conversation a person opened. ⚑ `auto` unless said: a given child's brief turn then ends and
   * it is idle. `ask` is the forest's, whose children inherit it and park on a card instead.
   */
  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'auto',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }

  /** An identity a give can name: opened by a person, then closed. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    await host.close(await personOpens(profileId), window)
  }

  const callFull = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Answered> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const result = await tool.call(args)
    return { structured: result.structured as Record<string, unknown>, text: result.text }
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => (await callFull(caller, name, args)).structured

  const isIdle = (id: string): boolean => {
    const last = events(id)
      .filter((event) => event.type === 'status')
      .at(-1) as { state?: string } | undefined
    return last?.state === 'idle'
  }

  /** What the PROVIDER was handed: the Fake echoes each send as an assistant message. */
  const saidToProvider = (id: string): string[] =>
    events(id)
      .filter((event) => event.type === 'assistant_message')
      .map((event) => (event as { text: string }).text)
      .filter((text) => text.startsWith('echo: '))
      .map((text) => text.slice('echo: '.length))

  /**
   * A give, answered `ok`, and the conversation it reached — idle on its piece, unless `parks`: a
   * child of an `ask` giver parks its brief turn on a card, and is never idle.
   */
  const aGive = async (
    giver: string,
    profile: string,
    title: string,
    brief: string,
    extra: Record<string, unknown> = {},
    parks = false,
  ): Promise<{ agent: string; piece: string; label: string }> => {
    const answer = await callOn(giver, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief,
      ...extra,
    })
    expect(answer.outcome, JSON.stringify(answer)).toBe('ok')
    const agent = (answer.agent ?? answer.owner) as string
    if (!parks) {
      await waitFor(
        () => saidToProvider(agent).some((said) => said.includes(brief)),
        `${agent} to be handed its brief`,
      )
      await waitFor(() => isIdle(agent), `${agent} to go idle on its first piece`)
    }
    return { agent, piece: answer.piece as string, label: answer.label as string }
  }

  const wrote = (name: string, content: Buffer | string): string => {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
    return path
  }

  /** One file kept by ONE `update_work` call, its own timestamp, answered `ok`. */
  const keeps = async (
    caller: string,
    piece: string,
    name: string,
    content: string,
    extra: Record<string, unknown> = {},
  ): Promise<Kept> => {
    const kept = await callOn(caller, 'update_work', {
      piece,
      resources: [wrote(name, content)],
      ...extra,
    })
    expect(kept.outcome, JSON.stringify(kept)).toBe('ok')
    const files = kept.resources as { resource: string; name: string }[]
    expect(files.map((one) => one.name)).toEqual([name])
    return { id: files[0]?.resource as string, name, content }
  }

  const rootOf = (conversation: string): { piece: string; label: string } => {
    const found = store.rootOf(conversation)
    if (found === null) throw new Error(`${conversation} owns no root`)
    return found
  }

  /** A conversation this app can name no profile for: found in the person's own provider home. */
  const aStranger = (id: string): string => {
    store.adopt({
      id,
      provider: 'claude',
      sessionId: `ext_${id}`,
      cwd: root,
      profileId: null,
      createdAt: 9_000_000,
      updatedAt: 9_000_000,
    })
    return id
  }

  /** The stored row of a kept file, or a failure: every `keptAt` below is read off the ledger. */
  const rowOf = (id: string): NonNullable<ReturnType<SessionStore['resource']>> => {
    const row = store.resource(id)
    if (row === null) throw new Error(`${id} is not in the store`)
    return row
  }

  /** The files of an answer that must be `ok`. */
  const filesOf = (answer: FilesKept): readonly KeptFile[] => {
    if (!answer.ok) throw new Error(`the door refused: ${answer.reason}`)
    return answer.files
  }

  const piecesFiles = (piece: string): readonly KeptFile[] =>
    filesOf(host.filesKept({ scope: 'piece', piece }))
  const treeOf = (conversation: string): readonly KeptFile[] =>
    filesOf(host.filesKept({ scope: 'tree', conversation }))
  const addedBy = (conversation: string): readonly KeptFile[] =>
    filesOf(host.filesKept({ scope: 'conversation', conversation }))
  const names = (rows: readonly KeptFile[]): string[] => rows.map((row) => row.name)
  const labels = (rows: readonly KeptFile[]): string[] => rows.map((row) => row.label)

  /** A person-opened conversation of `pm-N` that gave a piece to a fresh `worker-N`. */
  const aPair = async (
    inputs: string[] = [],
  ): Promise<{ pm: string; worker: string; piece: string; label: string }> => {
    const nth = ++pairs
    await bringIdentityIntoBeing(`worker-${String(nth)}`)
    const pm = await personOpens(`pm-${String(nth)}`)
    const given = await aGive(
      pm,
      `worker-${String(nth)}`,
      'the work',
      `do the work ${String(nth)}`,
      {
        ...(inputs.length === 0 ? {} : { inputs }),
      },
    )
    return { pm, worker: given.agent, piece: given.piece, label: given.label }
  }

  /** The kept rows pushed so far, flattened across every message. */
  const pushedFiles = (): KeptFile[] => pushed.flatMap((message) => [...message.kept])

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the doors that write a title
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the doors that write a title', () => {
    it('every door titles the files it keeps from their bytes: a reply, update_work and a give’s inputs', async () => {
      // (1) A give: its input is titled by its heading, and the row says it is an input.
      const brief = wrote('brief.md', '# The brief\n')
      const { pm, worker, piece, label } = await aPair([brief])
      const givenInput = piecesFiles(piece).find((row) => row.name === 'brief.md')
      expect(givenInput, 'the give kept its input').toBeDefined()
      expect(givenInput).toMatchObject({ role: 'input', title: 'The brief', label })
      expect(rowOf(givenInput?.resourceId as string).title, 'the stored row').toBe('The brief')

      // (2) update_work: as the giver, a page kept as an input; as the owner, a file it made.
      const scope = await keeps(pm, piece, 'scope.html', '<title>Plan &amp; scope</title>')
      const notes = await keeps(worker, piece, 'notes.md', '# Notes\n')
      expect(rowOf(scope.id)).toMatchObject({ role: 'input', title: 'Plan & scope' })
      expect(rowOf(notes.id)).toMatchObject({ role: 'made', title: 'Notes' })

      // (3) A reply — last, because it ends the piece. ⚑ The heading-less file beside it is titled
      // by its name, so a door that titled everything by name, or everything by heading, is not
      // what passed.
      const replied = await callOn(worker, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'the findings',
        resource_paths: [
          wrote('report.md', '# Findings\nbody\n'),
          wrote('plain.md', 'no heading\n'),
        ],
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      const ids = replied.resources as string[]
      expect(ids).toHaveLength(2)
      expect(ids.map((id) => rowOf(id).title)).toEqual(['Findings', 'plain.md'])

      // Each title is read from the door as well as from the stored row.
      const door = piecesFiles(piece)
      const byName = (name: string): KeptFile | undefined => door.find((row) => row.name === name)
      expect(names(door).sort()).toEqual(
        ['brief.md', 'notes.md', 'plain.md', 'report.md', 'scope.html'].sort(),
      )
      expect(byName('brief.md')).toMatchObject({ title: 'The brief', role: 'input' })
      expect(byName('scope.html')).toMatchObject({ title: 'Plan & scope', role: 'input' })
      expect(byName('notes.md')).toMatchObject({ title: 'Notes', role: 'made' })
      expect(byName('report.md')).toMatchObject({ title: 'Findings', role: 'made' })
      expect(byName('plain.md')).toMatchObject({ title: 'plain.md', role: 'made' })
    })

    it('list_tasks made says a file’s title only when it differs from its name', async () => {
      const ali = await personOpens('ali')
      const label = rootOf(ali).label
      const report = await keeps(ali, label, 'report.md', '# Findings\nbody\n')
      const plain = await keeps(ali, label, 'plain.md', 'no heading\n')

      const listed = await callFull(ali, 'list_tasks', { made: true })
      expect(listed.structured, listed.text).toMatchObject({ outcome: 'ok', more: 0 })
      // ⚑ The structure carries the stored title, the name for a file with no heading.
      const made = listed.structured.made as { resource: string; title: string }[]
      expect(made.find((one) => one.resource === report.id)?.title).toBe('Findings')
      expect(made.find((one) => one.resource === plain.id)?.title).toBe('plain.md')
      // ⚑ The words: the heading line says it, the heading-less line does not repeat the name.
      expect(listed.text).toContain(`(report.md) · Findings — on ${label}`)
      expect(listed.text).toContain(`(plain.md) — on ${label}`)
      expect(listed.text).not.toContain('· plain.md')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the door a window lists by
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the door a window lists by', () => {
    let f: Forest

    /**
     * ⚑ **The forest** — built per test, because some tests change it:
     *
     *  - **carol**, person-opened, first, with a root of her own;
     *  - **pm**, person-opened, root `R`; it gives `R.1` ("the index"), `R.2` and, after seven numbers
     *    are burned, `R.10` to one Ali (the second and third reach the conversation the first
     *    started); that Ali, `aliKid`, gives `R.1.1` ("the leaf") to a Bob (`bobKid`);
     *  - **seven files**, each by its own `update_work`, in this order: pm → R `plan.md` (made),
     *    pm → R.1 `in1.md` (an input), aliKid → R.1 `out1.md` (made), bobKid → R.1.1 `leaf.html`
     *    (a page), aliKid → R.2 `out2.md`, aliKid → R.10 `out10.md`, carol → her root `carols.md`.
     */
    const aForest = async (): Promise<Forest> => {
      const carol = await personOpens('carol')
      await bringIdentityIntoBeing('ali')
      await bringIdentityIntoBeing('bob')
      // ⚑ `ask`: a give is refused while the conversation it names still holds a piece of the giver's
      // whose turn ended, so the children park on a card instead — their pieces are never stalled.
      const pm = await personOpens('pm', 'ask')
      const pmRoot = rootOf(pm)
      const p1 = await aGive(pm, 'ali', 'the index', 'index it', {}, true)
      const aliKid = p1.agent
      const p2 = await aGive(pm, 'ali', 'the second piece', 'plan the second piece', {}, true)
      // ⚠️ The second give reached the conversation the first started.
      expect(p2.agent).toBe(aliKid)
      for (let burned = 0; burned < 7; burned++) store.numberUnder(pmRoot.piece)
      const p10 = await aGive(pm, 'ali', 'the tenth', 'plan the tenth piece', {}, true)
      const p11 = await aGive(aliKid, 'bob', 'the leaf', 'leaf it', { piece: p1.label }, true)
      const bobKid = p11.agent
      expect([p1.label, p2.label, p10.label, p11.label]).toEqual([
        `${pmRoot.label}.1`,
        `${pmRoot.label}.2`,
        `${pmRoot.label}.10`,
        `${pmRoot.label}.1.1`,
      ])

      const plan = await keeps(pm, pmRoot.label, 'plan.md', '# The plan\nbody\n')
      const in1 = await keeps(pm, p1.label, 'in1.md', 'a table, no heading\n')
      const out1 = await keeps(aliKid, p1.label, 'out1.md', '# Findings\nbody\n')
      const leaf = await keeps(
        bobKid,
        p11.label,
        'leaf.html',
        '<title>The leaf &amp; more</title><p>x</p>',
      )
      const out2 = await keeps(aliKid, p2.label, 'out2.md', 'no heading\n')
      const out10 = await keeps(aliKid, p10.label, 'out10.md', '# Ten\n')
      const carols = await keeps(carol, rootOf(carol).label, 'carols.md', 'carol\n')
      return {
        carol,
        pm,
        aliKid,
        bobKid,
        R: pmRoot.label,
        label: {
          root: pmRoot.label,
          p1: p1.label,
          p11: p11.label,
          p2: p2.label,
          p10: p10.label,
        },
        piece: {
          root: pmRoot.piece,
          p1: p1.piece,
          p11: p11.piece,
          p2: p2.piece,
          p10: p10.piece,
        },
        file: { plan, in1, out1, leaf, out2, out10, carols },
      }
    }

    beforeEach(async () => {
      f = await aForest()
    })

    it('the door lists one piece’s files by its label or its id, one row each with every field a window draws', () => {
      const byLabel = piecesFiles(f.label.p1)
      const byId = piecesFiles(f.piece.p1)
      // ⚑ Presence first: exactly two rows, oldest first, and not R's or R.1.1's files.
      expect(names(byLabel)).toEqual(['in1.md', 'out1.md'])
      expect(byId).toEqual(byLabel)

      const [inRow, outRow] = byLabel
      expect(inRow).toEqual({
        group: 'brief',
        resourceId: f.file.in1.id,
        title: 'in1.md',
        name: 'in1.md',
        form: 'markdown',
        bytes: Buffer.byteLength(f.file.in1.content),
        role: 'input',
        keptAt: rowOf(f.file.in1.id).createdAt,
        sha256: shaOf(f.file.in1.content),
        addedBy: {
          conversation: f.pm,
          name: host.whatToCallTheConversation(f.pm),
          identity: 'pm',
        },
        piece: f.piece.p1,
        label: f.label.p1,
        pieceTitle: 'the index',
      })
      expect(outRow).toEqual({
        group: 'working',
        resourceId: f.file.out1.id,
        title: 'Findings',
        name: 'out1.md',
        form: 'markdown',
        bytes: Buffer.byteLength(f.file.out1.content),
        role: 'made',
        keptAt: rowOf(f.file.out1.id).createdAt,
        sha256: shaOf(f.file.out1.content),
        addedBy: {
          conversation: f.aliKid,
          name: host.whatToCallTheConversation(f.aliKid),
          identity: 'ali',
        },
        piece: f.piece.p1,
        label: f.label.p1,
        pieceTitle: 'the index',
      })

      // ⚑ The neighbours each answer only their own files: a page on R.1.1, a root nobody titled.
      const leafRows = piecesFiles(f.label.p11)
      expect(names(leafRows)).toEqual(['leaf.html'])
      expect(leafRows[0]).toMatchObject({
        form: 'page',
        title: 'The leaf & more',
        label: f.label.p11,
        pieceTitle: 'the leaf',
        role: 'made',
      })
      const rootRows = piecesFiles(f.label.root)
      expect(names(rootRows)).toEqual(['plan.md'])
      expect(rootRows[0]).toMatchObject({ title: 'The plan', label: f.R, pieceTitle: null })
    })

    it('the tree scope lists the pieces a conversation holds or gave and everything under them in label order, oldest first within a piece', () => {
      // ⚑ The full positive: six rows for the PM, two levels down reached (R.1.1 was given by
      // aliKid and not by pm), R before R.1 before R.1.1 before R.2, R.2 BEFORE R.10 — which a text
      // sort gets backwards — and in1.md before out1.md, being older.
      const pmTree = treeOf(f.pm)
      expect(names(pmTree)).toEqual([
        'plan.md',
        'in1.md',
        'out1.md',
        'leaf.html',
        'out2.md',
        'out10.md',
      ])
      expect(labels(pmTree)).toEqual([
        f.R,
        f.label.p1,
        f.label.p1,
        f.label.p11,
        f.label.p2,
        f.label.p10,
      ])

      // …and each other tree excludes what is not under it.
      expect(names(treeOf(f.aliKid))).toEqual([
        'in1.md',
        'out1.md',
        'leaf.html',
        'out2.md',
        'out10.md',
      ])
      expect(names(treeOf(f.aliKid))).not.toContain('plan.md')
      expect(names(treeOf(f.bobKid))).toEqual(['leaf.html'])
      expect(names(treeOf(f.carol))).toEqual(['carols.md'])
      for (const other of ['plan.md', 'in1.md', 'out1.md', 'leaf.html', 'out2.md', 'out10.md']) {
        expect(names(treeOf(f.carol)), `carol's tree`).not.toContain(other)
      }
    })

    it('the conversation scope is exactly what the conversation added, and nothing another added to the same piece', () => {
      const pmAdded = addedBy(f.pm)
      expect(names(pmAdded)).toEqual(['plan.md', 'in1.md'])
      expect(labels(pmAdded)).toEqual([f.R, f.label.p1])
      const aliAdded = addedBy(f.aliKid)
      expect(names(aliAdded)).toEqual(['out1.md', 'out2.md', 'out10.md'])
      expect(labels(aliAdded)).toEqual([f.label.p1, f.label.p2, f.label.p10])
      expect(names(addedBy(f.bobKid))).toEqual(['leaf.html'])
      // ⚑ R.1 holds two files from two adders, and each scope shows only its own.
      expect(names(piecesFiles(f.label.p1))).toEqual(['in1.md', 'out1.md'])
      for (const [conversation, rows] of [
        [f.pm, pmAdded],
        [f.aliKid, aliAdded],
        [f.bobKid, addedBy(f.bobKid)],
      ] as const) {
        for (const row of rows) expect(row.addedBy?.conversation).toBe(conversation)
      }
    })

    it('a conversation that took another’s place lists what the one it replaced gave in its tree, and none of it in its conversation scope', async () => {
      // The giver's provider forgets it, and a person's message wakes it: R10 replaces it.
      await host.close(f.pm, window)
      issued.forgetAll()
      await host.send(f.pm, 'carry on', window)
      const replaced = events(f.pm).find((event) => event.type === 'replaced_by')
      if (replaced === undefined || replaced.type !== 'replaced_by') {
        throw new Error('the giver was not replaced')
      }
      const next = replaced.sessionId
      // ⚠️ The premise: a replacement stands in its place.
      expect(next).not.toBe(f.pm)

      // ⚑ The replacement's tree is what the replaced one GAVE and everything under it — and not
      // the replaced one's own root, and not carol's.
      const nextTree = treeOf(next)
      expect(names(nextTree)).toEqual(['in1.md', 'out1.md', 'leaf.html', 'out2.md', 'out10.md'])
      expect(names(nextTree)).not.toContain('plan.md')
      expect(names(nextTree)).not.toContain('carols.md')
      // …but a file is added by one conversation: the replacement added none.
      expect(host.filesKept({ scope: 'conversation', conversation: next })).toEqual({
        ok: true,
        files: [],
      })
      // ⚑ The paired positive: the old id's lists are as they were.
      expect(names(addedBy(f.pm))).toEqual(['plan.md', 'in1.md'])
      expect(names(treeOf(f.pm))).toEqual([
        'plan.md',
        'in1.md',
        'out1.md',
        'leaf.html',
        'out2.md',
        'out10.md',
      ])
    })

    it('a scope that names nothing answers its own word, and one that names something holding no files answers an empty list', async () => {
      // ⚑ The empty-but-real answers first: a person-opened conversation with no file, and a piece
      // with no file.
      const quiet = await personOpens('quiet')
      const fresh = await aGive(
        f.aliKid,
        'bob',
        'a fresh piece',
        'a fresh brief',
        { piece: f.label.p2 },
        true,
      )
      expect(host.filesKept({ scope: 'tree', conversation: quiet })).toEqual({
        ok: true,
        files: [],
      })
      expect(host.filesKept({ scope: 'conversation', conversation: quiet })).toEqual({
        ok: true,
        files: [],
      })
      expect(host.filesKept({ scope: 'piece', piece: fresh.label })).toEqual({
        ok: true,
        files: [],
      })
      expect(host.filesKept({ scope: 'piece', piece: fresh.piece })).toEqual({
        ok: true,
        files: [],
      })

      // …and a name nothing holds is a refusal in the words its neighbours use.
      for (const scope of ['tree', 'conversation'] as const) {
        expect(host.filesKept({ scope, conversation: 'sess_nobody' }), scope).toEqual({
          ok: false,
          reason: 'no-such-conversation',
        })
      }
      for (const piece of ['W999', 'work_nope']) {
        expect(host.filesKept({ scope: 'piece', piece }), piece).toEqual({
          ok: false,
          reason: 'no-piece-by-that-name',
        })
      }
    })

    it('a file’s piece is titled as it stands now: as given until it is renamed, and a root nobody titled has none', async () => {
      const rowsOn = (piece: string): KeptFile[] => [...piecesFiles(piece)]
      // ⚑ Before.
      expect(rowsOn(f.label.p1).map((row) => row.pieceTitle)).toEqual(['the index', 'the index'])
      expect(rowsOn(f.label.root).map((row) => row.pieceTitle)).toEqual([null])

      // ⚑ After the giver renames R.1: both its rows say it, and the leaf under it is its own.
      const renamed = await callOn(f.pm, 'update_work', {
        piece: f.label.p1,
        title: 'The index, renamed',
      })
      expect(renamed.outcome, JSON.stringify(renamed)).toBe('ok')
      expect(rowsOn(f.label.p1).map((row) => row.pieceTitle)).toEqual([
        'The index, renamed',
        'The index, renamed',
      ])
      expect(rowsOn(f.label.p11).map((row) => row.pieceTitle)).toEqual(['the leaf'])
      // …and `list_tasks {made}` says the same for the file the Ali made there.
      const made = (await callOn(f.aliKid, 'list_tasks', { made: true })).made as {
        resource: string
        piece_title: string
      }[]
      expect(made.find((one) => one.resource === f.file.out1.id)?.piece_title).toBe(
        'The index, renamed',
      )

      // ⚑ A root nobody titled takes the title a person-held conversation gives it.
      const titledRoot = await callOn(f.pm, 'update_work', {
        piece: f.label.root,
        title: 'Release plan',
      })
      expect(titledRoot.outcome, JSON.stringify(titledRoot)).toBe('ok')
      expect(rowsOn(f.label.root).map((row) => row.pieceTitle)).toEqual(['Release plan'])
      // ⚑ A sibling never renamed still says its title as given.
      expect(rowsOn(f.label.p2).map((row) => row.pieceTitle)).toEqual(['the second piece'])
    })

    it('a file kept before titles were taken reads as its name, a person’s file has no adder, and a name with no form has none', () => {
      // An old row: no door can write a NULL title any more, so the test's own db does.
      db.prepare('UPDATE work_resource SET title = NULL WHERE id = ?').run(f.file.out1.id)
      // A file a person kept, and one a conversation this app can name no profile for added.
      const persons = store.addResource(
        {
          piece: f.piece.p2,
          role: 'made',
          title: 'x',
          summary: null,
          name: 'notes.txt',
          sha256: '0'.repeat(64),
          bytes: 3,
          addedBy: null,
        },
        clock++,
      )
      const stray = aStranger('sess_stray_adder')
      const strays = store.addResource(
        {
          piece: f.piece.p2,
          role: 'made',
          title: 'stray',
          summary: null,
          name: 'stray.md',
          sha256: '1'.repeat(64),
          bytes: 3,
          addedBy: stray,
        },
        clock++,
      )

      const rows = piecesFiles(f.label.p1)
      const old = rows.find((row) => row.resourceId === f.file.out1.id)
      // ⚑ Never null and never empty: the name, the rule's own *or else*.
      expect(old?.title).toBe('out1.md')
      expect(old?.title).not.toBe('')

      const onP2 = piecesFiles(f.label.p2)
      const byId = (id: string): KeptFile | undefined => onP2.find((row) => row.resourceId === id)
      expect(byId(persons.resource)).toMatchObject({ name: 'notes.txt', addedBy: null, form: null })
      expect(byId(strays.resource)?.addedBy).toEqual({
        conversation: stray,
        name: AN_AGENT_THIS_APP_CANNOT_NAME,
        identity: null,
      })
      // ⚑ The paired positives in the same list: the file out2.md keeps its title, its form and its
      // adder, and the tenth piece's own heading stands.
      expect(byId(f.file.out2.id)).toMatchObject({
        title: 'out2.md',
        form: 'markdown',
        addedBy: { conversation: f.aliKid, identity: 'ali' },
      })
      expect(piecesFiles(f.label.p10)[0]).toMatchObject({ title: 'Ten', form: 'markdown' })
    })

    it('the window’s door is strict on every arm, answers any window, and hands its command to the host', async () => {
      const owner = window
      const stranger = new RecordingSink('webContents:2')
      const parses = (raw: unknown): boolean => runtimeCommandSchema.safeParse(raw).success

      // ⚑ The three valid shapes parse — a piece of exactly 200 characters included — so a schema
      // that refused everything is not what passed.
      const piece200 = 'W'.repeat(200)
      expect(parses({ kind: 'filesKept', scope: 'tree', conversation: 'c' })).toBe(true)
      expect(parses({ kind: 'filesKept', scope: 'conversation', conversation: 'c' })).toBe(true)
      expect(parses({ kind: 'filesKept', scope: 'piece', piece: 'W1' })).toBe(true)
      expect(parses({ kind: 'filesKept', scope: 'piece', piece: piece200 })).toBe(true)

      // ⛔ A stray key is a refusal that names it, on every arm.
      for (const raw of [
        { kind: 'filesKept', scope: 'tree', conversation: 'c', stray: 1 },
        { kind: 'filesKept', scope: 'conversation', conversation: 'c', stray: 1 },
        { kind: 'filesKept', scope: 'piece', piece: 'W1', stray: 1 },
      ]) {
        expect(parses(raw), JSON.stringify(raw)).toBe(false)
        await expect(executeRuntimeCommand(host, owner, raw)).rejects.toThrow(
          'Unrecognized key: "stray"',
        )
      }
      // ⛔ …and so is another scope's field, a missing field, an empty or too long one, and a scope
      // nobody declared.
      for (const raw of [
        { kind: 'filesKept', scope: 'piece', piece: 'W1', conversation: 'c' },
        { kind: 'filesKept', scope: 'tree' },
        { kind: 'filesKept', scope: 'piece', piece: '' },
        { kind: 'filesKept', scope: 'piece', piece: 'W'.repeat(201) },
        { kind: 'filesKept', scope: 'tree', conversation: '' },
        { kind: 'filesKept', scope: 'everything', conversation: 'c' },
      ]) {
        expect(parses(raw), JSON.stringify(raw)).toBe(false)
      }

      // ⚑ Answered, to the window that opened the conversation and to any other: the host's own
      // answer, with the two rows of R.1.
      const expected = host.filesKept({ scope: 'piece', piece: f.label.p1 })
      expect(expected.ok).toBe(true)
      expect(filesOf(expected)).toHaveLength(2)
      const command = { kind: 'filesKept', scope: 'piece', piece: f.label.p1 }
      expect(await executeRuntimeCommand(host, owner, command)).toEqual(expected)
      expect(await executeRuntimeCommand(host, stranger, command)).toEqual(expected)
      // …and a 200-character piece is answered with the word for a name nothing holds.
      expect(
        await executeRuntimeCommand(host, owner, {
          kind: 'filesKept',
          scope: 'piece',
          piece: piece200,
        }),
      ).toEqual({ ok: false, reason: 'no-piece-by-that-name' })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the push
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the push', () => {
    it('a reply’s files are pushed to every window once the reply is down, as the rows the door answers', async () => {
      const { worker, piece } = await aPair()
      await settle()
      pushed.length = 0

      const replied = await callOn(worker, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'the findings',
        resource_paths: [wrote('findings.md', '# Findings\nbody\n')],
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      const id = (replied.resources as string[])[0] as string
      await waitFor(() => pushedFiles().length > 0, 'the reply’s file to be pushed')
      await settle()

      // ⚑ Exactly one pushed row for the file across every message, and it IS the door's row.
      const sent = pushedFiles().filter((row) => row.resourceId === id)
      expect(sent).toHaveLength(1)
      expect(pushedFiles()).toHaveLength(1)
      const door = piecesFiles(piece).find((row) => row.resourceId === id)
      expect(door).toBeDefined()
      expect(sent[0]).toEqual(door)
      expect(sent[0]).toMatchObject({
        title: 'Findings',
        role: 'made',
        addedBy: { conversation: worker },
        piece,
      })
      // ⚑ Every message carries both halves, and none is empty.
      for (const message of pushed) {
        expect(Array.isArray(message.moved) && Array.isArray(message.kept)).toBe(true)
        expect(message.moved.length + message.kept.length).toBeGreaterThan(0)
      }
    })

    it('update_work’s files are pushed with only that call’s files, even when no state moved', async () => {
      const ali = await personOpens('ali')
      const label = rootOf(ali).label
      await settle()
      pushed.length = 0

      // ⚑ The first keep proves the harness hears a push at all.
      const a = await keeps(ali, label, 'a.md', '# A\n')
      await waitFor(() => pushedFiles().length > 0, 'the first keep to be pushed')
      await settle()
      expect(pushedFiles().map((row) => row.resourceId)).toEqual([a.id])
      pushed.length = 0

      const b = await keeps(ali, label, 'b.md', '# B\n')
      await waitFor(() => pushedFiles().length > 0, 'the second keep to be pushed')
      await settle()
      // ⚑ Only b.md: a.md, already on that piece, is not sent again — and it IS the door's row.
      const sent = pushedFiles()
      expect(sent.map((row) => row.resourceId)).toEqual([b.id])
      const door = piecesFiles(rootOf(ali).piece).find((row) => row.resourceId === b.id)
      expect(sent[0]).toEqual(door)
      expect(piecesFiles(rootOf(ali).piece)).toHaveLength(2)
      // ⚠️ No state moved — an idle conversation kept a file — and the message that carries the
      // file alone is delivered: one message, no state in it.
      expect(pushed).toHaveLength(1)
      expect(pushed[0]?.moved).toEqual([])
    })

    it('a give’s inputs are pushed with the piece they were handed over on', async () => {
      await bringIdentityIntoBeing('ali')
      await bringIdentityIntoBeing('bob')
      const pm = await personOpens('pm')
      await settle()
      pushed.length = 0

      // ⚑ The paired absence first: a give with NO inputs pushes states and no file.
      const bare = await aGive(pm, 'bob', 'a bare give', 'nothing handed over')
      await settle()
      expect(pushed.length, 'the give was heard').toBeGreaterThan(0)
      expect(pushedFiles()).toEqual([])
      expect(piecesFiles(bare.piece)).toEqual([])
      pushed.length = 0

      const given = await aGive(pm, 'ali', 'the index', 'index it', {
        inputs: [wrote('brief.md', '# The brief\n')],
      })
      await waitFor(() => pushedFiles().length > 0, 'the give’s input to be pushed')
      await settle()
      const sent = pushedFiles()
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        role: 'input',
        title: 'The brief',
        label: given.label,
        piece: given.piece,
        addedBy: { conversation: pm },
      })
      expect(sent[0]).toEqual(piecesFiles(given.piece)[0])
    })

    it('a call that keeps no file, and a call refused before it keeps one, push no file', async () => {
      const ali = await personOpens('ali')
      const label = rootOf(ali).label
      const piece = rootOf(ali).piece
      await settle()
      pushed.length = 0

      // ⚑ A title and a status line keep nothing: states may move, no file is pushed.
      const named = await callOn(ali, 'update_work', { piece: label, title: 'A title' })
      expect(named.outcome, JSON.stringify(named)).toBe('ok')
      const said = await callOn(ali, 'update_work', { piece: label, status: 'a status line' })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      // ⚑ A path that does not exist is refused, and keeps nothing.
      const missing = join(root, 'not-yet.md')
      const refused = await callOn(ali, 'update_work', { piece: label, resources: [missing] })
      expect(refused.outcome, JSON.stringify(refused)).not.toBe('ok')
      await settle()
      expect(pushedFiles()).toEqual([])
      expect(store.resourcesOf(piece)).toEqual([])

      // ⚑ The paired positives: an ordinary keep pushes its file, and the refused path, once it
      // exists, pushes too.
      const ordinary = await keeps(ali, label, 'ordinary.md', '# Ordinary\n')
      await waitFor(() => pushedFiles().length > 0, 'the ordinary keep to be pushed')
      await settle()
      expect(pushedFiles().map((row) => row.resourceId)).toEqual([ordinary.id])
      pushed.length = 0
      writeFileSync(missing, '# Not yet\n')
      const landed = await callOn(ali, 'update_work', { piece: label, resources: [missing] })
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
      await waitFor(() => pushedFiles().length > 0, 'the once-refused path to be pushed')
      await settle()
      expect(pushedFiles().map((row) => row.name)).toEqual(['not-yet.md'])
    })

    it('a state that cannot be read never costs the files, nor one piece’s files another’s', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        // (a) A reply writes the replier's row — which marks its state — and keeps its files in one
        // synchronous stretch, so both are asked of ONE flush. The shared card reads throw once.
        const first = await aPair()
        await settle()
        pushed.length = 0
        warn.mockClear()
        let faults = 0
        fault = (name) => {
          if (name === 'instructionAsksWaiting' && faults === 0) {
            faults += 1
            throw new Error('planted')
          }
        }
        const replied = await callOn(first.worker, 'reply_to_parent', {
          piece: first.piece,
          outcome: 'done',
          summary: 'the findings',
          resource_paths: [wrote('first.md', '# First\n')],
        })
        expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
        const firstId = (replied.resources as string[])[0] as string
        await waitFor(
          () => pushedFiles().some((row) => row.resourceId === firstId),
          'the reply’s file to be pushed',
        )
        await settle()
        // ⚑ The fault fired, so the pass is not vacuous; the failure names what could not be said.
        expect(faults).toBe(1)
        expect(
          warn.mock.calls.some(([line]) =>
            String(line).includes('could not say what its agents are doing'),
          ),
        ).toBe(true)
        // ⚑ …and the file was still pushed, once, in a message that says no state.
        expect(pushedFiles().filter((row) => row.resourceId === firstId)).toHaveLength(1)
        const carrying = pushed.filter((message) => message.kept.length > 0)
        expect(carrying.every((message) => message.moved.length === 0)).toBe(true)
        fault = null

        // (b) Two owners keep one file each on two pieces in ONE tick. The unfaulted control
        // first: both files arrive.
        const second = await aPair()
        const pmRoot = rootOf(second.pm)
        await settle()
        pushed.length = 0
        const control = await Promise.all([
          keeps(second.pm, pmRoot.label, 'ctl-a.md', '# Control A\n'),
          keeps(second.worker, second.label, 'ctl-b.md', '# Control B\n'),
        ])
        await waitFor(() => pushedFiles().length >= 2, 'both control files to be pushed')
        await settle()
        expect(
          pushedFiles()
            .map((row) => row.resourceId)
            .sort(),
        ).toEqual(control.map((one) => one.id).sort())

        // The fault run: reading piece A's files throws, and B's still arrive.
        pushed.length = 0
        warn.mockClear()
        let reads = 0
        fault = (name, args) => {
          const asked = args[0] as { scope?: string; piece?: string } | undefined
          if (name === 'filesKept' && asked?.scope === 'piece' && asked.piece === pmRoot.piece) {
            reads += 1
            throw new Error('planted')
          }
        }
        const [onA, onB] = await Promise.all([
          keeps(second.pm, pmRoot.label, 'on-a.md', '# On A\n'),
          keeps(second.worker, second.label, 'on-b.md', '# On B\n'),
        ])
        await waitFor(
          () => pushedFiles().some((row) => row.resourceId === onB.id),
          'B’s file to be pushed',
        )
        await settle()
        expect(reads, 'the fault fired').toBeGreaterThan(0)
        expect(pushedFiles().filter((row) => row.resourceId === onB.id)).toHaveLength(1)
        expect(pushedFiles().some((row) => row.resourceId === onA.id)).toBe(false)
        expect(
          warn.mock.calls.some(([line]) =>
            String(line).includes(`could not say which files were kept on ${pmRoot.piece}`),
          ),
        ).toBe(true)
        // Cleared, the door finds A's file: nothing was lost, only not pushed.
        fault = null
        expect(piecesFiles(pmRoot.piece).some((row) => row.resourceId === onA.id)).toBe(true)
      } finally {
        warn.mockRestore()
      }
    })
  })
})
