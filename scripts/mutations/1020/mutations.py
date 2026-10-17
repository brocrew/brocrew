"""1020 · D-020 · `agentIdentities` and `setCapabilities` refuse unknown fields.

⚑ **Why `1020`**: card D-00N's table is `100N`. D-020 is one DEV commit, `fef758d8`.

## What it changed

Both commands are `z.strictObject` on the runtime wire, so a field nobody declared is refused by name
(*"unrecognized key"*) instead of silently stripped. The grant inside `setCapabilities` was already
strict (table `355`); now its envelope is too.

 * `M1`–`M4` — killed by the landing's `a-field-nobody-declared-is-refused-by-name.test.ts` (`M3` also by
   `the-grant-nobody-can-give.test.ts`).

Designed read-only by a Sonnet 5.5 agent from the commit and today's code; each row verified alone by the
landing agent.

## Verification

- **RED: 4 of 4.** Each row alone by `verify_row.py` with its named killer, on `landing` over `5f2dc9e1`
  (the merge of `75d3e2b4`, over `fef758d8`), none by a syntax, reference or type error. Each killer
  file ran green unmutated first.
"""

IPC = "apps/desktop/src/main/runtime/ipc.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · agentIdentities goes back to a plain z.object, so a field nobody declared on the roster read is silently stripped and the read is answered as if it had been asked bare — killed by `a-field-nobody-declared-is-refused-by-name.test.ts`",
        [
            (IPC, "  z.strictObject({ kind: z.literal('agentIdentities') }),", "  z.object({ kind: z.literal('agentIdentities') }),"),
        ],
    ),
    (
        "M2 · setCapabilities goes back to a plain z.object, so a stray field beside a whole valid grant is stripped while the grant is written and the caller is told it all landed — killed by `a-field-nobody-declared-is-refused-by-name.test.ts`",
        [
            (IPC, "  z.strictObject({\n    kind: z.literal('setCapabilities'),", "  z.object({\n    kind: z.literal('setCapabilities'),"),
        ],
    ),
    (
        "M3 · the strict setCapabilities envelope forgets a field the window sends: externalMcpServerIds is no longer declared, so the sheet's whole Save is refused as an unrecognised key — killed by `a-field-nobody-declared-is-refused-by-name.test.ts`, `the-grant-nobody-can-give.test.ts`",
        [
            (IPC, "    externalMcpServerIds: z.array(externalMcpServerId).max(MAX_EXTERNAL_MCP_GRANTS),\n", ""),
        ],
    ),
    (
        "M4 · the wire's refusal sentence keeps where (the path) but drops why, so an unrecognised key at the command's root is refused as just '(root)' without naming the key — killed by `a-field-nobody-declared-is-refused-by-name.test.ts`",
        [
            (IPC, "    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)", "    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}`)"),
        ],
    ),
]
