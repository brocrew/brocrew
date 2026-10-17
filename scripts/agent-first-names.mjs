/**
 * Writes `apps/desktop/src/shared/agent-first-names.json`: the first names BroBot draws a new
 * agent's name from, copied out of the person data of the Faker locales below, as the installed
 * `@faker-js/faker` lists them (its female, male and neutral names, each once, in Faker's order).
 *
 * Only these names ship. Importing a Faker locale brings its whole data set into the bundle (three
 * locales measured 653 KB), so the names are copied here once, from the pinned version, and the app
 * imports this file. Which of them can name an agent is decided where they are read
 * (`human-names.ts`).
 *
 * The locales are those whose names are written in the Latin alphabet, one per country or
 * language, from several continents. Left out: those written in another script, Vietnamese (its
 * letters stack two marks), the regional copies of German and French, and Faker's joke and
 * constructed-language locales.
 *
 * `node scripts/agent-first-names.mjs` rewrites the file; `--check` exits 1, changing nothing,
 * when it is out of date.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as faker from '@faker-js/faker'
import * as prettier from 'prettier'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const NAMES_FILE = join(ROOT, 'apps', 'desktop', 'src', 'shared', 'agent-first-names.json')

/** The Faker locales the names come from. */
export const LOCALES = [
  'af_ZA',
  'az',
  'cs_CZ',
  'da',
  'de',
  'en_AU',
  'en_GH',
  'en_IN',
  'en_NG',
  'en_NP',
  'en_ZA',
  'es',
  'es_MX',
  'fi',
  'fr',
  'fr_SN',
  'hr',
  'hu',
  'id_ID',
  'it',
  'ku_kmr_latin',
  'lv',
  'nb_NO',
  'nl',
  'pl',
  'pt_BR',
  'pt_PT',
  'ro',
  'sk',
  'sl_SI',
  'sv',
  'tr',
  'uz_UZ_latin',
  'yo_NG',
  'zu_ZA',
]

/** The installed Faker's version. */
export function fakerVersion() {
  const require = createRequire(import.meta.url)
  return JSON.parse(readFileSync(require.resolve('@faker-js/faker/package.json'), 'utf8')).version
}

/** One locale's first names, each once, in the order Faker lists them. */
function firstNamesOf(locale) {
  const names = faker[locale]?.person?.first_name
  if (names === undefined)
    throw new Error(`Faker ${fakerVersion()} has no first names for ${locale}`)
  return [...new Set([...(names.generic ?? []), ...(names.female ?? []), ...(names.male ?? [])])]
}

/** The file's text, formatted as the repository formats JSON. */
export async function generated() {
  const data = {
    faker: fakerVersion(),
    locales: Object.fromEntries(LOCALES.map((locale) => [locale, firstNamesOf(locale)])),
  }
  const options = (await prettier.resolveConfig(NAMES_FILE)) ?? {}
  return prettier.format(JSON.stringify(data), { ...options, parser: 'json' })
}

// ⚠️ Only when this file IS the command.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = await generated()
  if (process.argv.includes('--check')) {
    let text = ''
    try {
      text = readFileSync(NAMES_FILE, 'utf8').replace(/\r\n/g, '\n')
    } catch {
      // A missing file is out of date.
    }
    if (text !== next) {
      process.stderr.write(
        'agent-first-names.json is out of date: run `node scripts/agent-first-names.mjs`.\n',
      )
      process.exit(1)
    }
    process.stdout.write('agent-first-names.json is up to date.\n')
  } else {
    writeFileSync(NAMES_FILE, next)
    process.stdout.write(`wrote ${NAMES_FILE}\n`)
  }
}
