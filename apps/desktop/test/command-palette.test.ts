import { describe, expect, it } from 'vitest'
import {
  GROUP_LABEL,
  NO_MATCH_BODY,
  NO_MATCH_ESCAPE,
  PALETTE_GROUPS,
  bandedResults,
  buildCommands,
  filterCommands,
  inGroup,
  matches,
  noMatchHeading,
  score,
  searchedNote,
  type PaletteCommand,
  type PaletteInput,
  type PaletteOpenRow,
} from '../src/renderer/src/lib/command-palette'

/** ⚑ **D-017b · one row of the rail's one list** — the same shape whatever the conversation is doing. */
function openRow(over: Partial<PaletteOpenRow> = {}): PaletteOpenRow {
  return {
    sessionId: over.sessionId ?? 'sess_a',
    provider: over.provider === undefined ? 'codex' : over.provider,
    label: over.label ?? 'workspace-a',
    // ⚑ D-016 · commit 7 · R2 — `null`, a conversation holding no piece: titled by its label, as
    // every case below reads it.
    named: over.named === undefined ? null : over.named,
    word: over.word ?? 'idle',
    opening: over.opening ?? null,
    place: over.place ?? null,
  }
}

const EMPTY: PaletteInput = {
  conversations: [],
  activeId: null,
  // 279 — stated rather than left off. `null` is *"there is no conversation on screen, so there is
  // no agent to talk about"*, which is what every case in this file is about; the band's own cases
  // live in `agent-commands.test.ts`.
  agent: null,
}

const idsOf = (commands: readonly PaletteCommand[]): string[] => commands.map((c) => c.id)

