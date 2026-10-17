import type { BuiltInSkillName } from './built-in-skills'

/** Why a launch could not use a text pack, each said in one fixed sentence. */
export type TextPackRefusal =
  | { readonly kind: 'not-absolute' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'core-missing' }
  | { readonly kind: 'core-block-missing'; readonly block: 'core' | 'coordinator' }
  | { readonly kind: 'turn-line-missing' }
  | { readonly kind: 'turn-line-without'; readonly skill: BuiltInSkillName }
  | { readonly kind: 'skill-missing'; readonly skill: BuiltInSkillName }
  | { readonly kind: 'skill-rules' }
  | { readonly kind: 'too-large'; readonly file: string }

/** What a launch did with a text pack, kept with its record. */
export type TextPackUse =
  | { readonly folder: string; readonly refused: null }
  | { readonly folder: string; readonly refused: TextPackRefusal }

export function textPackRefusalSaid(refusal: TextPackRefusal): string {
  switch (refusal.kind) {
    case 'not-absolute':
      return 'its folder is not a full path'
    case 'unreadable':
      return 'its folder could not be read'
    case 'core-missing':
      return 'core.md is missing'
    case 'core-block-missing':
      return refusal.block === 'core'
        ? 'core.md has no “Core for every agent” block'
        : 'core.md has no “BroBot-only addition” block'
    case 'turn-line-missing':
      return 'turn-line.md is missing'
    case 'turn-line-without':
      return `turn-line.md has no line for ${refusal.skill}`
    case 'skill-missing':
      return `${refusal.skill}/SKILL.md is missing`
    case 'skill-rules':
      return 'a skill’s name, description or line breaks the rules built-in skills follow'
    case 'too-large':
      return `${refusal.file} is larger than 64 KB`
  }
}

/** The line a conversation shows when its launch could not use the text pack. */
export function textPackRefusedSaid(
  use: TextPackUse & { readonly refused: TextPackRefusal },
): string {
  return `The text pack at ${use.folder} could not be used: ${textPackRefusalSaid(use.refused)}. This conversation uses the texts this build ships.`
}

/** The source the agent-input popup names for the texts a pack gave. */
export function textPackSourceSaid(folder: string): string {
  return `From the text pack at ${folder}`
}
