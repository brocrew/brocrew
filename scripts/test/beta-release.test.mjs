import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { notesOf, platformsOf, titleOf } from '../beta-release.mjs'

/**
 * 🔴 **W4.96 — what a beta tester reads on a build's release page, written once for both builds.**
 *
 *  - §1 · a tag names its platforms, and `beta-N` names both — one prerelease, the same words from
 *    whichever job made it.
 *  - §2 · the words: how to get past each system's warning, how to sign in, and where the Mac's data
 *    is — the steps `docs/install-windows.md` and `docs/install-macos.md` give at length.
 *  - §3 · both workflows publish through it, on the tags that name them.
 */

const here = dirname(fileURLToPath(import.meta.url))
const workflow = (name) => readFileSync(join(here, '../../.github/workflows', name), 'utf8')

describe('§1 · a tag names its platforms', () => {
  it('🔴 windows-beta-N, mac-beta-N, and beta-N for both', () => {
    expect(platformsOf('windows-beta-4')).toEqual(['windows'])
    expect(platformsOf('mac-beta-1')).toEqual(['mac'])
    expect(platformsOf('beta-1')).toEqual(['windows', 'mac'])
    expect(titleOf('mac-beta-1')).toBe('BroCrew — macOS beta (mac-beta-1)')
    expect(titleOf('windows-beta-4')).toBe('BroCrew — Windows beta (windows-beta-4)')
    expect(titleOf('beta-1')).toBe('BroCrew — beta (beta-1)')
  })

  it('⛔ a tag that names no platform is refused, not published with words for nothing', () => {
    for (const tag of ['v1', 'dev-latest', 'mac-beta', 'windows-beta-', 'beta-1 x']) {
      expect(() => platformsOf(tag), tag).toThrow(/names no beta platform/)
    }
  })
})

describe('§2 · the words', () => {
  it('🔴 the Mac: Open Anyway in Privacy & Security, the quarantine fallback, and the shared data folder', () => {
    const mac = notesOf('mac-beta-1', '1a2b3c4')
    expect(mac).toContain('from commit 1a2b3c4 (tag mac-beta-1)')
    expect(mac).toContain('signed ad hoc and not notarized')
    expect(mac).toContain('Privacy & Security')
    expect(mac).toContain('Open Anyway')
    expect(mac).toContain('xattr -dr com.apple.quarantine /Applications/BroCrew.app')
    expect(mac).toContain('~/Library/Application Support/@brobot2/desktop')
    expect(mac).not.toContain('Windows')
  })

  it('⚑ Windows: SmartScreen, the BroBot and BroBot2 replacement, and the keys pages as they are today', () => {
    const win = notesOf('windows-beta-4', '1a2b3c4')
    expect(win).toContain('More info, then Run anyway')
    expect(win).toContain('Already have BroBot or BroBot2?')
    expect(win).toContain('platform.claude.com/settings/keys')
    expect(win).toContain('your Claude Code login on this PC')
    expect(win).not.toContain('console.anthropic.com')
    expect(win).not.toContain('macOS')
  })

  it('beta-N retains both platforms’ private sign-in steps and links the install pages', () => {
    const both = notesOf('beta-1', '1a2b3c4')
    expect(both).toContain('**Windows (x64):**')
    expect(both).toContain('**macOS (Apple silicon')
    expect(both).toContain('To sign in on Windows:')
    expect(both).toContain('To sign in on the Mac:')
    expect(both).toContain('`docs/install-windows.md`')
    expect(both).toContain('`docs/install-macos.md`')
  })

  it('public version tags require Claude Code first and describe only API keys', () => {
    for (const tag of ['v0.1.0', 'v0.1.1-beta.2']) {
      const notes = notesOf(tag, '1a2b3c4')
      expect(notes, tag).toContain('save an Anthropic API key on the Claude card')
      expect(notes, tag).toContain('Check it works')
      const install = notes.indexOf(
        'To use Claude, install Claude Code first, from Anthropic: https://code.claude.com/docs/en/setup. Codex comes with BroCrew.',
      )
      expect(install, tag).toBeGreaterThan(-1)
      expect(install, tag).toBeLessThan(notes.indexOf('To add your API keys:'))
      for (const word of ['login', 'To sign in', 'sign in to it', 'Claude plan', 'PowerShell']) {
        expect(notes, `${tag}: ${word}`).not.toContain(word)
      }
    }
  })

  it('⚑ with the repository known, each install page is linked at the build’s own commit', () => {
    expect(notesOf('v0.1.0', '1a2b3c4', 'example/brobot')).toContain(
      'macOS, https://github.com/example/brobot/blob/1a2b3c4/docs/install-macos.md.',
    )
  })
  it('private beta tags retain each platform’s login instructions', () => {
    expect(notesOf('windows-beta-4', '1a2b3c4')).toContain('your Claude Code login on this PC')
    expect(notesOf('mac-beta-1', '1a2b3c4')).toContain(
      'the Claude and Codex logins already on the Mac',
    )
    expect(notesOf('beta-1', '1a2b3c4')).toContain('the account the key or login belongs to')
  })

  it('public install pages require Claude Code before keys and keep the renamed paths', () => {
    for (const platform of ['macos', 'windows']) {
      const path = join(here, '../../docs', `install-${platform}.md`)
      const page = readFileSync(path, 'utf8')
      expect(page.indexOf('Install Claude Code first')).toBeGreaterThan(-1)
      expect(page.indexOf('Install Claude Code first')).toBeLessThan(page.indexOf('An API key'))
      expect(page).toContain('https://code.claude.com/docs/en/setup')
      expect(page).toContain('No Anthropic API key is set')
      expect(page).toContain('BroCrew found no Claude Code where its installers put it')
      // The Mac's own login password, asked for by the Keychain, is not a Claude login.
      expect(page).not.toMatch(/sign.in|login(?! password)|Pro or Max|CLAUDE_CODE_OAUTH_TOKEN/i)
      expect(existsSync(join(here, '../../docs', `${platform}-beta.md`))).toBe(false)
    }
    expect(existsSync(join(here, '../../docs/claude-login-token.md'))).toBe(false)
  })
})

