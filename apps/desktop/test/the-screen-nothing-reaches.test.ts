import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computed, nextTick, ref, type ComputedRef } from 'vue'
import { describe, expect, it } from 'vitest'
import type { SessionRecord } from '../src/renderer/src/lib/session-record'
import { RESERVED_PLACES, useSurface } from '../src/renderer/src/composables/useSurface'
import { buildCommands } from '../src/renderer/src/lib/command-palette'
import { proseSpans } from './lib/prose-spans'

/**
 * # 🔴 570 · the screen nothing reaches, and the section that said the same thing twice
 *
 * ## ⛔ The property, and why it is ONE test
 *
 * ⚑ **`568` built a Team roster — every identity, what it is for, a rename, a removal — and
 * nothing in the app reached it.** ⛔ **`EXT-008` §4.4 ruled the other half:** *"The rail says zero
 * and then names three agents. That is the identity-versus-folder distinction leaking into
 * navigation, and the Agents page is where it gets explained — not the rail."*
 *
 * > 🔴 **At no commit does a window exist with neither surface.**
 *
 * ⛔ **Either half alone is a worse app than the one before it.** Take the section out first and a
 * person loses the only thing in the product that names their agents. Route the page first and
 * leave the section and the app says two different things about one subject, on one screen, in one
 * window — which is the contradiction `EXT-008` §4.4 is about, doubled.
 *
 * ⚠️ **So §1 is a SINGLE expectation over a composed object**, not two assertions that happen to
 * sit together: reverting either half on its own changes one field of it and the test fails. ⛔ Two
 * independent `expect`s would each still pass in the world the other one forbids.
 *
 * ## ⚑ What is here, and what is drawn elsewhere
 *
 * ⛔ **A source census is what a both-directions claim about a WINDOW can be**, because nothing in
 * this repository mounts `RuntimeScreen` — the parent owns the `v-if`, so no child can be asserted
 * to remove itself (`a-child-cannot-be-asserted-to-remove-itself`). ⚑ **The rendered pairing is in
 * `test/dom/rail-identity.dom.test.ts`**, which mounts the rail and the page from ONE roster object
 * and asserts they name one identity identically — the assertion that would have caught `568`'s
 * fold drawing `default` where the rail says `BroBot (default)`.
 *
 * ## ⚠️ Every census below reads CODE, never prose
 *
 * ⛔ **This file's own docblocks quote the hooks it forbids.** {@link code} blanks every comment
 * through `prose-spans.ts`' parser rather than a regex, so a `/*` inside a string cannot become a
 * comment (`a-source-census-must-strip-prose-before-it-asserts`).
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(HERE, '../src')

const read = (path: string): string => readFileSync(join(SRC, path), 'utf8')

/** ⛔ Every comment blanked, newlines kept — see the header for why a regex will not do. */
function code(file: string, source: string): string {
  let out = source
  for (const span of proseSpans(file, source)) {
    out = out.replace(span.text, span.text.replace(/[^\n]/g, ' '))
  }
  return out
}

const RAIL_PATH = 'renderer/src/components/SideRail.vue'
const SCREEN_PATH = 'renderer/src/components/RuntimeScreen.vue'
const PAGE_PATH = 'renderer/src/components/TeamWorkspace.vue'

/**
 * 🔴 **The four elements that made the rail a second roster**, each named, because *the section is
 * gone* is a claim any one of them could falsify on its own. ⚑ `EXT-008` §5's ban, in hooks: *"No
 * counts, no `+`, no lists, no explanatory sentences."*
 */
const THE_RAIL_WAS_A_ROSTER = [
  'data-cy="rail-agents"',
  'data-cy="agent-count"',
  'data-cy="rail-new-agent"',
  'data-cy="rail-agents-empty"',
  'data-cy="rail-agents-orphans"',
  'openAgentCapabilities',
] as const

const railCode = (): string => code('SideRail.vue', read(RAIL_PATH))
const screenCode = (): string => code('RuntimeScreen.vue', read(SCREEN_PATH))

/** A store with nothing in it — `useSurface` only ever reads these two. */
function fakeStore(): { live: ComputedRef<SessionRecord[]>; get: () => SessionRecord | null } {
  const rows = ref<SessionRecord[]>([])
  return { live: computed(() => rows.value), get: () => null }
}

