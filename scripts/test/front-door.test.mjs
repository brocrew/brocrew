import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FRONT_DOOR_CANNOT_ASK,
  PLACEABLE,
  whatIsNotPlaceable,
  whatTheFrontDoorCannotCarry,
  whatTheFrontDoorWasAskedFor,
  whatThePlacedDoorCannotCarry,
} from '../lib/front-door.mjs'
import {
  constantFrom,
  fieldsOf,
  nativeDelegationTools,
  placedDoorSends,
  themeTokenFrom,
} from '../lib/app-source.mjs'

/**
 * 🔴 **420 · the two closed sets three live instruments share, and the app they are about.**
 *
 * ⛔ **A shared module with no test is a shared DEFECT waiting for a second importer.** These two
 * lists exist because the same nine-field refusal was written three times and a copy that loses a
 * field loses it silently — so the thing that must be checked is not the lists' contents but
 * their correspondence to the app: `PLACEABLE` against the wire schema, and the predicate against
 * the three values a caller can legitimately pass for *nothing asked for*.
 *
 * ⚠️ **Every assertion here is about a fact somewhere else.** A test that only restated the
 * literals would be a fourth copy.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..')
const IPC = readFileSync(join(REPO, 'apps/desktop/src/main/runtime/ipc.ts'), 'utf8')
const SCRIPTS = join(REPO, 'scripts')

describe('PLACEABLE is the wire, not a list beside it', () => {
  /**
   * The `createSession` arm of `runtimeCommandSchema`, sliced at its own literal.
   *
   * ⛔ **Sliced rather than grepped whole-file**, because half these field names appear on other
   * arms — `cwd` is on `checkCwd`, `model` on `setSessionSetting` — and a file-wide census would
   * pass over a `createSession` that had lost one.
   */
  const arm = (() => {
    const at = IPC.indexOf("z.literal('createSession')")
    expect(
      at,
      'ipc.ts has no createSession arm — this whole file measures nothing',
    ).toBeGreaterThan(0)
    return IPC.slice(at, IPC.indexOf("z.literal('", at + 30))
  })()

  it('⛔ every field PLACEABLE names is on the createSession schema', () => {
    // ⚠️ **Two spellings, and the first draft only had one.** `profileId` is object SHORTHAND —
    // `profileId,` on its own line, reusing the shared validator declared above the union
    // (`169 §1`: *"the shared profileId, not a second copy of it"*) — so a pattern requiring a
    // colon reported a live field as gone from the wire. A negative is only as strong as its
    // search shape.
    for (const field of PLACEABLE) {
      expect(arm, `${field} is not on createSession's wire any more`).toMatch(
        new RegExp(`\\n\\s*${field}(:|,\\n)`),
      )
    }
  })

  it('⛔ …and the schema names nothing PLACEABLE has missed, except launchKey and answerARefusal', () => {
    // 🔴 **The direction that actually rots.** A field ADDED to `createSession` and not to this
    // list makes `placeSession` refuse a legal placement — which reads as a typo in the step and
    // sends the next author looking in the wrong file.
    //
    // ⚠️ `launchKey` is excluded by name and by reason: it is the launcher's cancel token
    // (`102`'s dead Cancel), minted per press by the renderer, and an instrument that supplied
    // one would be claiming a press nobody made.
    //
    // ⚠️ **716 · `answerARefusal` too**: it says how a refusal comes BACK (`710` F-7), not where
    // the conversation is placed — an instrument that supplied it would be answered a value where
    // `placeSession` reads a rejection.
    const onTheWire = [...arm.matchAll(/\n\s{2,}([a-zA-Z]+)(?::|,\n)/g)].map((m) => m[1])
    expect(onTheWire.length, 'the arm was sliced wrong — no fields came out').toBeGreaterThan(5)
    const NOT_A_PLACEMENT = ['kind', 'launchKey', 'answerARefusal']
    const missed = onTheWire.filter(
      (field) => !NOT_A_PLACEMENT.includes(field) && !PLACEABLE.includes(field),
    )
    expect(missed, `createSession grew ${missed.join(', ')} and PLACEABLE did not`).toEqual([])
    expect(PLACEABLE, 'launchKey is a press, not a placement').not.toContain('launchKey')
    expect(PLACEABLE, 'answerARefusal is an answer, not a placement').not.toContain(
      'answerARefusal',
    )
    // ⚑ …and each exception is still on the wire, or it excuses nothing.
    expect(onTheWire).toEqual(expect.arrayContaining(NOT_A_PLACEMENT.slice(1)))
  })

  it('⚑ whatIsNotPlaceable finds a typo, and the wire is why it has to', () => {
    // The wire strips unknown keys in silence, so this is the only place a misspelling can fail.
    expect(whatIsNotPlaceable({ provider: 'codex', cwd: '/tmp' })).toEqual([])
    expect(whatIsNotPlaceable({ profileID: 'x', aproovalMode: 'auto' })).toEqual([
      'profileID',
      'aproovalMode',
    ])
  })
})

