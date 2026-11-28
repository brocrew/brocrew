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
 * The nine fields the front door cannot be asked for, spelled as the callers spell them rather than
 * as the wire does: `profile`/`newProfile` are the smokes' two ways of naming an identity and
 * `autoApprove` is their boolean for `approvalMode: 'auto'`. This is what a step might ask for, the
 * only thing a refusal in front of `startSession` can check. {@link PLACEABLE} is the wire spelling.
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
 * Every field a placement may put on the wire: `CreateSessionInput`, minus `launchKey`.
 *
 * The wire schema strips unknown keys (`ipc.ts`'s object is not strict), so a misspelled field is
 * dropped silently. An instrument that places sessions checks against this list so the typo fails
 * where it was written.
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
 * Which of {@link FRONT_DOOR_CANNOT_ASK} this call actually asked for, `[]` when none.
 *
 * This is the blacklist half; {@link whatTheFrontDoorCannotCarry} is the whitelist beside it. On its
 * own it is not enough: a misspelled field such as `profileId` is not on the list and would be
 * dropped silently.
 *
 * The predicate is shared and not obvious: `undefined` is not asked for; neither is `false`, because
 * `planMode`/`autoApprove`/`ultracode` are booleans a caller may pass off; neither is `''`, because
 * a blank folder means nobody chose (as in `scratch-cwd.ts`). A file that re-derived this could treat
 * `autoApprove: false` as a request and refuse steps that asked for nothing.
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
 * Everything the front door was handed that it will not carry: the whitelist half.
 *
 * The front door sends three fields and none of them is the caller's to choose, so a call that
 * carries anything but a prompt was written by someone who believed otherwise. Checked as a closed
 * set rather than a list of known-bad names, so a field nobody thought to forbid is still caught.
 *
 * @param {Record<string, unknown>} asked the options object, prompt already removed
 */
export function whatTheFrontDoorCannotCarry(asked) {
  const named = whatTheFrontDoorWasAskedFor(asked)
  // The named ones first and in list order, so the message leads with the field a reader most likely
  // meant, then anything else, which is the half the blacklist cannot see.
  return [...named, ...Object.keys(asked).filter((field) => !named.includes(field))]
}

/**
 * What the placed door cannot carry either: the count that says how much of the interim is waiting
 * on a surface and how much on nothing.
 *
 * `NewConversation.vue` sends the identity and the folder a person chose, so what still holds a
 * placement is a field no launch-time control sets. The question an instrument can answer is which
 * placements are held up by a field some surface could carry, and which by a field no door in this
 * product will ever have.
 *
 * `approvalMode` needs its value, which is why this is a function and not a set difference: the
 * sheet sends the literal `'ask'`, so a placement asking for `'ask'` is carryable and one asking for
 * `'auto'` is not (every live approval control applies to the next message, so `'auto'` on turn 1
 * has no surface).
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