describe('249 §2 · the rows the palette can honestly offer', () => {
  it('⛔ always offers every destination, so an empty result can only ever mean a search miss', () => {
    // ⚑ This is what makes the panel's `v-else` correct by construction rather than by a branch:
    // with no conversations at all there are still these rows, so zero rows after filtering has
    // exactly one cause. `104`'s "first-run distinct from no-match", settled in the builder.
    // ⚠️ **The title said *the three destinations* until `566` made it four** — a title naming a
    // count the assertion below does check, which is the one way that shape stays honest, and it
    // still had to move with the list (`a-title-that-names-a-count-the-assertion-never-checks`).
    // ⚑ `570` made it five and `572` six, and the title needed no edit either time, which is
    // what de-numbering it bought. ⚑ **`606` made it eight in one commit** — `EXT-008` §3's split
    // of Home into *Waiting on you* and *While you were away* — and the title still needed no
    // edit.
    //
    // ⛔ **The two new rows sit where Home was**, which is the rail's own order (`EXT-008` §5:
    // *New conversation · Waiting on you · While you were away · Projects · Agents · Tools ·
    // History*), and the order here is the order a person reads with no query typed. ⚑ **D-016
    // took Home and Projects out** — `go-home` and `go-projects` went with the places they opened.
    expect(idsOf(buildCommands(EMPTY))).toEqual([
      'go-new',
      'go-sessions',
      'go-waiting',
      'go-away',
      'go-tools',
      'go-team',
      'go-providers',
    ])
  })

  it('names Recent activity while still finding the former page name', () => {
    const rows = buildCommands(EMPTY)
    expect(rows.find((row) => row.id === 'go-away')?.title).toBe('Recent activity')
    expect(idsOf(filterCommands(rows, 'while you were away'))).toContain('go-away')
  })

  it('⛔ a conversation on screen gets both exports — and a window with none gets neither', () => {
    const conversations = [openRow({ sessionId: 'sess_a' })]
    const withActive = buildCommands({ ...EMPTY, conversations, activeId: 'sess_a' })
    expect(idsOf(inGroup(withActive, 'this'))).toEqual(['this-export-native', 'this-export-bundle'])

    // The paired negative — same rows, nothing selected. Absent, not disabled (`118`).
    const without = buildCommands({ ...EMPTY, conversations, activeId: null })
    expect(inGroup(without, 'this')).toHaveLength(0)
    // …and NOT vacuous: the conversation itself is still offered, so the builder plainly still ran.
    expect(idsOf(inGroup(without, 'conversations'))).toEqual(['open-sess_a'])
  })

  it('⚠️ an activeId whose row has not arrived gets no export rather than an invented label', () => {
    const built = buildCommands({ ...EMPTY, conversations: [], activeId: 'sess_ghost' })
    expect(inGroup(built, 'this')).toHaveLength(0)
    expect(idsOf(inGroup(built, 'go'))).toContain('go-sessions')
  })

  it('🔴 D-017b · every conversation is one row in ONE band, and its press opens it', () => {
    // The palette reads the same conversation list as the rail, with no “Not open in this
    // window” or “Closed conversations” band. A quit-stopped conversation, one held by
    // another window, and one currently working all open through the same full view. State
    // words come from `agentStateWords`, matching the rail.
    const rows = [
      openRow({ sessionId: 'working', word: 'active' }),
      openRow({ sessionId: 'elsewhere', word: 'needs you' }),
      openRow({ sessionId: 'stopped', word: 'idle', provider: null }),
    ]
    const built = buildCommands({ ...EMPTY, conversations: rows })
    const conversations = inGroup(built, 'conversations')
    expect(idsOf(conversations)).toEqual(['open-working', 'open-elsewhere', 'open-stopped'])
    expect(conversations.map((row) => row.action)).toEqual([
      { kind: 'select', sessionId: 'working' },
      { kind: 'select', sessionId: 'elsewhere' },
      { kind: 'select', sessionId: 'stopped' },
    ])
    // ⛔ **…and every conversation row is in that band** — the split's old ids and bands are gone,
    // so no row is filed anywhere else.
    expect(built.filter((row) => row.id.startsWith('open-'))).toHaveLength(3)
    expect(idsOf(built).some((id) => id.startsWith('closed-'))).toBe(false)
    expect(PALETTE_GROUPS).toEqual(['this', 'conversations', 'go', 'agent'])
    // ⚑ **The control, same call**: the band a person reads above them names the one population.
    expect(GROUP_LABEL.conversations).toBe('Conversations')
    // ⚠️ A row whose provider the host has not said yet says less, not something else.
    expect(conversations[2]?.detail).toBe('unknown · idle')
  })

  it('⚠️ an open row shows its opening line when it has one, and its standing when it does not', () => {
    const [withOpening] = inGroup(
      buildCommands({
        ...EMPTY,
        conversations: [openRow({ sessionId: 'sess_a', opening: 'fix the export path' })],
      }),
      'conversations',
    )
    expect(withOpening?.detail).toBe('fix the export path')

    // ⛔ `211` §3: absent is a real answer, and the row simply says less — it does not say nothing.
    const [without] = inGroup(
      buildCommands({
        ...EMPTY,
        conversations: [openRow({ sessionId: 'sess_a', word: 'working' })],
      }),
      'conversations',
    )
    expect(without?.detail).toBe('codex · working')
  })

  /**
   * 🔴 **449 · the TITLE stopped being the folder, so the folder had to stay findable.**
   *
   * ⛔ **A person who knows a conversation by where it runs could search for it here while the
   * folder WAS the title.** ⚠️ Dropping it would have made a searchable fact unsearchable in the
   * same commit that stopped displaying it — which is not a trade anybody chose.
   *
   * ⚑ **D-017b · one band now**, built from the rail's own row — the closed band's half of this
   * test went with the band.
   */
  it('🔴 449 · the place a conversation runs in is still how a person finds it', () => {
    const [open] = inGroup(
      buildCommands({
        ...EMPTY,
        conversations: [openRow({ sessionId: 'sess_a', label: 'Project manager', place: 'acme' })],
      }),
      'conversations',
    )
    expect(open?.title).toBe('Project manager')
    expect(open?.detail).toBe('codex · idle · acme')
    expect(open?.keywords).toContain('acme')

    // ⚑ **The pairing: a row with no place says one fewer thing rather than an empty one** — no
    // trailing separator, and no blank keyword for a query to match everything on.
    const [nowhere] = inGroup(
      buildCommands({
        ...EMPTY,
        conversations: [openRow({ sessionId: 'sess_b', word: 'working' })],
      }),
      'conversations',
    )
    expect(nowhere?.detail).toBe('codex · working')
  })

  it('⚠️ every band this file declares has a heading, and the panel draws them in this order', () => {
    expect(PALETTE_GROUPS.every((group) => GROUP_LABEL[group].length > 0)).toBe(true)
    expect(GROUP_LABEL.conversations).toBe('Conversations')
    // `154`: one noun. The rail says "All conversations" and so does this.
    const [sessions] = buildCommands(EMPTY).filter((c) => c.id === 'go-sessions')
    expect(sessions?.title).toBe('All conversations')
    // The rail and palette share the approved plain description.
    expect(sessions?.detail).toBe('Includes chats from Claude and Codex on this computer.')
  })
})

