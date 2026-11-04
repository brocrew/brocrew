/**
 * Share the fields the front door cannot express, fields placeable on the wire, and fields
 * the real placed door cannot carry. Front-door launches use the app's provider, default
 * profile and `ask` approval; an instrument must refuse settings it cannot deliver.
 * `PLACEABLE` follows `CreateSessionInput` without `launchKey`.
 *
 * Keep refusal remedies and launch closures in each instrument: available alternate doors,
 * connection expressions and send guards differ. Sharing those would change behaviour or
 * recommend a door a particular instrument does not have.
 */

/**
 * ⛔ **The nine fields the front door cannot be asked for** — `417`, HO-022 §2.
 *
 * ⚠️ **Spelled as the CALLERS spell them, not as the wire does.** `profile`/`newProfile` are the
 * smokes' own two ways of naming an identity and `autoApprove` is their boolean for what the wire
 * calls `approvalMode: 'auto'` — so this list is what a STEP might ask for, which is the only
 * thing a refusal in front of `startSession` can check. {@link PLACEABLE} is the other spelling.
 */
export const FRONT_DOOR_CANNOT_ASK = Object.freeze([
  'provider',
  'profile',
  'newProfile',
  'cwd',
  'model',
  'reasoningEffort',
  'planMode',
  'autoApprove',
  'ultracode',
])

/**
 * Every field a placement may put on the wire — `CreateSessionInput`, minus `launchKey`.
 *
 * ⛔ **The wire schema STRIPS unknown keys** (`ipc.ts`'s `.strict()`-less object), so a misspelled
 * field is dropped in silence and the session starts on a shape nobody asked for. An instrument
 * that places sessions checks against this list so the typo fails where it was written.
 */
export const PLACEABLE = Object.freeze([
  'provider',
  'profileId',
  'cwd',
  'approvalMode',
  'model',
  'reasoningEffort',
  'planMode',
  'ultracode',
])

/**
 * Which of {@link FRONT_DOOR_CANNOT_ASK} this call actually asked for — `[]` when none.
 *
 * 🔴 **A BLACKLIST, and {@link whatTheFrontDoorCannotCarry} is the whitelist beside it.** This
 * answers *"did the step ask for something the product cannot express?"*, which needs the
 * callers' own spellings and cannot be derived from the wire. ⛔ On its own it is not enough:
 * found by an adversarial pass over `420`'s diff, `startSession(cdp, { prompt, profileId: 'x' })`
 * passed it — nine names checked, `profileId` not among them — and started a `default` session
 * with the field dropped and nothing said. **That is the wire schema's own silent-strip defect,
 * on the door in front of it**, and it is the exact spelling `420` introduced at forty-odd
 * placement call sites one screen away.
 *
 * ⚑ **The predicate is the shared half and it is not obvious.** `undefined` is *not asked for*;
 * so is `false`, because `planMode`/`autoApprove`/`ultracode` are booleans a caller may pass off;
 * and so is `''`, because a blank folder means *nobody chose* everywhere else in this app
 * (`scratch-cwd.ts`'s own blank branch). ⛔ A file that re-derived this would be free to treat
 * `autoApprove: false` as a request, and its refusal would fire on steps that asked for nothing.
 *
 * @param {Record<string, unknown>} asked the options object a step handed to the front door
 * @returns {string[]} the offending field names, in list order
 */
export function whatTheFrontDoorWasAskedFor(asked) {
  return FRONT_DOOR_CANNOT_ASK.filter(
    (field) => asked[field] !== undefined && asked[field] !== false && asked[field] !== '',
  )
}

/**
 * Which fields of a placement are not on the wire at all — `[]` when the call is well-formed.
 *
 * @param {Record<string, unknown>} placement everything but `prompt` and the instrument's own
 *   bookkeeping fields, which the caller strips before asking
 */
export function whatIsNotPlaceable(placement) {
  return Object.keys(placement).filter((field) => !PLACEABLE.includes(field))
}

/**
 * ⛔ **Everything the front door was handed that it will not carry** — the whitelist half.
 *
 * The front door sends three fields and none of them is the caller's to choose, so a call that
 * carries ANYTHING but a prompt is a call whose author believed otherwise. ⚑ Checked as a
 * closed set rather than a list of known-bad names, because the failure that made this necessary
 * was a field nobody had thought to forbid.
 *
 * @param {Record<string, unknown>} asked the options object, prompt already removed
 */
export function whatTheFrontDoorCannotCarry(asked) {
  const named = whatTheFrontDoorWasAskedFor(asked)
  // ⚠️ The named ones first and in list order, so the message leads with the field a reader is
  // most likely to have meant — then anything else, which is the half the blacklist cannot see.
  return [...named, ...Object.keys(asked).filter((field) => !named.includes(field))]
}

/**
 * 🔴 **What the PLACED door cannot carry either — the count that says how much of the interim is
 * waiting on a surface, and how much on nothing** (`427` §3).
 *
 * ⛔ **`423` relay 1 shipped the real placed door and it did NOT retire `placeSession`.**
 * `StartAsAgent.vue` sends the identity and, since D-016, the folder a person chose — the interim
 * door's load-bearing per-step `cwd` — so what still holds a placement is a field no launch-time
 * control sets. ⚑ So the honest question an instrument can answer is not *"is there a real door
 * yet"* but **which placements are held up by a field some surface could carry, and which by a
 * field no door in this product will ever have.**
 *
 * ⚠️ **`approvalMode` needs its VALUE, which is why this is a function and not a set difference.**
 * The sheet sends the literal `'ask'`, so a placement that asked for `'ask'` is carryable and one
 * that asked for `'auto'` is not — and `420`'s own finding is that every live approval control is
 * queued for the NEXT message, so `'auto' on turn 1` has no surface at all.
 *
 * @param {Record<string, unknown>} placement everything but `prompt` and `forced`
 * @param {readonly string[]} sends what the sheet really sends — {@link placedDoorSends}, passed
 *   in rather than imported so the caller's derivation is visible at the call site.
 * @returns {string[]} the field names this door could not express, sorted.
 */
export function whatThePlacedDoorCannotCarry(placement, sends) {
  if (!Array.isArray(sends) || sends.length === 0) {
    throw new Error(
      'whatThePlacedDoorCannotCarry: an empty field list would report every placement as movable, ' +
        'which is the direction that flatters the product — pass placedDoorSends()',
    )
  }
  return Object.keys(placement)
    .filter((field) =>
      field === 'approvalMode' ? placement.approvalMode !== 'ask' : !sends.includes(field),
    )
    .sort()
}
