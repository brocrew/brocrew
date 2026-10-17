import FAKER_FIRST_NAMES from './agent-first-names.json'
import { PROVIDER_NAME } from './runtime-ipc'

/**
 * The name this app gives an agent it brings into being. The app assigns it, so nobody is asked
 * and no run waits on the answer; a person can rename the agent afterwards.
 *
 * It is a name nothing already answers to: no agent on this app's roster holds it, as its slug or
 * its name. BroBot's own list ({@link HUMAN_NAMES}) is given first, in its order, so an install
 * carries on from where it is; once all of it is taken, names are drawn at random from first names
 * Faker lists for many languages (`agent-first-names.json`). Names are compared with accents and
 * case set aside ({@link aNameKey}), so *Zoë* is not given beside *Zoe*. An agent stays on the roster for as
 * long as any conversation is recorded as it, so a name in an agent's history is not given to
 * another agent while that history is kept.
 *
 * Nothing here reads the slug, the role or the project: the name is a handle, and what an agent is
 * lives in its slug and its rules.
 */

/**
 * BroBot's own list, given first and in this order. Every agent named from it keeps its name;
 * nothing here renames anybody.
 */
export const HUMAN_NAMES = [
  'Ada',
  'Ali',
  'Amara',
  'Ana',
  'Anh',
  'Arjun',
  'Ayo',
  'Bo',
  'Camille',
  'Chen',
  'Dara',
  'Diego',
  'Eli',
  'Elif',
  'Emeka',
  'Esme',
  'Farah',
  'Felix',
  'Gabi',
  'Hana',
  'Hugo',
  'Ida',
  'Ilya',
  'Imani',
  'Ines',
  'Iris',
  'Jae',
  'Jonas',
  'Juno',
  'Kai',
  'Kamal',
  'Kenji',
  'Kiran',
  'Lars',
  'Leila',
  'Lena',
  'Lior',
  'Luca',
  'Mai',
  'Malik',
  'Mara',
  'Mateo',
  'Milo',
  'Nia',
  'Noor',
  'Ola',
  'Omar',
  'Oscar',
  'Petra',
  'Priya',
  'Quinn',
  'Rafa',
  'Remy',
  'Rin',
  'Rosa',
  'Sami',
  'Sanne',
  'Sara',
  'Tariq',
  'Teo',
  'Tomas',
  'Uma',
  'Vera',
  'Wren',
  'Yara',
  'Yusuf',
  'Zane',
  'Zara',
  'Zoe',
] as const satisfies readonly string[]

/**
 * First names that also read as something else where an agent's name is written — in the window and
 * in what agents are told: an everyday English word (*"Grace is waiting"*), a title, a role or a
 * religious figure, a rude or loaded word, or the name of an AI assistant or a brand. None is given,
 * nor the name of a provider this app runs. Compared by {@link aNameKey}.
 */
export const NAMES_THAT_READ_AS_WORDS = [
  // Everyday words.
  'ace',
  'alpha',
  'amber',
  'among',
  'angel',
  'ant',
  'august',
  'bay',
  'bill',
  'bless',
  'blessing',
  'bob',
  'can',
  'chase',
  'comfort',
  'constant',
  'daisy',
  'dale',
  'dean',
  'desire',
  'dev',
  'earnest',
  'even',
  'fine',
  'flip',
  'floor',
  'frank',
  'glen',
  'grace',
  'grant',
  'gun',
  'guy',
  'hale',
  'hazel',
  'heather',
  'holly',
  'honor',
  'hope',
  'hunter',
  'idea',
  'innocent',
  'ivy',
  'jack',
  'jade',
  'jail',
  'jay',
  'jazz',
  'jet',
  'job',
  'joy',
  'june',
  'karma',
  'kick',
  'kin',
  'lava',
  'lean',
  'lily',
  'line',
  'lot',
  'mark',
  'mate',
  'max',
  'may',
  'melody',
  'mine',
  'nail',
  'nil',
  'nine',
  'nova',
  'olive',
  'parfait',
  'peer',
  'per',
  'pie',
  'piper',
  'poppy',
  'prima',
  'promise',
  'prudence',
  'rich',
  'robin',
  'rose',
  'rover',
  'ruby',
  'said',
  'salvo',
  'sandy',
  'shade',
  'sky',
  'soda',
  'storm',
  'sue',
  'summer',
  'toke',
  'tone',
  'valid',
  'vino',
  'violet',
  'virgin',
  'wade',
  'wage',
  'will',
  'willow',
  'wolf',
  'yoga',
  // Titles, roles and religious figures.
  'barman',
  'buddha',
  'dame',
  'guru',
  'imam',
  'jesus',
  'queen',
  'server',
  'sir',
  'swami',
  // Words that are rude or loaded in English.
  'adolf',
  'anal',
  'fanny',
  'isis',
  'willy',
  // AI assistants and brands (the providers' own names are added below).
  'alexa',
  'cody',
  'devin',
  'dior',
  'eliza',
  'gemini',
  'gemma',
  'jules',
  'kimi',
  'mercedes',
  'nike',
  'sydney',
] as const satisfies readonly string[]

