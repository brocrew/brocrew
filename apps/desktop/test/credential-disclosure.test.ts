import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { capabilitiesFor, provisionCodexAuth, SUPPORTED_PROVIDERS } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { prepareProviderHome } from '../src/main/runtime/provider-homes'
import { whoElseCanOpen } from '../../../scripts/lib/readable-only-by-this-user.mjs'

/**
 * 329 · **The credential disclosure answers to the code that does the copying.**
 *
 * ⛔ **The gap this closes is measured, not hypothetical.** `308` corrected the Info panel's
 * `auth.json` sentence and wrote twenty-two mutation rows; two of them — *"the Codex note reverts to
 * 'copied in once'"* and *"the English lies while the table stays honest"* — **survived the whole
 * suite**. The one place the product told a user their machine credential had been copied was
 * protected by nothing at all. `329` puts a second, louder sentence about the same act on the
 * launcher, so it arrives with the gate that one never had.
 *
 * ## What is bound to what
 *
 * `ProviderCapabilities.homeCredential` is a claim about behaviour: *"a folder here holds a sign-in
 * of its own, and it starts as a copy of the machine's"* on one provider, *"nothing of yours is
 * written into it"* on the other. ⚑ **So the gate runs the behaviour** — the real `prepareProviderHome`
 * and the real `provisionCodexAuth`, against temp directories — and asserts the declaration matches
 * what happened. A declaration that drifted from the code goes red here rather than on a screen.
 *
 * ## ⛔ Why the personal `~/.codex` is never read
 *
 * `provider-homes.ts` states the rule this file obeys: the credential seams exist so that *"tests —
 * and `pnpm run ci` — never read the machine Keychain or the personal `~/.codex`"*. Two consequences
 * for the shape below, and both are deliberate:
 *
 *  - **Routing** is proved with the seam as a SPY. It shows which provider's branch reaches the
 *    credential writer, and it touches nothing of the user's.
 *  - **Behaviour** is proved by calling the real `provisionCodexAuth` with `sourceAuthPath` pointed
 *    at a fixture. That option exists for exactly this, and it means the function under test is the
 *    one that ships rather than a double standing in for it.
 *
 * ⚠️ Neither half alone would do. The spy proves the branch and says nothing about what the writer
 * writes; the direct call proves the copy and says nothing about who calls it.
 */

const made: string[] = []

/**
 * A sign-in file is compared by a digest of its bytes, so a failure prints two digests and never
 * what a file holds.
 */
const digestOf = (bytes: string | Buffer): string =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 16)
const signInAt = (path: string): string => digestOf(readFileSync(path))

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), `brobot2-${prefix}-`))
  made.push(path)
  return path
}

afterEach(() => {
  while (made.length > 0) rmSync(made.pop() as string, { recursive: true, force: true })
})

/** A credential-shaped fixture. 🔒 Not a token, not an account — bytes with a recognisable marker. */
function fakeMachineAuth(body: string): string {
  const home = temp('fake-machine')
  const path = join(home, 'auth.json')
  writeFileSync(path, body, { mode: 0o600 })
  return path
}

/** Which providers' branches reach the credential writer, measured rather than assumed. */
async function providersThatProvisionACredential(): Promise<Provider[]> {
  const reached: Provider[] = []
  for (const provider of SUPPORTED_PROVIDERS) {
    const userData = temp('userdata')
    await prepareProviderHome(
      userData,
      { profileId: 'default', provider },
      {
        provisionCodexAuth: () => void reached.push(provider),
        // Nothing here may read the machine Keychain; the branch under test is the one that asks.
        claudeAuthHealth: () => ({ ok: true }),
      },
    )
  }
  return reached
}

describe('🔴 the declaration answers to the code (329)', () => {
  it('exactly the providers whose branch provisions a credential declare `homeCredential` available', async () => {
    const reached = await providersThatProvisionACredential()
    // Non-vacuity in both directions: a run where nobody provisioned, or everybody did, would make
    // the comparison below pass over nothing interesting.
    expect(
      reached.length,
      'no provider reached the writer — the routing probe measured nothing',
    ).toBeGreaterThan(0)
    expect(
      reached.length,
      'every provider reached it — then this file proves no asymmetry',
    ).toBeLessThan(SUPPORTED_PROVIDERS.length)
    const declared = SUPPORTED_PROVIDERS.filter(
      (provider) => capabilitiesFor(provider).homeCredential.state === 'available',
    )
    expect(
      [...declared].sort(),
      'a provider claims a sign-in of its own without the code putting one there, or the reverse',
    ).toEqual([...reached].sort())
  })

  it('⛔ the provider that declares it absent leaves the folder with nothing in it', async () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      if (capabilitiesFor(provider).homeCredential.state === 'available') continue
      const userData = temp('userdata')
      // ⚑ The REAL function, no credential seam — its Claude branch writes nothing and this is the
      // assertion that says so. `claudeAuthHealth` is stubbed because the alternative is reading the
      // machine Keychain, which is the one thing a test may not do.
      const home = await prepareProviderHome(
        userData,
        { profileId: 'default', provider },
        {
          claudeAuthHealth: () => ({ ok: true }),
          // ⛔ **A REFUSING seam, not an absent one** (found reviewing 329's own diff). This loop is
          // only for providers that provision nothing; without this, a provider that started
          // reaching the credential writer would fall through to the real `provisionCodexAuth` and
          // read the personal `~/.codex/auth.json` — the one thing `provider-homes.ts` says the
          // seams exist to stop a test doing. It fails loudly instead. Today it never fires, which
          // is the claim; the point is what happens on the day that stops being true.
          provisionCodexAuth: () => {
            throw new Error(
              `${provider} declares homeCredential absent and reached the credential writer`,
            )
          },
        },
      )
      // Positive first: the folder really was created, so the emptiness below is about a place that
      // exists rather than about a path nothing ever made.
      expect(statSync(home).isDirectory(), `${provider} home`).toBe(true)
      expect(
        readdirSync(home),
        `${provider} put something in the folder it declares empty`,
      ).toEqual([])
    }
  })
})

