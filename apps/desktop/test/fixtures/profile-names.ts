/**
 * ⛔ **The corpus BOTH ends of the profile-name rule are checked against** (169 §1, criterion 3).
 *
 * The launcher decides whether Send can be pressed; the IPC schema decides whether the value may
 * cross the wire. They are one rule — `isPathSegment`, in the module main, preload and the renderer
 * all import — and this file is how that is *asserted* rather than asserted-about: one list, read by
 * `profile-name-rule.test.ts` (the schema, main-side). ⛔ **The browser end is gone**: `417`
 * removed the launcher's `+ New profile…` box (HO-022 §2) and deleted
 * `profile-picker.dom.test.ts`, so this corpus now has ONE reader. ⚠️ It is kept rather than
 * folded into its one caller because the rule it carries is the wire's, and the roster (HO-022 §4)
 * is where the second reader comes back. It used to be read by `profile-picker.dom.test.ts` (the
 * control, in a real browser), with the verdict written down here rather than computed from the
 * predicate under test. A corpus that asked `isPathSegment` what it expects would agree with
 * anything `isPathSegment` came to believe.
 *
 * ⚑ **The first four are the PM's own measurement** on `8f30309`, typed into the running app.
 */
export interface ProfileNameCase {
  /** What is typed into the name box. */
  name: string
  /** Whether it is a name a directory can have — the ONE rule, written out by hand. */
  legal: boolean
  /** Why it is in the list, for the failure message. */
  why: string
}

export const PROFILE_NAME_CASES: readonly ProfileNameCase[] = [
  // ── the four the PM measured, with Send lit over every one of them ──
  { name: '..', legal: false, why: 'the parent directory' },
  { name: 'a/b', legal: false, why: 'a separator: two directories, not one' },
  { name: '../../escape', legal: false, why: 'a walk out of the managed root' },
  { name: '   ', legal: false, why: 'whitespace only — a folder you cannot see' },
  // ── the shape rule, at its edges ──
  { name: '', legal: false, why: 'nothing typed' },
  { name: 'a\\b', legal: false, why: 'the other separator, for the other OS' },
  { name: '/absolute', legal: false, why: 'an absolute path' },
  { name: '.hidden', legal: false, why: 'must START with a letter or a digit' },
  { name: '-lead', legal: false, why: 'same, for a dash' },
  { name: 'has space', legal: false, why: 'a space is not in the alphabet' },
  { name: ' padded ', legal: false, why: 'NOT trimmed on the way through — refused, not repaired' },
  { name: 'café', legal: false, why: 'outside the alphabet, however ordinary it looks' },
  { name: '+new', legal: false, why: "the menu's own sentinel can never be a real name" },
  { name: 'x'.repeat(65), legal: false, why: 'one over the length bound' },
  { name: 'x'.repeat(64), legal: true, why: 'exactly the length bound' },
  { name: 'painter', legal: true, why: 'the ordinary case' },
  { name: 'a.b-c_d', legal: true, why: 'every punctuation the alphabet allows' },
  { name: '2nd', legal: true, why: 'a digit may lead' },
  {
    name: 'default',
    legal: true,
    why: 'legal in SHAPE — the launcher refuses it as a clash (167)',
  },
]
