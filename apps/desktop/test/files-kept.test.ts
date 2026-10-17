import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addedBySays,
  distinctFiles,
  filesReadFor,
  fileTitleSays,
  filtered,
  filesPerPiece,
  rootFilesOf,
  showFilesOn,
  sizeWords,
  treeFileGroups,
} from '../src/renderer/src/lib/files-kept'
import type { KeptFile } from '../src/shared/runtime-ipc'

/**
 * # ⚑ UI-002 · the files kept, as the window groups, sizes and reads them
 *
 * ⚑ `07-where-resources-show` §2 — the rows are D-026's `KeptFile`, read by `RuntimeScreen` in two
 * scopes. This file pins the pure half (`lib/files-kept.ts`) and the source contract of the read
 * that fills `TheCast.treeFiles` and `TheCast.cardFiles`; browser controls also exercise that read.
 */

const file = (resourceId: string, piece: string, keptAt: number): KeptFile => ({
  resourceId,
  title: resourceId,
  name: `${resourceId}.md`,
  form: 'markdown',
  bytes: 10,
  role: 'made',
  keptAt,
  sha256: 'b'.repeat(64),
  addedBy: null,
  piece,
  label: piece.replace('work_', 'W'),
  pieceTitle: null,
})

describe('the files kept, as the Files tab lays them out', () => {
  /** ⚑ One row as the door answers it: its piece, its bytes, who kept it and when. */
  const at = (
    resourceId: string,
    label: string,
    bytes: string,
    who: string | null,
    keptAt: number,
    role: 'made' | 'input' = 'made',
  ): KeptFile => ({
    ...file(resourceId, `work_${label}`, keptAt),
    label,
    role,
    sha256: bytes.repeat(64),
    addedBy: who === null ? null : { conversation: `sess_${who}`, name: who, identity: who },
  })

  it('🔴 in the door’s order, one row per set of bytes, the other pieces that kept them on it, and a depth by label', () => {
    const groups = treeFileGroups([
      at('r1', 'W1', 'a', 'bro', 50),
      at('r2', 'W1.3', 'a', 'bro', 44),
      at('r3', 'W1.3.1', 'b', 'ada', 34),
      at('r4', 'W1.10', 'e', 'ana', 29),
      at('r5', 'W1.10.1', 'e', 'ali', 28),
    ])
    // ⚑ A piece whose every file stands on another piece's row is not drawn.
    expect(groups.map((group) => [group.label, group.depth])).toEqual([
      ['W1', 0],
      ['W1.3.1', 1],
      ['W1.10', 1],
    ])
    expect(groups.map((group) => group.lines.map((line) => line.file.resourceId))).toEqual([
      ['r1'],
      ['r3'],
      ['r4'],
    ])
    expect(groups[0]!.lines[0]!.alsoOn).toEqual([
      { piece: 'work_W1.3', label: 'W1.3', conversation: 'sess_bro' },
    ])
    expect(groups[1]!.lines[0]!.alsoOn).toEqual([])
    expect(groups[2]!.lines[0]!.alsoOn).toEqual([
      { piece: 'work_W1.10.1', label: 'W1.10.1', conversation: 'sess_ali' },
    ])
  })

  it('🔴 oldest first within a piece, as the door answers — and a piece sets in under the DRAWN ones only', () => {
    const one = treeFileGroups([
      at('r1', 'W1.3.1', 'b', 'ada', 34, 'input'),
      at('r2', 'W1.3.1', 'c', 'ada', 35),
    ])
    expect(one).toHaveLength(1)
    expect(one[0]!.lines.map((line) => line.file.resourceId)).toEqual(['r1', 'r2'])
    // ⛔ Two siblings under a piece with no file are both at the top — neither is under the other.
    expect(
      treeFileGroups([at('r1', 'W1.3.2', 'a', 'bro', 1), at('r2', 'W1.10', 'b', 'bro', 2)]).map(
        (group) => group.depth,
      ),
    ).toEqual([0, 0])
    // ⚑ …and a gap: W1.5.1 is not under W1.4, whatever its label's length.
    expect(
      treeFileGroups([
        at('r1', 'W1.4', 'a', 'bro', 1),
        at('r2', 'W1.4.1', 'b', 'bro', 2),
        at('r3', 'W1.5.1', 'c', 'bro', 3),
      ]).map((group) => group.depth),
    ).toEqual([0, 1, 0])
  })

  it('🔴 the row stands at the keep that matters most: main result, then section, then the higher piece, then the earliest', () => {
    const inSection = (
      resourceId: string,
      label: string,
      group: 'result' | 'working' | 'brief',
      keptAt: number,
      mainResult = false,
    ): KeptFile => ({
      ...at(resourceId, label, 'f', 'bro', keptAt),
      group,
      ...(mainResult ? { mainResult: true as const } : {}),
    })
    const standsAt = (files: KeptFile[]): string[] =>
      treeFileGroups(files).flatMap((group) => group.lines.map((line) => line.file.resourceId))
    // ⚑ The same conversation keeping its own bytes on the piece above: the higher piece.
    expect(standsAt([at('r1', 'W2', 'a', 'bro', 9), at('r2', 'W2.1', 'a', 'bro', 1)])).toEqual([
      'r1',
    ])
    // ⚑ A Result beats a Working file, however deep it is.
    expect(
      standsAt([inSection('w', 'W5', 'working', 1), inSection('r', 'W5.1.1', 'result', 2)]),
    ).toEqual(['r'])
    // ⚑ The main result beats a Result.
    expect(
      standsAt([inSection('r', 'W6', 'result', 1), inSection('m', 'W6.1', 'working', 2, true)]),
    ).toEqual(['m'])
    // ⚑ Two keeps alike in all else: the earliest, and a label that merely starts the same is no higher.
    expect(standsAt([at('r1', 'W4.1', 'd', 'bro', 9), at('r2', 'W4.10', 'd', 'ada', 1)])).toEqual([
      'r2',
    ])
  })

  it('🔴 a piece named opens the conversation holding it: the forest’s word, else the one that made the file there', () => {
    const files = [
      at('r1', 'W9', 'a', 'bro', 1),
      at('r2', 'W9.1', 'a', 'bro', 2, 'input'),
      at('r3', 'W9.2', 'a', 'ada', 3),
    ]
    // ⚑ No forest: an input's keeper is its giver, so it names nobody; a made file names its maker.
    expect(treeFileGroups(files)[0]!.lines[0]!.alsoOn).toEqual([
      { piece: 'work_W9.1', label: 'W9.1', conversation: null },
      { piece: 'work_W9.2', label: 'W9.2', conversation: 'sess_ada' },
    ])
    // ⚑ The forest names who holds each piece, and its word comes first.
    const held = treeFileGroups(files, (piece) => (piece === 'work_W9.1' ? 'sess_ana' : 'sess_ali'))
    expect(held[0]!.lines[0]!.alsoOn.map((one) => one.conversation)).toEqual([
      'sess_ana',
      'sess_ali',
    ])
  })

  it('🔴 the same name with other bytes is another file, and has its own row', () => {
    const groups = treeFileGroups([
      { ...at('r1', 'W8', 'a', 'bro', 1), name: 'notes.md', title: 'notes.md' },
      { ...at('r2', 'W8.1', 'c', 'ada', 2), name: 'notes.md', title: 'notes.md' },
    ])
    expect(groups.map((group) => group.lines.map((line) => line.file.resourceId))).toEqual([
      ['r1'],
      ['r2'],
    ])
    expect(groups.flatMap((group) => group.lines.map((line) => line.alsoOn))).toEqual([[], []])
  })

  it('⛔ the same bytes kept again on the SAME piece draw one row and name no other piece; a filter shows its own keep', () => {
    const again = treeFileGroups([at('r1', 'W6', 'a', 'bro', 1), at('r2', 'W6', 'a', 'bro', 2)])
    expect(again[0]!.lines.map((line) => [line.file.resourceId, line.alsoOn])).toEqual([['r1', []]])
    // ⚑ An input handed back as made on the same piece: one row, and under Made the made keep.
    const back = [at('r1', 'W6', 'a', 'bro', 1, 'input'), at('r2', 'W6', 'a', 'ada', 2)]
    expect(treeFileGroups(back)[0]!.lines.map((line) => line.file.resourceId)).toEqual(['r1'])
    expect(
      treeFileGroups(filtered(back, 'made'))[0]!.lines.map((line) => line.file.resourceId),
    ).toEqual(['r2'])
  })

  it('🔴 counted by distinct bytes; filtered by role BEFORE grouping, so a filter’s row is a keep it shows', () => {
    const files = [
      at('r1', 'W1', 'a', 'bro', 2),
      at('r2', 'W1.3', 'a', 'bro', 1),
      at('r3', 'W1.3.1', 'b', 'bro', 3, 'input'),
    ]
    expect(distinctFiles(files)).toBe(2)
    expect(filtered(files, 'all')).toBe(files)
    expect(treeFileGroups(filtered(files, 'input')).map((group) => group.label)).toEqual(['W1.3.1'])
    expect(treeFileGroups(filtered(files, 'made')).map((group) => group.label)).toEqual(['W1'])
    // ⚑ Bytes made on W3 and handed down to W3.1 as an input: under Inputs the input is the row.
    const down = [at('r1', 'W3', 'c', 'bro', 1), at('r2', 'W3.1', 'c', 'ada', 5, 'input')]
    const inputs = treeFileGroups(filtered(down, 'input'))
    expect(inputs.map((group) => group.lines.map((line) => line.file.resourceId))).toEqual([['r2']])
    expect(inputs[0]!.depth).toBe(0)
  })

  it('⚑ none, no group — and a person is *You*', () => {
    expect(treeFileGroups([])).toEqual([])
    expect(addedBySays({ addedBy: null })).toBe('You')
    expect(addedBySays({ addedBy: { conversation: 'sess_a', name: 'Ada', identity: 'ada' } })).toBe(
      'Ada',
    )
  })
})

