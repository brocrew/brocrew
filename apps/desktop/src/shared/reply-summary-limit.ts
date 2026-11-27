/**
 * 🔴 **How long a summary may be, in UTF-16 code units — 1,280** (`353` §6.2, HO-007 §6.2).
 *
 * ⚑ **Measured before it was chosen.** `353` ran the required shape on both providers and saw a
 * maximum of **740** units; 1,280 leaves **540 units / 73% headroom**. ⛔ HO-006 §4.4: *"the agent
 * never guesses a byte threshold; bound `summary`, refuse structurally"* — so the number lives here
 * and is named in the refusal rather than being a thing a model has to have been told.
 *
 * ⚠️ **UTF-16 code units, which is `String.prototype.length` and NOT bytes or characters.** An
 * emoji is two; a byte bound would refuse different strings on different days depending on how much
 * of the reply was ASCII. ⛔ **The bound is measured on `summary` alone**, never on the whole
 * payload: a caller must be able to compute for itself whether a string will fit, and a bound over
 * a JSON encoding it never sees is one it cannot.
 *
 * 🔴 **A test that writes `REPLY_SUMMARY_LIMIT + 1` pins nothing** — `380` learned this on
 * `MAX_DOCUMENT_BYTES` and wrote `1048576` and `1048577` as literals. The suite for this one writes
 * `1280` and `1281`.
 *
 * ⚠️ **The confidence, stated rather than implied:** `353` called it high for the required shape and
 * MEDIUM for prompt drift — a bound tuned on today's instruction that tomorrow's routinely exceeds
 * turns a structural refusal into a permanent block. It is retryable and it names itself, which is
 * what makes that recoverable rather than silent.
 */
export const REPLY_SUMMARY_LIMIT = 1_280
