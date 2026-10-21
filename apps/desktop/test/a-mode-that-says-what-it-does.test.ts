import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SUPPORTED_PROVIDERS, capabilitiesFor } from '@brobot2/runtime'

/**
 * 🔴 **367 · HO-011 §3.2 — the app calls the mode "auto-approve", and that is not what it does.**
 *
 * > *"**'Auto-approve' is not what Codex `auto` means.** `danger-full-access`, no prompt, the OS
 * > user's full reach is what it means, and that sentence should be **in front of a person before
 * > they choose it** and **visible wherever a session in that mode appears.** Claude's `auto` needs
 * > its own true sentence, including that **`Bash` is an opaque string the structured scan does not
 * > see.**"*
 *
 * ## ⛔ What was MEASURED at this base, because the sentence may not be pasted from a brief
 *
 * Every clause below was read off the code that sets the policy on `main` @ `3c9e667`:
 *
 *  - **Codex** — `codex/codex-runtime.ts`'s `APPROVAL_PROFILES`: `ask` is
 *    `{ approvalPolicy: 'on-request', sandbox: 'read-only' }`, `auto` is
 *    `{ approvalPolicy: 'never', sandbox: 'danger-full-access' }`.
 *  - **Claude** — `claude/claude-runtime.ts`: `permissionModeFor` asks for `'default'` in every
 *    non-planning session (`140`: `bypassPermissions` *"has never once been in force here"*), the
 *    `PreToolUse` hook returns `{ continue: true }` on `isAutoApprove`, and `handleCanUseTool`
 *    returns `{ behavior: 'allow' }` on the same predicate.
 *
 * ⚠️ **So the brief's own framing needed one correction and it is the point of this file.** `Bash`
 * walking past `scanForProtected` was not a property of `auto` — the scan sat ABOVE the mode check
 * and refused in **both** modes, and a command string carried no path in either. What `auto` takes
 * away on Claude is the CARD. Naming the scan as something yolo defeats would have overstated what
 * `ask` gives you, which is `086` in the more dangerous direction.
 *
 * Claude’s permission note names no surviving app-level scan in either mode. §1 asserts that
 * absence explicitly.
 *
 * ⚠️ **§3 lives in `a-mode-that-says-what-it-does.render.test.ts`**, because it renders an SFC and
 * `tsconfig.web.json` says a test that does is a renderer file. This half reads source and needs
 * `node:fs`, which the web project has no types for — so the split is the two tsconfigs' own.
 *
 * ## ⚑ Where the sentences live, and why not here
 *
 * In the two adapters, as `ProviderCapabilities.approvals.note` — `039`'s rule, and the same route
 * `329` used for `homeCredential` when one sentence was saying the same thing to two providers that
 * do opposite things. The renderer indexes the map by the session's provider and renders what comes
 * back; `provider-neutrality.test.ts` is what keeps that from becoming a comparison.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = join(HERE, '../src')

/** Comments stripped first (`345`): a sentence quoted in a docblock is prose, not a copy. */
function withoutProse(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/** Every renderer- and shared-tree file, the two trees `provider-neutrality` scans. */
function rendererAndShared(): { file: string; code: string }[] {
  return ['renderer', 'shared'].flatMap((root) =>
    readdirSync(join(SRC, root), { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.(ts|vue)$/.test(name))
      .map((name) => ({
        file: `${root}/${name}`,
        code: readFileSync(join(SRC, root, name), 'utf8'),
      })),
  )
}

/** The `auto` sentence each adapter declares. Read from the declaration, never restated. */
function declaredNote(provider: (typeof SUPPORTED_PROVIDERS)[number]): string {
  const status = capabilitiesFor(provider).approvals
  if (status.state !== 'available') throw new Error(`${provider}.approvals is not available`)
  return status.note ?? ''
}

describe('§1 · every provider declares what this mode does, and the two answers differ', () => {
  it('⛔ both declare `approvals` available with a note that says something', () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      const note = declaredNote(provider)
      // Not the empty string the optional `note` allows, and not a shrug: it is shown to a person
      // at the moment they arm the mode.
      expect(note.trim().length, provider).toBeGreaterThan(60)
      expect(note, provider).toMatch(/[a-z]{3,} [a-z]{2,}/i)
    }
  })

  it('🔴 the two notes are DIFFERENT, which is the whole reason the entry exists', () => {
    // ⚠️ A set whose members must differ needs the distinctness check written down. Both providers
    // could be declared `available` with the same sentence and every other assertion here would
    // still pass — and that sentence is exactly the defect `367` was sent to fix.
    const notes = SUPPORTED_PROVIDERS.map(declaredNote)
    expect(new Set(notes).size, 'one sentence for both is the defect').toBe(notes.length)
  })

  it('⛔ each note carries the clause its own adapter measured, and NOT the other one’s', () => {
    // ⚑ Content, not plumbing. The assertions above compare the notes with each other and would
    // pass on two different wrong sentences; these read the fact each one exists to carry.
    //
    // ⚠️ Written as a table keyed by provider so a note that drifted onto the WRONG provider fails
    // rather than passing on the union — `capabilitiesFor` is indexed here, which is main's
    // privilege and not the renderer's.
    const codex = declaredNote('codex')
    expect(codex, 'the sandbox mode Codex is actually started with').toContain('danger-full-access')
    // ⛔ **What the sandbox on the other side of that switch actually does** — and the two halves
    // of it, because naming only one would let the sentence read as containment. `366` measured
    // that Codex's sandbox narrows writes and network and nothing else.
    // 🔴 **736 · R96 — the write bound of the Codex CLI's own default preset**, measured
    // (`probe:codex-mcp-tool-approval`'s `preset` arm): the folder and `/tmp` written unasked, a
    // patch outside asked. ⛔ On `main` it said *"cannot write outside your folder"* — `read-only`'s.
    expect(codex, 'what it writes unasked').toMatch(/your folder and the temporary folders/i)
    expect(codex, 'the write bound').toMatch(/anywhere else .* unless you approve it/i)
    expect(codex, 'not read-only’s bound').not.toMatch(/cannot write outside your folder/i)
    expect(codex, 'the network bound').toMatch(/network/i)
    // 🔴 **The clause the PM relayed from `366` mid-dispatch**: the rail buys consent, not
    // containment, and a Codex sentence that stopped after "read-only" would have been read as
    // reach. A planted file outside the workspace is readable under every profile Codex has.
    expect(codex, 'reads are not narrowed by either mode').toMatch(/limits what it can read/i)

    const claude = declaredNote('claude')
    // ⛔ The Claude sentence's subject is the ABSENCE of a sandbox in BOTH modes, and the card as
    // the only thing this mode removes. A note here that talked about a sandbox coming off would
    // be the Codex sentence wearing Claude's name.
    expect(claude).toMatch(/nothing is sandboxed in either mode/i)
    expect(claude).toMatch(/card/i)
    // ⚑ `726` · R92 — the note named *"the only check left reads the paths a tool call names, and
    // a shell command names none"* until the path scan was removed. ⛔ On `main` it matched; there
    // is no refusal of this app's left in either mode, so the note may not name one.
    expect(claude, 'no path check of the app’s survives R92').not.toMatch(
      /check left|shell command|refus/i,
    )
    expect(claude, 'Claude is never started with a Codex sandbox mode').not.toContain(
      'danger-full-access',
    )
  })
})

