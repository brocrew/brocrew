import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { HOME_FOLDER, HOMES_DIRNAME, planProviderHomes } from '../lib/clean-base.mjs'
import { trustedAnchor } from '../lib/safe-remove.mjs'
import {
  fixture,
  HIS_PROFILES,
  plantUserData,
  removeFixtures,
} from './fixtures/a-planted-user-data.mjs'

/**
 * # What `clean-base` does with the entries BESIDE the one home folder, asked without running it
 *
 * ⚑ **Why this file exists.** Since D-016a's second commit (`a5d66e92`) every provider home lives
 * in ONE folder under `provider-homes/` (`HOME_FOLDER`, `default`), and the walk that plans the reset
 * reads that level as folders rather than projects. Three rules about that level were pinned only
 * by `scripts/gate-only/clean-base.test.mjs`, which SPAWNS the script and runs only inside the
 * whole `pnpm run ci` — so `verify_row` could not re-verify rows `351 M29`, `351 M45` and `352 M4`
 * after the rename moved their anchors. This file asks the same three questions of
 * `planProviderHomes`, which only reads the tree and returns a plan.
 *
 *  - a Finder `.DS_Store` beside the folders is a named stray, never a refusal (`351` review: a
 *    refusal on it could never be cleared);
 *  - a folder whose name BroBot could not have made refuses the whole run;
 *  - the ordinary tree, planted the same way, plans the removal with no refusal and no stray.
 *
 * ⚑ **Every negative is paired** with the ordinary tree on the same walk, so an empty `refusals`
 * or `strays` is a measurement of that entry and not of a walk that found nothing.
 */

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url)))
const REPO = dirname(SCRIPTS)

afterEach(removeFixtures)

/** The plan for a planted userData with HIS profiles, plus whatever `extra` puts beside them. */
const planWith = (extra = () => {}) => {
  const userData = plantUserData(fixture(), { profiles: HIS_PROFILES, extra })
  const anchor = trustedAnchor(userData, { repoRoot: REPO, home: fixture(), env: {} })
  expect(anchor.kind, 'the fixture must be a directory the predicate trusts').toBe('trusted')
  return planProviderHomes(anchor)
}

describe('the level beside the one home folder, as the reset plans it', () => {
  it('⚑ the ordinary tree: every profile in the home folder, no refusal and no stray', () => {
    const plan = planWith()
    expect(plan.refusals).toEqual([])
    expect(plan.strays).toEqual([])
    expect(plan.actions.map((action) => action.rel)).toEqual([HOMES_DIRNAME])
    expect(plan.profiles).toEqual(HIS_PROFILES.map((profile) => `${HOME_FOLDER}/${profile}`))
  })

  it('🔴 a .DS_Store beside the home folder is removed and NAMED, and refuses nothing', () => {
    const plan = planWith(({ userData }) => {
      writeFileSync(join(userData, HOMES_DIRNAME, '.DS_Store'), 'finder\n')
    })
    // The stray is named by its path, and the run still goes ahead: the whole tree is removed.
    expect(plan.strays).toEqual([`${HOMES_DIRNAME}/.DS_Store`])
    expect(plan.refusals).toEqual([])
    expect(plan.actions.map((action) => action.rel)).toEqual([HOMES_DIRNAME])
    // …and the folder beside it was still walked: the menu is all there.
    expect(plan.profiles).toEqual(HIS_PROFILES.map((profile) => `${HOME_FOLDER}/${profile}`))
  })

  it('🔴 a folder whose name BroBot could not have made refuses the run, and says why', () => {
    const plan = planWith(({ userData }) => {
      mkdirSync(join(userData, HOMES_DIRNAME, '.hidden-folder'), { recursive: true })
    })
    expect(plan.refusals).toEqual([
      `${HOMES_DIRNAME}/.hidden-folder is not a valid folder name — BroBot cannot have created it, so this reset will not remove it`,
    ])
    // The paired positive: the home folder beside it is still read as the home folder.
    expect(plan.profiles).toEqual(HIS_PROFILES.map((profile) => `${HOME_FOLDER}/${profile}`))
    expect(plan.strays).toEqual([])
  })
})