describe('each piece’s file count, for the Graph tab', () => {
  it('preserves a child origin when a later main replaces its earlier returned copy', () => {
    const files: KeptFile[] = [
      {
        ...file('parent-copy', 'work_1', 2),
        addedBy: { conversation: 'sess_pm', name: 'PM', identity: 'pm' },
        group: 'working',
      },
      {
        ...file('child-first', 'work_1.1', 1),
        addedBy: { conversation: 'sess_worker', name: 'Worker', identity: 'worker' },
        group: 'result',
      },
      {
        ...file('child-main', 'work_1.1', 3),
        addedBy: { conversation: 'sess_worker', name: 'Worker', identity: 'worker' },
        group: 'result',
        mainResult: true,
      },
    ]
    for (const filter of ['all', 'made'] as const) {
      const groups = treeFileGroups(filtered(files, filter))
      // ⚑ The child's main result is the row, and the parent's copy is named on it.
      expect(groups).toHaveLength(1)
      expect(groups[0]!.label).toBe('W1.1')
      expect(groups[0]!.lines).toMatchObject([
        {
          file: { resourceId: 'child-main', mainResult: true, keptAt: 3 },
          alsoOn: [{ piece: 'work_1', label: 'W1', conversation: 'sess_pm' }],
        },
      ])
    }
    expect(treeFileGroups(filtered(files, 'input'))).toEqual([])
  })

  it('retains the designated main row when the same result bytes were returned twice', () => {
    const groups = treeFileGroups([
      { ...file('first', 'work_1', 1), group: 'result' },
      { ...file('main', 'work_1', 2), group: 'result', mainResult: true },
    ])
    expect(groups[0]!.lines).toHaveLength(1)
    expect(groups[0]!.lines[0]?.file).toMatchObject({ resourceId: 'main', mainResult: true })
    expect(groups[0]!.lines[0]?.alsoOn).toEqual([])
  })

  it('draws identical bytes in several sections of one piece once, at the main result; a filter shows its own section', () => {
    const files: KeptFile[] = [
      { ...file('brief', 'work_1', 1), role: 'input', group: 'brief' },
      { ...file('working', 'work_1', 2), group: 'working' },
      { ...file('result', 'work_1', 3), group: 'result', mainResult: true },
      { ...file('again', 'work_1', 4), group: 'working' },
    ]
    const groups = treeFileGroups(files)
    expect(groups).toHaveLength(1)
    expect(
      groups[0]!.sections.map((section) => [
        section.group,
        section.lines.map((line) => line.file.resourceId),
      ]),
    ).toEqual([['result', ['result']]])
    expect(
      treeFileGroups(filtered(files, 'input'))[0]!.lines.map((line) => line.file.resourceId),
    ).toEqual(['brief'])
  })

  it('leaves unread membership unclassified, and names a piece a person kept the same bytes on', () => {
    const apart = treeFileGroups([
      { ...file('unknown', 'work_1', 1), sha256: 'u'.repeat(64) },
      { ...file('result', 'work_2', 2), group: 'result' },
    ])
    expect(apart[0]!.sections[0]?.group).toBeNull()
    const same = treeFileGroups([
      { ...file('unknown', 'work_1', 1) },
      { ...file('result', 'work_2', 2), group: 'result' },
    ])
    expect(same.map((group) => group.label)).toEqual(['W2'])
    expect(same[0]!.lines[0]).toMatchObject({
      file: { resourceId: 'result' },
      alsoOn: [{ piece: 'work_1', label: 'W1', conversation: null }],
    })
  })

  it('🔴 the files on the conversation’s own root — a label with no dot, counted by bytes; none, none', () => {
    const root = { ...file('r', 'work_r', 1), label: 'W7' }
    const again = { ...file('r2', 'work_r', 2), label: 'W7' }
    const under = { ...file('u', 'work_u', 3), label: 'W7.1' }
    expect(rootFilesOf('sess_1', [root, again, under])).toEqual({
      conversation: 'sess_1',
      piece: 'work_r',
      label: 'W7',
      count: 1,
    })
    expect(rootFilesOf('sess_1', [under])).toBeNull()
  })

  it('🔴 distinct bytes per piece — a second copy on one piece counts once', () => {
    const counts = filesPerPiece([
      file('a', 'work_1', 1),
      { ...file('b', 'work_1', 2), sha256: 'c'.repeat(64) },
      file('a2', 'work_1', 3),
      file('d', 'work_2', 4),
    ])
    expect([...counts]).toEqual([
      ['work_1', 2],
      ['work_2', 1],
    ])
    expect(filesPerPiece([]).size).toBe(0)
  })

  it('⚑ the count’s press says what it opens, one file or several', () => {
    expect(showFilesOn(1, 'W1.3')).toBe('Show the file kept on W1.3')
    expect(showFilesOn(3, 'W1.3')).toBe('Show the 3 files kept on W1.3')
  })
})

