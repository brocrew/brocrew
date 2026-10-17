import { describe, expect, it } from 'vitest'
import {
  aPolicysRule,
  cancelVerdict,
  notOffered,
  reasonVerdict,
  sandboxRefused,
  whoWroteIt,
  type AskSeen,
} from '../smoke/approval-reason-evidence'

/**
 * # ⚑ 709 · `probe:codex-approval-reason`'s verdicts, pinned from `ci`
 *
 * ⛔ The live probe is not in `pnpm run ci`; what it CONCLUDES is (`pin-a-live-only-instrument-from-a-
 * cheap-gate`). Each arm below plants the turns the probe collects, with the measured strings verbatim
 * where they matter, and moves ONE fact to show which verdict that fact decides.
 */

const JUSTIFICATION = 'MODEL-JUSTIFICATION-n709'
const REASON = 'MODEL-REASON-n709'
const COMPOUND = 'MODEL-JUSTIFICATION-compound-n709'
const THE_MODELS_OVERRIDDEN = 'MODEL-JUSTIFICATION-rule-n709'
/** What Codex 0.146.0 wrote on a command a `prompt` rule stopped (measured, the path shortened). */
const POLICY_SAID =
  "`/bin/zsh -lc '/usr/bin/touch a.txt'` requires approval: POLICY-JUSTIFICATION-n709"
const POLICY_SILENT = "`/bin/zsh -lc '/bin/mkdir d'` requires approval by policy"
/** ⚑ 720 · the commands those two sentences name — the raw request's own `command`. */
const POLICY_SAID_COMMAND = "/bin/zsh -lc '/usr/bin/touch a.txt'"
const POLICY_SILENT_COMMAND = "/bin/zsh -lc '/bin/mkdir d'"
/** What the model was told of an unescalated write the read-only sandbox refused (measured). */
const SANDBOX_REFUSED =
  'Script completed\nWall time 0.1 seconds\nOutput:\n\nR709:{"exit_code":1,"output":"touch: a.txt: Operation not permitted\\n"}'

/**
 * A command an exec-policy `prompt` rule stopped — Codex's words on the wire, and on the card as the
 * PROVIDER's, labelled as its rule, when they name one (`720`, R73). ⚠️ `elsewhere` holds them too:
 * the probe flattens every string but the agent's, so a model's words are looked for inside them.
 */
function stoppedByAPolicy(
  turn: string,
  modelWrote: string | null,
  rawReason: string,
  rawCommand: string,
): AskSeen {
  const rule = rawReason.startsWith(`\`${rawCommand}\` requires approval: `)
  return {
    turn,
    modelWrote,
    method: 'item/commandExecution/requestApproval',
    rawReason,
    rawCommand,
    card: {
      agentReason: null,
      providerReason: rule ? rawReason : null,
      providerReasonFrom: rule ? 'a-policy-rule' : null,
      elsewhere: [rawCommand, ...(rule ? [rawReason, 'a-policy-rule'] : [])],
    },
    toolAnswer: null,
  }
}
/** What Codex 0.146.0's code-mode host answered a call to a tool the model was not offered (measured). */
const NOT_A_FUNCTION =
  'Script error:\nTypeError: tools.request_permissions is not a function\n    at exec_main.mjs:1:28'

