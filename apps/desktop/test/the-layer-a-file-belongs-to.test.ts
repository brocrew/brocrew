import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { instructionScope } from '../src/main/runtime/instruction-scope'
import { readInstructionSource } from '../src/main/instruction-source'
import { PROFILE_OWNS } from '../src/renderer/src/lib/profile-words'

/**
 * 🔴 **356 §3 · which layer an instruction file belongs to, and §2 · reading one of them.**
 *
 * 357 asked whether the `AGENTS.md` the Info panel shows is the profile's own and answered no: this
 * app authors no profile instruction leaf, so on an ordinary session every path the provider reports
 * comes off the cwd chain. Its ruling for the panel is *"a CWD `AGENTS.md` row must say project; it
 * must never be presented as proof that the selected profile owns it"* — which is a LABEL, and the
 * label is computed here.
 *
 * ⛔ **Every case below is chosen so the two readings DIVERGE.** A fixture whose home and cwd are
 * unrelated directories is answered the same way by *"is it in the home"*, *"is it on the chain"*
 * and *"is it neither"* for most inputs; those cases measure nothing. The overlapping home, the
 * sibling with a shared prefix, and the file one level BELOW the cwd are the three places two
 * plausible implementations disagree.
 */

const trash: string[] = []

afterEach(() => {
  for (const at of trash.splice(0)) rmSync(at, { recursive: true, force: true })
})

function scratch(): string {
  const at = mkdtempSync(join(tmpdir(), 'b2-scope-'))
  trash.push(at)
  return at
}

