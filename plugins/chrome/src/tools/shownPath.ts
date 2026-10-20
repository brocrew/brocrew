import os from 'node:os'
export function shownPath(p: string, home: string = os.homedir()): string {
  const sep = home.includes('\\') ? '\\' : '/'
  const inHome =
    p === home ||
    p.startsWith(home + sep) ||
    (sep === '\\' && p.toLowerCase().startsWith(`${home.toLowerCase()}\\`))
  return inHome ? `~${p.slice(home.length)}`.split(sep).join('/') : p
}