describe('249 §2 · what Enter runs, and why that row is first', () => {
  const rows = buildCommands({
    ...EMPTY,
    conversations: [
      openRow({ sessionId: 'sess_team', label: 'team-lab' }),
      openRow({ sessionId: 'sess_other', label: 'unrelated', word: 'idle' }),
    ],
  })

  it('⛔ an exact title beats a prefix beats a substring beats a keyword', () => {
    const exact = {
      id: 'a',
      title: 'home',
      detail: null,
      group: 'go',
      keywords: [],
      action: { kind: 'go', place: 'team' },
    } as PaletteCommand
    const prefix = { ...exact, id: 'b', title: 'home-lab' }
    const inside = { ...exact, id: 'c', title: 'my home page' }
    const keyword = { ...exact, id: 'd', title: 'Dashboard', keywords: ['home'] }
    expect(score(exact, 'home')).toBeGreaterThan(score(prefix, 'home'))
    expect(score(prefix, 'home')).toBeGreaterThan(score(inside, 'home'))
    expect(score(inside, 'home')).toBeGreaterThan(score(keyword, 'home'))
    expect(score(keyword, 'zzz')).toBe(0)
    expect(matches(keyword, 'home')).toBe(true)
    expect(matches(keyword, 'zzz')).toBe(false)
  })

  it('⛔ …so the row a person meant is the one under the cursor', () => {
    // "team" matches the Team destination exactly, the `team-lab` conversation by prefix, and
    // `go-new`/`go-sessions` not at all. The exact one wins even though it is built LAST.
    // ⚑ D-016 · it was "home" and the Home destination until Home was deleted.
    expect(filterCommands(rows, 'team')[0]?.id).toBe('go-team')
    expect(idsOf(filterCommands(rows, 'team'))).toContain('open-sess_team')
    expect(idsOf(filterCommands(rows, 'team'))).not.toContain('open-sess_other')
  })

  it('⚠️ an empty query keeps build order, which is band order', () => {
    expect(idsOf(filterCommands(rows, ''))).toEqual(idsOf(rows))
    expect(idsOf(filterCommands(rows, '   '))).toEqual(idsOf(rows))
  })

  it('⚠️ a session id is matched but never drawn, which is why the note claims ids', () => {
    const found = filterCommands(rows, 'sess_other')
    expect(idsOf(found)).toEqual(['open-sess_other'])
    expect(found[0]?.title).not.toContain('sess_other')
    expect(found[0]?.detail ?? '').not.toContain('sess_other')
    expect(searchedNote({ conversations: 2, looked: true })).toContain('ids')
  })

  it('⛔ nothing matches is a real answer, and it is the only way to get an empty list', () => {
    expect(filterCommands(rows, 'zzzz-nothing')).toHaveLength(0)
    // ⚠️ The paired positive was `…length).toBeGreaterThanOrEqual(0)`, which is true of every array
    // ever and would have passed over a `filterCommands` that returned `[]` unconditionally (found
    // in this dispatch's own review — the one place in this file that broke its own docblock's
    // rule). One character apart from the miss above, and it finds something.
    expect(idsOf(filterCommands(rows, 'zzzz-nothin'))).toEqual([])
    expect(idsOf(filterCommands(rows, 'team'))).toContain('go-team')
  })
})

describe('249 · one order — what the eye reads and what the cursor walks', () => {
  const withExports = buildCommands({
    ...EMPTY,
    conversations: [openRow({ sessionId: 'sess_a', label: 'workspace-a' })],
    activeId: 'sess_a',
  })

  it('⛔ the band holding the best match comes FIRST, even when it is built last', () => {
    // "workspace" is a prefix of the conversation's title and merely appears in each export row's
    // second line. `This conversation` is built first; it must not be drawn first here.
    const bands = bandedResults(withExports, 'workspace')
    expect(bands.map((band) => band.group)).toEqual(['conversations', 'this'])
    expect(bands.flatMap((band) => idsOf(band.rows))).toEqual([
      'open-sess_a',
      'this-export-native',
      'this-export-bundle',
    ])
  })

  it('⚠️ …and an empty query draws exactly what the builder built', () => {
    const bands = bandedResults(withExports, '')
    expect(bands.map((band) => band.group)).toEqual(['this', 'conversations', 'go'])
    expect(bands.flatMap((band) => idsOf(band.rows))).toEqual(idsOf(withExports))
  })

  it('⛔ the flattening of the bands IS the ranked list — the two cannot disagree', () => {
    for (const needle of ['', 'workspace', 'export', 'a', 'conversation']) {
      const flattened = bandedResults(withExports, needle).flatMap((band) => [...band.rows])
      // Same membership as the flat filter — the order is the bands', which is the point.
      expect(idsOf(flattened).sort()).toEqual(idsOf(filterCommands(withExports, needle)).sort())
      // …and the first row drawn is a best-scoring row, which is what Enter promises.
      if (flattened.length > 0) {
        const best = Math.max(...filterCommands(withExports, needle).map((c) => score(c, needle)))
        expect(score(flattened[0]!, needle)).toBe(best)
      }
    }
  })

  it('⚠️ an empty band is absent, not an empty heading', () => {
    expect(bandedResults(buildCommands(EMPTY), '').map((band) => band.group)).toEqual(['go'])
  })
})

