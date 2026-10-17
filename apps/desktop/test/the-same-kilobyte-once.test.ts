import { describe, expect, it } from 'vitest'
import { legacyWorkspaceFiles } from './helpers/legacy-workspace-files'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InjectedInstruction, SessionInstructions } from '../src/shared/runtime-ipc'
import {
  INSTRUCTION_FILE_CAP,
  readSessionInstructions,
  type WorkspaceOwnFile,
} from '../src/main/runtime/instructions'
import {
  brobotWorkspace,
  CLAUDE_INSTRUCTIONS_FILE,
  CODEX_INSTRUCTIONS_FILE,
  ensureWorkspace,
  WORKSPACE_CANARY,
  workspaceOwnFilesIn,
} from '../src/main/runtime/workspace'

/**
 * 🔴 **The same kilobyte, once** (594, `HO-075` §1 · `576`'s measurement).
 *
 * > ⚑ **`HO-075` §1:** *"An agent working in a directory receives that directory's conventions,
 * > ONCE, whatever engine it runs on."*
 *
 * ⛔ **BroBot publishes ONE body under TWO names** — `legacyWorkspaceFiles()` renders
 * `WORKSPACE_INSTRUCTIONS` as both `CLAUDE.md` and `AGENTS.md`, and `ensureWorkspace` writes both at
 * every launch, because two engines look for different ones. ⚠️ **That publication is correct and
 * `581` is why**: Codex reads `AGENTS.md` natively and is injected nothing, so removing either file
 * would strip the workspace text from every default-cwd Codex conversation.
 *
 * 🔴 **The defect was on the CLAUDE side.** The walk selects the cwd's `AGENTS` layer the way
 * `codexConventionChain` does, so in the workspace — the default cwd of every conversation that
 * names no folder — the reader admitted our `AGENTS.md` as `repository-conventions` and then our
 * `CLAUDE.md` as `workspace-instructions`. ⛔ It deduplicates by PATH, so the same body went to the
 * model twice.
 *
 * ## ⛔ What this file is FOR, stated once
 *
 * ⚑ **The whole repair is gated on an optional input**, so the arm without it reproduces the old
 * output byte for byte — which means **not one test that existed before 594 could catch a
 * regression of it.** ⚠️ That is why every section below carries its own control rather than
 * leaning on the suites next door.
 */

/** ⚑ The two files this app publishes, and what it wrote in them — as `main/index.ts` derives them. */
const published = (userData: string): WorkspaceOwnFile[] =>
  legacyWorkspaceFiles().map((file) => ({
    path: join(brobotWorkspace(userData), file.name),
    content: file.content,
  }))

interface Launch {
  readonly cwd?: string
  readonly home?: string
  /** ⛔ Omitted = the reader as it behaved BEFORE 594. This is the control, not a convenience. */
  readonly ours?: readonly WorkspaceOwnFile[]
}

/** One Claude launch against a real workspace on disk. */
const claude = (userData: string, launch: Launch = {}): SessionInstructions => {
  const workspace = brobotWorkspace(userData)
  return readSessionInstructions({
    provider: 'claude',
    cwd: launch.cwd ?? workspace,
    providerHome: join(userData, 'home'),
    home: launch.home ?? userData,
    workspaceFile: join(workspace, CLAUDE_INSTRUCTIONS_FILE),
    ...(launch.ours === undefined ? {} : { workspaceOwnFiles: launch.ours }),
  }).instructions
}

const kinds = (read: SessionInstructions): string[] => read.injected.map((item) => item.kind)
const paths = (read: SessionInstructions): string[] => read.injected.map((item) => item.path)
const at = (read: SessionInstructions, path: string): InjectedInstruction | undefined =>
  read.injected.find((item) => item.path === path)
/** How many times the workspace marker reaches the model in the composed hint. */
const markers = (read: SessionInstructions): number =>
  (read.composed ?? '').split(WORKSPACE_CANARY).length - 1

