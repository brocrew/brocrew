import type { CapabilityStatus, ModelCatalogue, ModelChoice } from '../../../shared/runtime-ipc'
import { COPY_MACHINE_SIGN_IN, SIGN_IN_HERE } from './credential-words'

/**
 * 🔴 **What the model field may say, decided ONCE** (310).
 *
 * ## Distinguish a missing model list from a provider refusal
 *
 * New conversation · provider `codex` · profile **`+ New profile…`** · the model box a plain text
 * input reading *provider default* · reasoning offering only *provider default*. He read it as
 * *"Codex has no model dropdown"* and reported it as a Codex defect.
 *
 * ⛔ **Codex's catalogue was seven rows, with per-model efforts up to `ultra`.** Nothing was broken.
 * The profile did not exist yet, so nothing had been asked — and *"nothing has been asked"* rendered
 * exactly like *"we asked and were refused"*, like *"we are still asking"*, and like *"there is a
 * list and you have not opened it"*. ⚠️ **The one thing a person could not do was find out which**,
 * which is why a healthy provider was reported as broken.
 *
 * ## Why a function and not four `v-if`s
 *
 * `299`'s `permission-offer.ts`, `214`'s `user-input-offer.ts` and `305`'s `home-attention.ts` are
 * the same shape and the same argument: **one pure function decides what every surface may draw, so
 * there is no second predicate to drift.** Two surfaces read a model catalogue then — the launcher's
 * combobox and the drawer's live `model` select — and before this they each collapsed the absence
 * their own way. ⚑ **Since UI-012 the one reader is the model picker's provider section**
 * (`ModelPicker.vue`), wherever it is drawn. The drawer's copy said *"This provider named no models"* over a REFUSED probe,
 * which is a claim about a provider invented out of a fact about us; its own comment admitted it.
 *
 * ## ⚠️ The `[]` rule is preserved, in one place instead of two
 *
 * `058`'s review established that an empty list and no list give the same INSTRUCTION downstream —
 * a `datalist` with nothing in it is a dropdown arrow that opens onto emptiness, which reads as a
 * broken control rather than an absent one. {@link ModelField.choices} is that collapse and it is
 * the only one. ⛔ **They do not give the same SENTENCE**: `empty` says the provider listed none,
 * and nothing here may turn *"it said none"* into *"we could not ask"*.
 *
 * ## What this is NOT allowed to do
 *
 * ⛔ **It never names a provider.** `039`'s rule, enforced by `provider-neutrality.test.ts`: the id
 * arrives as {@link ModelFieldWorld.provider} and is interpolated, never compared. Every remedy is
 * decided from the CAPABILITIES the adapters declare — which is how one function says *"sign in to
 * this profile"* on one provider and *"starting a Claude conversation renews it"* on the other
 * without knowing either of their names.
 */

/**
 * Which of the six things is true about this provider's catalogue, here, now — one of them a menu,
 * and five of them silences.
 *
 * ⚠️ **FIVE silences, not the three the ticket named**, and the two extra are not padding:
 *
 *  - `empty` was always distinct from a refusal upstream (`058` review) and had no distinct sentence;
 *  - `asking` cannot come from the wire at all — {@link ModelCatalogue} is what a SETTLED probe
 *    produced, so *"still asking"* is the renderer holding no answer yet, and it is the state a
 *    person spends the first second of every launcher in.
 */
export type ModelFieldState = 'listed' | 'empty' | 'asking' | 'no-profile' | 'closing' | 'refused'

/** How loudly to draw {@link ModelField.message}. */
export type ModelFieldTone = 'note' | 'warn'