describe('the front door’s refusal, both halves', () => {
  it('⛔ three values mean NOTHING WAS ASKED FOR, and each for its own reason', () => {
    // `undefined` — absent. `false` — the three booleans a caller may pass off. `''` — a blank
    // folder, which means *nobody chose* everywhere else in this app (`scratch-cwd.ts`).
    expect(
      whatTheFrontDoorWasAskedFor({
        provider: undefined,
        planMode: false,
        autoApprove: false,
        ultracode: false,
        cwd: '',
      }),
    ).toEqual([])
    // …and each of the three really is a field this list carries, or the fixture above is empty.
    for (const field of ['provider', 'planMode', 'cwd']) {
      expect(FRONT_DOOR_CANNOT_ASK).toContain(field)
    }
  })

  it('⛔ a named field is refused, in list order', () => {
    expect(whatTheFrontDoorWasAskedFor({ model: 'haiku', provider: 'claude' })).toEqual([
      'provider',
      'model',
    ])
  })

  it('🔴 …and the WHITELIST catches what the blacklist cannot — the defect that made it exist', () => {
    // ⛔ `profileId` is not in `FRONT_DOOR_CANNOT_ASK` — the list carries the smokes' own
    // `profile`/`newProfile` spellings — and it is the exact field `420` introduced at forty-odd
    // placement call sites one screen from the front door. Before the whitelist,
    // `startSession(cdp, { prompt, profileId: 'x' })` started a `default` session with the field
    // dropped and nothing said.
    expect(whatTheFrontDoorWasAskedFor({ profileId: 'smoke-x' })).toEqual([])
    expect(whatTheFrontDoorCannotCarry({ profileId: 'smoke-x' })).toEqual(['profileId'])
    // …and the other field a placement carries that the blacklist also cannot see.
    expect(whatTheFrontDoorCannotCarry({ approvalMode: 'auto' })).toEqual(['approvalMode'])
    // ⚑ Named fields still come FIRST, so the message leads with the one a reader likely meant.
    expect(whatTheFrontDoorCannotCarry({ profileId: 'x', provider: 'claude' })).toEqual([
      'provider',
      'profileId',
    ])
    // ⚠️ And an empty ask is still empty — a whitelist that refused everything would refuse the
    // seven steps that legitimately go through this door.
    expect(whatTheFrontDoorCannotCarry({})).toEqual([])
  })
})