/** A turn the probe measured, measured the way `709`'s run measured it — the shipped profile's. */
function planted(): AskSeen[] {
  return [
    {
      turn: 'justified',
      modelWrote: JUSTIFICATION,
      method: 'item/commandExecution/requestApproval',
      rawReason: JUSTIFICATION,
      rawCommand: "/bin/zsh -lc '/usr/bin/touch a.txt'",
      card: { agentReason: JUSTIFICATION, elsewhere: ["/bin/zsh -lc '/usr/bin/touch a.txt'"] },
      toolAnswer: null,
    },
    {
      turn: 'bare',
      modelWrote: null,
      method: 'item/commandExecution/requestApproval',
      rawReason: undefined,
      rawCommand: "/bin/zsh -lc '/usr/bin/touch b.txt'",
      card: { agentReason: null, elsewhere: ["/bin/zsh -lc '/usr/bin/touch b.txt'"] },
      toolAnswer: null,
    },
    {
      turn: 'p-shipped',
      modelWrote: REASON,
      method: null,
      rawReason: undefined,
      rawCommand: null,
      card: null,
      toolAnswer: NOT_A_FUNCTION,
    },
    {
      turn: 'p-enabled',
      modelWrote: REASON,
      method: 'item/permissions/requestApproval',
      rawReason: REASON,
      rawCommand: null,
      card: {
        agentReason: REASON,
        elsewhere: ['The agent asks you to grant it more access.', 'write /tmp/outside'],
      },
      toolAnswer: null,
    },
    {
      turn: 'compound',
      modelWrote: COMPOUND,
      method: 'item/commandExecution/requestApproval',
      rawReason: COMPOUND,
      rawCommand: "/bin/zsh -lc '/usr/bin/touch a.txt && /usr/bin/touch b.txt'",
      card: {
        agentReason: COMPOUND,
        elsewhere: ["/bin/zsh -lc '/usr/bin/touch a.txt && /usr/bin/touch b.txt'"],
      },
      toolAnswer: null,
    },
    {
      turn: 'sandbox-denied',
      modelWrote: null,
      method: null,
      rawReason: undefined,
      rawCommand: null,
      card: null,
      toolAnswer: SANDBOX_REFUSED,
    },
    stoppedByAPolicy('rule-said', null, POLICY_SAID, POLICY_SAID_COMMAND),
    stoppedByAPolicy('rule-silent', null, POLICY_SILENT, POLICY_SILENT_COMMAND),
    stoppedByAPolicy('rule-justified', THE_MODELS_OVERRIDDEN, POLICY_SAID, POLICY_SAID_COMMAND),
    stoppedByAPolicy('rule-escalated', THE_MODELS_OVERRIDDEN, POLICY_SAID, POLICY_SAID_COMMAND),
  ]
}

/** The planted turns with one of them replaced. */
function withTurn(turn: string, change: Partial<AskSeen>): AskSeen[] {
  return planted().map((ask) => (ask.turn === turn ? { ...ask, ...change } : ask))
}

describe('709 · the sandbox REFUSED the write — `sandbox-denied`’s premise, read off what the model was told', () => {
  const denied = (): AskSeen => planted().find((ask) => ask.turn === 'sandbox-denied') as AskSeen

  it('⚑ the measured refusal: a failed command, in the OS’s own words', () => {
    expect(sandboxRefused(denied())).toBe(true)
  })

  it('⛔ a write that SUCCEEDED refused nothing — and the verdict says the turn measured nothing', () => {
    const wrote = SANDBOX_REFUSED.replace('"exit_code":1', '"exit_code":0').replace(
      ': Operation not permitted',
      '',
    )
    expect(sandboxRefused({ ...denied(), toolAnswer: wrote })).toBe(false)
    expect(reasonVerdict(withTurn('sandbox-denied', { toolAnswer: wrote }))).toEqual({
      verdict: 'not-performed',
      because:
        'sandbox-denied raised no request, and the model was not told the sandbox refused it',
    })
  })

  it('⛔ …and a command that failed for ANOTHER reason refused nothing either', () => {
    const other = SANDBOX_REFUSED.replace('Operation not permitted', 'No such file or directory')
    expect(sandboxRefused({ ...denied(), toolAnswer: other })).toBe(false)
    // ⚑ The words alone are not a failure: a refusal the command recovered from is exit 0.
    const recovered = SANDBOX_REFUSED.replace('"exit_code":1', '"exit_code":0')
    expect(sandboxRefused({ ...denied(), toolAnswer: recovered })).toBe(false)
  })
})

describe('709 · who wrote a reason — the one fact that decides it', () => {
  it('⚑ the model, when the reason IS the text it wrote — byte for byte', () => {
    const [justified] = planted()
    expect(whoWroteIt(justified as AskSeen)).toBe('the-model')
    expect(whoWroteIt({ ...(justified as AskSeen), rawReason: `${JUSTIFICATION} ` })).toBe(
      'not-the-model',
    )
  })

  it('⚑ absent when the key is missing OR null, and no-request when Codex raised nothing', () => {
    const [, bare] = planted() as [AskSeen, AskSeen]
    expect(whoWroteIt(bare)).toBe('absent')
    expect(whoWroteIt({ ...bare, rawReason: null })).toBe('absent')
    expect(whoWroteIt({ ...bare, method: null })).toBe('no-request')
  })

  it('⛔ not-offered is read off what the model was TOLD — never off a silence', () => {
    const shipped = planted()[2] as AskSeen
    expect(notOffered(shipped)).toBe(true)
    // ⚑ The same turn, told nothing: a request that simply did not arrive is not a measurement.
    expect(notOffered({ ...shipped, toolAnswer: null })).toBe(false)
    expect(notOffered({ ...shipped, toolAnswer: 'Script completed' })).toBe(false)
  })
})

