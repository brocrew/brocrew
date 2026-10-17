import { foldProfileName } from '../../shared/runtime-ipc'
import type { IdentityCreator } from '../../shared/runtime-ipc'

/**
 * **How the rows this app writes are NAMED in the database** (204) — an agent identity, a version
 * of an identity's instructions, an amendment to its memory — and the one stored key that is not a
 * row id, {@link ROOTS_SCOPE}.
 *
 * ⛔ **Derived ids, not generated ones, and this module is the one place the app derives them.** A
 * surrogate `<prefix>_<uuid>` would be a second name for a row's natural key and could take two
 * values for one thing the moment two writers raced; a derived id is the same for every writer that
 * computes it from the same facts. ⚑ A row with no natural key — a conversation, a piece of work, a
 * kept resource — takes a generated id from `ids.ts` instead.
 *
 * ⚠️ **What settles a race is not the same for every kind, and the store's statements say which.**
 * An identity row is `INSERT OR IGNORE` on its id: two writers minting one agent want one row, and
 * that is all the concurrency control it needs. An instruction version and a memory amendment are
 * plain `INSERT`s: a second writer that computed the same number lost a race and has to be told so.
 * `OR IGNORE` would report that as a save; the primary key refuses it instead.
 *
 * ⚑ **`:` cannot appear in a slug.** `PATH_SEGMENT_PATTERN` is `[A-Za-z0-9][A-Za-z0-9._-]*`, so no
 * name can spell a separator and collide with another pair.
 */

/** The separator. Not in `PATH_SEGMENT_PATTERN`, which is what makes the ids unambiguous. */
const SEP = ':'

/**
 * 🔴 **D-016 · the `work_sequence` scope the roots are numbered in** — `W1`, `W2`, … app-wide.
 *
 * ⛔ **A word and not NULL**: a root has no parent, and SQLite cannot key on NULL as one value —
 * two NULL keys are two rows — so the roots' counter needs a key of its own. ⚑ Every other scope is
 * a parent's `work.id` (`work_<uuid>`), which this word can never be.
 */
export const ROOTS_SCOPE = 'roots'

/**
 * `aid:<folded profile slug>` — a GLOBAL agent identity's row id (369).
 *
 * ⛔ **Nothing but the name in it, and that absence is the whole dispatch.** HO-009 §4: keying an
 * identity on anything narrower mints a fresh agent with an empty memory for every ticket.
 *
 * ⚑ **Derived rather than generated, for this module's reason** — every insert computes the same
 * id from the same fact, so `INSERT OR IGNORE` is all the concurrency control it needs.
 *
 * ⚠️ **Folded, and it is the only axis this id has**, so there is no unfolded half to open
 * later: `agent_identity_slug_folded_ck` refuses a row whose slug is not already folded, and
 * `agent_identity_slug_uq` compares NOCASE — three spellings of one rule, all ASCII, all agreeing.
 */
export function agentIdentityRowId(profileSlug: string): string {
  return `aid${SEP}${foldProfileName(profileSlug)}`
}

/**
 * 🔴 **One {@link IdentityCreator}, as `agent_identity.created_by` spells it** (598, `HO-084` §1).
 *
 * ⛔ **Here and not in `shared/`, because this module is the one place `aid:` is derived** — its
 * own header says so, and an encoder that spelled the prefix a second time would be free to
 * disagree with {@link agentIdentityRowId} the day the prefix moves.
 *
 * ⚑ **The three shapes cannot collide, and the reason is already written down.**
 * `PATH_SEGMENT_PATTERN` is `[A-Za-z0-9][A-Za-z0-9._-]*`, so no slug can spell {@link SEP} — which
 * is what makes `aid:…` unmistakable for the two bare words, and it is the same argument the header
 * makes about two ids colliding.
 *
 * ⚠️ **It writes the FOLDED slug**, through {@link agentIdentityRowId} rather than beside it, so
 * the value stored is the row id of a row that exists and can be compared without a second fold.
 */
export function identityCreatorColumn(creator: IdentityCreator): string {
  return creator.by === 'an-agent' ? agentIdentityRowId(creator.agent) : creator.by
}

/**
 * 🔴 **`agent_identity.created_by`, folded back into the union** (598) — or `null`, which is
 * *nobody recorded it*.
 *
 * ## ⛔ An unreadable value is NULL, which is the narrow direction and not a guess
 *
 * ⚠️ **`parseChoice`'s rule, one column over**: a word this app cannot read folds to the value that
 * claims the least. ⛔ Here the least is `null` — *nobody recorded it* — because every arm of
 * {@link IDENTITY_ORIGINS} is a CLAIM about who acted, and a hand-edited column must not be able to
 * put a claim into a row nobody wrote one into.
 *
 * ⚠️ **`aid:` with nothing after it is unreadable and not an agent called ``.** An empty slug is a
 * row id no row can have — `agent_identity_slug_folded_ck` and `PATH_SEGMENT_PATTERN` both refuse
 * it — so reading one as `an-agent` would mint a creator out of a malformed string.
 */
export function readIdentityCreator(raw: string | null): IdentityCreator | null {
  if (raw === null) return null
  if (raw === 'a-person' || raw === 'this-app') return { by: raw }
  const prefix = `aid${SEP}`
  if (!raw.startsWith(prefix)) return null
  const agent = raw.slice(prefix.length)
  return agent === '' ? null : { by: 'an-agent', agent }
}

/**
 * `ins:<folded profile slug>:<version>` — one saved version of an identity's own instructions (582).
 *
 * ⛔ **Derived, and derived from the NATURAL KEY**: the real identity of the row is *"version 3 of
 * what this person told `developer`"*, and a surrogate `ins_<uuid>` would be a second name for that
 * pair, free to take two values the moment two writers computed the same version. ⚑ Here the
 * collision is the POINT — `identity_instruction`'s primary key is what makes a reissued version
 * number a constraint violation rather than a second row.
 *
 * ⚠️ **The version is not zero-padded**: an id has to be re-derivable from an integer for ever, and
 * a padding width chosen today would become part of the key and could never widen.
 */
export function ownInstructionsRowId(profileSlug: string, version: number): string {
  return `ins${SEP}${foldProfileName(profileSlug)}${SEP}${String(version)}`
}

export { foldProfileName }

/**
 * `mem:<folded profile slug>:<seq>` — one amendment a person made to an identity's memory (625).
 *
 * ⛔ **Derived from the NATURAL KEY**, for {@link ownInstructionsRowId}'s reason exactly: the real
 * identity of the row is *"the third thing this person did to `developer`'s memory"*, and a
 * surrogate would be free to take two values the moment two writers computed the same sequence.
 * ⚑ Here the collision is the POINT — the primary key is what makes a reissued sequence a
 * constraint violation rather than a second row (`a-max-over-survivors-reissues-a-burned-number`,
 * on a table where the premise that defeats it is enforced by the table itself).
 *
 * ⚠️ **The sequence is not zero-padded**, for {@link ownInstructionsRowId}'s reason: an id has to
 * be re-derivable from an integer for ever.
 */
export function memoryAmendmentRowId(profileSlug: string, seq: number): string {
  return `mem${SEP}${foldProfileName(profileSlug)}${SEP}${String(seq)}`
}
