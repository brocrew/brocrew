import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  describeHits,
  describeMissing,
  describeScan,
  filesContaining,
  MIN_MARKER_LENGTH,
  pathsNaming,
  requireMarkers,
  whyIncomplete,
} from '../lib/personal-home-guard.mjs'

/**
 * 176 · The control that replaced five before/after fingerprints of the user's personal home.
 *
 * ⚑ **This file IS the demonstration `176` acceptance 3 asks for**, and it is here rather than in a
 * live smoke for one reason: 🔒 **the demonstration has to write into something shaped like
 * `~/.claude`, and writing into the real one is forbidden.** So it builds a decoy root with the same
 * shape (`168`'s method) and runs the pair that is the whole proof:
 *
 *  1. **It ignores the machine.** Every file `174` actually caught — a transcript in another
 *     repository, a `tasks/…/60.json` written by a live agent, `~/.claude.json` rewriting itself —
 *     is planted here, DURING the window, and the control stays silent.
 *  2. **It catches us.** One file naming this run's own session id, and the control names it.
 *
 * ⛔ **Neither half means anything without the other**, which is the mistake the retired control
 * made in the opposite direction: it was so sensitive to (1) that nobody ever checked it could see
 * (2) — and it could not, for any write outside its two-file keyhole.
 *
 * ⚠️ **This runs in `pnpm run ci`.** The five callers are live smokes and the mutation table cannot
 * reach them; this is the part of the control the table CAN reach, and it is deliberately the part
 * that holds the logic.
 */