/** Latin letters no accent can be taken off, each as the plain letters it is written with. */
const PLAIN_LETTERS: Readonly<Record<string, string>> = {
  ø: 'o',
  ł: 'l',
  ı: 'i',
  đ: 'd',
  ð: 'd',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  ħ: 'h',
  ŀ: 'l',
  ŧ: 't',
  þ: 'th',
  ŋ: 'n',
  ĳ: 'ij',
}

/**
 * The key two names are compared by: accents and case set aside, so *Zoë* and *zoe* are one, and
 * so are *Michał* and the slug `michal`.
 */
export function aNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[øłıđðæœßħŀŧþŋĳ]/gu, (letter) => PLAIN_LETTERS[letter] ?? letter)
    .trim()
}

const READS_AS_A_WORD = new Set<string>([
  ...NAMES_THAT_READ_AS_WORDS,
  ...Object.values(PROVIDER_NAME).map(aNameKey),
])

/**
 * Whether `name` can be given: one word of 2 to 10 letters, a capital and then small letters, all
 * from the Latin alphabet with its accented letters (to Latin Extended-A, which the window's
 * typeface draws and every language here writes with), and not a word that reads as something else.
 * Names with marks stacked on one letter, apostrophes, hyphens or spaces are left out.
 */
export function aNameThatCanBeGiven(name: string): boolean {
  return (
    /^\p{Lu}\p{Ll}{1,9}$/u.test(name) &&
    /^[A-Za-z\u00C0-\u017F]+$/.test(name) &&
    !READS_AS_A_WORD.has(aNameKey(name))
  )
}

/** One source of names: BroBot's own list, or one Faker locale's. */
interface NameSource {
  readonly names: readonly { readonly name: string; readonly key: string }[]
}

let sources: readonly NameSource[] | null = null

/** Every source, each name as it can be given and only once across all of them. Built on first use. */
function nameSources(): readonly NameSource[] {
  if (sources !== null) return sources
  const seen = new Set<string>()
  const lists: readonly (readonly string[])[] = [
    HUMAN_NAMES,
    ...Object.values<readonly string[]>(FAKER_FIRST_NAMES.locales),
  ]
  sources = lists.map((list) => {
    const names: { name: string; key: string }[] = []
    for (const raw of list) {
      const name = raw.normalize('NFC')
      const key = aNameKey(name)
      if (seen.has(key) || !aNameThatCanBeGiven(name)) continue
      seen.add(key)
      names.push({ name, key })
    }
    return { names }
  })
  return sources
}

/** Every name this app can give, each once. */
export function namesThatCanBeGiven(): readonly string[] {
  return nameSources().flatMap((source) => source.names.map((one) => one.name))
}

/** One of `list`, as `random` chooses. */
function oneOf<T>(list: readonly T[], random: () => number): T {
  const at = Math.min(list.length - 1, Math.floor(random() * list.length))
  return list[at]!
}

/**
 * A name for a new agent that nothing in `taken` answers to. `taken` is every name in use, slugs and
 * names alike; `random` returns a number in [0, 1), as `Math.random` does.
 *
 * The first free name of BroBot's own list, while it has one. Then a Faker locale with a free name
 * is chosen, and a free name in it, so a locale with a long list is not drawn more often than one
 * with a short list. When every name is taken, one is given again with the lowest number that
 * makes it new: *Ada 2*, then *Ada 3*.
 */
export function aNameForANewAgent(taken: Iterable<string>, random: () => number): string {
  const answersTo = new Set<string>()
  for (const name of taken) {
    const key = aNameKey(name)
    // A name that is blank or punctuation collides with nothing.
    if (key !== '') answersTo.add(key)
  }
  const [own, ...faker] = nameSources()
  const first = own?.names.find((one) => !answersTo.has(one.key))
  if (first !== undefined) return first.name
  const free = faker
    .map((source) => source.names.filter((one) => !answersTo.has(one.key)))
    .filter((names) => names.length > 0)
  if (free.length > 0) return oneOf(oneOf(free, random), random).name
  const again = oneOf(namesThatCanBeGiven(), random)
  for (let number = 2; ; number += 1) {
    const numbered = `${again} ${number}`
    if (!answersTo.has(aNameKey(numbered))) return numbered
  }
}
