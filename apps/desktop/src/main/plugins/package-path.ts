import { refusePlugin } from './verification-error'

const DEVICE = /^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i

/** Curated package paths use an ASCII-only namespace. */
export function pluginPackagePath(value: string): string {
  if (value === '' || Buffer.byteLength(value, 'utf8') > 1024 || !/^[A-Za-z0-9._@/-]+$/.test(value))
    refusePlugin('path')
  const parts = value.split('/')
  for (const part of parts) {
    if (
      part === '' ||
      part === '.' ||
      part === '..' ||
      part.startsWith('.') ||
      part.endsWith('.') ||
      Buffer.byteLength(part, 'utf8') > 255 ||
      DEVICE.test(part)
    )
      refusePlugin('path')
  }
  return value
}

interface PathNode {
  spelling: string
  kind?: 'file' | 'directory'
  children: Map<string, PathNode>
}

/** The same tree catches duplicate files, case aliases, and file/parent conflicts. */
export class PluginPackagePaths {
  private readonly root: PathNode = { spelling: '', children: new Map() }

  add(path: string, kind: 'file' | 'directory'): void {
    const parts = pluginPackagePath(path).split('/')
    let node = this.root
    for (const part of parts) {
      if (node.kind === 'file') refusePlugin('path')
      const key = part.toLowerCase()
      let child = node.children.get(key)
      if (child === undefined) {
        child = { spelling: part, children: new Map() }
        node.children.set(key, child)
      } else if (child.spelling !== part) refusePlugin('path')
      node = child
    }
    if (node.kind !== undefined || (kind === 'file' && node.children.size > 0)) refusePlugin('path')
    node.kind = kind
  }
}
