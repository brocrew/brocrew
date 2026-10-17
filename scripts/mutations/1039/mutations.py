"""1039 · D-039 · Codex conversations start again, and a failed start is an oriented refusal.

⚑ **Why `1039`**: card D-00N's table is `100N`. D-039 is one DEV commit, `17a9220d`, landed through
the frontend's merge `7d54be3b`.

## What it changed

The Codex tool namespace's description is one fixed sentence, within the app-server's 1,024-character
cap; the full instructions reach a Codex model as the first section of its first-turn lead, owed again
after a compaction or a failed turn. A provider that refuses or fails to start a conversation is told as
an oriented refusal at every door, never a raw protocol error.

 * `M1`–`M10` — killed by the landing's
   `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts`.

Designed read-only by a Sonnet 5.5 agent from the commit and today's code; each row verified alone by the
landing agent.

## Verification

- **RED: 10 of 10.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `7b046154` (the merges of `7d54be3b` and `4c598c4b`), none by a syntax, reference or type error.
  Each killer file ran green unmutated first.
"""

AGENT_TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
RUNTIME_HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
AGENT_TOOLS_CODEX = "packages/runtime/src/codex/agent-tools.ts"
CODEX_RUNTIME = "packages/runtime/src/codex/codex-runtime.ts"
CODEX_TRANSPORT = "packages/runtime/src/codex/codex-transport.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · the Codex namespace is declared with a description past the app-server's 1,024-character cap again · CODEX_TOOLS_DESCRIPTION becomes the sentence repeated thirty times (1,470 characters), so thread/start is refused for every Codex conversation (F055) while the existing test, which compares the namespace to the constant itself, stays green — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts` — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts`",
        [
            (AGENT_TOOLS_CODEX, "export const CODEX_TOOLS_DESCRIPTION = 'Tools that reach the app you are running inside.'", "export const CODEX_TOOLS_DESCRIPTION = 'Tools that reach the app you are running inside. '.repeat(30)"),
        ],
    ),
    (
        "M2 · the tools' words ride the wrong provider · toolsToldInTextFor answers for Claude instead of Codex, so a Codex conversation's lead never tells it how to use the tools (the F055 parity gap) and Claude reads them twice, in its catalogue and in its system prompt — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts` — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts`",
        [
            (AGENT_TOOLS, "  return provider === 'codex'\n    ? { server: AGENT_TOOL_SERVER, instructions: AGENT_TOOL_INSTRUCTIONS }\n    : undefined", "  return provider === 'claude'\n    ? { server: AGENT_TOOL_SERVER, instructions: AGENT_TOOL_INSTRUCTIONS }\n    : undefined"),
        ],
    ),
    (
        "M3 · a compaction no longer owes the lead again · HostedSession.firstTurnLead is not set back after a compaction row, so a Codex conversation whose history was rewritten goes on without the tools' instructions — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts` — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts`",
        [
            (RUNTIME_HOST, "      event.type === 'compaction' ||\n", ""),
        ],
    ),
    (
        "M4 · a turn this app failed no longer owes the lead again · the first turn's lead goes to a provider that never began it and the life runs on without it — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts` — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts`",
        [
            (RUNTIME_HOST, " ||\n      (event.type === 'turn' && event.state === 'failed' && event.wordOf === 'this-app')", ""),
        ],
    ),
    (
        "M5 · a request Codex refused is no longer told apart · aFailedStart returns the raw CodexRequestRefused, so a person and a giver read the JSON-RPC envelope again ({\"code\":-32600,…}) and the host cannot say the provider refused to start it — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts` — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts`",
        [
            (CODEX_RUNTIME, "  if (!(error instanceof CodexRequestRefused)) return error", "  return error"),
        ],
    ),
    (
        "M6 · a resume Codex refused for any reason but a lost thread carries the raw refusal · ResumeError.cause is the CodexRequestRefused again, so a reopen and a wake never see a StartRefused and say 'resume failed: {…}' — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts` — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts`",
        [
            (CODEX_RUNTIME, "        cause: noSuchSession ? error : aFailedStart(error),", "        cause: error,"),
        ],
    ),
    (
        "M7 · the host stops translating a provider's refused start for a person · aRefusalAPersonReads skips aFailedStartAsARefusal, so New Conversation, a reopen and a message to a stopped conversation read the raw error (codex refused thread/start: …) instead of the oriented sentence — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts` — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts`",
        [
            (RUNTIME_HOST, "    const error = this.aFailedStartAsARefusal(failed, id, reopening)", "    const error = failed"),
        ],
    ),
    (
        "M8 · a give its provider refused is told in the word's own sentence · the agent-could-not-be-started reason says this machine could not run its provider's program (false) instead of A_PROVIDER_REFUSED_THE_START, so a giver is sent to look for a missing binary — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts` — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts`",
        [
            (AGENT_TOOLS, "      reason: A_PROVIDER_REFUSED_THE_START,\n", ""),
        ],
    ),
    (
        "M9 · a give with new: true no longer says the new agent was made · the refusal drops THE_NEW_AGENT_WAS_MADE, so a giver whose launch failed repeats the same give and meets that-profile-exists without being told why — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts` — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts`",
        [
            (AGENT_TOOLS, "        aLaunchRefused(failed, args['new'] === true, {", "        aLaunchRefused(failed, false, {"),
        ],
    ),
    (
        "M10 · the app-server's exit is no longer told apart by type · the transport's terminal error when the child exits is a plain Error again, so a launch that meets it is not StartFailed and a person and a giver read 'codex app-server exited (stderr tail: …)' with up to 500 bytes of the child's output — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts` — killed by `the-tools-reach-codex-in-its-lead-and-a-refused-start-is-told-in-words.test.ts`",
        [
            (CODEX_TRANSPORT, "    this.terminate(new CodexExited(this.exitMessage()))", "    this.terminate(new Error(this.exitMessage()))"),
        ],
    ),
]
