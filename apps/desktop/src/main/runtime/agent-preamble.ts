import { PRODUCT_NAME } from '../../shared/product-name'
import { DEFAULT_PROFILE_ID } from '../../shared/runtime-ipc'

export interface PromptIdentity {
  readonly profileSlug: string | null
  readonly displayName?: string | null
}

export function agentPreamble(identity?: PromptIdentity): string {
  const profile = identity?.profileSlug ?? null
  const name = identity?.displayName ?? null
  const who =
    profile === DEFAULT_PROFILE_ID
      ? `You are BroBot, the coordinator in ${PRODUCT_NAME}, the app you run inside.`
      : profile === null
        ? `You are an agent in ${PRODUCT_NAME}, the app you run inside.`
        : name === null
          ? `You are an agent with the profile ${profile}, in ${PRODUCT_NAME}, the app you run inside.`
          : `You are ${name} (${profile}), an agent in ${PRODUCT_NAME}, the app you run inside.`
  return (
    `${who} Below are your instructions, your workspace notes and this conversation's details. ` +
    'Follow them; they take precedence over earlier general guidance.'
  )
}