describe('570 §1 · at no commit does a window exist with neither surface', () => {
  it('🔴 the roster is reachable AND the rail has stopped being a second one — one expectation', () => {
    const rail = railCode()
    const screen = screenCode()
    // ⛔ **One object, one `expect`.** ⚑ Reverting the route leaves `mountsTheRoster` false;
    // reverting the eviction leaves `theRailIsStillARoster` non-empty; reverting both fails
    // twice. ⚠️ **A pair of separate assertions would not have this property** — each would pass
    // in exactly the world the other forbids, which is the defect the sequencing produced.
    expect({
      theRailIsStillARoster: THE_RAIL_WAS_A_ROSTER.filter((mark) => rail.includes(mark)),
      mountsTheRoster: screen.includes("surface === 'team'") && screen.includes('<TeamWorkspace'),
      theRailReachesIt: rail.includes('data-cy="rail-team"') && rail.includes("emit('go', 'team')"),
    }).toEqual({ theRailIsStillARoster: [], mountsTheRoster: true, theRailReachesIt: true })
  })

  it('⚑ the census is not vacuous — each half is refutable, proven on a planted world', () => {
    // 🔴 **`a-positive-assertion-must-differ-from-the-default`, applied to a three-field
    // object.** ⛔ Each field is computed again over a source with the relevant line taken out,
    // and each must move — otherwise a green run above says nothing about any of the three.
    const rail = railCode()
    const screen = screenCode()
    expect(
      THE_RAIL_WAS_A_ROSTER.filter((mark) => `${rail}\n${THE_RAIL_WAS_A_ROSTER[0]}`.includes(mark)),
    ).toEqual([THE_RAIL_WAS_A_ROSTER[0]])
    expect(screen.replace("surface === 'team'", 'x').includes("surface === 'team'")).toBe(false)
    expect(rail.replace('data-cy="rail-team"', 'x').includes('data-cy="rail-team"')).toBe(false)
    // 🔴 **And the STRIPPER is doing work, proven on the subject file rather than on a string.**
    // ⛔ A first version asserted only that `SideRail.vue` mentions `EXT-008` — which it does
    // fifteen times, and which never calls {@link code} at all. ⚠️ **The rail's template comment
    // quotes `EXT-008` §4.4 verbatim**, once, to say why the section left; the raw file holds
    // that sentence and the stripped file must not. ⚑ So this line fails the day `code()` stops
    // stripping, which is the only day §1's negatives could pass by accident.
    const quoted = 'The rail says zero'
    expect(read(RAIL_PATH), 'the rail stopped explaining what left it').toContain(quoted)
    expect(
      rail,
      'the stripper stopped stripping — every negative above is now vacuous',
    ).not.toContain(quoted)
  })
})

