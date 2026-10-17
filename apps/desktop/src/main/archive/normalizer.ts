/**
 * **Which importer built a derived ledger** (065, from 061 finding 6).
 *
 * The provider's file is the record and `events` is a projection of it, and a projection needs to
 * be able to say who made it. Until now it could not: a ledger derived in April and a ledger derived today were
 * indistinguishable rows, so improving an importer silently split the corpus into conversations that
 * had the improvement and conversations that never would.
 *
 * ## When to bump it
 *
 * **When the importers would produce a DIFFERENT ledger from the same file.** Not when they get
 * faster, not when a comment changes, not when a bug is fixed that could never have fired. The test
 * is whether re-deriving an existing file would change what the user sees — because that is
 * precisely what this number causes to be offered.
 *
 * Bumping it marks every older ledger stale. It does **not** rebuild anything: nothing here rebuilds
 * a session that was not asked for by name (`runtime-host.ts`, `rebuildLedger`). The measured corpus
 * on the dispatching machine is 150 sessions and ~2.3 GB, and a version bump that quietly re-derived
 * all of it would be a ten-minute surprise on next launch.
 *
 * ## The history of the number
 *
 * | version | what changed |
 * |---|---|
 * | `0` | Backfilled for ledgers derived before versioning; these read as stale. |
 * | `1` | `import-codex.ts` preserves `image_generation_end`, including generated pictures. |
 * | `2` | Both importers mark imported `user_turn` events with `attribution: 'provider_transcript'`, since the app did not observe the person typing them. |
 * | `3` | `import-codex.ts` separates harness-injected developer/user context from the person's request instead of attributing it to the person. Older ledgers need Rebuild to correct their bubbles. |
 * | `4` | `import-claude.ts` diverts synthetic API notices to errors for every error word and for wordless `isApiErrorMessage` notices. Older ledgers need Rebuild to stop showing provider notices as assistant words. |
 */
export const NORMALIZER_VERSION = 4

/**
 * The version a ledger with no recorded one is treated as having.
 *
 * Named rather than written as a bare `0` at the three places that need it, because the whole point
 * is that it is not a version anybody chose — it is the absence of one.
 */
export const PRE_CONTRACT_NORMALIZER_VERSION = 0