describe('709 · R44 — the model’s words are carried under the agent’s name, and nowhere else', () => {
  it('⚑ by-its-author — 709’s measured shape: both cards carry it by author; the shipped profile offers no permissions tool', () => {
    expect(reasonVerdict(planted())).toEqual({
      verdict: 'by-its-author',
      shipped: 'not-offered',
      sandboxRetry: 'not-asked',
    })
  })

  it('⚑ 720 · R73 — a policy’s RULE is the provider’s words, labelled; the rule-silent sentence is no rule', () => {
    const [, , , , , , said, silent] = planted() as AskSeen[]
    expect(aPolicysRule(said as AskSeen)).toBe(true)
    expect(aPolicysRule(silent as AskSeen)).toBe(false)
    // ⛔ tied to the request's OWN command: the same sentence about another command is no rule of its
    expect(aPolicysRule({ ...(said as AskSeen), rawCommand: 'ls' })).toBe(false)
  })

  it('🔴 720 · R73 · the-rule-unsaid — a policy’s rule carried by nobody (`709`’s card, measured)', () => {
    const turns = withTurn('rule-said', {
      card: { agentReason: null, elsewhere: [POLICY_SAID_COMMAND] },
    })
    expect(reasonVerdict(turns)).toEqual({ verdict: 'the-rule-unsaid', turns: ['rule-said'] })
  })

  it('⚑ 720 · R73 — a rule stated over a MULTI-LINE command is carried cleaned, and that is its author', () => {
    const heredoc = "/bin/zsh -lc 'cat <<EOF > a.txt\nhello\nEOF'"
    const said = `\`${heredoc}\` requires approval: POLICY-JUSTIFICATION-n709`
    const turns = planted().map((ask) =>
      ask.turn === 'rule-said'
        ? {
            ...stoppedByAPolicy('rule-said', null, said, heredoc),
            card: {
              agentReason: null,
              providerReason:
                "`/bin/zsh -lc 'cat <<EOF > a.txt hello EOF'` requires approval: POLICY-JUSTIFICATION-n709",
              providerReasonFrom: 'a-policy-rule',
              elsewhere: [heredoc],
            },
          }
        : ask,
    )
    expect(reasonVerdict(turns)).toMatchObject({ verdict: 'by-its-author' })
  })

  it('🔴 720 · R73 · the-rule-unsaid — …or carried without its label', () => {
    const turns = withTurn('rule-escalated', {
      card: {
        agentReason: null,
        providerReason: POLICY_SAID,
        providerReasonFrom: null,
        elsewhere: [POLICY_SAID_COMMAND, POLICY_SAID],
      },
    })
    expect(reasonVerdict(turns)).toEqual({ verdict: 'the-rule-unsaid', turns: ['rule-escalated'] })
  })

  it('🔴 720 · R73 · misattributed — the provider’s name on words that are no policy’s rule', () => {
    // ⚑ the MODEL's justification, carried as Codex's
    const justified = withTurn('justified', {
      card: {
        agentReason: JUSTIFICATION,
        providerReason: JUSTIFICATION,
        providerReasonFrom: 'a-policy-rule',
        elsewhere: [],
      },
    })
    expect(reasonVerdict(justified)).toEqual({ verdict: 'misattributed', turns: ['justified'] })
    // ⚑ the rule-SILENT sentence carried as a rule — "and no further"
    const silent = withTurn('rule-silent', {
      card: {
        agentReason: null,
        providerReason: POLICY_SILENT,
        providerReasonFrom: 'a-policy-rule',
        elsewhere: [POLICY_SILENT_COMMAND, POLICY_SILENT],
      },
    })
    expect(reasonVerdict(silent)).toEqual({ verdict: 'misattributed', turns: ['rule-silent'] })
  })

  it('🔴 720 · R73 · moved — Codex’s sentence no longer names the request’s own command, or no turn states a rule', () => {
    expect(
      reasonVerdict(withTurn('rule-said', { rawCommand: "/bin/zsh -lc 'something else'" })),
    ).toEqual({ verdict: 'moved', because: "rule-said's reason does not name its own command" })
    const noRule = planted().map((ask) =>
      ask.turn.startsWith('rule-') && ask.turn !== 'rule-silent'
        ? stoppedByAPolicy(ask.turn, ask.modelWrote, POLICY_SILENT, POLICY_SILENT_COMMAND)
        : ask,
    )
    expect(reasonVerdict(noRule)).toEqual({
      verdict: 'moved',
      because: 'no policy turn carried a rule’s text',
    })
  })

  it('🔴 misattributed — a POLICY’s words carried as the agent’s (709’s own card before its review, measured)', () => {
    const turns = withTurn('rule-said', {
      card: { agentReason: POLICY_SAID, elsewhere: ["/bin/zsh -lc '/usr/bin/touch a.txt'"] },
    })
    expect(reasonVerdict(turns)).toEqual({ verdict: 'misattributed', turns: ['rule-said'] })
  })

  it('🔴 misattributed — the CONTROL grew agent words it was never given', () => {
    const turns = withTurn('bare', { card: { agentReason: 'invented', elsewhere: [] } })
    expect(reasonVerdict(turns)).toEqual({ verdict: 'misattributed', turns: ['bare'] })
  })

  it('⚑ a Codex bump that ASKS to retry a sandbox-denied command is judged by the policy’s rule, and says so', () => {
    const asked = {
      method: 'item/commandExecution/requestApproval',
      rawReason: 'command failed; retry without sandbox?',
      toolAnswer: null,
    }
    expect(
      reasonVerdict(
        withTurn('sandbox-denied', { ...asked, card: { agentReason: null, elsewhere: [] } }),
      ),
    ).toEqual({ verdict: 'by-its-author', shipped: 'not-offered', sandboxRetry: 'asked' })
    expect(
      reasonVerdict(
        withTurn('sandbox-denied', {
          ...asked,
          card: { agentReason: 'command failed; retry without sandbox?', elsewhere: [] },
        }),
      ),
    ).toEqual({ verdict: 'misattributed', turns: ['sandbox-denied'] })
  })

  it('🔴 unlabelled — a model’s words a policy overrode, found on the card anyway', () => {
    const turns = withTurn('rule-justified', {
      card: { agentReason: null, elsewhere: [`Why: ${THE_MODELS_OVERRIDDEN}`] },
    })
    expect(reasonVerdict(turns)).toEqual({ verdict: 'unlabelled', turns: ['rule-justified'] })
  })

  it('🔴 moved — a Codex bump: a policy-stopped command carries the model’s words, or none', () => {
    expect(reasonVerdict(withTurn('rule-justified', { rawReason: THE_MODELS_OVERRIDDEN }))).toEqual(
      {
        verdict: 'moved',
        because: "rule-justified's reason is the-model, not Codex's",
      },
    )
    expect(reasonVerdict(withTurn('rule-silent', { rawReason: undefined }))).toMatchObject({
      verdict: 'moved',
    })
  })

  it('🔴 moved — a compound command’s reason is no longer the model’s', () => {
    expect(reasonVerdict(withTurn('compound', { rawReason: POLICY_SAID }))).toMatchObject({
      verdict: 'moved',
    })
  })

  it('🔴 unlabelled — the command card carried the justification somewhere ELSE too (its prompt, its detail)', () => {
    const turns = withTurn('justified', {
      card: { agentReason: JUSTIFICATION, elsewhere: [`Allow? ${JUSTIFICATION}`] },
    })
    expect(reasonVerdict(turns)).toEqual({ verdict: 'unlabelled', turns: ['justified'] })
  })

  it('🔴 unlabelled — the permissions card’s headline is the model’s reason (`main`’s shape)', () => {
    // ⛔ **`prompt = reason || …`** and `permission.reason`: the agent's sentence, with no author,
    // drawn as the card's headline and as Home's first scope line.
    const turns = withTurn('p-enabled', {
      card: { agentReason: null, elsewhere: [REASON, REASON] },
    })
    expect(reasonVerdict(turns)).toEqual({ verdict: 'unlabelled', turns: ['p-enabled'] })
  })

  it('🔴 unlabelled — the words were dropped entirely (`704`’s shape on the command card)', () => {
    const turns = withTurn('justified', {
      card: { agentReason: null, elsewhere: ["/bin/zsh -lc '/usr/bin/touch a.txt'"] },
    })
    expect(reasonVerdict(turns)).toEqual({ verdict: 'unlabelled', turns: ['justified'] })
  })

  it('🔴 moved — a Codex bump: the command’s reason is no longer the model’s justification', () => {
    const turns = withTurn('justified', { rawReason: 'command failed; retry without sandbox?' })
    expect(reasonVerdict(turns)).toMatchObject({ verdict: 'moved' })
  })

  it('🔴 moved — the bare command grew a reason of Codex’s own', () => {
    expect(reasonVerdict(withTurn('bare', { rawReason: 'Codex wants to' }))).toMatchObject({
      verdict: 'moved',
    })
  })

  it('⚑ a bump that OFFERS the tool on the shipped profile is judged by the same rule, and says so', () => {
    const turns = withTurn('p-shipped', {
      method: 'item/permissions/requestApproval',
      rawReason: REASON,
      card: { agentReason: REASON, elsewhere: ['The agent asks you to grant it more access.'] },
      toolAnswer: null,
    })
    expect(reasonVerdict(turns)).toEqual({
      verdict: 'by-its-author',
      shipped: 'offered',
      sandboxRetry: 'not-asked',
    })
  })

  it('⛔ not-performed — a turn missing, a request missing, a card missing, or a silence', () => {
    expect(reasonVerdict(planted().filter((ask) => ask.turn !== 'bare'))).toMatchObject({
      verdict: 'not-performed',
    })
    expect(reasonVerdict(withTurn('justified', { method: null }))).toMatchObject({
      verdict: 'not-performed',
    })
    expect(reasonVerdict(withTurn('p-enabled', { card: null }))).toMatchObject({
      verdict: 'not-performed',
    })
    expect(reasonVerdict(withTurn('p-shipped', { toolAnswer: null }))).toMatchObject({
      verdict: 'not-performed',
    })
    expect(reasonVerdict(withTurn('rule-escalated', { method: null }))).toMatchObject({
      verdict: 'not-performed',
    })
    expect(reasonVerdict(withTurn('sandbox-denied', { toolAnswer: null }))).toEqual({
      verdict: 'not-performed',
      because:
        'sandbox-denied raised no request, and the model was not told the sandbox refused it',
    })
    expect(
      reasonVerdict(
        withTurn('sandbox-denied', {
          method: 'item/commandExecution/requestApproval',
          rawReason: 'command failed; retry without sandbox?',
          toolAnswer: null,
        }),
      ),
    ).toEqual({
      verdict: 'not-performed',
      because: 'the product published no card for sandbox-denied',
    })
  })
})

describe('709 · Codex’s own word after a card’s Cancel, beside the product’s — the premise R43’s tests plant', () => {
  it('⚑ the-providers-word — Codex said `interrupted` after `{decision:"cancel"}`, and so did the product (measured)', () => {
    expect(cancelVerdict({ providerStatus: 'interrupted', productWord: 'interrupted' })).toEqual({
      verdict: 'the-providers-word',
      word: 'interrupted',
    })
  })

  it('🔴 renamed — Codex completed it and the product said `interrupted` (`main`’s latch, had Codex completed)', () => {
    expect(cancelVerdict({ providerStatus: 'completed', productWord: 'interrupted' })).toEqual({
      verdict: 'renamed',
      provider: 'completed',
      product: 'interrupted',
    })
  })

  it('⛔ not-performed — either ending missing', () => {
    expect(cancelVerdict({ providerStatus: null, productWord: 'interrupted' })).toMatchObject({
      verdict: 'not-performed',
    })
    expect(cancelVerdict({ providerStatus: 'interrupted', productWord: null })).toMatchObject({
      verdict: 'not-performed',
    })
  })
})
