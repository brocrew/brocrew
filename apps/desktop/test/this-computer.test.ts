import { describe, expect, it } from 'vitest'
import { binWord, chordKeys, chordSaid } from '../src/renderer/src/lib/this-computer'

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
})
