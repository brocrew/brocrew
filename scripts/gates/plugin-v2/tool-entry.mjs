import { demand } from './contract.mjs'

// Optional package paths match esbuild0.28.1 node-platform.ts; no wrapper/download fallback.
export function nativeEsbuildTarget(platform, arch) {
  if (platform === 'darwin' && arch === 'arm64')
    return { packageName: '@esbuild/darwin-arm64', subpath: 'bin/esbuild' }
  if (platform === 'win32' && arch === 'x64')
    return { packageName: '@esbuild/win32-x64', subpath: 'esbuild.exe' }
  demand(false)
}
export function esbuildInvocation(binary, args, bytes, platform, arch) {
  nativeEsbuildTarget(platform, arch)
  demand(Array.isArray(args) && Buffer.isBuffer(bytes))
  if (platform === 'darwin') {
    demand(
      bytes.length >= 8 &&
        bytes.subarray(0, 4).toString('hex') === 'cffaedfe' &&
        bytes.readUInt32LE(4) === 0x0100000c,
    )
  } else {
    demand(bytes.length >= 64 && bytes.subarray(0, 2).toString() === 'MZ')
    const pe = bytes.readUInt32LE(0x3c)
    demand(
      pe >= 64 &&
        pe <= bytes.length - 6 &&
        bytes.subarray(pe, pe + 4).toString('hex') === '50450000' &&
        bytes.readUInt16LE(pe + 4) === 0x8664,
    )
  }
  return {
    program: binary,
    args,
    kind: platform === 'darwin' ? 'native-macho-arm64' : 'native-pe-x64',
  }
}
