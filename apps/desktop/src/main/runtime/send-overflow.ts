import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { newResourceId } from '../db/ids'
import type { GivenInput } from '../../shared/documents'
import {
  keepResource,
  refuseResource,
  sha256Hex,
  type OfferedFile,
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
  const sha256 = sha256Hex(bytes)
  const kept = keepResource(root, { name, bytes, sha256 })
  if (!kept.ok) {
    return {
      ok: false,
      refusal: refuseResource('resource-could-not-be-kept', { path: name, problem: kept.problem }),
    }
  }
  return {
    ok: true,
    inline: overflowPreview(text),
    overflow: {
      field,
      characters: text.length,
      file: { resource: newResourceId(), name, title: name, sha256, bytes: bytes.length },
    },
  }
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

export function keepTasklessSendFiles(
  cwd: string,
  offered: readonly OfferedFile[],
): PreparedSendFiles {
  const files: { path: string; name: string }[] = []
  for (const { name, bytes } of offered) {
    const kept = writeTasklessFile(cwd, name, bytes)
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

export function keepTasklessSendText(cwd: string, field: string, text: string): PreparedSendText {
  const kept = writeTasklessFile(cwd, `${field.replaceAll('_', '-')}.txt`, text)
  if (!kept.ok) return kept
  const overflow = { field, characters: text.length, path: kept.path }
  return {
    ok: true,
    text: `${overflowPreview(text)} ${sendOverflowPointer(overflow)}`,
    overflow,
  }
}

function writeTasklessFile(
  cwd: string,
  name: string,
  body: string | Buffer,
):
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly refusal: ResourceRefusal } {
  const path = resolve(cwd, `brocrew-${randomUUID()}-${name}`)
  try {
    writeFileSync(path, body, { encoding: 'utf8', flag: 'wx' })
    return { ok: true, path }
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
