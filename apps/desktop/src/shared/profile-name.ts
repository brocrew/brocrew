/**
 * What a profile id may be. It becomes a directory name, so the alphabet excludes
 * anything that could be spelled to walk out of the managed root, and the length is bounded —
 * a 300-character id passes any regex and then fails deep inside `mkdir` with `ENAMETOOLONG`,
 * naming a path instead of the field that caused it.
 *
 * It lives here, in the module main, preload and the renderer all import, so the launcher can
 * tell you the value is wrong BEFORE sending it and the boundary can reject it with the exact
 * same rule. Two copies of this would drift, and the drift would be silent.
 */
export const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const PATH_SEGMENT_MAX_LENGTH = 64
export function isPathSegment(value: string): boolean {
  return value.length <= PATH_SEGMENT_MAX_LENGTH && PATH_SEGMENT_PATTERN.test(value)
}

/** How to say it, once, wherever a bad id has to be explained. */
export const PATH_SEGMENT_RULE = `letters, digits, dot, dash or underscore (max ${PATH_SEGMENT_MAX_LENGTH})`

/**
 * ⛔ **The fold the DATABASE performs** — a second fold, deliberately, and not the one above (238,
 * from 208 H1).
 *
 * `db/identity.ts` derives `aid:<profile>` through this, `agent_identity_slug_folded_ck` folds with
 * SQLite's `lower()`, and `agent_identity_slug_uq` compares with `COLLATE NOCASE`. Those three must
 * give one answer for every input or the database keys on one identity while the app talks about
 * another — which is 208 H1 all over again, with the fix in place.
 *
 * ⛔ **ASCII only, because SQLite without ICU is.** `lower('DÉV')` is `dÉv` and `NOCASE` compares the
 * same way, while JavaScript's `toLowerCase()` folds the whole of Unicode and answers `dév` — a
 * different string, and therefore a different `aid:` id from the one the migration and the index
 * compute for the very same row.
 *
 * ## ⚠️ Why this is NOT {@link profileAlreadyNamed}'s fold, though it looks like it
 *
 * ⛔ **They answer two different questions, and only one of them is SQLite's.**
 * {@link profileAlreadyNamed} asks *which directory does this name name*, so it folds the way the
 * VOLUME does — and a case-insensitive macOS volume folds far more than ASCII (measured on the
 * shipped one: a Kelvin sign `K` and `k` are one dirent, and so are `Éx` and `éx`). This one asks
 * *which row does this name key*, and the migration and the index have to reproduce it in SQL.
 * Unifying them would make one of the two wrong: an ASCII-only matcher would stop 187 refusing a `K`
 * beside a `k` the disk already treats as one folder, and a Unicode-folding derivation would make
 * `agentIdentityRowId` disagree with the SQL that computes the same id.
 *
 * ⚑ **And they cannot disagree about anything either of them will ever see, because the ALPHABET is
 * ASCII** (review — the first draft of this paragraph claimed a residual that does not exist).
 * {@link PATH_SEGMENT_PATTERN} is `[A-Za-z0-9][A-Za-z0-9._-]*`, and it is not only the wire that
 * enforces it: the adoption sweep filters every DIRENT through {@link isPathSegment}
 * (`provider-homes.ts`, `listProviderHomes`), and a `.brobot` bundle's `meta.profileId` is refined by
 * it in `read-bundle.ts` — which 203 added, its own comment naming that reader as *"the one entrance
 * that skipped it"*. ⛔ **Those two guards are what make this pair safe.** Relaxing either one
 * without also giving SQLite the same fold — an ICU build, or a stored fold column — reopens 208 H1
 * for every name outside the alphabet.
 *
 * ⚠️ `toLowerCase` per ASCII letter, never `toLocaleLowerCase`: under a Turkish locale
 * `'I'.toLocaleLowerCase()` is `'ı'`, so an identity would resolve by the machine's locale. Applied
 * one `A`–`Z` at a time, `toLowerCase` cannot answer anything but `a`–`z`.
 */
export function foldProfileName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
}

/**
 * **The profile a session gets when none is chosen** — and, since 167, a value the RENDERER needs.
 *
 * ## 🔴 592 · it was `'default'`, and the word was the defect rather than the thing it named
 *
 * ⛔ **This docblock read *"so the default has to stay `'default'`: every session recorded before
 * profiles existed lived there."*** ⚠️ **`HO-078` §2 is the ruling that retires it**, and the
 * sentence is corrected rather than deleted because it was TRUE when it shipped and is the exact
 * shape standing rule 19's corollary is about.
 *
 * Use a meaningful default slug so the main agent does not display as `default` when its name is absent, avoiding a persistent display-only special case.
 *
 * ## ⚠️ What the old sentence was RIGHT about, and how it was paid rather than argued away
 *
 * Profiles define provider-home and shared-memory boundaries. Because the identity id derives from the slug, changing it creates another identity with its own home and memory rather than renaming an existing one.
 *
 * 🔴 **So this is NEW INSTALLS ONLY and there is no migration.** ⛔ Nothing moves a provider home,
 * nothing rewrites a row, and every statement keyed on the old slug — `0021`'s role `UPDATE`,
 * `0025`'s `INSERT … WHERE slug = 'default'` — matches nothing on a fresh database, which is the
 * state every install in the world is about to be in. ⚠️ **An install that is NOT clean keeps its
 * old identity untouched and gains a second one**, which is standing rule 11's direction: this app
 * seeds at creation and never rewrites what is already there.
 *
 * ⚠️ **It lives HERE rather than in `main/runtime/provider-homes.ts`, where it used to, for exactly
 * the reason {@link PATH_SEGMENT_PATTERN} does**: main, preload and the renderer all import this
 * module, and the launcher now has to name the default profile — to preselect it, to label it, and
 * to refuse a "new" name that is already taken. `provider-homes.ts` re-exports it, so every existing
 * import site is unchanged and there is still one literal. The renderer previously carried its own
 * `const BROBOT_PROFILE = 'default'`, which was a second answer to a question the host also answers.
 */
export const DEFAULT_PROFILE_ID = 'brobot'
