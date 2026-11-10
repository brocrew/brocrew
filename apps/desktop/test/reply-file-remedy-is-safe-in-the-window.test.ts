import { describe, expect, it } from 'vitest'
import { replyUnkeptFileReason } from '../src/main/runtime/reply-rails'

describe('reply file guidance', () => {
  it.each([
    ['/folder.with.dot/run.ZSH', 'a .zsh file'],
    ['/folder.zsh/plain', 'a file of an unrecognised kind'],
    ['/folder.zsh/.zsh', 'a file of an unrecognised kind'],
    ['/folder/.script.zsh', 'a .zsh file'],
    ['/folder/notes.ts', 'a .ts file'],
    ['/folder/file.PRIVATE_EXTENSION', 'a file of an unrecognised kind'],
    ['/folder/report.', 'a file of an unrecognised kind'],
    [undefined, 'a file of an unrecognised kind'],
    [42, 'a file of an unrecognised kind'],
  ])('only the final file segment determines the fixed kind: %s', (path, kind) => {
    const reason = replyUnkeptFileReason(path)
    expect(reason).toContain(`This app does not keep ${kind}.`)
    expect(reason).not.toContain('PRIVATE_EXTENSION')
    expect(reason).not.toContain('/folder')
  })
})
