/**
 * ⚑ **D-018 · a process's memory as its agent card says it** — `314 MB`, `1.2 GB`, in the
 * 1024-based units the app's other sizes use.
 */
export function processMemoryWords(bytes: number): string {
  return bytes < 1024 ** 3
    ? `${Math.round(bytes / 1024 ** 2)} MB`
    : `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
