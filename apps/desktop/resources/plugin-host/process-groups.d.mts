export function groupIdentity(pid: number): string | null
export function liveGroupMembers(group: number): Promise<number[]>
export function stopGroups(
  groups: ReadonlyMap<number, string> | Iterable<number>,
  graceMs?: number,
): Promise<boolean>

export function pluginServerLaunch(
  node: string,
  preload: string,
  options?: {
    platform?: string
    stat?: (path: string) => { isFile(): boolean; uid: number }
    access?: (path: string, mode: number) => void
  },
): { execPath: string; execArgv: string[] }
export function readPriorityClamped(
  pid: number,
  options?: { platform?: string; read?: (ownedPid: number) => unknown },
): boolean | null
export function powershellPath(environment?: NodeJS.ProcessEnv): string | null
export function endProcessesByIdentity(
  identities: ReadonlyMap<number, string>,
  ms?: number,
): Promise<boolean>
export function fileTimeOf(ms: number): bigint
export function endWindowsTree(
  rootPid: number,
  startedMs: number,
  endedMs: number,
  ms?: number,
  options?: { readCommand?: string },
): Promise<boolean>