/** A disposable install: a real workspace, published by the real publisher. */
const install = (run: (userData: string, workspace: string) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'brobot-594-'))
  try {
    const userData = join(root, 'userData')
    const workspace = ensureWorkspace(userData)
    for (const file of legacyWorkspaceFiles())
      writeFileSync(join(workspace, file.name), file.content)
    run(userData, workspace)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('594 §1 · the body BroBot publishes twice reaches Claude once', () => {
  it('🔴 one block where there were two — and the same launch without the input still gets two', () => {
    install((userData, workspace) => {
      // ⛔ **The control FIRST, and it is a red/green pair rather than a decoration.** The repair is
      // gated on an optional input; with it absent this reader is the one `576` measured, and the
      // assertion below would pass against a reader that had been changed in no way at all.
      const before = claude(userData)
      expect(kinds(before)).toEqual(['repository-conventions', 'workspace-instructions'])
      expect(markers(before)).toBe(2)

      const after = claude(userData, { ours: published(userData) })
      expect(kinds(after)).toEqual(['workspace-instructions'])
      expect(paths(after)).toEqual([join(workspace, CLAUDE_INSTRUCTIONS_FILE)])
      expect(markers(after)).toBe(1)

      // ⚑ **The text did not merely move — it is still all there**, which is the half a count
      // cannot say. A repair that dropped BOTH copies would satisfy every line above but this one.
      expect(after.composed).toContain('This directory is the working directory for conversations')

      // ⛔ **The EXACT delta, not merely *smaller*** (found in review). *Shorter* is satisfied by a
      // repair that removed one byte, or that truncated rather than dropped. ⚑ What went is one
      // whole block — its header, its body and the separator between blocks — which is the same
      // arithmetic `allocate` charges for it, derived here from the control's own row.
      const twin = before.injected[0]
      const header = `Contents of ${String(twin?.path)} (this repository's shared agent conventions, read by BroCrew so both engines get them):\n\n`
      expect(twin?.kind).toBe('repository-conventions')
      expect(
        Buffer.byteLength(before.composed ?? '', 'utf8') -
          Buffer.byteLength(after.composed ?? '', 'utf8'),
      ).toBe(Buffer.byteLength(header + String(twin?.text) + '\n\n', 'utf8'))
    })
  })

  it('⚑ the survivor keeps its POSITION in the prompt — the deeper block, which is the CLI order', () => {
    install((userData, workspace) => {
      // ⛔ **Within one directory the convention file is taken BEFORE the `CLAUDE.md` spelling, and
      // later text wins when two files disagree** (`364` §2.3). ⚠️ So keeping the last of the two
      // leaves the prompt saying exactly what it said before, one copy shorter — and the control
      // is that the dropped one really was the earlier of the two.
      const before = claude(userData)
      expect(paths(before)).toEqual([
        join(workspace, CODEX_INSTRUCTIONS_FILE),
        join(workspace, CLAUDE_INSTRUCTIONS_FILE),
      ])
      const after = claude(userData, { ours: published(userData) })
      expect(paths(after)).toEqual([join(workspace, CLAUDE_INSTRUCTIONS_FILE)])
    })
  })

  it('⛔ nothing is REFUSED for it — the bytes were sent, so no row says they were not', () => {
    install((userData) => {
      // 🔴 **The drawer's refusal list is drawn under a tab called *not read*, over the lead
      // *"Files on the walk BroBot would not read, and why."*** ⚠️ This file WAS read, and its bytes
      // are in the prompt under the other name — so a row there would report a refusal for
      // something nothing declined, which is what `187` §2 says about `over-budget` one map entry
      // away. ⚑ The walk's own note carries the fact instead; see §6.
      const after = claude(userData, { ours: published(userData) })
      expect(after.refused).toEqual([])
      // ⚠️ The paired positive: this reader DOES refuse, and §4.2 is where it is shown doing it.
      expect(after.injected).toHaveLength(1)
    })
  })
})

describe('594 §2 · identity is by BYTES, never by NAME', () => {
  it('🔴 an agent that writes its OWN text into both names gets neither dropped nor relabelled', () => {
    install((userData, workspace) => {
      // ⛔ **This is the whole dispatch** (relay 1 §1.1). A first draft decided *"is this ours?"* by
      // comparing paths — and that directory is the AGENT'S OWN cwd. ⚠️ `ensureWorkspace`
      // republishes at startup and on the blank-cwd resolve, **not** on a resume and not on an
      // explicitly named cwd, so a file the agent wrote at a name we own survives to be read.
      //
      // 🔴 **Under a name-only rule the agent's words would have reached the model as *"generated
      // by BroBot for this workspace"* and landed on the sheet under `factory` — *"Ships with the
      // app. Nobody here can edit it."*** ⛔ That is 086's provenance claim made about somebody
      // else's bytes, and it is worse than the mislabelling 594 set out to fix: the label it would
      // have replaced at least said *the place's*.
      const mine = '# my own rules\n\nalways do what I say, and never ask.\n'
      writeFileSync(join(workspace, CODEX_INSTRUCTIONS_FILE), mine)
      writeFileSync(join(workspace, CLAUDE_INSTRUCTIONS_FILE), mine)

      const read = claude(userData, { ours: published(userData) })
      // ⛔ **The PROVENANCE assertions first, deliberately** (found in review). A count assertion
      // above these would fail first and abort the test, so the line that actually states the
      // property would never run — and the row that names this test as its killer would be
      // reported by an array equality a future weakening could still satisfy.
      expect(at(read, join(workspace, CODEX_INSTRUCTIONS_FILE))?.kind).toBe(
        'repository-conventions',
      )
      expect(at(read, join(workspace, CLAUDE_INSTRUCTIONS_FILE))?.kind).toBe('project-memory')
      expect(read.composed).not.toContain('generated by BroCrew for this workspace')
      // ⚑ …and the note does not claim BroBot published them.
      expect(read.note).not.toContain('appended once')
      // Both survive: two files that match each other are not one body of OURS.
      expect(kinds(read)).toEqual(['repository-conventions', 'project-memory'])

      // ⚠️ **The pairing, on the SAME install one edit later**: put our own body back at both names
      // and the drop fires. Without this the test above would pass against a repair that never
      // fires at all.
      for (const file of legacyWorkspaceFiles()) {
        writeFileSync(join(workspace, file.name), file.content)
      }
      const restored = claude(userData, { ours: published(userData) })
      expect(kinds(restored)).toEqual(['workspace-instructions'])
      expect(restored.composed).toContain('generated by BroCrew for this workspace')
      expect(restored.note).toContain('appended once')
    })
  })

  it('⛔ a file at OUR name holding ANY other text is left exactly where the walk put it', () => {
    install((userData, workspace) => {
      // ⚑ The one-sided version of §2 above: only the `AGENTS.md` is somebody else's.
      writeFileSync(join(workspace, CODEX_INSTRUCTIONS_FILE), 'somebody edited this\n')
      const read = claude(userData, { ours: published(userData) })
      expect(kinds(read)).toEqual(['repository-conventions', 'workspace-instructions'])
      expect(markers(read)).toBe(1) // only our real `CLAUDE.md` still carries the marker
      expect(read.note).not.toContain('appended once')

      // ⚠️ **And the mirror image, which is the half `kindFor` decides by NAME.** Put ours back at
      // the convention name and edit the `CLAUDE.md` instead: the edited one stops being called
      // BroBot's, because a path this app publishes at is not a claim it wrote what is there.
      for (const file of legacyWorkspaceFiles()) {
        writeFileSync(join(workspace, file.name), file.content)
      }
      writeFileSync(join(workspace, CLAUDE_INSTRUCTIONS_FILE), 'the agent wrote this one\n')
      const other = claude(userData, { ours: published(userData) })
      expect(at(other, join(workspace, CLAUDE_INSTRUCTIONS_FILE))?.kind).toBe('project-memory')
      expect(at(other, join(workspace, CODEX_INSTRUCTIONS_FILE))?.kind).toBe(
        'workspace-instructions',
      )
      expect(other.composed).not.toContain('the agent wrote this one\n\nContents')
    })
  })
})

describe('594 §3 · the boundary — the five shapes that must keep BOTH', () => {
  it('⛔ a real repository whose own two files are identical BY HAND', () => {
    install((userData) => {
      // 🔴 **`576` ruled a blanket content dedupe OUT** — *"a blanket content dedupe across
      // repositories would discard intentional sources"* — and this is the case that tells the two
      // repairs apart. ⚠️ A reviewer may call it paranoid; `an-override-file-shadows-differently-at-two-scopes`
      // is the same shape, and it was not.
      const root = join(userData, '..', 'repo')
      mkdirSync(join(root, '.git'), { recursive: true })
      const same = '# house rules\n\nthe same text in both, on purpose.\n'
      writeFileSync(join(root, CODEX_INSTRUCTIONS_FILE), same)
      writeFileSync(join(root, CLAUDE_INSTRUCTIONS_FILE), same)

      const read = claude(userData, { cwd: root, home: join(userData, '..') })
      const withOurs = claude(userData, {
        cwd: root,
        home: join(userData, '..'),
        ours: published(userData),
      })
      // ⚑ **Identical with and without the input**, which is the strongest form of *untouched*.
      expect(kinds(withOurs)).toEqual(kinds(read))
      expect(kinds(withOurs)).toEqual(['repository-conventions', 'project-memory'])
      expect(withOurs.injected).toHaveLength(2)
    })
  })

  it('⛔ two ENORMOUS files at our names that share their first 64 KiB', () => {
    install((userData, workspace) => {
      // ⚠️ **The property, pinned independently of the line that enforces it.** `readInstructionFile`
      // returns the first `INSTRUCTION_FILE_CAP` bytes, so a prefix compare would call these one
      // body. ⛔ The comparison is against the WHOLE published text, which a cut file cannot equal —
      // and a `!truncated` guard written here was removed because nothing could make it decide
      // anything. 🔴 This test is what says the property survived the line.
      // ⛔ **Both files START with the body this app publishes** and then run past the cap, which
      // is the shape that makes the hazard real: a `startsWith` compare would call each of them
      // ours, and the two capped reads are identical, so one would be deleted from the prompt.
      const body = legacyWorkspaceFiles()[0]?.content ?? ''
      const head = `${body}${'z'.repeat(INSTRUCTION_FILE_CAP)}`
      writeFileSync(join(workspace, CODEX_INSTRUCTIONS_FILE), `${head}one tail\n`)
      writeFileSync(join(workspace, CLAUDE_INSTRUCTIONS_FILE), `${head}another tail\n`)

      const read = claude(userData, { ours: published(userData) })
      // ⛔ **Both kept, and the `CLAUDE.md` spelling is DEMOTED**: it sits at a path this app
      // publishes but does not hold what this app wrote, so it belongs to the place it is in.
      expect(kinds(read)).toEqual(['repository-conventions', 'project-memory'])
      // ⚑ The premise of the test: both really were cut, so a prefix compare really would have
      // matched. Without this line the assertion above could pass for the wrong reason.
      expect(read.injected.every((item) => item.truncated)).toBe(true)
      // ⚠️ …and the two capped reads really are IDENTICAL, so a prefix reading would have had to
      // pick one of them to delete. Without this the row above could pass because they differed.
      expect(read.injected[0]?.text).toBe(read.injected[1]?.text)
      expect(read.injected[0]?.text.startsWith(body)).toBe(true)
    })
  })

  it('🔴 a VERBATIM copy of both published bodies, in a directory that is not the workspace', () => {
    install((userData) => {
      // ⛔ **The mirror of §2, and the half a content-only rule would fail.** A rule that asked only
      // *"does this hold one of our bodies?"* — with no path — passes every other test in this file,
      // because nothing else ever puts a published body anywhere but the workspace. ⚠️ A person who
      // copies `brobot-workspace/CLAUDE.md` into a project as a template, under both names, would
      // have one of their OWN files deleted from the prompt with no row to say so, and the survivor
      // relabelled *generated by BroCrew for this workspace* — 086's inversion reached from the
      // other side.
      const root = join(userData, '..', 'template-repo')
      mkdirSync(join(root, '.git'), { recursive: true })
      for (const file of legacyWorkspaceFiles()) {
        writeFileSync(join(root, file.name), file.content)
      }
      const home = join(userData, '..')
      const without = claude(userData, { cwd: root, home })
      const read = claude(userData, { cwd: root, home, ours: published(userData) })

      // ⚑ **Identical with and without the input** — the strongest form of *untouched*.
      expect(kinds(read)).toEqual(kinds(without))
      expect(kinds(read)).toEqual(['repository-conventions', 'project-memory'])
      expect(read.injected).toHaveLength(2)
      // ⛔ **Both copies really did reach the model**, which is what the count cannot say.
      expect(markers(read)).toBe(2)
      expect(read.note).not.toContain('appended once')
      expect(read.composed).not.toContain('generated by BroCrew for this workspace')
    })
  })

  it('⛔ an impostor at our name of EXACTLY the right length', () => {
    install((userData, workspace) => {
      // ⚠️ **§2 is titled *by bytes* and every other impostor in this file is also a different
      // LENGTH** (found in review), so a byte-COUNT compare would pass all of them. ⛔ An agent
      // editing the workspace file length-preservingly — swapping the canary's trailing digits — is
      // the cheapest version of M7's harm, and this is the only test that separates *the same
      // bytes* from *the same number of bytes*.
      const body = legacyWorkspaceFiles()[1]?.content ?? ''
      const impostor = body.replace(WORKSPACE_CANARY, `${WORKSPACE_CANARY.slice(0, -4)}DEAD`)
      expect(impostor.length).toBe(body.length)
      expect(impostor).not.toBe(body)
      writeFileSync(join(workspace, CODEX_INSTRUCTIONS_FILE), impostor)

      const read = claude(userData, { ours: published(userData) })
      expect(kinds(read)).toEqual(['repository-conventions', 'workspace-instructions'])
      expect(read.note).not.toContain('appended once')
    })
  })

  it('⛔ an `AGENTS.override.md` somebody dropped into the workspace', () => {
    install((userData, workspace) => {
      // ⚑ `conventionFileIn` prefers the override, so our own `AGENTS.md` is never even looked at.
      // ⚠️ The override is not at a path this app published, so it keeps the place's label — which
      // is right: somebody else wrote it.
      writeFileSync(join(workspace, 'AGENTS.override.md'), 'an override somebody dropped in\n')
      const read = claude(userData, { ours: published(userData) })
      expect(kinds(read)).toEqual(['repository-conventions', 'workspace-instructions'])
      expect(at(read, join(workspace, 'AGENTS.override.md'))?.kind).toBe('repository-conventions')
      expect(markers(read)).toBe(1)
      // ⚑ **With and without the input, identical** — this section's own control, which this shape
      // was missing (found in review): our generated `AGENTS.md` is shadowed and never a candidate,
      // so there is nothing here for 594 to do and it does nothing.
      expect(kinds(claude(userData))).toEqual(kinds(read))
    })
  })
})

describe('594 §4 · when the counterpart is gone, the twin carries the body — as OURS', () => {
  it('⚑ `CLAUDE.md` absent: `AGENTS.md` survives and stops being called the repository’s', () => {
    install((userData, workspace) => {
      unlinkSync(join(workspace, CLAUDE_INSTRUCTIONS_FILE))
      // ⛔ **The control, and it is what makes this a relabel rather than an accident**: before 594
      // this same file arrived as `repository-conventions` — *"this repository's shared agent
      // conventions"* — and the workspace is not a repository and nobody shared anything.
      expect(kinds(claude(userData))).toEqual(['repository-conventions'])

      const read = claude(userData, { ours: published(userData) })
      expect(kinds(read)).toEqual(['workspace-instructions'])
      expect(paths(read)).toEqual([join(workspace, CODEX_INSTRUCTIONS_FILE)])
      expect(markers(read)).toBe(1)
      // ⚠️ Nothing was dropped, so the note draws no clause — the sentence is about a drop.
      expect(read.note).not.toContain('appended once')
    })
  })

  /**
   * 🔴 **733 · `CLAUDE.md` is a LINK: followed, as the CLI follows it — and what it holds is the
   * place's, not ours.**
   *
   * ⛔ This was *"🔒 `CLAUDE.md` is a SYMLINK: refused, and the twin still carries the body as
   * ours"* — `261` §2's rail, *"a session can write its own cwd, so a link planted at `CLAUDE.md`
   * is the whole attack"*, with a target standing in for a credential. ⚑ R93 removed that rail
   * (`731` F-3). ⚠️ **What 594 does with the result is unchanged, and this is where it is shown**:
   * a name we publish at is not a claim we wrote what is there, so the linked text keeps the
   * place's label, and the `AGENTS.md` twin still carries our body as ours, once.
   */
  it('🔴 733 · `CLAUDE.md` is a LINK: followed, labelled the place’s — and the twin carries our body', () => {
    install((userData, workspace) => {
      // ⚠️ In a folder of its own, as `733` needed it: a link into the home itself was refused as
      // `personal-home` until `736` (which follows it, as the CLI does). It is kept apart so this
      // fixture stays about a link, not about home.
      mkdirSync(join(userData, 'elsewhere'), { recursive: true })
      writeFileSync(join(userData, 'elsewhere', 'linked.md'), 'what somebody linked in\n')
      unlinkSync(join(workspace, CLAUDE_INSTRUCTIONS_FILE))
      symlinkSync(
        join(userData, 'elsewhere', 'linked.md'),
        join(workspace, CLAUDE_INSTRUCTIONS_FILE),
      )

      const read = claude(userData, { ours: published(userData) })
      // ⛔ On `main`: refused as `symlink`, and its text in nothing.
      expect(read.refused).toEqual([])
      expect(read.composed).toContain('what somebody linked in')
      // ⛔ The whole list, in prompt order — the twin first, then the linked file (review of `733`).
      expect(kinds(read)).toEqual(['workspace-instructions', 'project-memory'])
      expect(at(read, join(workspace, CLAUDE_INSTRUCTIONS_FILE))?.kind).toBe('project-memory')
      // ⚑ …and our body is still sent ONCE, under our own label, on the twin.
      expect(at(read, join(workspace, CODEX_INSTRUCTIONS_FILE))?.kind).toBe(
        'workspace-instructions',
      )
      expect(markers(read)).toBe(1)
    })
  })
})

describe('594 §5 · Codex is untouched, and both files are still published', () => {
  it('⛔ Codex is injected nothing and composes nothing, with the input present', () => {
    install((userData, workspace) => {
      const codex = readSessionInstructions({
        provider: 'codex',
        cwd: workspace,
        providerHome: join(userData, 'home'),
        home: userData,
        workspaceFile: join(workspace, CLAUDE_INSTRUCTIONS_FILE),
        workspaceOwnFiles: published(userData),
      }).instructions
      expect(codex.injected).toEqual([])
      expect(codex.composed).toBeNull()
      // ⚑ The paired positive: the SAME workspace hands Claude a block, so the emptiness above is
      // about the provider and not about a workspace with nothing in it.
      expect(claude(userData, { ours: published(userData) }).injected).toHaveLength(1)
    })
  })

  it('🔴 the pair the READER compares is the pair the PUBLISHER writes, and the two bodies are one', () => {
    install((userData, workspace) => {
      // ⛔ **The premise, asserted rather than relied on.** `renderFor`'s header ternary has two
      // identical arms today, which is the only reason the two published files are byte-equal.
      // ⚠️ **Give the Codex arm a voice of its own — which is that ternary's stated purpose — and
      // the duplication silently comes back with nothing to catch it.** 🔴 So the equality is
      // pinned here, on the publisher, not inferred from the reader's behaviour.
      const files = legacyWorkspaceFiles()
      expect(files.map((file) => file.name)).toEqual([
        CLAUDE_INSTRUCTIONS_FILE,
        CODEX_INSTRUCTIONS_FILE,
      ])
      expect(files[0]?.content).toBe(files[1]?.content)
      // ⚑ **And the reader's pair is derived from that same call**, so the two cannot drift: every
      // path the composition root hands over is a file the publisher actually wrote.
      for (const one of published(userData)) {
        expect(files.some((file) => join(workspace, file.name) === one.path)).toBe(true)
      }
    })
  })
})

describe('594 §6 · the panel says what happened, and only when it happened', () => {
  it('⚑ the walk’s note names both files on a launch that dropped one, and is silent otherwise', () => {
    install((userData, workspace) => {
      const dropped = claude(userData, { ours: published(userData) }).note
      expect(dropped).toContain(CODEX_INSTRUCTIONS_FILE)
      expect(dropped).toContain(CLAUDE_INSTRUCTIONS_FILE)
      expect(dropped).toContain('the two held the same text, so it was appended once')
      // ⛔ **And it does NOT say the ENGINE finds them** (found in review). Claude launches with
      // `settingSources: []`, so the provider opens neither file — BroBot reads one and appends it
      // as inert text. A sentence saying the engine found it is `HO-070` §3's shape: a wrong claim
      // about HOW text is read makes a reader disbelieve data that is correct.
      expect(dropped).not.toContain('either engine finds them')
      expect(dropped).toContain('BroCrew reads yours for Claude')
      // ⚠️ …and it closes with the fact that disqualifies the two files it just named, so the
      // sentence after it — *editing one of these takes effect next launch* — cannot be read as an
      // invitation to edit a file the app overwrites at every launch.
      expect(dropped).toContain('BroCrew rewrites both at every launch')

      // ⛔ **Rendered from what happened, never asserted** (standing rule 8, pointed at a person's
      // sentence). The same install, one file edited, draws no clause at all.
      writeFileSync(join(workspace, CODEX_INSTRUCTIONS_FILE), 'edited\n')
      const silent = claude(userData, { ours: published(userData) }).note
      expect(silent).not.toContain('appended once')
      // ⚠️ The paired positive: the note is still there and still says what the walk did, so the
      // negative above is about the clause and not about an empty string.
      expect(silent).toContain('Read at launch and appended as text')
    })
  })
})

describe('594 §7 · the walk reaches its own files through an ALIAS, and the wiring is real', () => {
  it('🔒 a cwd that reaches the workspace through a symlink still gets ONE copy', () => {
    install((userData, workspace) => {
      // ⛔ **`170` §4's property, carried into 594's own comparison.** The composition root derives
      // the pair it publishes from `brobotWorkspace(userData)`; a person or a launcher may reach the
      // SAME directory by another spelling, and a lexical compare answers *no* to every one of
      // them. ⚠️ The direction of that mistake is the wrong one — the body would go twice again,
      // silently, on exactly the installs where somebody moved their workspace behind a link.
      const alias = join(userData, 'alias-workspace')
      symlinkSync(workspace, alias)

      const read = claude(userData, { cwd: alias, ours: published(userData) })
      expect(kinds(read)).toEqual(['workspace-instructions'])
      expect(markers(read)).toBe(1)
      // ⚑ **The row still shows the path a person TYPED**, not the resolved one — `170` returns the
      // chain lexically on purpose, and this is the control that the alias really was used.
      expect(paths(read)).toEqual([join(alias, CLAUDE_INSTRUCTIONS_FILE)])

      // ⚠️ The pairing: the same alias WITHOUT the input still gets both, so the single block above
      // is 594 firing through the link rather than the link hiding a file.
      expect(kinds(claude(userData, { cwd: alias }))).toEqual([
        'repository-conventions',
        'workspace-instructions',
      ])
    })
  })

  it('the current app claims no generated workspace instructions', () => {
    install((userData) => {
      ensureWorkspace(userData)
      expect(workspaceOwnFilesIn(userData)).toEqual([])
      expect(kinds(claude(userData, { ours: [] }))).toEqual([])
    })
  })

  it('⛔ EVERY caller of this reader outside the tests passes it — a roster from the IMPORT', () => {
    // ⚠️ **Derived, never a hand-listed path** (rule 27.1: a guard scoped by where things live today
    // expires silently). 🔴 The shipped composition root is not the only hand copy of that call:
    // `smoke/the-text-a-child-is-actually-told.smoke.ts` holds two more, and a field added in
    // `main/index.ts` alone would leave the one instrument that can watch a LIVE prompt measuring
    // the reader as it was before 594.
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (entry.name.endsWith('.ts')) files.push(path)
      }
    }
    for (const one of ['../src', '../smoke']) walk(join(import.meta.dirname, one))

    // ⚠️ Comments out first: these files argue about `workspaceOwnFiles` in prose, and a census that
    // cannot tell code from the paragraph explaining it measures the paragraph.
    const code = (path: string): string =>
      readFileSync(path, 'utf8').replaceAll(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1')
    const callers = files.filter(
      (path) =>
        !path.endsWith('runtime/instructions.ts') &&
        code(path).includes('readSessionInstructions({'),
    )
    // ⛔ **Re-aimed rather than weakened, when it fired on a caller that was right** (found by this
    // census on its first run): `smoke/lifecycle-stage.smoke.ts` passes NEITHER half and composes no
    // hint at all, so it claims nothing about the workspace and owes nothing. ⚑ The property is
    // *both halves or neither* — a caller that knows the workspace's `CLAUDE.md` by name and not by
    // content is the one shape 594 exists to make impossible.
    const aboutTheWorkspace = callers.filter((path) => code(path).includes('workspaceFile:'))
    // ⛔ **Both lists are non-empty and they differ** — a census over nothing passes, and one where
    // every caller abstained would too.
    expect(callers.length).toBeGreaterThan(aboutTheWorkspace.length)
    expect(aboutTheWorkspace.length).toBeGreaterThanOrEqual(2)
    for (const path of aboutTheWorkspace) {
      expect(
        code(path),
        `${path} names the workspace file but never says what this app wrote in it`,
      ).toContain('workspaceOwnFiles:')
    }
  })
})

