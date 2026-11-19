import { newResourceId } from '../db/ids'
import type { GivenInput } from '../../shared/documents'
import {
  keepResource,
  refuseResource,
  sha256Hex,
  type ResourceRefusal,
} from '../resources/resources'
import { WORK_BRIEF_CHARS } from '../../shared/work-fields'

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
  if (text.length <= WORK_BRIEF_CHARS) return { ok: true, inline: text, overflow: null }
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
    inline: text
      .trimStart()
      .slice(0, WORK_BRIEF_CHARS)
      .replace(/[\uD800-\uDBFF]$/, ''),
    overflow: {
      field,
      characters: text.length,
      file: { resource: newResourceId(), name, title: name, sha256, bytes: bytes.length },
    },
  }
}

export function sendOverflowSaid(overflow: SendOverflow): string {
  const { field, characters, file } = overflow
  return ` Your ${field} was ${characters.toLocaleString('en-US')} characters, so the full text is attached as ${file.name} (${file.resource}).`
}
