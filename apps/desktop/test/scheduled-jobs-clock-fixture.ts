import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { local } from './lib/scheduled-wall-time'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** The host's lead before a job's minute: thirty seconds. */
const LEAD = 30_000
/** When the one-shot below was made, and when its minute is. */
const LISTED = local(9, 28, 11, 50)
const DUE = local(9, 28, 14, 45)
/** Twenty-five seconds before {@link DUE}: inside the lead, so a wake-up is owed at once. */
const LATE = local(9, 28, 14, 44, 35)

/** A one-shot at 14:45. */
const ONE_SHOT_A = {
  id: 'job-a',
  schedule: '45 14 28 9 *',
  recurring: false,
  prompt: 'check the deploy',
} as const

export { migrationsFolder, LEAD, LISTED, DUE, LATE, ONE_SHOT_A }