describe('§2 · the words are the adapter’s, and the renderer holds no copy', () => {
  it('⛔ neither sentence appears anywhere in `renderer/` or `shared/`', () => {
    // 039: *"the renderer owns no copy of its own, so a reason that goes stale is fixed in one
    // place and cannot be fixed in only one of two."* A paste would be invisible to the neutrality
    // census — it names no provider in code — and would go stale the first time an adapter's policy
    // moved. Prose is stripped, so quoting a clause in a comment is allowed and copying it is not.
    const files = rendererAndShared()
    // ⚑ The paired non-vacuity floor: a walk that found no files would forbid nothing.
    expect(files.length, 'the walk found no source at all').toBeGreaterThan(50)

    const pasted = SUPPORTED_PROVIDERS.flatMap((provider) => {
      const note = declaredNote(provider)
      return files
        .filter(({ code }) => withoutProse(code).includes(note))
        .map(({ file }) => `${provider} → ${file}`)
    })
    expect(pasted).toEqual([])
  })

  it('⚑ …and the surfaces read it through the capability, by index and never by name', () => {
    // Adapter-specific disclosures remain on the conversation controls and placed launcher.
    // The front door uses the selected Ask/Auto description instead of an always-visible card.
    for (const file of ['composables/useConversationControls.ts', 'components/StartAsAgent.vue']) {
      const code = withoutProse(readFileSync(join(SRC, 'renderer/src', file), 'utf8'))
      expect(code, file).toMatch(/capabilities\?\.\[[^\]]+\]\?\.approvals/)
    }
    const header = withoutProse(
      readFileSync(join(SRC, 'renderer/src/components/SessionHeader.vue'), 'utf8'),
    )
    expect(header).toMatch(/capabilities\?\.\[[^\]]+\]\?\.approvals/)
  })
})
