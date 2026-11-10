export interface ProviderConfigLayout {
  readonly homeEnv: string
  readonly model: string
  readonly authNote: string | null
  readonly files: readonly { readonly name: string; readonly note: string }[]
}

type OptionStance = 'passed' | 'pinned' | 'absent'

export interface SdkOptionClaim {
  readonly option: string

  readonly label: string
  readonly stance: OptionStance
}

export function humanList(items: readonly string[]): string {
  if (items.length === 0) return 'nothing'
  if (items.length === 1) return items[0]!
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`
}