describe('the roster this module exists for', () => {
  it('⛔ every instrument that has a front door imports the policy rather than restating it', () => {
    // 🔴 **The failure this module was extracted to stop, checked rather than hoped for.** Three
    // copies of a closed set is three copies that will differ once; the day a fourth instrument
    // pastes the list instead of importing it, this goes red.
    const importers = readdirSync(SCRIPTS)
      .filter((name) => name.endsWith('.mjs'))
      .filter((name) =>
        readFileSync(join(SCRIPTS, name), 'utf8').includes('refuseWhatTheFrontDoor'),
      )
      .sort()
    expect(importers).toEqual(['packaged-smoke.mjs', 'resume-live-smoke.mjs', 'ui-live-smoke.mjs'])
    for (const name of importers) {
      const source = readFileSync(join(SCRIPTS, name), 'utf8')
      expect(source, `${name} does not import the shared policy`).toContain(
        "from './lib/front-door.mjs'",
      )
      // ⛔ The copy, by its own shape: a local array literal opening with the same first two
      // fields. This is what was there before the extraction, in all three.
      expect(source, `${name} has restated FRONT_DOOR_CANNOT_ASK`).not.toMatch(
        /const FRONT_DOOR_CANNOT_ASK = \[/,
      )
    }
  })
})

describe('app-source: constants read from the app, not written down twice', () => {
  it('⛔ the four it answers for are the app’s own values', () => {
    expect(constantFrom('WORKSPACE_DIRNAME')).toBe('brobot-workspace')
    expect(constantFrom('WORKSPACE_CANARY')).toBe('BROBOT-WORKSPACE-CANARY-4F2A')
    expect(constantFrom('CODEX_INSTRUCTIONS_FILE')).toBe('AGENTS.md')
    // ⚑ The `<script setup>` spelling — unexported, type-annotated, inside a `.vue`. It is the
    // one a regex is most likely to miss and the one `417` made permanent for every person.
    expect(constantFrom('DEFAULT_PROVIDER')).toBe('codex')
  })

  it('⚑ the provider’s own sub-agent tools are the three names the live steps look for', () => {
    // ⚑ 722 · read by `ui-live-smoke.mjs` steps 57, 58 and 80. The app holds no list of them, so
    // the names are written in `app-source.mjs` and pinned HERE, where an edit to them fails the
    // gate rather than a live batch.
    expect(nativeDelegationTools()).toEqual(['Agent', 'Workflow', 'Task'])
  })

  /**
   * 🔴 **`427` · the live suite had `--accent` written into it and the app had moved.**
   *
   * ⛔ `ui-live-smoke.mjs` step `1c` asserted `#7dbbff` and reported *"the token layer is not
   * loaded"* on a healthy app; `chat-theme.test.ts` pins `#a7b7ff` in the gate. Two statements of
   * one constant, the live one drifting, and the drift reading as an app defect — standing rule 1,
   * in the instrument that costs the most to be wrong about.
   */
  it('🔴 a theme token is read from tokens.css, and it is the value the gate pins', () => {
    expect(themeTokenFrom('--accent')).toBe('#ff8a5c')
    // ⚠️ **A second token, so the reader is not one lucky regex.** `--danger` sits below `--accent`
    // in the same block, after three declarations and a comment on every line.
    expect(themeTokenFrom('--danger')).toBe('#ff6b81')
  })

  it('⛔ …and a token it cannot read is a STOP, like every other derived value here', () => {
    expect(() => themeTokenFrom('--no-such-token')).toThrow(/not declared in tokens.css/)
  })

  it('⛔ …and a value it cannot read is a STOP, both ways', () => {
    // A constant that quietly became `undefined` turns an assertion into `includes(undefined)` —
    // a check that cannot fire, which is worse than none because it is green.
    expect(() => constantFrom('NO_SUCH_CONSTANT')).toThrow(/no declared home/)
    // …and the pairing: a name that HAS a home but no readable declaration throws differently, so
    // a reader can tell "nobody registered it" from "the file stopped saying it".
    expect(() => constantFrom('WORKSPACE_DIRNAME')).not.toThrow()
  })
})

describe('427 · every live script evaluates page code inside an ASYNC wrapper', () => {
  /**
   * 🔴 **One missing word cost a packaged run, and no gate could see it.**
   *
   * `packaged-smoke.mjs` step `4b` — the one real Claude turn inside the BUILT app — died on
   * `SyntaxError: await is only valid in async functions`. Its `placeSession` writes
   * `return await window.api.runtime.createSession(…)`, copied from `ui-live-smoke.mjs`, which
   * wraps page code in `(async () => { … })()`. ⛔ **That file wrapped in a plain arrow**, so the
   * expression was a syntax error the moment it was written — at `420`, wired and never run,
   * which is precisely the risk the batching policy names.
   *
   * ⚑ **The rule is uniform rather than conditional.** *"A script may use `await` only if its
   * wrapper is async"* would need a parser to find the `await`s inside evaluated template
   * literals; *"every wrapper is async"* is one line, reads the same in three files, and makes the
   * mismatch unrepresentable.
   */
  const LIVE = ['ui-live-smoke.mjs', 'resume-live-smoke.mjs', 'packaged-smoke.mjs']

  it.each(LIVE)('%s wraps its page expression in an async IIFE', (name) => {
    const source = readFileSync(join(SCRIPTS, name), 'utf8')
    // ⛔ **Both spellings**: two files inline the wrapper at the `Runtime.evaluate` call site and
    // `ui-live-smoke.mjs` builds it in `withPageDeadline`. A check that knew only one would report
    // the file with the deadline — the only one that was never broken — as the offender.
    const wrapped = /\(async \(\) => \{/.test(source)
    expect(wrapped, `${name} evaluates page code without an async wrapper`).toBe(true)
    expect(
      /expression: `\(\(\) => \{/.test(source),
      `${name} still has a plain-arrow Runtime.evaluate wrapper`,
    ).toBe(false)
  })

  it('⛔ the roster is not empty, and every name on it exists', () => {
    expect(LIVE.length).toBeGreaterThan(2)
    for (const name of LIVE) expect(() => readFileSync(join(SCRIPTS, name), 'utf8')).not.toThrow()
  })
})

describe('427 · the REAL placed door, and what it still cannot carry', () => {
  const SENDS = placedDoorSends()

  /**
   * 🔴 **Derived from `StartAsAgent.vue`, so a field added to that sheet moves this by itself.**
   *
   * ⛔ **Pinned as well as derived**, for `hook-reach`'s reason: the derivation does the covering,
   * the equality makes a field joining or leaving the door a red somebody acknowledges in a diff.
   * ⚠️ Both halves matter here — the count `ui-live-smoke.mjs` prints about how much of its
   * interim door is waiting on a surface is computed from this list.
   */
  it('⛔ the door’s payload is read out of the component and is exactly four fields', () => {
    expect(SENDS).toEqual(['provider', 'profileId', 'cwd', 'approvalMode'])
  })

  it('⛔ every field it sends is a field the wire accepts', () => {
    expect(SENDS.filter((field) => !PLACEABLE.includes(field))).toEqual([])
  })

  /**
   * 🔴 **The measurement `427` §3 was asked for**, and D-016 moved it: the sheet sends the folder a
   * person chose, so `cwd` no longer holds a placement, and what does is a field with no
   * launch-time control. ⛔ A placement is *movable* only when the sheet could express every field
   * it carries.
   */
  it('🔴 cwd is carried since D-016, and a launch-time-only field is what holds a placement', () => {
    expect(whatThePlacedDoorCannotCarry({ provider: 'claude', profileId: 'pm' }, SENDS)).toEqual([])
    expect(whatThePlacedDoorCannotCarry({ provider: 'claude', cwd: '/tmp/x' }, SENDS)).toEqual([])
    expect(
      whatThePlacedDoorCannotCarry({ cwd: '/tmp/x', model: 'm', planMode: true }, SENDS),
    ).toEqual(['model', 'planMode'])
  })

  /**
   * ⚠️ **`approvalMode` is judged on its VALUE, which a set difference could not do.** The sheet
   * sends the literal `'ask'`; `420` measured that every live approval control is queued for the
   * NEXT message, so `'auto' on turn 1` has no surface anywhere in the product.
   */
  it('⚠️ approvalMode ask is carried and auto is not — the same key, two answers', () => {
    expect(whatThePlacedDoorCannotCarry({ approvalMode: 'ask' }, SENDS)).toEqual([])
    expect(whatThePlacedDoorCannotCarry({ approvalMode: 'auto' }, SENDS)).toEqual(['approvalMode'])
  })

  /**
   * ⛔ **Both kinds of prose, and the block comment is the one that can bite.** `//` can never be
   * mistaken for a field — `/` is not an identifier character — but a block comment's inner line
   * can be anything, and `StartAsAgent.vue`'s payload carries a four-line note today. ⚑ Planted
   * here because the literal `placedDoorSends` reads in production is a real component and cannot
   * have a fixture put inside it.
   */
  it('⛔ fieldsOf counts no field that only a comment mentions', () => {
    expect(fieldsOf('\n  provider: p,\n  profileId: q,\n')).toEqual(['provider', 'profileId'])
    // ⚠️ **A line comment needs no stripping and gets none** — the pattern wants an identifier
    // straight after the indent, so `/` ends it. Kept as a characterisation: the day somebody adds
    // a `//` filter "for safety", this says it was already true and the filter carries no rule.
    expect(fieldsOf('\n  provider: p,\n  // projectSlug: removed at 431,\n')).toEqual(['provider'])
    expect(fieldsOf('\n  provider: p,\n  /*\n    projectSlug: removed at 431,\n  */\n')).toEqual([
      'provider',
    ])
    // ⚠️ …and the paired positive: a field written AFTER a block comment is still counted, so the
    // strip cannot pass by eating the rest of the literal.
    expect(fieldsOf('\n  /* a note */\n  provider: p,\n')).toEqual(['provider'])
  })

  it('⛔ an empty field list is refused rather than reporting everything as movable', () => {
    expect(() => whatThePlacedDoorCannotCarry({ cwd: '/tmp/x' }, [])).toThrow(
      /flatters the product/,
    )
    expect(() => whatThePlacedDoorCannotCarry({ cwd: '/tmp/x' }, undefined)).toThrow(
      /flatters the product/,
    )
  })
})