export interface ModelField {
  state: ModelFieldState
  /**
   * The rows to offer, or `null` when there is no menu to offer.
   *
   * ⛔ **The ONLY place `[]` and a silence become one thing**, and they become one thing here
   * because they give one instruction: draw no `datalist`. See the note above.
   */
  choices: ModelChoice[] | null
  /**
   * What to say beside the field — or `null` in the one state where the menu IS the message.
   *
   * ⚠️ **`listed` is the only `null`, and that is a single meaning rather than the four this
   * dispatch removed.** Nothing reads it as a state: {@link state} is the discriminant, and a
   * surface that wants to know whether there is a menu asks {@link choices}.
   */
  /**
   * ⛔ **The FACT, and only the fact.** What to do about it instead is the reading surface's
   * business — since UI-012 the picker's provider section, which offers a person's own models and
   * *+ Add* beside it. A sentence here that named a control would be wrong the day the control
   * changed, as the free-text box and the `<select>` both did.
   */
  message: string | null
  tone: ModelFieldTone
  /**
   * What to DO about it, in the words of the button that does it — or `null` when there is nothing
   * to do, which is most of the time.
   *
   * ⛔ **Only `refused` has one.** `no-profile` resolves itself by starting the conversation,
   * `asking` by waiting, `closing` by the app being gone, and `empty` is the provider's answer.
   * Offering a remedy for any of those would be `106`'s control that cannot act, in sentence form.
   */
  remedy: string | null
}

export interface ModelFieldWorld {
  /**
   * What this provider said about this profile, or `null` when no answer is held.
   *
   * ⚠️ **`null` here is one fact and not four** — nobody has answered yet — because the other three
   * now arrive as {@link ModelCatalogue} arms. Which of "still asking" and "never asked" it means is
   * decided by {@link profileExists} and nothing else.
   */
  catalogue: ModelCatalogue | null
  /**
   * Whether the profile this field is about exists on disk yet.
   *
   * ⛔ **The launcher's `+ New profile…` never reaches the host at all**, which is why this is an
   * input rather than something the catalogue could carry. `RuntimeScreen.profilesToProbe` only asks
   * about profiles that are in the list, so a name still being typed produces no probe, no answer,
   * and — before this — no sentence. The host's own `no-profile` arm covers the race where the list
   * moved underneath a probe; both land in the same state, which is the point.
   *
   * ⚠️ **`true` while the profile LIST itself has not arrived.** That reads as `asking`, which is
   * what is really happening: a read is out. Guessing `false` there would tell a person their
   * profile does not exist because we had not finished looking.
   */
  profileExists: boolean
  /** The provider id, for interpolation only — ⛔ never compared (039). */
  provider: string
  /** Whether this provider can be signed into inside a profile (098) — asked, never inferred. */
  signIn: CapabilityStatus
  /** Whether the machine credential can be copied into it — a separate capability (098 review 15). */
  reprovision: CapabilityStatus
}

/**
 * ⛔ **The sentence for a profile that does not exist yet — written ONCE, reached two ways.**
 *
 * The launcher gets here without asking anybody (`+ New profile…` is not a profile to probe), and
 * the host gets here by refusing to probe a name it has no home for. ⚠️ **Two paths, one fact**, so
 * two copies of the sentence would be the drift this whole module exists to prevent — in the module
 * itself, which is how these things actually happen.
 *
 * ⚑ **It says what WILL happen.** *"This is not an error"* is a claim a person has to take on
 * trust; a sentence that describes the next step is one they can act on, and it is what makes a
 * plain box read as waiting rather than as broken.
 *
 * ⛔ **And it stops there.** *"…so type an id or leave the box empty"* was in this sentence and is
 * not any more: it was true of the launcher's combobox and false of the drawer's `<select>`, and a
 * shared function that describes one surface's control is how the next drift starts. What a
 * control offers instead is that control's own sentence — see {@link ModelField.message}.
 */
function comingWithTheProfile(): string {
  return (
    'The model list arrives once this profile exists — it is created when the conversation ' +
    'starts, not now.'
  )
}

/**
 * What to offer a person whose probe was refused — in the words of the gesture that would fix it.
 *
 * ⛔ **Decided from the declared capabilities, never from the provider's name** (039). Codex
 * declares `signIn: available`, so the remedy is the panel's primary button. Claude declares both
 * `absent`, and its `reprovisionAuth.reason` is already an INSTRUCTION rather than an explanation —
 * *"If it has expired, starting a Claude conversation renews it"* — which is the machine
 * sign-in, in the adapter's own words. Writing a parallel sentence here would be a second copy to
 * keep true; `capabilities.ts` is the one place either is edited.
 *
 * ⚠️ **A refused probe is not proof of a credential problem** — a missing binary refuses too — so
 * this is offered as the thing to check rather than asserted as the cause. The catalogue's own
 * `detail` is what says what actually happened, and it is rendered beside this.
 */