describe('570 §2 · Team is a PLACE, and a place is decided in four files', () => {
  it('🔴 place "team" is the Team surface — and before this it was a project called team', async () => {
    const surface = useSurface(fakeStore())
    await nextTick()
    surface.place.value = 'team'
    // ⛔ **The assertion that fails without the reservation.** `RESERVED_PLACES` did not hold the
    // word, so the chain reached `'project'` — and since D-016 took projects out, a word no place
    // answers to draws the launcher, which is the same unreachable page by another route.
    expect(surface.surface.value).toBe('team')
  })

  it('⚑ …and a word nobody reserved does not reach the Team page', async () => {
    const surface = useSurface(fakeStore())
    await nextTick()
    surface.place.value = 'teamwork'
    // ⚠️ **The paired control**: reserving a word routes THAT word, not every word that starts
    // with it. ⚑ **D-016** · it routed as a project until projects went; an unreserved word now
    // falls through to the launcher (`useSurface`'s fallback).
    expect(surface.surface.value).toBe('launcher')
  })

  it('⛔ the word is reserved, which is the half the precedence chain cannot do alone', () => {
    expect([...RESERVED_PLACES]).toContain('team')
  })

  it('⚑ the palette offers it, with the sentence the rail row deliberately does not carry', () => {
    const rows = buildCommands({
      conversations: [],
      activeId: null,
      agent: null,
    })
    const team = rows.find((row) => row.id === 'go-team')
    expect(team?.action).toEqual({ kind: 'go', place: 'team' })
    // ⛔ **One noun across the three surfaces** (`154`), and it was DECIDED rather than preferred:
    // `561` §1 put *Team versus Agents* to the designer and refused to pick; v2.10's changelog §7
    // answered *"I kept Team… the individual noun stays agent."*
    expect(team?.title).toBe('Team')
    expect(team?.detail).toContain('run or not')
  })

  it('🔴 every file that decides a destination names this one — the 537-shaped wiring census', () => {
    const sites: { file: string; holds: string; why: string }[] = [
      {
        file: 'renderer/src/composables/useSurface.ts',
        holds: "'team'",
        why: 'reserved, named in SurfaceName, and in the precedence chain',
      },
      {
        file: SCREEN_PATH,
        holds: "surface === 'team'",
        why: 'the branch inside <main> that mounts the page',
      },
      {
        file: RAIL_PATH,
        holds: 'data-cy="rail-team"',
        why: 'the destination row a person presses',
      },
      {
        file: 'renderer/src/lib/command-palette.ts',
        holds: "place: 'team'",
        why: 'the palette row, and the widened action arm beside it',
      },
    ]
    const missing = sites.filter(({ file, holds }) => {
      const name = file.slice(file.lastIndexOf('/') + 1)
      return !code(name, read(file)).includes(holds)
    })
    expect(missing.map((one) => `${one.file} — ${one.why}`)).toEqual([])

    // ⛔ **The census is proven by violating it**: a string no file holds must be reported, or a
    // green run above says nothing about the reader.
    const invented = sites.filter(({ file }) =>
      code(file.slice(file.lastIndexOf('/') + 1), read(file)).includes("place: 'team-that-is-not'"),
    )
    expect(invented).toEqual([])
  })
})

describe('570 §3 · what the rail stopped doing, and where each part of it went', () => {
  it('⛔ the list, the count, the +, the two notes and the sheet door are all out of the column', () => {
    const rail = railCode()
    // ⚑ Non-vacuity: the rail still names this subject, as a destination and nothing else.
    expect(rail).toContain('data-cy="rail-team"')
    for (const gone of THE_RAIL_WAS_A_ROSTER) {
      expect(rail, `${gone} is still in the rail`).not.toContain(gone)
    }
    // ⛔ **And the emit contract shrank with the markup.** A dead emit is a door the screen still
    // listens on and nothing can open — `566` removed `openExternalMcp` for the same reason.
    expect(rail, 'the rail still declares a gesture nothing in it raises').not.toContain('newAgent')
  })

  it('🔴 the two doors the section was the ONLY opener of are open, on the page', () => {
    const screen = screenCode()
    const page = code('TeamWorkspace.vue', read(PAGE_PATH))
    // ⚠️ **`RuntimeScreen` is the only site in the renderer that opens either overlay**, so a move
    // that dropped a listener would remove the product's only way to create an agent, or its only
    // way to open a capability sheet, and no test would have said so.
    expect(screen).toContain("overlays.open({ kind: 'newAgent' })")
    expect(screen).toContain("overlays.open({ kind: 'agentCapabilities', profileSlug })")
    expect(screen).toContain('@create=')
    expect(screen).toContain('@open=')
    // ⛔ …and the rail no longer listens for either, which is the other direction of the claim.
    expect(screen).not.toContain('@new-agent=')
    expect(screen).not.toContain('@open-agent-capabilities=')
    // ⚑ The page RAISES both rather than performing either — the shape `566` used for its own.
    expect(page).toContain("emit('create')")
    expect(page).toContain("emit('open', member.identity.slug)")
  })

  it('⚠️ …and the prop the section read SURVIVES it, because two other readers need it', () => {
    const rail = railCode()
    // Keep the roster prop used by `agentName` and the palette even if the surrounding block
    // is removed. `oneSpelling` and `agentName`’s fallback still consult that roster;
    // dropping it would put the shared `brobot-workspace` directory name back on every row.
    expect(rail).toContain('agentName(meta.profileId, props.agents?.identities ?? null)')
    expect(rail).toContain('identities: props.agents?.identities ?? null,')
  })
})
