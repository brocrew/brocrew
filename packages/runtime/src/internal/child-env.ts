/**
 * The environment for a provider child: all of `base`, as a plain client gets it, with each key of
 * `add` set on top. On Windows, where variable names have no case, a key of `add` replaces the
 * inherited key however it is spelled, so the child sees one value.
 */
export function buildChildEnv(
  add: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const fold = (key: string): string => (platform === 'win32' ? key.toUpperCase() : key)
  const replaced = new Set(Object.keys(add).map(fold))
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !replaced.has(fold(key))) env[key] = value
  }
  return Object.assign(env, add)
}