function remedyFor(world: ModelFieldWorld): string {
  if (world.signIn.state === 'available') {
    return `If this profile is not signed in: ${SIGN_IN_HERE}.`
  }
  if (world.reprovision.state === 'available') {
    return `If this profile is not signed in: ${COPY_MACHINE_SIGN_IN}.`
  }
  return world.reprovision.reason
}

/**
 * ⛔ **One answer, read by every surface that draws a model catalogue.**
 *
 * Pure and exported for the reason `home-attention.ts` gives: nothing mounts a component in the SSR
 * project, so a rule left inside a `computed` is a rule a test can only reach through HTML.
 */
export function modelField(world: ModelFieldWorld): ModelField {
  const silent = { choices: null, tone: 'note', remedy: null } as const
  // 🔴 **FIRST, and ahead of any answer that is being held** — which is a rule found by the DOM test
  // for this dispatch rather than reasoned out in advance.
  //
  // The first version read the catalogue first and only asked about the profile when nothing was
  // held. That is wrong in a way that has a name: `256` H1, *"a second profile's launcher quietly
  // presenting the default profile's catalogue"*. ⚠️ **A catalogue cannot be ABOUT a profile that
  // does not exist**, so an answer still on the page from the profile chosen a moment ago is stale
  // by construction — and the launcher really is in that position for a tick, because the model map
  // and the profile choice arrive from two different places.
  //
  // ⛔ **Safe because `profileExists` is `true` while the profile LIST has not arrived** (see its
  // own doc). `false` therefore means the list came back and this name was not in it, which is not
  // a state a real catalogue can coexist with.
  if (!world.profileExists) {
    return {
      ...silent,
      state: 'no-profile',
      // ⛔ **This must not read as broken**, because it is the normal path for every first
      // conversation in a new profile — and it is the sentence whose absence made a healthy
      // provider look defective. It says what will happen, not what went wrong.
      message: comingWithTheProfile(),
    }
  }
  const held = world.catalogue
  if (held === null) {
    return {
      ...silent,
      state: 'asking',
      // ⚠️ Present tense and no blame. A slow probe that looked like an absent list is one of the
      // four things the old `null` said, and it is the one that resolves on its own.
      message: `Asking ${world.provider} what it can run…`,
    }
  }
  if (held.ok) {
    return held.models.length > 0
      ? { state: 'listed', choices: held.models, message: null, tone: 'note', remedy: null }
      : {
          ...silent,
          state: 'empty',
          // ⚠️ **"listed none", never "could not be asked"** — the trap this dispatch was warned
          // about, and the one 058's review already drew upstream. We could ask, and it said none.
          message: `${world.provider} listed no models for this profile, so there is no menu.`,
        }
  }
  // ⚑ **Reachable even though the guard above covers the launcher's own case**: the HOST answers
  // `no-profile` when the profile list moved underneath a probe, and the drawer — where a session
  // is running, so `profileExists` is a constant `true` — has no other way to hear it.
  if (held.reason === 'no-profile') {
    return { ...silent, state: 'no-profile', message: comingWithTheProfile() }
  }
  if (held.reason === 'closing') {
    return {
      ...silent,
      state: 'closing',
      // A fact about US. The provider is not implicated and the sentence must not implicate it.
      message: `BroCrew is closing, so ${world.provider} was not asked what it can run.`,
    }
  }
  // ⚑ **The provider's own diagnostic, which is the only copy of it** — 098's rule, on the path that
  // never had it. A reason in a `console.warn` is a reason nobody in front of the app can act on,
  // and this branch has been logging one since 058.
  //
  // ⚠️ **A blank one drops the colon rather than dangling one.** `errorMessage` has never returned
  // an empty string here, so this is a shape the type allows and the producer does not — and a
  // sentence ending in *"what it can run: "* is worse than the same sentence without a clause.
  const said = held.detail.trim()
  return {
    state: 'refused',
    choices: null,
    message: `${world.provider} could not be asked what it can run${said === '' ? '.' : `: ${said}`}`,
    tone: 'warn',
    remedy: remedyFor(world),
  }
}
