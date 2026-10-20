import fs from 'node:fs'
import path from 'node:path'
import { PublicToolError } from './shared/toolServer.js'

export const REFUSALS = Object.freeze({
  'read-off':
    'Reading WhatsApp is turned off. The person can turn on Read conversations in Settings → Plugins → WhatsApp.',
  'cannot-write':
    "You can't write to this group. Use list_groups to see the groups you can write to.",
  'not-linked':
    "WhatsApp isn't linked. The person can link a phone in Settings → Plugins → WhatsApp.",
  'too-many': 'Too many messages. Try again in a few minutes.',
  duplicate: 'This message was already sent to this group in the last hour.',
  'too-long': 'Too long: at most 4,000 characters.',
  'caption-too-long': 'Too long: at most 1,000 characters.',
  'two-groups': "Two groups have this name. Use the group's id from list_groups.",
  'file-type': "This file can't be sent: its type isn't allowed.",
  'no-media': 'This message has no photo or PDF up to 25 MB.',
  busy: 'Plugin busy. Try again.',
})
export type RefusalCode = keyof typeof REFUSALS | 'file'

/** The file line names the folder an agent can put files in. */
export const fileRefusal = (folder: string): string =>
  `Only files in ${folder} can be sent, up to 100 MB.`

const LOG_BYTES = 1024 * 1024

/**
 * Every refused call is written to refusals.jsonl in the plugin's private root: when, which tool and
 * which rule, never what was asked. The log keeps about the last megabyte.
 */
export function createRefusals(home: string, files: string, now: () => Date = () => new Date()) {
  const file = path.join(home, 'refusals.jsonl')
  const record = (tool: string, code: RefusalCode): void => {
    try {
      const size = fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0
      if (size > LOG_BYTES) fs.renameSync(file, path.join(home, 'refusals.1.jsonl'))
      fs.appendFileSync(
        file,
        JSON.stringify({ at: now().toISOString(), tool, refused: code }) + '\n',
        { mode: 0o600 },
      )
    } catch {
      // A log that cannot be written never turns a refusal into a different answer.
    }
  }
  return {
    record,
    /** Logs the refusal and returns the error whose words the agent reads. */
    refuse(tool: string, code: RefusalCode): PublicToolError {
      record(tool, code)
      return new PublicToolError(code === 'file' ? fileRefusal(files) : REFUSALS[code])
    },
  }
}
export type Refusals = ReturnType<typeof createRefusals>
