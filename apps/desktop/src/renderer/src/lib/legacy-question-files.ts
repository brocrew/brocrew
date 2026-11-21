import type { ActionFile, QuestionFiles } from '../../../shared/question-contracts'

function tasklessFile(path: string): QuestionFiles[number] | null {
  if (!/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(path)) return null
  const basename = path.split(/[\\/]/).at(-1) ?? ''
  const name = /^brocrew-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}-(.+)$/u.exec(basename)?.[1]
  return name === undefined ? null : { path, name }
}

function namedFile(line: string, known: readonly ActionFile[] | undefined) {
  const resource = /^Read (.+) with read_document using (res_[a-f0-9]{32})\.$/u.exec(line)
  if (resource?.[1] !== undefined && resource[2] !== undefined) {
    const file = { name: resource[1], resource: resource[2] }
    return known && !known.some((one) => one.resource === file.resource && one.name === file.name)
      ? null
      : file
  }
  const path = /^Read the file (.+)\.$/u.exec(line)?.[1]
  return path === undefined || known ? null : tasklessFile(path)
}

/** Read only the attachment suffixes emitted before display words were stored separately. */
export function legacyQuestionFiles(
  text: string,
  known?: readonly ActionFile[],
): { text: string; files: QuestionFiles } {
  const files: QuestionFiles[number][] = []
  const separator = text.lastIndexOf('\n\n')
  if (separator >= 0) {
    const named = text
      .slice(separator + 2)
      .split('\n')
      .map((line) => namedFile(line, known))
    if (named.every((file) => file !== null)) {
      files.push(...named)
      text = text.slice(0, separator)
    }
  }

  const overflow =
    / The full text is attached as (res_[a-f0-9]{32}): read it with read_document\.$/u.exec(text)
  if (overflow?.[1] !== undefined) {
    const resource = overflow[1]
    const file = known?.find((one) => one.resource === resource)
    if (file || !known) {
      files.unshift(file ?? { name: 'question.txt', resource })
      text = text.slice(0, overflow.index)
    }
  }
  if (!known) {
    const saved = / The full text is saved at (.+): read the file\.$/u.exec(text)
    if (saved?.[1] !== undefined) {
      const file = tasklessFile(saved[1])
      if (file?.name === 'question.txt') {
        files.unshift(file)
        text = text.slice(0, saved.index)
      }
    }
  }
  return { text, files }
}
