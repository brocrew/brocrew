// Only inherited, non-secret macOS launch metadata may cross the fixture environment fence.
import { requireCI } from './contract.mjs'

export const systemKeyRules = {
  __CF_USER_TEXT_ENCODING: /^0x[0-9a-f]+:\d+:\d+$/i,
  XPC_FLAGS: /^0x[0-9a-f]+$/i,
  XPC_SERVICE_NAME: /^[a-z0-9._:-]{1,160}$/i,
}
export function hostedSystemEnvironment(
  source = process.env,
  platform = process.platform,
  arch = process.arch,
) {
  try {
    requireCI(source, platform, arch)
  } catch {
    return {}
  }
  return Object.fromEntries(
    Object.entries(systemKeyRules)
      .filter(([key, rule]) => typeof source[key] === 'string' && rule.test(source[key]))
      .map(([key]) => [key, source[key]]),
  )
}
// The returned object contains names only, even when input values are secrets or paths.
export function environmentKeyDiff(baseline, fixture) {
  const names = (value) => Object.keys(value).sort()
  const left = names(baseline),
    right = names(fixture)
  return {
    onlyInV2: left.filter((key) => !right.includes(key)),
    onlyInFixture: right.filter((key) => !left.includes(key)),
    shared: left.filter((key) => right.includes(key)),
  }
}
