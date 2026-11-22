import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isOfferedLabel, type UserInputQuestion } from '@brobot2/runtime'
import { newResourceId } from '../db/ids'
import type { GivenInput } from '../../shared/documents'
import {
  keepResource,
  refuseResource,
  type OfferedFileBytes,
  type ResourceRefusal,
} from '../resources/resources'
import { WORK_BRIEF_CHARS } from '../../shared/work-fields'
import type { SendReceipt } from '../../shared/tool-outcome'

export const INLINE_TEXT_LIMIT = WORK_BRIEF_CHARS

export interface SendOverflow {
  readonly field: string
  readonly characters: number
  readonly file: GivenInput
}

/** Keep the complete text using the same bytes and input records as files a giver supplies. */
export function keepSendOverflow(
  root: string | undefined,
  field: string,
  text: string,
):
  | { readonly ok: true; readonly inline: string; readonly overflow: SendOverflow | null }
  | { readonly ok: false; readonly refusal: ResourceRefusal } {
  if (text.length <= INLINE_TEXT_LIMIT) return { ok: true, inline: text, overflow: null }
  if (root === undefined)
    return { ok: false, refusal: refuseResource('resource-store-unavailable') }

  const name = `${field.replaceAll('_', '-')}.txt`
  const bytes = Buffer.from(text, 'utf8')
  const kept = keepPlainSendFile(root, name, bytes)
  if (!kept.ok) return kept
  return {
    ok: true,
    inline: overflowPreview(text),
    overflow: {
      field,
      characters: text.length,
      file: { resource: newResourceId(), name, title: name, sha256: kept.key, bytes: bytes.length },
    },
  }
}

/** A task's inputs: the files its sender handed over, then each long field's kept file. */
export function inputsWithOverflow(
  files: readonly {
    readonly title: string
    readonly name: string
    readonly sha256: string
    readonly bytes: { readonly length: number }
  }[],
  overflow: readonly SendOverflow[],
): GivenInput[] {
  return [
    ...files.map((file) => ({
      resource: newResourceId(),
      title: file.title,
      name: file.name,
      sha256: file.sha256,
      bytes: file.bytes.length,
    })),
    ...overflow.map((one) => one.file),
  ]
}

interface OverflowOnDisk {
  readonly field: string
  readonly characters: number
  readonly path: string
}

export type ReadableSendOverflow = SendOverflow | OverflowOnDisk

export function sendOverflowAttachment(
  overflow: ReadableSendOverflow,
): SendReceipt['attachments'][number] {
  return 'path' in overflow
    ? { path: overflow.path, overflowField: overflow.field }
    : { resource: overflow.file.resource, name: overflow.file.name, overflowField: overflow.field }
}

function sendOverflowPointer(overflow: ReadableSendOverflow): string {
  return 'path' in overflow
    ? `The full text is saved at ${overflow.path}: read the file.`
    : resourcePointer(overflow.file.resource)
}

export type PreparedSendText =
  | { readonly ok: true; readonly text: string; readonly overflow?: ReadableSendOverflow }
  | { readonly ok: false; readonly refusal: ResourceRefusal }

export type PreparedSendFiles =
  | { readonly ok: true; readonly files: SendReceipt['attachments'] }
  | { readonly ok: false; readonly refusal: ResourceRefusal }

function keepSentResource(
  root: string,
  name: string,
  bytes: Buffer,
):
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly refusal: ResourceRefusal } {
  // Isolate sent files from task resource deletion and preserve case-only filename differences.
  const subdir = 'sent'
  const sha256 = createHash('sha256').update(name).update('\0').update(bytes).digest('hex')
  const path = resolve(root, subdir, sha256, name)
  const kept = keepResource(root, { sha256, name, bytes }, subdir)
  if (kept.ok) return { ok: true, path }
  return {
    ok: false,
    refusal: refuseResource('resource-could-not-be-kept', {
      path,
      problem: kept.cause ?? kept.problem,
    }),
  }
}