describe('a file’s size and title, in a row’s words', () => {
  it('🔴 bytes, then KB, then MB, 1024-based', () => {
    expect(sizeWords(70)).toBe('70 B')
    expect(sizeWords(1023)).toBe('1023 B')
    expect(sizeWords(1024)).toBe('1 KB')
    expect(sizeWords(2_150)).toBe('2 KB')
    expect(sizeWords(1024 ** 2 - 1)).toBe('1024 KB')
    expect(sizeWords(1.4 * 1024 ** 2)).toBe('1.4 MB')
  })

  it('🔴 the tooltip names the file only where the title is not its name', () => {
    expect(fileTitleSays({ title: 'Open findings', name: 'open-findings.md' })).toBe(
      'Open findings — open-findings.md',
    )
    expect(fileTitleSays({ title: 'notes.md', name: 'notes.md' })).toBe('notes.md')
  })
})

describe('a scope’s answer, kept by the band’s rule', () => {
  const one = [file('a', 'work_1', 1)]
  it('🔴 an answer is the list, answered', () => {
    expect(filesReadFor('sess_1', one, null)).toEqual({
      conversation: 'sess_1',
      files: one,
      answered: true,
    })
  })
  it('⚠️ a read that did not answer keeps the last list for the SAME conversation, marked', () => {
    const kept = { conversation: 'sess_1', files: one, answered: true }
    expect(filesReadFor('sess_1', null, kept)).toEqual({ ...kept, answered: false })
  })
  it('⛔ …and has nothing to keep for a conversation never answered about', () => {
    const kept = { conversation: 'sess_1', files: one, answered: true }
    expect(filesReadFor('sess_2', null, kept)).toBeNull()
    expect(filesReadFor('sess_2', null, null)).toBeNull()
  })
})

