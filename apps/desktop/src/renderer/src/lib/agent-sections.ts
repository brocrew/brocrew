/**
 * ⛔ **What shapes an agent, organised by WHOSE TEXT IT IS** — `EXT-015` §2, built by `626`.
 *
 * ## ⚑ Why this is a vocabulary and not four headings in a template
 *
 * ⚠️ **`EXT-015` §1 asks for one popup behind two doors** — the Team page, where no conversation is
 * open, and a conversation, where one is. ⛔ **The two doors cannot fill the same sections**, and
 * that is not a defect to be hidden: a section a door cannot fill has to SAY so, in one line, or a
 * person cannot tell *this agent has none* from *this app has not read any*.
 *
 * 🔴 **That distinction is the whole reason this module exists.** The PO has raised it in four
 * consecutive documents and it has a name: an absence a person cannot account for is worse than a
 * gap they can. So an absence here is never a missing block — it is {@link SectionAtADoor}, which
 * is a value with a sentence attached.
 *
 * ## ⛔ What the exhaustiveness buys
 *
 * ⚑ **{@link SECTION_AT_EACH_DOOR} is a `Record` over {@link AGENT_SECTIONS}**, so a fifth section
 * added later does not compile until somebody says what it does at BOTH doors.
 * ⚠️ **A section that appears at neither door is legal — but it has to be written down as such**,
 * which is `626` relay 2 §4's ruling:
 *
 * > ⚑ *"each group declares which door(s) it appears at, and the test asserts the DECLARATION is
 * > exhaustive … A group that appears at neither door must say so deliberately."*
 *
 * ⛔ **This is a CLASSIFICATION and deliberately not a partition.** The first draft of the rule was
 * *close the conversation — whatever remains belonged to the agent*, and it does not cleave: the
 * app's six `WHOSE_TEXT` owner groups include one whose text belongs to a DIRECTORY but is derived
 * from a conversation's cwd, and one that is internally mixed. ⚠️ A test that forced every member
 * to one side would assert something false. See `626`'s response §4.
 */

/**
 * ⛔ **The four, in the order `EXT-015` §2 lists them**, which is also the order a person meets
 * them: what the app said, what you said, what it said to itself, and what this one run was given.
 */
export const AGENT_SECTIONS = [
  'brobots-rules',
  'your-instructions',
  'its-memory',
  'this-conversation',
] as const

export type AgentSection = (typeof AGENT_SECTIONS)[number]

/**
 * ⚑ **The two doors `EXT-015` §1 names.** ⚠️ Spelled as places rather than as `team`/`session`,
 * because the sentences below are shown to a person and read better as the place they are standing.
 */
export const DOORS = ['the-team-page', 'a-conversation'] as const

export type Door = (typeof DOORS)[number]

/**
 * ⛔ **Why a section is not on screen, and the two reasons are NOT the same fact.**
 *
 * ⚠️ **`not-here` is a property of the DOOR** — *there is no conversation to describe* is true
 * forever and is nobody's bug. ⛔ **`not-yet` is a property of this BUILD** — the app cannot read
 * it from here today, and somebody is fixing that.
 *
 * 🔴 **Collapsing them is the criterion-18 failure.** A person reading *"nothing here"* over both
 * cannot tell a thing that will never exist from a thing that is coming, and the second one is the
 * one they would wait for.
 */
export type WhyNot = 'not-here' | 'not-yet'

/** ⚑ What a section does at ONE door: it is drawn, or it is absent WITH a sentence. */
export type SectionAtADoor =
  { readonly drawn: true } | { readonly drawn: false; readonly why: WhyNot; readonly says: string }

export interface SectionDeclaration {
  /** ⚑ **The heading a person reads** — `EXT-015` §2.2: *"Not file paths, not layer names."* */
  readonly heading: string
  /**
   * ⛔ **There is deliberately no `takesEffect` field here** (626, found reviewing this module's
   * own diff).
   *
   * ⚠️ **`EXT-015` §2.1 asks each section to say when a change takes effect, and only ONE section
   * can be changed at all.** ⚑ That section's sentence already exists and already has one home —
   * `TAKES_EFFECT_AT_THE_NEXT_LAUNCH`, rendered by `OwnInstructions` beside its own Save control.
   * 🔴 A field here would have been `null` on all four members: a promise nothing keeps, and a
   * second place for a sentence that must not have two.
   */
  readonly at: Readonly<Record<Door, SectionAtADoor>>
}

/**
 * ⛔ **Every section, at every door.** ⚑ A `Record` twice over, so neither a new section nor a new
 * door can be added without somebody answering for it.
 *
 * ⚠️ **The `not-yet` sentences name no dispatch number**, deliberately: a person reading the popup
 * is not owed our ticket numbers, and a sentence that ages out when the ticket lands is a sentence
 * that will be wrong for longer than it was right.
 */
export const SECTION_AT_EACH_DOOR: Readonly<Record<AgentSection, SectionDeclaration>> = {
  'brobots-rules': {
    heading: "BroCrew's rules",
    at: {
      'a-conversation': { drawn: true },
      // ⛔ **Composed AT LAUNCH, from the files as they were then** — so outside a conversation
      // there is no composition to show. ⚠️ Not *this agent has no rules*: it has them, and this
      // door cannot reach them.
      'the-team-page': {
        drawn: false,
        why: 'not-yet',
        says: 'These are put together when a conversation starts, so they can only be read inside one.',
      },
    },
  },
  'your-instructions': {
    heading: 'Your instructions',
    at: {
      'a-conversation': { drawn: true },
      'the-team-page': { drawn: true },
    },
  },
  'its-memory': {
    heading: 'Its memory',
    at: {
      'a-conversation': { drawn: true },
      // ⛔ **The reading this door takes carries no memory at all** — for either provider. ⚠️ It is
      // not a Codex gap: the conversation's reading carries memory for both.
      'the-team-page': {
        drawn: false,
        why: 'not-yet',
        says: 'This app cannot read what an agent wrote down except from inside one of its conversations.',
      },
    },
  },
  'this-conversation': {
    heading: 'This conversation',
    at: {
      'a-conversation': { drawn: true },
      // 🔴 **`not-here`, and this is the member that makes the distinction earn its keep.** There
      // is no conversation at this door, so there is nothing to describe and never will be. ⛔ A
      // person must not read this as something the app is failing to fetch.
      'the-team-page': {
        drawn: false,
        why: 'not-here',
        says: 'There is no conversation open here — this describes one run, and belongs to it.',
      },
    },
  },
}

/** ⚑ The sections a door DRAWS, in {@link AGENT_SECTIONS} order. */
export function sectionsDrawnAt(door: Door): readonly AgentSection[] {
  return AGENT_SECTIONS.filter((section) => SECTION_AT_EACH_DOOR[section].at[door].drawn)
}

/**
 * ⛔ **The sections a door does NOT draw, each with the sentence it owes.**
 *
 * ⚠️ **Returned rather than filtered away**, which is the module's whole point: the caller renders
 * these, it does not skip them.
 */
export function sectionsAbsentAt(
  door: Door,
): readonly { readonly section: AgentSection; readonly why: WhyNot; readonly says: string }[] {
  const absent: { section: AgentSection; why: WhyNot; says: string }[] = []
  for (const section of AGENT_SECTIONS) {
    const at = SECTION_AT_EACH_DOOR[section].at[door]
    if (!at.drawn) absent.push({ section, why: at.why, says: at.says })
  }
  return absent
}
