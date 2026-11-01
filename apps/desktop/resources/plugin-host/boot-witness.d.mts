export type BootWitness = { kind: 'darwin-boot-session-v1' | 'windows-tick64-v1'; value: string }
export function bootWitness(value: unknown): BootWitness | null
export function laterBoot(before: unknown, after: unknown): boolean
export function readBootWitness(options?: {
  platform?: NodeJS.Platform
  read?(file: string, args: string[]): Promise<string>
}): Promise<BootWitness | null>
