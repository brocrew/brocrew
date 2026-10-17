import { describe, expect, it } from 'vitest'
import { pathTail } from '../src/shared/path-tail'
import { basenameOf } from '../src/renderer/src/lib/paths'

describe('the last named parts of a path', () => {
  it('reads POSIX and Windows separators, including a trailing separator', () => {
    expect(pathTail('/work/picture.png')).toBe('picture.png')
    expect(pathTail('C:\\work\\picture.png')).toBe('picture.png')
    expect(pathTail('C:/work\\picture.png\\')).toBe('picture.png')
    expect(pathTail('/work/picture.png/')).toBe('picture.png')
    expect(basenameOf('C:\\work\\picture.png')).toBe('picture.png')
  })

  it('names a drive root and preserves the two-part names that disambiguate files', () => {
    expect(pathTail('C:\\')).toBe('C:')
    expect(pathTail('/')).toBe('')
    expect(pathTail('C:\\alpha\\notes.md', 2)).toBe('alpha/notes.md')
  })
})