describe('594 §8 · the pair that is ours but is no longer ONE TEXT', () => {
  it('🔴 two published bodies that DIFFER are both sent, and both are still ours', () => {
    install((userData, workspace) => {
      // ⛔ **`sendOurWorkspaceBodyOnce` compares each candidate to ITS OWN published body.** That
      // each matched what this app wrote into it is not the same fact as the two being one text —
      // they are one text today only because `renderFor`'s header ternary has two identical arms,
      // and that ternary exists so *"each provider's conventional filename and voice"* can diverge.
      // 🔴 **The day the Codex arm gets a voice, these are two different texts under two names and
      // BOTH must be sent**; without the pairwise compare one of them is silently deleted.
      //
      // ⚑ **Driven through the INPUT rather than by editing `workspace.ts`**, which publishes what
      // it publishes: the reader's rule is what is under test, and this is that rule's own shape.
      const claudeBody = '# BroCrew workspace\n\nthe Claude voice.\n'
      const codexBody = '# BroCrew workspace\n\nthe Codex voice, which is not the same.\n'
      writeFileSync(join(workspace, CLAUDE_INSTRUCTIONS_FILE), claudeBody)
      writeFileSync(join(workspace, CODEX_INSTRUCTIONS_FILE), codexBody)
      const ours = [
        { path: join(workspace, CLAUDE_INSTRUCTIONS_FILE), content: claudeBody },
        { path: join(workspace, CODEX_INSTRUCTIONS_FILE), content: codexBody },
      ]

      const read = claude(userData, { ours })
      // ⛔ **Both sent** — the drop cannot fire, because there is no duplication to remove.
      expect(read.injected).toHaveLength(2)
      expect(read.composed).toContain('the Claude voice')
      expect(read.composed).toContain('the Codex voice, which is not the same')
      // ⚑ **And both are OURS**, which is the half a keeper-only relabel got wrong: each holds
      // exactly what this app published at that name, so neither belongs to the place.
      expect(kinds(read)).toEqual(['workspace-instructions', 'workspace-instructions'])
      // ⚠️ …and the panel says nothing, because nothing was appended twice.
      expect(read.note).not.toContain('appended once')

      // ⛔ **The pairing, one byte over**: make the two bodies equal and the drop fires again — so
      // the two assertions above are about the texts DIFFERING and not about a rule that never runs.
      writeFileSync(join(workspace, CODEX_INSTRUCTIONS_FILE), claudeBody)
      const same = claude(userData, {
        ours: [ours[0], { path: ours[1]!.path, content: claudeBody }] as WorkspaceOwnFile[],
      })
      expect(same.injected).toHaveLength(1)
      expect(same.note).toContain('appended once')
    })
  })
})

