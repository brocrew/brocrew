import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import { DRAWER_TABS } from '../src/renderer/src/lib/drawer'
import { STATE_TOGGLES } from '../src/renderer/src/lib/library-filters'
import { ALL_PROVIDER_FOLDERS, A_PROVIDER_FOLDER, PROVIDER_NAME } from '../src/shared/runtime-ipc'

/**
 * ⛔ **"Provider home" is this repo's word, and nobody outside this repo has met it** (169 §2).
 *
 * ## Where the rule comes from
 *
 * User-facing explanations name Claude Code and Codex and call the storage location a folder.
 * “Provider home” is repository jargon whose meaning the interface does not teach; the
 * vocabulary check covers more than `whyNotResumable`.
 *
 * ## Why a sweep needs a test and not a checklist
 *
 * ⚑ **Because that is twice now.** A list of strings in a document is a list of strings somebody has
 * to re-derive; this walks the tree. What it forbids is the phrase in code and in rendered prose;
 * what it deliberately allows is the phrase in COMMENTS, because *"provider home"* is the accurate
 * internal name for `<userData>/provider-homes/default/<profile>/<provider>` and a rule that
 * banned the words outright would push the explanation out of the file it belongs in — the same
 * split `reading-pane.render.test.ts` already draws for provider names.
 *
 * ## Which folder a sentence is about, which is the part that is not a substitution
 *
 * Two different directories wore one word, and 167 is why the difference now matters:
 *
 * | the folder | who owns it | how a sentence names it |
 * |---|---|---|
 * | `<userData>/provider-homes/…` | us, one per profile | *"this profile's folder"* |
 * | `~/.claude`, `~/.codex` | the user's own agents | *"Claude's own folder"* |
 *
 * The adopt scan reads only the first (`index.ts`: *"Adoption looks in every home this app owns"*);
 * the library's sweep reads only the second (`user-homes.ts`: *"the one exception… the only file in
 * the main process that names the real ones"*). One substitution applied eight times would have
 * called half of them the wrong thing.
 */

const SRC = join(__dirname, '../src')

/** The file with its COMMENTS removed — `reading-pane.render.test.ts`'s rule, and its reason. */
const withoutComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(ts|vue)$/.test(entry)) out.push(path)
  }
  return out
}

/**
 * The trees a user-facing sentence can live in. `main/` is here too, and that is 169's correction to
 * its own brief: the eight in the table were the renderer's, and five more of these sentences are
 * composed main-side, where 151 rewrote the first one.
 */
const SCANNED = ['renderer/src', 'shared', 'main']

describe('🔒 no surface says “provider home” (169 §2)', () => {
  const files = SCANNED.flatMap((root) => walk(join(SRC, root)))

  it('the walk finds the tree it claims to — a scanner over nothing forbids nothing', () => {
    // Non-vacuity, and the same floor `provider-neutrality.test.ts` keeps for the same reason:
    // silent in the direction that matters, so it is moved deliberately rather than never.
    expect(files.length).toBeGreaterThan(120)
  })

  /**
   * The two lines that keep the words, each argued for rather than pattern-matched away.
   *
   * ⛔ **Both are read by an AGENT, not by a person**, which is where 151's register stops: the
   * generated `CLAUDE.md` tells Claude how this app is laid out, and *"provider home"* is what that
   * directory IS. The workspace sentence is also load-bearing — 164 §4 pinned it, `workspace.test.ts`
   * asserts it, and `DEFAULT_PROFILE_LABEL` names it as the claim *"BroBot (default)"* is the
   * user-facing half of. Rewriting it here would break an agreement two dispatches deep for a
   * readability problem no person has.
   */
  const AGENT_FACING = [
    {
      file: 'main/runtime/workspace.ts',
      code: "Your instructions are this profile's own: BroBot runs each agent profile from its own provider home,",
      why: 'the generated workspace CLAUDE.md — written for Claude, pinned by 164 §4',
    },
  ]

  /** A module specifier is a path on disk, not a sentence. */
  const isImportPath = (line: string): boolean => /from '[^']*provider-homes?'/.test(line)

  it('still refuses the words in a string literal', () => {
    const code = withoutComments("const words = 'a file in its provider home'")
    expect(code).toMatch(/provider[- ]home/i)
    expect(isImportPath(code)).toBe(false)
  })

  it('allows the singular runtime module only as an import specifier', () => {
    const code = withoutComments(
      "import { withProviderHomeLock } from '@brobot2/runtime/provider-home'",
    )
    expect(code).toMatch(/provider[- ]home/i)
    expect(isImportPath(code)).toBe(true)
  })

  const offendingLines = files.flatMap((path) =>
    withoutComments(readFileSync(path, 'utf8'))
      .split('\n')
      .map((code, index) => ({
        file: relative(SRC, path).replaceAll('\\', '/'),
        line: index + 1,
        code: code.trim(),
      }))
      .filter((site) => /provider[- ]home/i.test(site.code) && !isImportPath(site.code)),
  )

  it('names it nowhere in code or in rendered text', () => {
    const offenders = offendingLines
      // `provider-homes.ts` IS the module that provisions them, and `provider-homes` is the
      // directory's real name on disk: identifiers and paths are not prose.
      .filter((site) => !site.file.endsWith('provider-homes.ts'))
      .filter((site) => !AGENT_FACING.some((ok) => ok.file === site.file && ok.code === site.code))
    expect(
      offenders.map((site) => `${site.file}:${site.line} — ${site.code}`),
      'a user-facing sentence uses the repo’s own word for a directory (151, 153 §7, 169 §2)',
    ).toEqual([])
  })

  it('…and the exemptions are still there, so neither is a permit for something else', () => {
    // The other direction: an exemption whose line has moved or been rewritten is an exemption that
    // now excuses nothing and hides whatever takes its place.
    for (const ok of AGENT_FACING) {
      expect(
        offendingLines.some((site) => site.file === ok.file && site.code === ok.code),
        `${ok.file} no longer holds the line it is exempt for — ${ok.why}`,
      ).toBe(true)
    }
    expect(
      offendingLines.filter((s) => s.file.endsWith('provider-homes.ts')).length,
    ).toBeGreaterThan(0)
  })

  it('…and the scan would catch one, in either kind of file', () => {
    // The other half: strip-comments doing too much would pass everything and mean nothing.
    expect(withoutComments(`<template><p>your provider homes</p></template>`)).toMatch(
      /provider[- ]home/i,
    )
    expect(withoutComments(`const why = 'still only in a provider home'`)).toMatch(
      /provider[- ]home/i,
    )
    // …and the exemption it is built on: a comment explaining the mechanism survives untouched.
    expect(withoutComments(`/* the provider home we provision per profile */`)).not.toMatch(
      /provider[- ]home/i,
    )
  })
})