describe('the layer a provider-reported file belongs to (356 §3)', () => {
  const HOME = '/homes/default/codex'
  const CWD = '/work/checkout/apps/web'

  it('⛔ a file in the provider home is the PROFILE’s', () => {
    expect(
      instructionScope('/homes/default/codex/AGENTS.md', { providerHome: HOME, cwd: CWD }),
    ).toBe('profile')
  })

  it('⛔ a file at the cwd is the PROJECT’s', () => {
    expect(
      instructionScope('/work/checkout/apps/web/AGENTS.md', { providerHome: HOME, cwd: CWD }),
    ).toBe('project')
  })

  it('⛔ …and so is one at an ANCESTOR of the cwd — the chain is walked root-to-cwd', () => {
    // This is the case a naive `startsWith(cwd)` gets wrong: the project root's file does not
    // contain the cwd as a prefix, it is the other way round.
    expect(instructionScope('/work/checkout/AGENTS.md', { providerHome: HOME, cwd: CWD })).toBe(
      'project',
    )
  })

  it('⛔ a file BELOW the cwd is neither — nothing walks downward', () => {
    // ⚠️ The divergence a prefix test cannot see: `/work/checkout/apps/web/deep/AGENTS.md` shares
    // every character of the cwd and is not on the chain. Labelling it `project` would tell a reader
    // that a file which applies to a subdirectory applies here.
    expect(
      instructionScope('/work/checkout/apps/web/deep/AGENTS.md', { providerHome: HOME, cwd: CWD }),
    ).toBe('unknown')
  })

  it('⛔ a sibling directory that merely SHARES A PREFIX with the home is not the profile’s', () => {
    // `/homes/default/codex-old` starts with `/homes/default/codex`. Without the separator this
    // would read as the profile's own file, on a home that was renamed rather than moved.
    expect(
      instructionScope('/homes/default/codex-old/AGENTS.md', { providerHome: HOME, cwd: CWD }),
    ).toBe('unknown')
  })

  it('⛔ …and a sibling of the CWD is not the project’s either', () => {
    expect(
      instructionScope('/work/checkout/apps/website/AGENTS.md', { providerHome: HOME, cwd: CWD }),
    ).toBe('unknown')
  })

  it('🔴 a home nested INSIDE the cwd answers profile, not project — the overlap case', () => {
    // Both readings are true of this path, so the answer is a ruling rather than an accident: a file
    // in the home is the profile's however the directories happen to be arranged. ⚠️ The paired
    // negative below is what makes this a measurement — the same fixture, one directory up.
    const nested = { providerHome: '/work/checkout/.brobot/codex', cwd: '/work/checkout' }
    expect(instructionScope('/work/checkout/.brobot/codex/AGENTS.md', nested)).toBe('profile')
    expect(instructionScope('/work/checkout/AGENTS.md', nested)).toBe('project')
  })

  it('⚑ a path outside both is `unknown`, and `unknown` is a real answer', () => {
    expect(instructionScope('/etc/AGENTS.md', { providerHome: HOME, cwd: CWD })).toBe('unknown')
  })

  it('⛔ an empty home or cwd claims nothing — and the fixture is where it can SEE that', () => {
    // 🔴 **Written against `process.cwd()` on purpose** (found reviewing this file). `resolve('')` is
    // the process's own working directory, so with the empty-string guards deleted an empty home
    // silently becomes *"the directory the test runner happens to be in"*. A fixture of synthetic
    // paths like `/anything/AGENTS.md` never lies under that directory, so it answers `unknown`
    // either way — and all three guards were lines no input in this file could make red.
    const here = process.cwd()
    const above = dirname(here)

    // With `if (root === '')` gone, this file IS inside the base and would read `profile`.
    expect(instructionScope(join(here, 'AGENTS.md'), { providerHome: '', cwd: CWD })).toBe(
      'unknown',
    )
    // With `if (cwd === '')` gone, the walk starts at `here` and `above` is on it — `project`.
    expect(instructionScope(join(above, 'AGENTS.md'), { providerHome: HOME, cwd: '' })).toBe(
      'unknown',
    )
    // With `if (path === '')` gone, the empty path resolves to `here`, whose parent is on the walk
    // up from a cwd that contains it — `project` again.
    expect(instructionScope('', { providerHome: HOME, cwd: here })).toBe('unknown')
    // …and the paired positive on the same three shapes, so this is three guards rather than a
    // function that answers `unknown` for everything.
    expect(instructionScope(join(here, 'AGENTS.md'), { providerHome: here, cwd: CWD })).toBe(
      'profile',
    )
    expect(instructionScope(join(above, 'AGENTS.md'), { providerHome: HOME, cwd: here })).toBe(
      'project',
    )
  })

  it('⚠️ case is compared exactly — a differently-spelled home claims nothing', () => {
    // On APFS these name one directory and `realpath` does not canonicalise case, so the two
    // spellings really do both occur. Failing toward `unknown` is a sentence the panel can print;
    // case-folding would make the label depend on the volume the app happens to be installed on.
    expect(
      instructionScope('/HOMES/default/codex/AGENTS.md', { providerHome: HOME, cwd: CWD }),
    ).toBe('unknown')
  })
})

