export interface JobKeeper {
  readonly opened: Promise<number | null>
  readonly reason: string | null
  readonly cached: boolean
  readonly pid: number | null
  assign(pid: number): Promise<string | null>
  count(): Promise<number | null>
  priorityClamped(): Promise<boolean | null>
  terminate(): Promise<boolean>
  close(): void
  end(graceMs?: number): Promise<boolean>
}
export function startJobKeeper(options?: {
  openMs?: number
  cache?: string
  env?: NodeJS.ProcessEnv
}): JobKeeper
