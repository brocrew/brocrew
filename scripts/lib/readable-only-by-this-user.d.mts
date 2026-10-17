export interface WindowsAccess {
  readonly me: string
  readonly allowed: readonly { readonly sid: string; readonly name: string }[]
}
export const THE_COMPUTER_ITSELF: readonly string[]
export function windowsAccessOf(path: string): WindowsAccess
export function othersAllowed(access: WindowsAccess): string[]
export function whoElseCanOpen(path: string, mode: number): string[]