describe('what the Codex note claims, against `provisionCodexAuth` itself', () => {
  /** The declared sentence, or `''` — read once, so every assertion below is about the shipped one. */
  const note = (): string => {
    const status = capabilitiesFor('codex').homeCredential
    return status.state === 'available' ? (status.note ?? '') : ''
  }

  it('“a copy” — the CONTENT of the machine file arrives in the folder', async () => {
    const home = temp('home')
    const source = fakeMachineAuth('{"marker":"329-original"}')
    await provisionCodexAuth(home, { sourceAuthPath: source })
    expect(signInAt(join(home, 'auth.json'))).toBe(digestOf('{"marker":"329-original"}'))
    expect(note()).toMatch(/copy/i)
  })

  it('“readable only by you” — 0600 however the umask is set, and on Windows by its access list', async () => {
    const home = temp('home')
    await provisionCodexAuth(home, { sourceAuthPath: fakeMachineAuth('{"marker":"329-mode"}') })
    expect(whoElseCanOpen(join(home, 'auth.json'), 0o600)).toEqual([])
    expect(note()).toMatch(/readable only by you/i)
  })

  it('🔴 “made once … never replaced on its own” — a second provisioning does not overwrite', async () => {
    const home = temp('home')
    await provisionCodexAuth(home, { sourceAuthPath: fakeMachineAuth('{"marker":"329-first"}') })
    // A DIFFERENT machine credential, provisioned again into the same folder. The sentence on the
    // launcher promises this does nothing; if it ever starts clobbering, the promise is the defect.
    await provisionCodexAuth(home, { sourceAuthPath: fakeMachineAuth('{"marker":"329-second"}') })
    expect(signInAt(join(home, 'auth.json'))).toBe(digestOf('{"marker":"329-first"}'))
    expect(note()).toMatch(/never replaced/i)
  })

  it('⚠️ …and the second source really was different, so the test above is not comparing a file to itself', async () => {
    // The control for the assertion above. Without it, "the bytes did not change" would also pass if
    // both fixtures happened to be identical — which is `310`'s no-op-mutation lesson in test form.
    const home = temp('home')
    await provisionCodexAuth(home, { sourceAuthPath: fakeMachineAuth('{"marker":"329-second"}') })
    expect(signInAt(join(home, 'auth.json'))).toBe(digestOf('{"marker":"329-second"}'))
  })

  it('🔴 “where it has none, as a copy of BroBot’s own” — with no machine sign-in, BroBot’s own is copied', async () => {
    const root = temp('managed')
    const home = join(root, 'homes', 'farah', 'codex')
    const ownHome = join(root, 'homes', 'brobot', 'codex')
    mkdirSync(home, { recursive: true, mode: 0o700 })
    mkdirSync(ownHome, { recursive: true, mode: 0o700 })
    writeFileSync(join(ownHome, 'auth.json'), '{"marker":"brobot-own"}', { mode: 0o600 })
    await provisionCodexAuth(home, {
      sourceAuthPath: join(temp('no-machine'), 'auth.json'),
      managedRoot: root,
      fallbackAuthPath: join(ownHome, 'auth.json'),
    })
    expect(signInAt(join(home, 'auth.json'))).toBe(digestOf('{"marker":"brobot-own"}'))
    expect(note()).toContain('where it has none, as a copy of BroBot’s own')
  })

  it('⛔ the note names no file, no path and no folder of ours', () => {
    // 169 §2's register: this sentence is read on a launcher, not in a shell. The Info panel is
    // where a path belongs, and it has one.
    expect(note().length).toBeGreaterThan(40)
    expect(note()).not.toMatch(/auth\.json|0600|provider home|~\//i)
  })
})

describe('what the other provider’s reason claims, against the same code', () => {
  it('⛔ “nothing of your sign-in is written” — and the only writer is reached by one branch', async () => {
    const status = capabilitiesFor('claude').homeCredential
    expect(status.state).toBe('absent')
    if (status.state !== 'absent') return
    expect(status.reason).toMatch(/nothing/i)
    // The evidence field must name where somebody looked, not repeat the conclusion (029/030).
    expect(status.checkedAgainst).toMatch(/provider-homes\.ts|provisionCodexAuth/)

    // …and the claim itself, run: the Claude branch reaches no credential writer at all.
    const reached = await providersThatProvisionACredential()
    expect(reached).not.toContain('claude')
    expect(reached, 'and the probe is live — it saw the other provider do it').toContain('codex')
  })
})

describe('the folder a home is made in', () => {
  it('⚠️ a pre-existing directory is not a credential — the emptiness check is about files', async () => {
    // The control for "leaves the folder with nothing in it": `provisionProviderHome` creates the
    // tree, so that assertion is only meaningful if creating the tree is not itself what it reads.
    const userData = temp('userdata')
    const home = await prepareProviderHome(
      userData,
      { profileId: 'other', provider: 'claude' },
      { claudeAuthHealth: () => ({ ok: true }) },
    )
    mkdirSync(join(home, 'sub'))
    expect(readdirSync(home)).toEqual(['sub'])
  })
})