describe('reading one file the provider reported (356 §2)', () => {
  it('⛔ reads the row the caller named, and reports the path the PROVIDER gave', () => {
    const at = scratch()
    const file = join(at, 'AGENTS.md')
    writeFileSync(file, '# Project instructions\n\nBe brief.\n')

    const read = readInstructionSource(['/nowhere/AGENTS.md', file], 1)

    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.text).toContain('Be brief.')
    expect(read.path).toBe(file)
    expect(read.name).toBe('AGENTS.md')
    expect(read.truncated).toBe(false)
  })

  it('⛔ refuses a row the provider never reported — the confinement, not a range check', () => {
    const at = scratch()
    const file = join(at, 'AGENTS.md')
    writeFileSync(file, 'x')

    // The file is real and readable, and the list does not contain it: an index past the end is a
    // refusal rather than a read of whatever happens to be nearby.
    expect(readInstructionSource([file], 1)).toEqual({ ok: false, reason: 'no-source' })
    expect(readInstructionSource([file], -1)).toEqual({ ok: false, reason: 'no-source' })
    expect(readInstructionSource([file], 1.5)).toEqual({ ok: false, reason: 'no-source' })
    expect(readInstructionSource([], 0)).toEqual({ ok: false, reason: 'no-source' })
    // …and the paired positive on the same fixture, so the four above are refusals rather than a
    // reader that cannot open anything.
    expect(readInstructionSource([file], 0).ok).toBe(true)
  })

  it('⛔ …and a row whose path is the EMPTY STRING is a refusal, not a read of the directory', () => {
    // ⚠️ **The one input that is not `undefined` and still names no file.** Every other bad index
    // reads `undefined` off the array and is caught by the same clause; this one arrives as a real
    // string, and without the second half of that guard it reaches `realPathOf` — which answers
    // `not-readable` for a relative path, a DIFFERENT sentence about a row that does not exist.
    expect(readInstructionSource([''], 0)).toEqual({ ok: false, reason: 'no-source' })
  })

  it('🔴 731 · reads a text file the PROVIDER put on the list, `auth.json` included (R92)', () => {
    // ⛔ On `main` both were refused `not-readable`: a Markdown-only allow-list kept a credential off
    // the screen on a provider's say-so. The PM, ruling on `726` §9: *"a text viewer opens any
    // readable text file a person names, `auth.json` included."* ⚠️ Planted text, never a credential.
    const at = scratch()
    const credential = join(at, 'auth.json')
    writeFileSync(credential, '{"OPENAI_API_KEY":"sk-not-a-real-key"}')
    const config = join(at, 'config.toml')
    writeFileSync(config, 'model = "gpt-5"\n')

    expect(readInstructionSource([credential], 0)).toMatchObject({
      ok: true,
      name: 'auth.json',
      text: '{"OPENAI_API_KEY":"sk-not-a-real-key"}',
    })
    expect(readInstructionSource([config], 0)).toMatchObject({
      ok: true,
      text: 'model = "gpt-5"\n',
    })
  })

  it('🔴 731 · …and a Markdown NAME that lands on one is read where it lands', () => {
    // ⛔ On `main` the check ran on the real path to refuse exactly this.
    const at = scratch()
    const credential = join(at, 'auth.json')
    writeFileSync(credential, '{"OPENAI_API_KEY":"sk-not-a-real-key"}')
    const link = join(at, 'AGENTS.md')
    symlinkSync(credential, link)

    expect(readInstructionSource([link], 0)).toMatchObject({ ok: true, path: link })
  })

  it('🔴 731 · a binary is refused, whatever it is called and wherever a link lands', () => {
    // ⛔ On `main` a binary NAMED `AGENTS.md` was read and drawn: the list asked the name, never the
    // bytes. The one type check left (`731`) is that a binary cannot be drawn as text.
    const at = scratch()
    const binary = join(at, 'AGENTS.md')
    writeFileSync(binary, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]))
    expect(readInstructionSource([binary], 0)).toEqual({ ok: false, reason: 'not-readable' })
    const link = join(at, 'CLAUDE.md')
    symlinkSync(binary, link)
    expect(readInstructionSource([link], 0)).toEqual({ ok: false, reason: 'not-readable' })
  })

  it('⚑ THE CONTROL — an image under an image’s name is not drawn as text, on either tree', () => {
    const at = scratch()
    const png = join(at, 'diagram.png')
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]))
    expect(readInstructionSource([png], 0)).toEqual({ ok: false, reason: 'not-readable' })
  })

  it('⚑ …but a link that lands on a real Markdown file is read, and reported at the name given', () => {
    // The paired positive: the rule above is about where a link LANDS, not about links.
    const at = scratch()
    const real = join(at, 'real.md')
    writeFileSync(real, 'planted\n')
    const link = join(at, 'AGENTS.md')
    symlinkSync(real, link)

    const read = readInstructionSource([link], 0)

    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.text).toBe('planted\n')
    // The row that was pressed, not where the link went — the viewer's toolbar has to agree with it.
    expect(read.path).toBe(link)
  })

  it('⚠️ a file the provider loaded and something has since removed is `gone`', () => {
    const at = scratch()
    expect(readInstructionSource([join(at, 'AGENTS.md')], 0)).toEqual({ ok: false, reason: 'gone' })
  })

  it('⚠️ a directory named like a document is not one', () => {
    const at = scratch()
    const dir = join(at, 'AGENTS.md')
    mkdirSync(dir)

    expect(readInstructionSource([dir], 0)).toEqual({ ok: false, reason: 'not-readable' })
  })

  it('⚑ a file past the ceiling comes back cut, and SAYS its real size', () => {
    const at = scratch()
    const file = join(at, 'AGENTS.md')
    // 512 KiB is the cap; one byte over it is the boundary this pins. ⛔ Written as the literal
    // rather than as `MAX_INSTRUCTION_BYTES + 1`, which would move with the constant and pin nothing.
    const bytes = 512 * 1024 + 1
    writeFileSync(file, 'a'.repeat(bytes))

    const read = readInstructionSource([file], 0)

    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.truncated).toBe(true)
    expect(read.bytes).toBe(bytes)
    expect(read.text.length).toBe(512 * 1024)
  })
})

