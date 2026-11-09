import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function expectedSigningIdentity(env = process.env) {
  const teamId = env.MAC_EXPECTED_TEAM_ID
  const authority = env.MAC_EXPECTED_SIGNING_AUTHORITY
  if (
    !/^[A-Z0-9]{10}$/.test(teamId ?? '') ||
    typeof authority !== 'string' ||
    !authority.startsWith('Developer ID Application: ') ||
    !authority.endsWith(` (${teamId})`) ||
    /[\r\n]/.test(authority)
  )
    throw new Error('Configured Mac signing team and authority are required')
  return { teamId, authority }
}

export function requireDistributionSignature(
  description,
  { executable = true, identity = null } = {},
) {
  const lines = description.split('\n')
  if (!/^Authority=Developer ID Application:/m.test(description))
    throw new Error('Developer ID Application signature required')
  if (!/^Timestamp=.+/m.test(description)) throw new Error('Secure timestamp required')
  if (executable && !/flags=.*\bruntime\b/.test(description))
    throw new Error('Hardened runtime required')
  if (
    identity &&
    (!lines.includes(`TeamIdentifier=${identity.teamId}`) ||
      !lines.includes(`Authority=${identity.authority}`))
  )
    throw new Error('Signature differs from the configured Mac signing identity')
}

export function selectSigningCertificate(text, env = process.env) {
  const identity = expectedSigningIdentity(env)
  const hashes = text.split('\n').flatMap((line) => {
    const match = /^\s*\d+\)\s+([A-F0-9]{40})\s+"([^"]+)"\s*$/.exec(line)
    return match?.[2] === identity.authority ? [match[1]] : []
  })
  if (hashes.length !== 1) throw new Error('Exactly one configured signing certificate is required')
  return hashes[0]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'check') expectedSigningIdentity()
  else if (process.argv[2] === 'mask') {
    const identity = expectedSigningIdentity()
    for (const value of Object.values(identity)) console.log(`::add-mask::${value}`)
  } else console.log(selectSigningCertificate(readFileSync(0, 'utf8')))
}