const roots = []
const decoy = () => {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-decoy-home-'))
  roots.push(root)
  return root
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** A personal home mid-life: other people's projects, other people's sessions. */
function plantForeignHome(root) {
  mkdirSync(join(root, 'projects', '-Users-someone-dev-notes-app'), { recursive: true })
  writeFileSync(
    join(root, 'projects', '-Users-someone-dev-notes-app', '011d3f20-aaaa-bbbb.jsonl'),
    '{"type":"user"}\n',
  )
  mkdirSync(join(root, 'tasks', '4f7b4663-cccc-dddd'), { recursive: true })
  writeFileSync(join(root, 'tasks', '4f7b4663-cccc-dddd', '59.json'), '{}')
  writeFileSync(join(root, '.claude.json'), JSON.stringify({ projects: { '/Users/someone': {} } }))
  writeFileSync(join(root, 'history.jsonl'), '{"display":"what did I do yesterday"}\n')
  return root
}

/** What a run owns: the session it created, and the working directory it created it in. */
const OURS = [
  { label: 'our session id', value: '5a663acd-1f40-4aa8-a802-a49e8ee6bc8b' },
  { label: 'our cwd', value: 'brobot2-cwd-toolset-n176x67243' },
]

describe('the personal-home guard ignores the machine', () => {
  it('is silent on a home full of other processes work', () => {
    const root = plantForeignHome(decoy())
    expect(pathsNaming(root, OURS).hits).toEqual([])
  })

  it('stays silent when the three files 174 actually caught appear DURING the window', () => {
    const root = plantForeignHome(decoy())
    expect(pathsNaming(root, OURS).hits).toEqual([])

    // 174's smoke:ui red — a live agent in another repository creating a task file mid-run.
    writeFileSync(join(root, 'tasks', '4f7b4663-cccc-dddd', '60.json'), '{"step":"a"}')
    // A transcript in the unrelated notes-app project changes while the guard runs.
    writeFileSync(
      join(root, 'projects', '-Users-someone-dev-notes-app', '011d3f20-aaaa-bbbb.jsonl'),
      '',
    )
    // 174's probe:toolset red — ~/.claude.json rewriting ITSELF, with nothing of ours running.
    writeFileSync(join(root, '.claude.json'), JSON.stringify({ projects: {}, rewritten: true }))

    expect(
      pathsNaming(root, OURS).hits,
      'every one of these failed a run under the retired control',
    ).toEqual([])
  })

  it('is silent on a session id that merely SHARES a prefix with ours', () => {
    const root = decoy()
    mkdirSync(join(root, 'projects', 'someone-else'), { recursive: true })
    writeFileSync(join(root, 'projects', 'someone-else', '5a663acd.jsonl'), '')
    expect(pathsNaming(root, OURS).hits).toEqual([])
  })
})

describe('the personal-home guard catches us', () => {
  it('names a transcript carrying this run session id', () => {
    const root = plantForeignHome(decoy())
    const leak = join(root, 'projects', '-Users-someone-dev-notes-app', `${OURS[0].value}.jsonl`)
    writeFileSync(leak, '{"type":"user"}\n')

    const { hits } = pathsNaming(root, OURS)
    expect(hits).toEqual([{ path: leak, label: 'our session id' }])
    expect(describeHits(hits)).toBe(`our session id → ${leak}`)
  })

  it('names a project DIRECTORY for our cwd, before any transcript lands in it', () => {
    const root = plantForeignHome(decoy())
    const bucket = join(root, 'projects', `-private-var-folders-T-${OURS[1].value}`)
    mkdirSync(bucket, { recursive: true })

    expect(pathsNaming(root, OURS).hits).toEqual([{ path: bucket, label: 'our cwd' }])
  })

  it('catches a leak nested deeper than the two files the retired control hashed', () => {
    const root = plantForeignHome(decoy())
    const deep = join(root, 'todos', 'a', 'b')
    mkdirSync(deep, { recursive: true })
    const leak = join(deep, `${OURS[0].value}-agent.json`)
    writeFileSync(leak, '[]')

    // ⛔ The point of the whole change: `~/.claude.json` and `~/.codex/auth.json` are the only two
    // paths the retired control looked at, and this is not one of them.
    expect(pathsNaming(root, OURS).hits).toEqual([{ path: leak, label: 'our session id' }])
  })

  it('reports a leak that predates the run, which a before/after window cannot', () => {
    const root = plantForeignHome(decoy())
    const leak = join(root, 'projects', `${OURS[0].value}.jsonl`)
    writeFileSync(leak, '')
    // Nothing is "after" here: no snapshot was ever taken. Ownership does not need one.
    expect(pathsNaming(root, OURS).hits.map((hit) => hit.path)).toEqual([leak])
  })
})

describe('the content scan, for markers that live inside a file', () => {
  const SECRET = [{ label: 'the machine refresh token', value: 'rt-not-a-real-token-9f3a' }]

  it('finds a marker inside a file and reports the LABEL, never the value', () => {
    const root = decoy()
    const file = join(root, 'auth.json')
    writeFileSync(file, JSON.stringify({ tokens: { refresh_token: SECRET[0].value } }))

    const scan = filesContaining([file], SECRET)
    expect(scan.hits).toEqual([{ path: file, label: 'the machine refresh token' }])
    // 🔒 The whole reason markers are labelled: a failure message must not carry a credential.
    expect(describeHits(scan.hits)).not.toContain(SECRET[0].value)
    expect(scan.read).toEqual([file])
    expect(scan.skipped).toEqual([])
  })

  it('says what it could NOT read, so a scan cannot look thorough by reading nothing', () => {
    const root = decoy()
    const absent = join(root, 'never-existed.json')
    const huge = join(root, 'huge.jsonl')
    writeFileSync(huge, 'x'.repeat(4096))

    const scan = filesContaining([absent, huge], SECRET, { maxBytes: 1024 })
    expect(scan.hits).toEqual([])
    expect(scan.read).toEqual([])
    expect(scan.skipped).toHaveLength(2)
    expect(scan.skipped[0]).toContain('absent or unreadable')
    expect(scan.skipped[1]).toContain('larger than')
  })
})

describe('the guard refuses to be vacuous', () => {
  it('throws on an empty marker list rather than finding nothing', () => {
    const root = plantForeignHome(decoy())
    // ⛔ This is 129's trap: a caller whose session id came back `undefined` would otherwise get a
    // green run forever, and the file would read as coverage.
    expect(() => pathsNaming(root, [])).toThrow(/vacuous/)
    expect(() => filesContaining([], [])).toThrow(/vacuous/)
  })

  it('throws on a marker too short to be distinctive', () => {
    expect(() => requireMarkers([{ label: 'too short', value: 'abc' }])).toThrow(
      new RegExp(String(MIN_MARKER_LENGTH)),
    )
  })

  it('throws on a marker with no label, because a finding has to name itself', () => {
    expect(() => requireMarkers([{ label: '', value: 'long-enough-value' }])).toThrow(/label/)
  })

  it('throws on a marker whose value is not a string — the undefined-session-id case', () => {
    expect(() => requireMarkers([{ label: 'our session id', value: undefined }])).toThrow(
      /shorter than/,
    )
  })
})

describe('the walk itself', () => {
  it('does not follow a symlink out of the home', () => {
    const root = decoy()
    const elsewhere = decoy()
    mkdirSync(join(elsewhere, 'projects'), { recursive: true })
    writeFileSync(join(elsewhere, 'projects', `${OURS[0].value}.jsonl`), '')
    symlinkSync(elsewhere, join(root, 'link-out'))

    // The linked tree holds a leak; the walk must not descend into it (a personal home links out to
    // plugin checkouts and worktrees, and following those walks half the disk).
    expect(pathsNaming(root, OURS).hits).toEqual([])
  })

  it('stops at maxDepth, and says so by finding nothing deeper', () => {
    const root = decoy()
    const deep = join(root, 'a', 'b', 'c', 'd')
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, `${OURS[0].value}.jsonl`), '')

    expect(pathsNaming(root, OURS, { maxDepth: 2 }).hits).toEqual([])
    expect(pathsNaming(root, OURS, { maxDepth: 6 }).hits).toHaveLength(1)
  })

  // ⛔ **196 M2, and the finding is bigger than the flag.** `188` made the HIT CAP a value the
  // caller receives and left the other two exits silent. A walk that hit its depth bound returned
  // `{ hits: [], truncated: false }` — the shape of a clean home — and on this machine the bound of
  // 6 was doing that to 156 directories under `~/.claude` and 1,627 under `~/.codex` on every run.
  it('SAYS it stopped at the depth bound, instead of reporting the leak below it as absence', () => {
    const root = decoy()
    const deep = join(root, 'a', 'b', 'c', 'd')
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, `${OURS[0].value}.jsonl`), '')

    const shallow = pathsNaming(root, OURS, { maxDepth: 2 })
    expect(shallow.hits, 'the leak is below the bound, as this test needs it to be').toEqual([])
    expect(shallow.complete, 'an empty result from an unfinished walk read as clean').toBe(false)
    expect(shallow.tooDeep.length).toBeGreaterThan(0)
    expect(whyIncomplete(shallow)).toMatch(/depth bound/)

    // ⚑ The paired positive, on the SAME tree: a walk that reaches the bottom says so AND finds it.
    const full = pathsNaming(root, OURS, { maxDepth: 6 })
    expect(full.complete).toBe(true)
    expect(whyIncomplete(full)).toBeNull()
    expect(full.hits).toHaveLength(1)
  })

  it('⛔ the DEFAULT depth reaches a real personal home, which 6 did not', () => {
    // The bound was 6, justified from `~/.codex/sessions/YYYY/MM/DD/<file>` and true of nothing
    // else in the tree: measured at 196, 156 directories under `~/.claude` and 1,627 under
    // `~/.codex` sat below it — plugin caches, marketplace checkouts and their `node_modules`.
    // ⚠️ Nothing asserted the DEFAULT, only explicit values, so the bound could be lowered back to
    // 6 without a single test changing colour. This is that assertion.
    const root = decoy()
    const deep = join(
      root,
      'plugins',
      'marketplaces',
      'a-marketplace',
      'plugins',
      'one',
      'node_modules',
      'dep',
      'lib',
    )
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, `${OURS[0].value}.jsonl`), '')

    const scan = pathsNaming(root, OURS)
    expect(scan.complete, 'the default walk did not finish a home this shallow').toBe(true)
    expect(scan.hits.map((hit) => hit.path)).toEqual([join(deep, `${OURS[0].value}.jsonl`)])
  })

  // Windows chmod cannot construct a POSIX permission denial.
  it.skipIf(process.platform === 'win32')(
    'SAYS a directory would not open, but does not call one that is simply absent a hole',
    () => {
      const root = decoy()
      const shut = join(root, 'shut')
      mkdirSync(join(shut, 'inside'), { recursive: true })
      writeFileSync(join(shut, 'inside', `${OURS[0].value}.jsonl`), '')
      chmodSync(shut, 0o000)
      try {
        const scan = pathsNaming(root, OURS)
        expect(scan.hits, 'the leak is inside the closed directory').toEqual([])
        expect(scan.complete, 'an unreadable directory read as a clean one').toBe(false)
        expect(scan.unreadable).toEqual([shut])
        expect(whyIncomplete(scan)).toMatch(/would not open/)
      } finally {
        chmodSync(shut, 0o700)
      }
      // ⚑ …and the paired positive is the same tree with the door open.
      const opened = pathsNaming(root, OURS)
      expect(opened.complete).toBe(true)
      expect(opened.hits).toHaveLength(1)
    },
  )

  it('caps the report at `limit` so one bad run cannot print ten thousand lines', () => {
    const root = decoy()
    mkdirSync(join(root, 'projects'), { recursive: true })
    for (let n = 0; n < 12; n++) {
      writeFileSync(join(root, 'projects', `${OURS[0].value}-${n}.jsonl`), '')
    }
    expect(pathsNaming(root, OURS, { limit: 5 }).hits).toHaveLength(5)
    expect(pathsNaming(root, OURS).hits.length).toBeGreaterThanOrEqual(12)
  })

  // ⛔ 182 M8: the cap was the whole defect, because nothing said it had been hit. A truncated walk
  // and a clean one returned the same shape, so "no leak" and "stopped looking" read identically.
  it('SAYS it stopped looking, so a truncated walk cannot be read as a clean one', () => {
    const root = decoy()
    mkdirSync(join(root, 'projects'), { recursive: true })
    for (let n = 0; n < 12; n++) {
      writeFileSync(join(root, 'projects', `${OURS[0].value}-${n}.jsonl`), '')
    }
    expect(pathsNaming(root, OURS, { limit: 5 }).truncated).toBe(true)
    // The paired positive: a walk that finished says so, on the SAME tree.
    expect(pathsNaming(root, OURS, { limit: 500 }).truncated).toBe(false)
    expect(pathsNaming(root, OURS, { limit: 500 }).hits.length).toBeGreaterThanOrEqual(12)
  })

  it('returns nothing for a root that does not exist, rather than throwing', () => {
    const scan = pathsNaming(join(tmpdir(), 'brobot2-no-such-home-176'), OURS)
    expect(scan.hits).toEqual([])
    // …and an absent root is FINISHED, not truncated: there was nothing to stop looking at.
    expect(scan.truncated).toBe(false)
    // ⚠️ 196 M2 draws the line by errno rather than by "the call threw": a home that is not there
    // leaves nothing unexamined, and calling that incomplete would fail every machine without one.
    expect(scan.complete).toBe(true)
    expect(scan.unreadable).toEqual([])
  })

  /**
   * ## ⛔ 202 · one idiom that cannot be spelled in a way that ignores an unfinished walk
   *
   * Nine TypeScript callers asked "did anything leak?" in eight slightly different ways, against a
   * `.d.mts` that said `pathsNaming` returned an array. Five threw on the line meant to prove
   * nothing leaked; four passed over an object whose `.length` is `undefined`. `describeScan` is the
   * one shape they all use now, and the completeness question is inside it rather than beside it.
   */
  describe('202 · describeScan', () => {
    it("says 'none' only when the walk finished AND found nothing", () => {
      const root = decoy()
      mkdirSync(join(root, 'projects'), { recursive: true })
      expect(describeScan(pathsNaming(root, OURS))).toBe('none')
    })

    // Windows chmod cannot construct a POSIX permission denial.
    it.skipIf(process.platform === 'win32')(
      '⛔ an unfinished walk is never clean, even with no hits',
      () => {
        const root = decoy()
        // A directory that exists and will not open: the walk cannot say what is inside it.
        const shut = join(root, 'shut')
        mkdirSync(shut, { recursive: true })
        mkdirSync(join(shut, 'inner'), { recursive: true })
        chmodSync(shut, 0o000)
        try {
          const said = describeScan(pathsNaming(root, OURS))
          expect(said).not.toBe('none')
          expect(said).toMatch(/stopped looking/)
        } finally {
          chmodSync(shut, 0o700)
        }
      },
    )

    it('names what it found, and folds several walks into one sentence', () => {
      const a = decoy()
      const b = decoy()
      writeFileSync(join(a, `${OURS[0].value}.jsonl`), '')
      const said = describeScan(pathsNaming(a, OURS), pathsNaming(b, OURS))
      expect(said).toContain(OURS[0].label)
      expect(said).not.toBe('none')
    })

    // Windows chmod cannot construct a POSIX permission denial.
    it.skipIf(process.platform === 'win32')(
      '⛔ says BOTH when it found something and could not finish',
      () => {
        const root = decoy()
        writeFileSync(join(root, `${OURS[0].value}.jsonl`), '')
        const shut = join(root, 'shut')
        mkdirSync(shut, { recursive: true })
        chmodSync(shut, 0o000)
        try {
          const said = describeScan(pathsNaming(root, OURS))
          expect(said).toContain(OURS[0].label)
          expect(said).toMatch(/stopped looking/)
        } finally {
          chmodSync(shut, 0o700)
        }
      },
    )
  })

  /**
   * ⛔ **206 H3 · the other direction, where the ABSENCE of a hit is the finding.**
   *
   * `claude-live.smoke.ts` §3.8 makes two claims at once — *every session this run created is in the
   * isolated home* and *none of them is in the personal one* — and only the second is
   * {@link describeScan}'s question. The first was a boolean (`hasTranscript`) whose `catch` returned
   * `false`, so a home that would not open, a tree deeper than the walk went, and a session that
   * genuinely is not there produced the same answer on the primary Claude isolation instrument.
   *
   * ⚠️ **This is where that logic is testable at all.** The row itself is a live smoke that
   * `pnpm run ci` cannot run and the mutation table cannot reach — the same reason
   * `smoke-verdicts.mjs` lives in `lib/`.
   */
  describe('206 H3 · describeMissing', () => {
    it("says 'none' only when EVERY marker was found", () => {
      const root = decoy()
      for (const marker of OURS) writeFileSync(join(root, `${marker.value}.jsonl`), '')
      expect(describeMissing(pathsNaming(root, OURS), OURS)).toBe('none')
    })

    it('⛔ names the marker that is missing, rather than reporting a clean walk', () => {
      const root = decoy()
      writeFileSync(join(root, `${OURS[0].value}.jsonl`), '')

      const said = describeMissing(pathsNaming(root, OURS), OURS)

      expect(said).toContain(OURS[1].label)
      expect(said).not.toContain(OURS[0].label) // the one that IS there is not reported missing
      expect(said).not.toBe('none')
    })

    // Windows chmod cannot construct a POSIX permission denial.
    it.skipIf(process.platform === 'win32')(
      '⛔ a missing marker from an UNFINISHED walk is not known to be absent',
      () => {
        // The finding itself: "I looked and it is not there" and "I could not look" were one word.
        const root = decoy()
        const shut = join(root, 'shut')
        mkdirSync(shut, { recursive: true })
        chmodSync(shut, 0o000)
        try {
          const said = describeMissing(pathsNaming(root, OURS), OURS)
          expect(said).toMatch(/NOT known to be absent/)
          expect(said).toMatch(/would not open/)
        } finally {
          chmodSync(shut, 0o700)
        }
      },
    )

    // Windows chmod cannot construct a POSIX permission denial.
    it.skipIf(process.platform === 'win32')(
      '⚑ …but a marker that WAS found needs no completeness — a hit is proof',
      () => {
        // The asymmetry, asserted. Failing this row because the walk also stopped somewhere else
        // would be a red nobody could act on, which is 176's own rule about measuring the machine.
        const root = decoy()
        for (const marker of OURS) writeFileSync(join(root, `${marker.value}.jsonl`), '')
        const shut = join(root, 'shut')
        mkdirSync(shut, { recursive: true })
        chmodSync(shut, 0o000)
        try {
          const scan = pathsNaming(root, OURS)
          expect(scan.complete).toBe(false) // the walk really did stop early
          expect(describeMissing(scan, OURS)).toBe('none')
          // …and the OTHER direction over the same scan still refuses to call it clean.
          expect(describeScan(scan)).toMatch(/stopped looking/)
        } finally {
          chmodSync(shut, 0o700)
        }
      },
    )

    it('throws on an empty marker list, exactly as every other entry point does', () => {
      // A row that scanned for nothing would report "nothing missing" forever — 129's trap, on the
      // side of the guard where an empty list looks most like a pass.
      expect(() => describeMissing(pathsNaming(decoy(), OURS), [])).toThrow(/vacuous/)
    })
  })
})