describe('what each swept sentence says instead (169 §2)', () => {
  it('the app’s own folders are named by the PROFILE they belong to', () => {
    // The drawer's Info tab describes the session's own home, which is its profile's.
    const info = DRAWER_TABS.find((tab) => tab.id === 'info')
    expect(info?.hint).toContain('profile')
    expect(info?.hint).not.toContain('provider home')
    // ⚠️ **The scan summary is asserted in `library-filters.dom.test.ts`, not here**, and not by
    // choice: `home-scan.ts` reads `window` at module scope, so importing it into the node project
    // fails the typecheck rather than the test. The sweep above still covers its source.
  })

  it('the user’s own folders are named by the PROGRAM that keeps them', () => {
    // ⚑ Composed from `PROVIDER_NAME`, never typed: a third provider joins these sentences by being
    // added to the table, which is the one place the typecheck already forces.
    for (const name of Object.values(PROVIDER_NAME)) {
      expect(ALL_PROVIDER_FOLDERS, `${name} must be in the sentence`).toContain(name)
      expect(A_PROVIDER_FOLDER, `${name} must be in the sentence`).toContain(name)
    }
    expect(ALL_PROVIDER_FOLDERS).toBe("Claude's and Codex's own folders")
    expect(A_PROVIDER_FOLDER).toBe("Claude's or Codex's own folder")

    // The Sessions filter, whose `why` is read beside a toggle that decides nothing else.
    const notImported = STATE_TOGGLES.find((toggle) => toggle.key === 'notImported')
    expect(notImported?.why).toBe("still only in Claude's or Codex's own folder")

    // …and the host's own refusal, which knows the reason and not the provider — so it names both.
    const said = describeUnavailable('read-only')
    expect(said).toContain(A_PROVIDER_FOLDER)
    // ⚑ **D-017b · *reopened* became *continued here*** — there is no Reopen press any more; a
    // message sent from its view is what carries a conversation on — and 151's sentence otherwise
    // survives both rewrites.
    expect(said, 'and the rest of 151’s sentence survives the rewrite').toContain(
      'read and exported, but not continued here',
    )
  })

  it('⚠️ `whyNoDirectInput` is untouched by this sweep — 151 left it deliberately (criterion 6)', () => {
    // ⛔ **Not swept, and the reason is in `session-store.ts`:** its words are *"another agent drove
    // it"* — a fact about this app, in ordinary words, naming no internal concept. It is also the
    // sentence 116/118 negotiated down from an unmeasured claim about provider capabilities, and
    // reopening it for a readability problem it does not have would put that back in play. Pinned
    // here so a sweep cannot take it by accident.
    // ⚑ **D-017b · its tail was reworded, and not by this sweep**: *"so there is no input end to
    // reopen"* named the Reopen gesture, which is gone, so it now says what a person meets — a
    // conversation that takes no message of its own. ⛔ The negotiated half, *another agent drove
    // it*, is the same bytes, and it still names no provider folder.
    const source = readFileSync(join(SRC, 'main/db/session-store.ts'), 'utf8')
    expect(source).toContain(
      "return 'a sub-agent conversation — another agent drove it, so it takes no message of its own'",
    )
  })
})
