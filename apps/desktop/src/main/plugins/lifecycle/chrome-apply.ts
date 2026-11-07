import { z } from 'zod'
import type { PluginNodeReady } from '../node-host'
import { PluginSupervisorError } from '../supervisor/protocol'

const profile = z.string().regex(/^[a-z0-9-]{1,32}$/)
/** Durable changes understood by earlier owners; destructive page commands are never stored. */
export const ChromeLedgerProposal = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('create-profile'), profile }),
  z.strictObject({ action: z.literal('set-enabled'), profile, enabled: z.boolean() }),
  z.strictObject({ action: z.literal('open-window'), profile }),
])
export const ChromeProposal = z.union([
  ChromeLedgerProposal,
  z.strictObject({ action: z.literal('rename-profile'), profile, newName: z.string().max(4096) }),
  z
    .strictObject({
      action: z.literal('delete-profile'),
      profile,
      confirm: profile,
      deleteConfirmation: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
    })
    .refine((input) => input.confirm === input.profile),
  z.strictObject({ action: z.literal('helper-on'), profile }),
  z
    .strictObject({
      action: z.literal('set-flags'),
      profile,
      allowSync: z.boolean().optional(),
      allowExtensions: z.boolean().optional(),
      allowSettings: z.boolean().optional(),
    })
    .refine((value) =>
      [value.allowSync, value.allowExtensions, value.allowSettings].some(
        (flag) => flag !== undefined,
      ),
    ),
])
export type ChromeProposal = z.infer<typeof ChromeProposal>
/**
 * Record each live command's real prerequisite: a confirmed delete needs the profile off; turning
 * the helper on needs it enabled, and the plugin refuses otherwise. Neither is ever replayed.
 */
export function chromeProfileIntent(
  input: ChromeProposal,
): z.infer<typeof ChromeLedgerProposal> | null {
  const proposal = ChromeProposal.parse(input)
  if (
    proposal.action === 'set-flags' ||
    proposal.action === 'rename-profile' ||
    (proposal.action === 'delete-profile' && proposal.deleteConfirmation)
  )
    return null
  if (proposal.action === 'delete-profile')
    return { action: 'set-enabled', profile: proposal.profile, enabled: false }
  if (proposal.action === 'helper-on')
    return { action: 'set-enabled', profile: proposal.profile, enabled: true }
  return proposal
}
/** Fixed reviewed admin adapter. Neither routes, credentials nor arbitrary JSON come from the page. */
export async function applyChromeProfile(
  connection: PluginNodeReady,
  input: ChromeProposal,
  signal: AbortSignal,
): Promise<void> {
  const proposal = ChromeProposal.parse(input)
  const admin = connection.admin()
  let path: string, body: unknown
  switch (proposal.action) {
    case 'create-profile':
      path = '/profiles'
      body = { name: proposal.profile }
      break
    case 'set-enabled':
      path = '/profiles/' + proposal.profile + '/flags'
      body = { enabled: proposal.enabled }
      break
    case 'open-window':
      path = '/profiles/' + proposal.profile + '/open'
      body = {}
      break
    case 'delete-profile':
      path = '/profiles/' + proposal.profile + '/delete'
      body = {
        confirm: proposal.profile,
        ...(proposal.deleteConfirmation ? { deleteConfirmation: proposal.deleteConfirmation } : {}),
      }
      break
    case 'set-flags': {
      path = '/profiles/' + proposal.profile + '/flags'
      body = {
        ...(proposal.allowSync !== undefined ? { allowSync: proposal.allowSync } : {}),
        ...(proposal.allowExtensions !== undefined
          ? { allowExtensions: proposal.allowExtensions }
          : {}),
        ...(proposal.allowSettings !== undefined ? { allowSettings: proposal.allowSettings } : {}),
      }
      break
    }
    case 'rename-profile':
      path = '/profiles/' + proposal.profile + '/rename'
      body = { newName: proposal.newName }
      break
    case 'helper-on':
      path = '/profiles/' + proposal.profile + '/helper'
      body = {}
      break
  }
  const abort = new AbortController()
  try {
    const response = await fetch(admin.url + path, {
      method: 'POST',
      redirect: 'error',
      headers: { ...admin.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, abort.signal, AbortSignal.timeout(5000)]),
    })
    const expected =
      proposal.action === 'create-profile' ? 201 : proposal.action === 'open-window' ? 202 : 200
    if (response.status !== expected) throw new PluginSupervisorError('unavailable')
    // No returned admin bytes are page data. Cancel before releasing the request slot.
    void response.body?.cancel().catch(() => undefined)
  } catch {
    throw new PluginSupervisorError('unavailable')
  } finally {
    abort.abort()
  }
}