describe('594 §9 · the panel speaks for what was SENT, not for what was dropped', () => {
  it('⛔ a keeper the budget then refuses draws no clause — and the freed kilobyte is not monotone', () => {
    // 🔴 **`sentOnce` is decided BEFORE `allocate`.** If the survivor is then refused over-budget the
    // panel would say the body *was appended once* over a prompt that got it zero times, beside an
    // `over-budget` row for the very file it names — nothing on screen adding up.
    //
    // ⚑ **Reachable, and the layout is the derivation.** The workspace becomes a convention
    // directory only when a `.git` sits at or above it, so with the cwd one level BELOW it the pair
    // is no longer nearest and `allocate`'s nearest-first walk spends the cap on the deeper files
    // first. ⚠️ **The filler size is SEARCHED, not written down**, because a magic number that
    // drifts would leave this passing for the wrong reason (rule 22).
    const starved: number[] = []
    const restored: number[] = []
    for (const filler of [63000, 64000, 65000]) {
      install((userData, workspace) => {
        mkdirSync(join(workspace, '.git'), { recursive: true })
        const deep = join(workspace, 'deep')
        mkdirSync(join(deep, '.claude'), { recursive: true })
        const home = join(userData, 'home')
        mkdirSync(home, { recursive: true })
        writeFileSync(join(home, CLAUDE_INSTRUCTIONS_FILE), 'p'.repeat(INSTRUCTION_FILE_CAP))
        writeFileSync(join(deep, CLAUDE_INSTRUCTIONS_FILE), 'a'.repeat(INSTRUCTION_FILE_CAP))
        writeFileSync(
          join(deep, '.claude', CLAUDE_INSTRUCTIONS_FILE),
          'b'.repeat(INSTRUCTION_FILE_CAP),
        )
        writeFileSync(join(deep, CODEX_INSTRUCTIONS_FILE), 'c'.repeat(filler))

        const read = claude(userData, { cwd: deep, ours: published(userData) })
        const keeper = join(workspace, CLAUDE_INSTRUCTIONS_FILE)
        const refused = read.refused.some(
          (one) => one.path === keeper && one.reason === 'over-budget',
        )
        if (refused) {
          // ⛔ **The clause is silent**, which is the property. And the twin got no row of its own:
          // it was spliced out of the candidates before the budget ever saw it.
          expect(read.note).not.toContain('appended once')
          expect(paths(read)).not.toContain(keeper)
          starved.push(filler)
        } else {
          expect(read.note).toContain('appended once')
          restored.push(filler)
        }
      })
    }
    // ⛔ **The premise, asserted rather than hoped for**: at least one arm really did starve the
    // keeper. Without this the test passes on a layout where the budget never bit.
    expect(starved.length).toBeGreaterThanOrEqual(1)
    // 🔴 **And the allocator is not monotone**, which is the claim `sendOurWorkspaceBodyOnce`'s
    // docblock makes and the reason 594 answers *yes* to *"can this alter a budgeted outcome"*: a
    // LARGER filler leaves the keeper in the prompt, because the filler itself stops fitting and
    // `allocate` skips it with `continue` rather than stopping.
    expect(restored.length).toBeGreaterThanOrEqual(1)
    expect(Math.max(...restored)).toBeGreaterThan(Math.min(...starved))
  })
})
