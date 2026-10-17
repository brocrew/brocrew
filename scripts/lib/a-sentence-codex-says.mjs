// The one sentence of Codex's that BroBot matches, read from the constant the product matches it
// with, so the check at a Codex update and the product can never hold two spellings.

/** The sentence, from the text of `packages/runtime/src/codex/auth-probe.ts`. */
export function theSentenceCodexRefusesASignInWith(authProbeSource) {
  const found = /^export const CODEX_SIGN_IN_REFUSED_AT_ROUTING = '([^'\n]+)'$/m.exec(
    authProbeSource,
  )
  if (found === null) {
    throw new Error('CODEX_SIGN_IN_REFUSED_AT_ROUTING is not where this check reads it')
  }
  return found[1]
}

/** Whether a Codex program's bytes still hold that sentence, whole. */
export function theProgramStillSays(programBytes, sentence) {
  return programBytes.includes(sentence, 0, 'utf8')
}
