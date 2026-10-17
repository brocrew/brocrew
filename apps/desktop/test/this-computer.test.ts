import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { binWord, chordKeys, chordSaid } from '../src/renderer/src/lib/this-computer'

/**
 * A Windows PC is not called a Mac: the modifier key and where a deleted folder goes are worded for
 * the computer the window is on.
 */

const source = (name: string): string =>
  readFileSync(new URL(`../src/renderer/src/components/${name}`, import.meta.url), 'utf8')

describe('the words that differ between a Mac and a Windows PC', () => {
  it('🔴 a shortcut says ⌘ on a Mac and Ctrl elsewhere', () => {
    expect(chordSaid('MacIntel', 'K')).toBe('⌘K')
    expect(chordSaid('Win32', 'K')).toBe('Ctrl+K')
    expect(chordKeys('MacIntel', 'N')).toBe('⌘ N')
    expect(chordKeys('Win32', 'N')).toBe('Ctrl N')
    expect(chordSaid('Linux x86_64', 'K')).toBe('Ctrl+K')
  })

  it('🔴 a deleted folder goes to the Recycle Bin on Windows and the Trash elsewhere', () => {
    expect(binWord('Win32')).toBe('Recycle Bin')
    expect(binWord('MacIntel')).toBe('Trash')
    expect(binWord('')).toBe('Trash')
  })

  it('⛔ no component of the window names ⌘, Finder or the Trash in words a person reads', () => {
    for (const name of [
      'SideRail.vue',
      'CommandPalette.vue',
      'AgentCard.vue',
      'KeptFileDrawing.vue',
      'CanonicalDocumentViewer.vue',
      'WorkspacesSection.vue',
      'SessionInfo.vue',
      'SessionInstructions.vue',
    ]) {
      // Comments say what they like; only the words drawn or said are checked.
      const said = source(name)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(said, name).not.toMatch(/⌘|\bFinder\b|\bTrash\b/)
    }
  })

  it('⚑ the palette’s refusal and the card’s folder button take their words from the helpers', () => {
    expect(source('CommandPalette.vue')).toContain("chordSaid(platformHere(), 'K')")
    expect(source('AgentCard.vue')).toContain(':title="showName(workspace.name, fileManager)"')
  })
})