const screen = readFileSync(
  join(__dirname, '../src/renderer/src/components/RuntimeScreen.vue'),
  'utf8',
)
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/** ⛔ One function's body alone, ending at the next declaration or watch. */
function body(opening: string): string {
  const opens = screen.indexOf(opening)
  expect(opens, `${opening} was renamed or removed`).toBeGreaterThan(0)
  const rest = screen.slice(opens + 1)
  const next = rest.search(/\n(?:async )?function |\nwatch\(|\nlet /)
  return rest.slice(0, next < 0 ? undefined : next)
}

/** Both scope answers must come from the same paired request and keep their own destinations. */
function roundTrip(reads: string): { tree: string; added: string; settled: number } {
  const paired =
    /const (\w+) = await window\.api\.runtime\.filesKept\(\{\s*scope: 'tree',\s*conversation: asked,\s*withAdded: true,\s*\}\)/.exec(
      reads,
    )
  expect(
    paired,
    'one paired request for the tree and the files its conversation added',
  ).not.toBeNull()
  if (paired === null) throw new Error('paired file request missing')
  expect(reads.match(/window\.api\.runtime\.filesKept\(/g)).toHaveLength(1)
  const answer = paired[1]
  const assignments = new RegExp(
    String.raw`if \(${answer}\.ok\) \{\s*(\w+) = ${answer}\.files\s+(\w+) = ${answer}\.added \?\? null\s*\}`,
  ).exec(reads)
  expect(assignments, 'each successful scope answer stays in its own list').not.toBeNull()
  if (assignments === null || assignments[1] === undefined || assignments[2] === undefined)
    throw new Error('paired file destinations missing')
  return {
    tree: assignments[1],
    added: assignments[2],
    settled: reads.indexOf('await window.api.runtime.filesKept('),
  }
}

describe('the screen reads the files with the conversation, and again when one is kept', () => {
  it('🔴 both scopes in ONE round trip — the tree on screen, and what the card’s agent added', () => {
    roundTrip(body('async function readTheFiles('))
  })

  it('⛔ behind the band’s guards, and each answer kept by its rule', () => {
    const reads = body('async function readTheFiles(')
    const { tree, added, settled } = roundTrip(reads)
    const written = reads.indexOf('cast.treeFiles.value =')
    // The sequence is taken before the await; both freshness checks precede either assignment.
    expect(settled, 'the round trip moved — this census reads nothing').toBeGreaterThan(0)
    const taken = reads.indexOf('const mine = filesRead')
    const incremented = reads.indexOf('filesRead += 1')
    expect(incremented).toBeGreaterThan(0)
    expect(taken).toBeGreaterThan(incremented)
    expect(taken).toBeLessThan(settled)
    const guard = reads.indexOf('if (asked !== activeId.value || mine !== filesRead) return')
    expect(guard).toBeGreaterThan(settled)
    expect(guard).toBeLessThan(written)
    expect(reads.indexOf('cast.cardFiles.value =')).toBeGreaterThan(guard)
    expect(reads).toContain(
      `cast.treeFiles.value = filesReadFor(asked, ${tree}, cast.treeFiles.value)`,
    )
    expect(reads).toContain(
      `cast.cardFiles.value = filesReadFor(asked, ${added}, cast.cardFiles.value)`,
    )
  })

  it('⛔ a refusal or a throw is *did not answer*, never an empty list', () => {
    const reads = body('async function readTheFiles(')
    const { tree, added, settled } = roundTrip(reads)
    for (const name of [tree, added]) {
      const initial = reads.indexOf(`let ${name}: readonly KeptFile[] | null = null`)
      expect(initial, `${name} starts unanswered`).toBeGreaterThan(0)
      expect(initial).toBeLessThan(settled)
      expect(reads.match(new RegExp(String.raw`(?:^|\n)\s*${name} =`, 'g'))).toHaveLength(1)
    }
    // Only the successful arm replaces null; the catch must preserve those unanswered values.
    expect(reads).toMatch(/try \{\s*const \w+ = await window\.api\.runtime\.filesKept\(/)
    expect(reads).toMatch(/\}\s*catch \{\s*\}/)
    expect(reads).not.toMatch(/=\s*\[\s*\]/)
  })

  it('⚑ read when the conversation or the surface moves — and let go on unmount', () => {
    expect(screen).toMatch(/watch\(\[activeId, surface\], \(\) => void readTheFiles\(\)\)/)
    const reads = body('async function readTheFiles(')
    expect(reads).toContain(
      "const asked = surface.value === 'conversation' ? activeId.value : null",
    )
    const absent = reads.indexOf('if (asked === null) return')
    expect(absent).toBeGreaterThan(0)
    expect(absent).toBeLessThan(roundTrip(reads).settled)
    const released = [...screen.matchAll(/onUnmounted\(\(\) => \{([\s\S]*?)\n\}\)/g)].find(
      (match) => match[1]?.includes('cast.treeFiles.value = null'),
    )?.[1]
    expect(released, 'both lists are released by an unmount callback').toBeDefined()
    expect(released).toMatch(/cast\.treeFiles\.value = null\s+cast\.cardFiles\.value = null/)
    expect(released).toContain('stopListening?.()')
  })

  it('⚑ once on mount — a screen that remounts on an open conversation has no watch to fire', () => {
    const mounted = screen.slice(screen.indexOf('onMounted(() => {'))
    const opens = mounted.slice(0, mounted.indexOf('stopListening = whenTheWorldMoves('))
    expect(opens).toContain('listenProviderStates(window.api.runtime, store, (message) => {')
    expect(opens).toMatch(/^ {2}void readTheFiles\(\)$/m)
  })

  it('⚑ …and when the work moves — a retitle changes the title each row stands under', () => {
    const arm = /\n {4}work: \(\) => \{([\s\S]*?)\n {4}\},/.exec(screen)?.[1] ?? ''
    expect(arm, 'the `work` arm moved — this census reads nothing').toContain('void readTheWork()')
    expect(arm).toContain('void readTheFiles()')
  })
})
