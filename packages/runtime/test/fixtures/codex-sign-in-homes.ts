import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** A fictional ChatGPT sign-in as Codex writes it: an account, a renewal key and when it renewed. */
export interface FictionalSignIn {
  readonly auth_mode: 'chatgpt'
  readonly tokens: { account_id: string; access_token: string; refresh_token: string }
  readonly last_refresh: string
}

export const signIn = (account: string, refresh: string, refreshed: string): FictionalSignIn => ({
  auth_mode: 'chatgpt',
  tokens: { account_id: account, access_token: `access-${refresh}`, refresh_token: refresh },
  last_refresh: refreshed,
})

/** This computer refuses every link, as Windows does without Developer Mode or admin rights. */
export const noLinks = (): never => {
  throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
}

/** Agents' Codex homes under a scratch folder, and the renewal key each one holds. */
export function codexHomesUnder(root: () => string): {
  homeOf(who: string): string
  keyIn(who: string): string
} {
  const homeOf = (who: string) => join(root(), 'homes', who, 'codex')
  return {
    homeOf,
    keyIn: (who) =>
      (JSON.parse(readFileSync(join(homeOf(who), 'auth.json'), 'utf8')) as FictionalSignIn).tokens
        .refresh_token,
  }
}
