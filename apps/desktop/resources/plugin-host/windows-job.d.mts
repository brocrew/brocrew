export interface JobKeeper {
  readonly opened: Promise<number | null>
  readonly reason: string | null
  readonly cached: boolean
  readonly pid: number | null
  identity(): Promise<JobIdentity | null>
  assign(pid: number): Promise<string | null>
  count(): Promise<number | null>
  priorityClamped(): Promise<boolean | null>
  terminate(): Promise<boolean>
  close(): void
  end(graceMs?: number): Promise<boolean>
}
export interface JobIdentity {
  format: 1
  name: string
  guardian: { pid: number; birth: string }
  keeper: { pid: number; birth: string }
  boot: { kind: 'windows-tick64-v1'; value: string }
}
export function startJobKeeper(options?: {
  name?: string
  openMs?: number
  cache?: string
  env?: NodeJS.ProcessEnv
}): JobKeeper
