import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCALES, NAMES_FILE, fakerVersion, generated } from '../agent-first-names.mjs'
import { NOTICES, generated as noticesGenerated, withGenerated } from '../third-party-notices.mjs'

/**
 * The first names a new agent is given are copied from the pinned Faker, and the notices say so:
 * the file in the repository is what the script writes from the installed Faker, and Faker's
 * license travels in the notices, though Faker itself is not in the app.
 */
describe('the names copied from Faker', () => {
  it('are what the script writes from the installed, pinned Faker', async () => {
    expect(readFileSync(NAMES_FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(await generated())
    const pinned = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(pinned.devDependencies['@faker-js/faker']).toBe(fakerVersion())
    const file = JSON.parse(readFileSync(NAMES_FILE, 'utf8'))
    expect(file.faker).toBe(fakerVersion())
    expect(Object.keys(file.locales)).toEqual(LOCALES)
  })

  it('are credited in the notices, with Faker’s license, and the notices are up to date', () => {
    const notices = readFileSync(NOTICES, 'utf8').replace(/\r\n/g, '\n')
    expect(withGenerated(notices, noticesGenerated())).toBe(notices)
    expect(notices).toContain('`apps/desktop/src/shared/agent-first-names.json`')
    expect(notices).toContain(`version ${fakerVersion()}`)
    const license = readFileSync(
      new URL('../../node_modules/@faker-js/faker/LICENSE', import.meta.url),
      'utf8',
    )
    expect(notices).toContain(license.trimEnd())
    // Faker is a tool of the repository and not a package the app carries.
    expect(noticesGenerated()).not.toContain('@faker-js/faker')
  })
})