describe('249 · a visible reason beats an invisible one', () => {
  it('⛔ a KEYWORD match ranks below a match a person can see on the row', () => {
    // ⚠️ The concrete state this was found in: a conversation whose opening line is "download the
    // nightly build", and the query `download`. The two export rows carry `download` in `keywords`
    // and show it nowhere; the conversation shows it. Both scored 1, band order broke the tie, and
    // Enter WROTE A FILE. (Found in this dispatch's own review.)
    const built = buildCommands({
      ...EMPTY,
      conversations: [openRow({ sessionId: 'sess_a', opening: 'download the nightly build' })],
      activeId: 'sess_a',
    })
    const found = filterCommands(built, 'download')
    expect(idsOf(found)[0]).toBe('open-sess_a')
    // …and the export rows are still FOUND, which is what keywords are for.
    expect(idsOf(found)).toContain('this-export-native')
    const visible = found.find((row) => row.id === 'open-sess_a')!
    const invisible = found.find((row) => row.id === 'this-export-native')!
    expect(score(visible, 'download')).toBeGreaterThan(score(invisible, 'download'))
  })

  it('⚠️ …and the ladder still separates title, prefix, substring, detail and keyword', () => {
    const base = {
      id: 'x',
      detail: 'a detail line',
      group: 'go',
      keywords: ['keyworded'],
      action: { kind: 'go', place: 'team' },
    } as unknown as PaletteCommand
    expect(score({ ...base, title: 'home' }, 'home')).toBe(5)
    expect(score({ ...base, title: 'home-lab' }, 'home')).toBe(4)
    expect(score({ ...base, title: 'my home page' }, 'home')).toBe(3)
    expect(score({ ...base, title: 'nope' }, 'detail')).toBe(2)
    expect(score({ ...base, title: 'nope' }, 'keyworded')).toBe(1)
    expect(score({ ...base, title: 'nope' }, 'nothing')).toBe(0)
  })
})

describe('249 §2 · the palette says what it searched', () => {
  it('⛔ three states, and "has not looked yet" is not "there are none"', () => {
    // ⚑ **D-017b · one list, so one count** — the sentence counted open and closed apart until then.
    const looking = searchedNote({ conversations: 2, looked: false })
    expect(looking).toContain('has not answered yet')
    expect(looking).not.toMatch(/\b0 conversations/)

    const none = searchedNote({ conversations: 0, looked: true })
    expect(none).toContain('0 conversations')
    expect(none).not.toContain('has not answered yet')
  })

  it('⚠️ it counts in the singular when there is one of a thing', () => {
    expect(searchedNote({ conversations: 1, looked: true })).toContain('1 conversation and')
    expect(searchedNote({ conversations: 3, looked: true })).toContain('3 conversations and')
  })

  it('⛔ a read that FAILED is its own sentence, not a promise of an answer that is coming', () => {
    // `looked` is set only on success, so without this state a rail whose two IPC reads threw said
    // "has not answered yet" for ever (found in `249`'s own review).
    const failed = searchedNote({ conversations: 1, looked: false, failed: 'EACCES' })
    expect(failed).toContain('could not be read')
    expect(failed).not.toContain('has not answered yet')
    // …and it does not put the host's errno in this sentence: the rail already draws the reason.
    expect(failed).not.toContain('EACCES')
    // Paired: with no failure the waiting sentence is still what comes out.
    expect(searchedNote({ conversations: 1, looked: false, failed: null })).toContain(
      'has not answered yet',
    )
  })

  it('⛔ …but a failure with an EARLIER answer still reports the count', () => {
    // ⚠️ **The defect the previous fix introduced**, caught by `249`'s own review before it
    // shipped. The rail leaves the rows and `looked` alone when a LATER read throws, so the palette
    // goes on DRAWING those rows — and a sentence denying it searched them is the `106` this
    // sentence exists to prevent, inverted.
    const stale = searchedNote({ conversations: 2, looked: true, failed: 'boom' })
    expect(stale).toContain('2 conversations')
    expect(stale).not.toContain('could not be read')
  })

  it('⛔ the miss quotes the query back, trimmed, and names the page that holds the rest', () => {
    expect(noMatchHeading('  conductor  ')).toBe('Nothing matches “conductor”')
    expect(NO_MATCH_BODY).toContain('All conversations')
    // ⛔ It names the destinations too — they are always searched and are the only rows a fresh
    // install has, so leaving them out described a palette that had searched nothing (found in this
    // dispatch's own review), two lines above a foot sentence saying it had searched them.
    expect(NO_MATCH_BODY).toContain('where you can go')
    // ⚠️ **It must NOT promise to carry the query.** `@go` takes a place and nothing else, so a
    // sentence offering to search the library FOR this text would land a person on an empty box.
    expect(NO_MATCH_BODY).not.toMatch(/search(ing)? (all|every).*for/i)
    expect(NO_MATCH_ESCAPE).toEqual({ kind: 'go', place: 'sessions' })
  })
})
