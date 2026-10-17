import type { CapabilityStatus } from '../../../shared/runtime-ipc'

/**
 * ⛔ **What a profile does with your sign-in, said where the profile is chosen** (329 §4.1/§4.2).
 *
 * ## The defect this exists for
 *
 * `328` launched the app into a fresh `--user-data-dir`, sent nothing, and five seconds later found
 * a copy of the machine's Codex credential inside the default profile's folder. A second copy
 * appeared when it created a named profile in the launcher. ⚠️ **The behaviour is intended** — 085
 * chose per-profile folders, `prepareProviderHome` creates one on first use and `provisionCodexAuth`
 * copies once at `0600` and never overwrites — and none of that is touched here.
 *
 * 🔴 **The defect was WHERE it was disclosed.** The launcher's own line said a profile is *"an
 * agent's own home: the sessions and sign-in kept there…"*, which a reader takes as a place their
 * sign-in would go rather than as a copy of theirs being made; the true sentence existed only in the
 * conversation Info panel, after the profile existed and the copy had happened. ⚑ `098`'s rule is
 * the ancestor one step out: *asking a question must not write a credential to disk* — and starting
 * the app is a question too.
 *
 * ## ⛔ Why the words are not in this file
 *
 * The fact differs by provider **in kind**: Codex's folder starts out holding a copy of the machine
 * login, Claude's holds nothing at all and never will (015). That is exactly the split `039` forbids
 * the renderer from knowing — *"the UI just displays whatever it gets regardless of whether it's
 * coming from codex or claude code"* — so the sentence is `ProviderCapabilities.homeCredential`'s,
 * declared by the adapter and carried as data. **This function decides which sentence a surface may
 * draw and adds only the one thing the adapter cannot know: WHEN.**
 *
 * ⚠️ **The old line was not merely incomplete, it was false on one provider.** *"The sessions and
 * sign-in kept there"* names three things a profile owns, and on Claude one of them is not there —
 * `authNote` on the same app's Info panel says *"the token is injected per launch, never written
 * here"*. So `PROFILE_OWNS` lost that clause and this line replaces it with a per-provider truth.
 *
 * ## The shape
 *
 * `model-field.ts` (310), `home-attention.ts` (305), `permission-offer.ts` (299): one pure function
 * decides what every surface may draw, so there is no second predicate to drift. ⛔ **It reads no
 * profile and asks no host** — `257 §2` refuses to touch a profile that does not exist yet, and a
 * disclosure that probed to compose itself would commit the very act it is disclosing.
 */

/** Whether the copy has happened for this choice, or is still ahead of it. */
export type CredentialWhen =
  /**
   * A profile that already exists. ⛔ **`prepareProviderHome` has four callers and one of them is
   * this screen** — `RuntimeScreen` asks every known profile for its models on mount, and the first
   * thing that probe does is prepare the home. So for a profile in the list the copy is not waiting
   * on the user at all.
   */
  | 'existing'
  /**
   * A name being typed into `+ New profile…`. ⛔ **Nothing has been written for it**, and that is
   * `257 §2`'s guard rather than a coincidence: the host answers `no-profile` for a name not in
   * `profiles()` precisely so that rendering a launcher cannot provision one.
   */
  | 'new'

/** Which register the sentence is drawn in — the launcher's existing note classes, no new token. */
export type CredentialTone = 'note' | 'consequence'

export interface ProfileCredential {
  /** The whole sentence, adapter's words first. Never empty. */
  text: string
  /**
   * `consequence` only where something of the user's is copied. ⚠️ **171 §3's precedent** — the
   * yolo line is the other disclosure on this surface that reports a consequence rather than
   * offering advice, and it reuses `note warn` rather than inventing a token (080/107/125).
   */
  tone: CredentialTone
  /**
   * Whether this provider puts a credential in the folder — the one bit a test can assert without
   * comparing a string to the constant it was built from.
   */
  copies: boolean
}

/**
 * When the copy happens, in the launcher's own terms.
 *
 * ⛔ **Neither branch claims the copy HAS happened.** `009`: a surface may not imply a state it has
 * not established, and this function has established nothing — the probe can be refused during a
 * quit, and `provisionCodexAuth` throws rather than copying when the machine has no credential. Both
 * sentences state the rule and the earliest moment, which is what a person deciding needs and is
 * true either way.
 */
function timing(when: CredentialWhen): string {
  return when === 'new'
    ? 'It is copied when the conversation starts — nothing has been written for this name yet.'
    : 'It is copied the first time this app opens the profile: starting a conversation does it, and ' +
        'so does this screen asking the provider which models it can run.'
}

/**
 * What this surface may say about the selected profile's sign-in.
 *
 * `status` is `capabilities?.[provider]?.homeCredential` — ⚠️ **pass the launcher's own pending
 * placeholder for `null`** rather than defaulting here, so "nobody has answered yet" reaches the
 * screen as the provider's own sentence and not as a silence. That is the same choice `signIn` and
 * `reprovisionAuth` already make on this surface.
 */
export function profileCredential(
  status: CapabilityStatus,
  when: CredentialWhen,
): ProfileCredential {
  if (status.state === 'available') {
    // ⚠️ The note is optional on the type and every real declaration carries one; a provider that
    // omitted it would still have to say something, because silence here is the original defect.
    const said = status.note ?? 'This profile keeps a sign-in of its own.'
    return { text: `${said} ${timing(when)}`, tone: 'consequence', copies: true }
  }
  // ⛔ **`unwired` and `absent` render the same way and that is correct here**, which is unusual
  // enough to argue for: everywhere else the difference is *"a lead versus a limit"* and matters.
  // This surface is not offering a control — it is reporting what is in a folder — and for that
  // question the provider's own reason is the whole answer in both states. The distinction survives
  // in the data, where the next reader of the table can still see it.
  return { text: status.reason, tone: 'note', copies: false }
}
