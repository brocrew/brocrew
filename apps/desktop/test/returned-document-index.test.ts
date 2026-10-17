import { describe, expect, it } from 'vitest'
import { returnedDocumentIndex } from '../src/main/resources/returned-document-index'

describe('the returned main document names a path, not a spelling', () => {
  it('accepts Windows slash and case variants and selects the listed document', () => {
    expect(
      returnedDocumentIndex(
        'C:\\work',
        ['C:\\work\\notes.md', 'C:\\work\\reports\\RESULT.md'],
        'c:/Work/reports/result.md',
        'win32',
      ),
    ).toBe(1)
  })

  it('resolves relative Windows spellings in the recorded folder', () => {
    expect(
      returnedDocumentIndex(
        'C:\\work',
        ['C:\\work\\reports\\result.md'],
        'reports/./draft/../result.md',
        'win32',
      ),
    ).toBe(0)
  })

  it('preserves the explicitly named copy when several spellings resolve to one path', () => {
    expect(
      returnedDocumentIndex(
        'C:\\work',
        ['C:\\work\\result.md', 'c:/work/result.md'],
        'c:/work/result.md',
        'win32',
      ),
    ).toBe(1)
  })

  it('does not admit a Windows sibling, prefix neighbour or another drive', () => {
    for (const document of [
      'C:/work/other/result.md',
      'C:/work/reports/result.md.bak',
      'D:/work/reports/result.md',
    ]) {
      expect(
        returnedDocumentIndex('C:\\work', ['C:\\work\\reports\\result.md'], document, 'win32'),
      ).toBe(-1)
    }
  })

  it('refuses drive-relative paths whose drive differs from the recorded folder, even when exact', () => {
    for (const document of ['D:result.md', 'D:']) {
      expect(returnedDocumentIndex('C:\\work', [document], document, 'win32')).toBe(-1)
      expect(returnedDocumentIndex('C:\\work', [document], 'D:/result.md', 'win32')).toBe(-1)
    }
    expect(returnedDocumentIndex('C:\\work', ['C:\\work\\result.md'], 'C:result.md', 'win32')).toBe(
      0,
    )
  })

  it('keeps POSIX paths case sensitive while resolving relative spelling', () => {
    expect(returnedDocumentIndex('/work', ['/work/result.md'], './result.md', 'linux')).toBe(0)
    expect(returnedDocumentIndex('/work', ['/work/result.md'], 'RESULT.md', 'linux')).toBe(-1)
  })

  it('keeps the old exact admission when no recorded folder is available', () => {
    expect(returnedDocumentIndex(null, ['result.md'], 'result.md', 'linux')).toBe(0)
    expect(returnedDocumentIndex(null, ['result.md'], './result.md', 'linux')).toBe(-1)
  })
})
