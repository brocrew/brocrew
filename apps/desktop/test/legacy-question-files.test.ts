import { expect, it } from 'vitest'
import { legacyQuestionFiles } from '../src/renderer/src/lib/legacy-question-files'

it('recovers the old overflow file and named attachments from the generated suffix', () => {
  const overflow = 'res_' + 'a'.repeat(32)
  const first = 'res_' + 'b'.repeat(32)
  const second = 'res_' + 'c'.repeat(32)
  const text = 'Which draft?\n\nKeep the original words.'
  const saved =
    `${text} The full text is attached as ${overflow}: read it with read_document.\n\n` +
    `Read first draft.md with read_document using ${first}.\n` +
    `Read second draft.md with read_document using ${second}.`
  expect(legacyQuestionFiles(saved)).toEqual({
    text,
    files: [
      { name: 'question.txt', resource: overflow },
      { name: 'first draft.md', resource: first },
      { name: 'second draft.md', resource: second },
    ],
  })
  expect(legacyQuestionFiles(`${saved}\n\nQuoted above for reference.`)).toEqual({
    text: `${saved}\n\nQuoted above for reference.`,
    files: [],
  })
})

it('keeps a to-do’s own words when the old pointer names no file on it', () => {
  const resource = 'res_' + 'a'.repeat(32)
  const text = 'Review the draft.'
  const saved = `${text} The full text is attached as ${resource}: read it with read_document.`
  expect(legacyQuestionFiles(saved, [])).toEqual({ text: saved, files: [] })
  const files = [{ resource, name: 'action.txt' }]
  expect(legacyQuestionFiles(saved, files)).toEqual({ text, files })
})

it('recovers both historical taskless paths and keeps similar authored prose', () => {
  const text = 'Which draft?'
  const leaf = 'brocrew-12345678-1234-4123-8123-123456789abc-'
  const overflow = `C:\\Project folder\\${leaf}question.txt`
  const file = `/work/a draft/${leaf}draft 1.2.md`
  const saved = `${text} The full text is saved at ${overflow}: read the file.\n\nRead the file ${file}.`
  expect(legacyQuestionFiles(saved)).toEqual({
    text,
    files: [
      { path: overflow, name: 'question.txt' },
      { path: file, name: 'draft 1.2.md' },
    ],
  })
  const prose = `${text}\n\nRead the file /work/a draft/draft 1.2.md.`
  expect(legacyQuestionFiles(prose)).toEqual({ text: prose, files: [] })
})
