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
  'two-groups': "Two groups have this name. Use the group's id from list_groups.",
  'file-type': "This file can't be sent: its type isn't allowed.",
  'no-media': 'This message has no photo or PDF up to 25 MB.',
  busy: 'Plugin busy. Try again.',
})
export type RefusalCode = keyof typeof REFUSALS | 'file'

/** The file line names the folder an agent can put files in. */
export const fileRefusal = (folder: string): string =>
  `Only files in ${folder} can be sent, up to 100 MB.`

export function createRefusal(files: string) {
  return (code: RefusalCode): PublicToolError =>
    new PublicToolError(code === 'file' ? fileRefusal(files) : REFUSALS[code])
}