export function keepTasklessSendFiles(
  root: string,
  offered: readonly OfferedFileBytes[],
): PreparedSendFiles {
  const files: { path: string; name: string }[] = []
  for (const { name, bytes } of offered) {
    const kept = keepSentResource(root, name, bytes)
    if (!kept.ok) return kept
    files.push({ path: kept.path, name })
  }
  return { ok: true, files }
}

export function sendFilesSaid(files: SendReceipt['attachments']): string {
  if (files.length === 0) return ''
  return (
    '\n\n' +
    files
      .map((file) =>
        'path' in file
          ? `Read the file ${file.path}.`
          : `Read ${file.name} with read_document using ${file.resource}.`,
      )
      .join('\n')
  )
}

function overflowPreview(text: string): string {
  return previewOf(text.trimStart(), INLINE_TEXT_LIMIT)
}

function previewOf(text: string, limit: number): string {
  return text.slice(0, limit).replace(/[\uD800-\uDBFF]$/, '')
}

interface AnswerPart {
  readonly part: string
  readonly answer: readonly string[]
}

export function answerTextForFile(parts: readonly AnswerPart[]): string {
  const first = parts[0]
  if (parts.length === 1 && first?.answer.length === 1) return first.answer[0] ?? ''
  return parts.map(({ part, answer }) => `${part}: ${answer.join(', ')}`).join('\n')
}

export function answerPreview(
  parts: readonly AnswerPart[],
  questions: readonly UserInputQuestion[] | undefined,
  overflow: ReadableSendOverflow,
): readonly AnswerPart[] {
  const pointer = sendOverflowPointer(overflow)
  let remaining = INLINE_TEXT_LIMIT
  return parts.map(({ part, answer }) => {
    const question = questions?.find((one) => one.id === part)
    let pointed = false
    const shown: string[] = []
    for (const value of answer) {
      if (value === '' || (question !== undefined && isOfferedLabel(question, value))) {
        shown.push(value)
        continue
      }
      const preview = previewOf(value, remaining)
      remaining -= preview.length
      if (preview.length === value.length) shown.push(preview)
      else if (!pointed) {
        remaining = 0
        shown.push(preview === '' ? pointer : `${preview} ${pointer}`)
        pointed = true
      }
    }
    return { part, answer: shown }
  })
}

export function keepTasklessSendText(root: string, field: string, text: string): PreparedSendText {
  const kept = keepSentResource(
    root,
    `${field.replaceAll('_', '-')}.txt`,
    Buffer.from(text, 'utf8'),
  )
  if (!kept.ok) return kept
  const overflow = { field, characters: text.length, path: kept.path }
  return {
    ok: true,
    text: `${overflowPreview(text)} ${sendOverflowPointer(overflow)}`,
    overflow,
  }
}

export function keepPlainSendFile(
  root: string,
  name: string,
  body: Buffer,
):
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly refusal: ResourceRefusal } {
  // The existing resource row and reader take a 64-hex directory name.
  const key = randomBytes(32).toString('hex')
  const folder = resolve(root, key)
  const path = resolve(folder, name)
  try {
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    writeFileSync(path, body)
    return { ok: true, key }
  } catch (error) {
    return {
      ok: false,
      refusal: refuseResource('resource-could-not-be-kept', {
        path,
        problem: error instanceof Error ? error.message : String(error),
      }),
    }
  }
}

export function textWithOverflowResource(inline: string, resource: string | undefined): string {
  return resource === undefined ? inline : `${inline} ${resourcePointer(resource)}`
}

function resourcePointer(resource: string): string {
  return `The full text is attached as ${resource}: read it with read_document.`
}

export function sendOverflowSaid({ field, characters, file }: SendOverflow): string {
  return ` Your ${field} was ${characters.toLocaleString('en-US')} characters, so the full text is attached as ${file.name} (${file.resource}).`
}

export function outboundOverflowSaid(overflow: ReadableSendOverflow): string {
  const { field, characters } = overflow
  const place =
    'path' in overflow
      ? `saved at ${overflow.path}`
      : `attached as ${overflow.file.name} (${overflow.file.resource})`
  return ` Your ${field} was ${characters.toLocaleString('en-US')} characters, so the full text is ${place}; the message shows its start.`
}