describe('§3 · both workflows publish through it, on the tags that name them', () => {
  it('🔴 each takes its own tag and beta-*, and publishes or adds to the one prerelease', () => {
    const tags = {
      'windows.yml': "tags: ['windows-beta-*', 'beta-*']",
      'macos.yml': "tags: ['mac-beta-*', 'beta-*']",
    }
    for (const [name, line] of Object.entries(tags)) {
      const text = workflow(name)
      expect(text, name).toContain(line)
      expect(text, name).toContain("startsWith(github.ref, 'refs/tags/beta-')")
      expect(text, name).toContain('node scripts/beta-release.mjs title "$GITHUB_REF_NAME"')
      // ⚑ The release with no file, then the file: a `beta-*` tag's two jobs never race on a draft.
      expect(text, name).toContain(
        'gh release create "$GITHUB_REF_NAME" --repo "$GITHUB_REPOSITORY"',
      )
      expect(text, name).toContain('gh release view "$GITHUB_REF_NAME"')
      expect(text, name).toContain('gh release upload "$GITHUB_REF_NAME"')
      expect(text, name).toContain('--verify-tag')
    }
  })

  it('⚑ the Mac build signs ad hoc and is checked before it is published', () => {
    const mac = workflow('macos.yml')
    expect(mac).toContain('run: pnpm --filter @brobot2/desktop package:mac-beta')
    expect(mac).toMatch(
      /run: node scripts\/macos-packaged-check\.mjs apps\/desktop\/dist\/mac-arm64\/BroCrew\.app /,
    )
    const pkg = JSON.parse(readFileSync(join(here, '../../apps/desktop/package.json'), 'utf8'))
    expect(pkg.scripts['package:mac-beta']).toMatch(/ -c\.mac\.identity=-$/)
    // ⛔ A person's own `pnpm run package` keeps whatever identity their Mac has.
    expect(pkg.scripts.package).not.toContain('identity')
  })
})