describe('the surface that describes a profile says one thing (167 §4, 356, narrowed by 417)', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const read = (name: string): string =>
    readFileSync(join(here, `../src/renderer/src/components/${name}`), 'utf8')

  /**
   * 🔴 **The launcher and the drawer named the same three things, in the same words — and since
   * `417` only the drawer names them at all** (see the 417 section at the foot of this block).
   *
   * 167 §4 aligned them and `032` is the rule: two surfaces describing one boundary differently is
   * the drift. ⛔ **356 corrected BOTH in one commit**, because a correction on one alone re-opens
   * that drift wearing the opposite sign — and the correction was needed: `CLAUDE.md` is one
   * provider's filename and it was stated for both, while 357 established this app authors neither
   * leaf. The sentence now names the THING.
   *
   * ## 🔴 384 changed what this file can ask, and it is a stronger question
   *
   * ⚠️ **The census used to say why it was a census:** *"the launcher's sentence is a module-local
   * constant in `<script setup>` — nothing imports it, and a browser test cannot read the file. What
   * is checked is that neither surface can be edited alone."* ⛔ **That was a workaround for a
   * missing module, and 384 §1.1 removed the reason** — {@link PROFILE_OWNS} is now importable, so
   * the wording is asserted ON THE CONSTANT and the surfaces are asserted to RENDER it.
   *
   * ⚑ **"Neither can be edited alone" becomes "there is nothing to edit twice"**, which is the
   * guarantee 032 actually wanted: a drift needs two strings, and the census below is what proves
   * there is one.
   *
   * ## ⚑ 417 (HO-022 §2) left ONE renderer, and that is why the census below did not go with it
   *
   * ⛔ **The launcher stopped describing a profile at all.** *"Opening a new conversation opens a
   * conversation with BroBot. That is all."* — the profile picker, its `+ New profile…` row and the
   * `profile-owns` note beneath them were removed together, so `NewConversation.vue` no longer
   * imports or interpolates {@link PROFILE_OWNS}. The positive half of the render assertion is
   * therefore `SessionInfo.vue`'s alone.
   *
   * ⚠️ **The two NEGATIVES below still read both files, deliberately.** 032's rule is about a
   * second STRING, not about a second component, and the shape a hurried removal takes is dropping
   * the import and leaving the sentence inline — so *"no surface holds it as a literal"* and *"no
   * surface names one provider's filename"* are asked of the launcher exactly as before. What was
   * a pair of surfaces agreeing is now one surface rendering and one surface silent, and silence is
   * a thing this file can still check.
   */
  const THREE_THINGS = [
    'the conversations it runs there',
    'its own instruction file',
    'and what it remembers',
    'every folder it works in',
  ]

  it('⛔ the constant names all three, and does not name one provider’s filename', () => {
    for (const thing of THREE_THINGS) expect(PROFILE_OWNS, thing).toContain(thing)
    expect(PROFILE_OWNS).not.toContain('CLAUDE.md')
    expect(PROFILE_OWNS).not.toContain('AGENTS.md')
  })

  it('⛔ …and the surface that says it renders THAT string rather than a copy of it', () => {
    // ⚑ **`NewConversation.vue` was the other half of this loop until 417** (HO-022 §2): it
    // imported `PROFILE_OWNS` and interpolated it under the profile picker. Picker and note went
    // together, so the file has nothing to render and asking it for `{{ PROFILE_OWNS }}` would be
    // asking for a sentence the product deliberately stopped showing there. ⛔ **The RULE — one
    // string, rendered, never retyped — is untouched, and the two negatives below keep the
    // launcher inside it.**
    for (const file of ['SessionInfo.vue']) {
      expect(read(file), `${file} does not interpolate the constant`).toContain(
        '{{ PROFILE_OWNS }}',
      )
      expect(read(file), `${file} does not import it`).toMatch(
        /import \{[^}]*PROFILE_OWNS[^}]*\} from '\.\.\/lib\/profile-words'/,
      )
    }
    // ⚑ **The paired absence, so the removal is a decision rather than a gap nobody noticed.** If
    // the launcher ever describes a profile again it must do it from the constant, and this line
    // is what makes putting the sentence back a visible act.
    expect(
      read('NewConversation.vue'),
      'the launcher describes a profile again — render PROFILE_OWNS, and put it back in the loop above',
    ).not.toContain('{{ PROFILE_OWNS }}')
  })

  /**
   * 🔴 **The census, and the reason it counts rather than asks.**
   *
   * ⛔ **A `toContain` finds the first copy and is blind to a second** — standing rule 12, and the
   * defect it names has landed twice this month. So this counts every occurrence in the RENDERED
   * text of every renderer file, and the number it may be is zero: the constant lives in `lib/`, so
   * a surface holding the sentence as a literal is by definition a second string.
   *
   * ⚠️ **The control plants TWO**, in two different files, because a counter that stopped at one
   * would pass a planted pair exactly the way it would pass the defect.
   */
  const rendered = (source: string): string =>
    source
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s+/g, ' ')

  const OPENING = 'A profile is an agent’s own home:'

  const copiesIn = (sources: readonly string[]): number =>
    sources.reduce((total, source) => total + rendered(source).split(OPENING).length - 1, 0)

  it('🔴 …and no surface in the app holds the sentence as a literal', () => {
    const surfaces = ['NewConversation.vue', 'SessionInfo.vue'].map(read)

    expect(
      copiesIn(surfaces),
      'a surface types the profile sentence out instead of rendering it',
    ).toBe(0)

    // ⛔ **The control, planting TWO** — one copy per file, so a counter that returned after its
    // first hit would report 1 and this would catch it.
    expect(copiesIn(surfaces.map((source) => `${source}\n<p>${OPENING} …</p>`))).toBe(2)
    // …and the stripper leaves rendered text alone, so the zero above is not the comment-stripper
    // eating the whole file.
    expect(rendered(read('SessionInfo.vue'))).toContain('{{ PROFILE_OWNS }}')
  })

  it('🔴 …and neither of them tells half the users the wrong filename to create', () => {
    // ⚠️ **The RENDERED strings only** — both files reason about `CLAUDE.md` in comments, and the
    // comments are where that reasoning belongs. Stripping them is what makes this a claim about
    // what a person reads rather than about what a developer wrote.
    expect(rendered(read('NewConversation.vue'))).not.toContain('its own CLAUDE.md')
    expect(rendered(read('SessionInfo.vue'))).not.toContain('its own CLAUDE.md')
  })
})
