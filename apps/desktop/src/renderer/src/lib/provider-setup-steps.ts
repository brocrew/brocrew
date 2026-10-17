import type { AuthState, ProviderVersion } from '../../../shared/runtime-ipc'
import { A_STANDING_WARNS } from '../../../shared/runtime-ipc'
import { whyNoLogin, type ProviderSetupSays } from './provider-setup'

/**
 * Where a provider's setup stands, read from the facts the window already holds: its program's
 * version and standing, its sign-in, and whether a saved key was refused. A program this app
 * carries has nothing to install, so its setup is only the sign-in.
 */
export type SetupStep = 'install' | 'version' | 'sign-in' | 'ready'

export type SetupState =
  | { readonly step: 'install'; readonly kind: 'missing' | 'cannot-check' | 'found' }
  | { readonly step: 'version'; readonly kind: 'older' | 'unreadable' | 'passed' }
  | {
      readonly step: 'sign-in'
      readonly kind:
        'sign-in' | 'expired' | 'cannot-check' | 'key-refused' | 'key-unreadable' | 'signed-in'
    }
  | { readonly step: 'ready'; readonly kind: 'account' | 'api-key' }

export interface SetupFacts {
  /** `null` before the read lands. */
  readonly version: ProviderVersion | null
  /** `null` while nothing is set up outside BroBot, `undefined` while main does not say. */
  readonly setup: ProviderSetupSays | null | undefined
  /** `null` before the first answer. */
  readonly auth: AuthState | null
  /** A saved key whose account can't pay for a request. */
  readonly keyRefused: boolean
  /** What the app says of a saved key this computer can't read; absent or null when it can. */
  readonly keyUnreadable?: string | null
}

/** Whether there is a program to install and keep updated: not for a copy this app carries. */
export function hasAProgramToInstall(facts: SetupFacts): boolean {
  if (facts.setup === null) return false
  return facts.version?.program?.from !== 'carried'
}

export function setupSteps(facts: SetupFacts): readonly SetupStep[] {
  return hasAProgramToInstall(facts)
    ? ['install', 'version', 'sign-in', 'ready']
    : ['sign-in', 'ready']
}

export const STEP_WORD: Readonly<Record<SetupStep, string>> = {
  install: 'Install',
  version: 'Version',
  'sign-in': 'Sign in',
  ready: 'Ready',
}

const ORDER: Readonly<Record<SetupStep, number>> = {
  install: 0,
  version: 1,
  'sign-in': 2,
  ready: 3,
}

export function stepOrder(step: SetupStep): number {
  return ORDER[step]
}

/** A state that lets a person go on to the next step. */
export function passes(state: SetupState): boolean {
  return (
    state.kind === 'found' ||
    state.kind === 'passed' ||
    state.kind === 'signed-in' ||
    state.step === 'ready'
  )
}

/** Whether a fact could not be read at all: never said as missing or signed out. */
export function couldNotCheck(state: SetupState): boolean {
  return state.kind === 'cannot-check'
}

/** `null` while a fact this step needs has not been read yet. */
export function stateAt(step: SetupStep, facts: SetupFacts): SetupState | null {
  switch (step) {
    case 'install': {
      if (facts.version === null) return null
      const program = facts.version.program
      if (program === undefined) return { step, kind: 'cannot-check' }
      return { step, kind: program.standing === 'missing' ? 'missing' : 'found' }
    }
    case 'version': {
      const program = facts.version?.program
      if (program === undefined || program.standing === 'missing') return null
      if (!A_STANDING_WARNS[program.standing]) return { step, kind: 'passed' }
      return { step, kind: program.standing === 'unreadable' ? 'unreadable' : 'older' }
    }
    case 'sign-in': {
      const auth = facts.auth
      if (auth === null) return null
      // A saved key outranks the sign-in, so one that can't be read starts nothing, whatever the
      // sign-in behind it says.
      if (facts.keyUnreadable != null) return { step, kind: 'key-unreadable' }
      if (auth.state === 'usable') {
        return auth.login === 'api-key' && facts.keyRefused
          ? { step, kind: 'key-refused' }
          : { step, kind: 'signed-in' }
      }
      if (auth.state === 'stale') return { step, kind: 'expired' }
      if (auth.state === 'unknown') return { step, kind: 'cannot-check' }
      const why = whyNoLogin(auth)
      if (why === 'unreadable') return { step, kind: 'cannot-check' }
      if (why === 'expired') return { step, kind: 'expired' }
      return { step, kind: 'sign-in' }
    }
    case 'ready': {
      const auth = facts.auth
      if (auth?.state !== 'usable') return null
      return { step, kind: auth.login === 'api-key' ? 'api-key' : 'account' }
    }
  }
}

/**
 * The first step that does not pass yet, or Ready. `null` while a fact it needs is still being
 * read. A version newer than tested passes: only a standing that warns stops the version step.
 */
export function firstToDo(facts: SetupFacts): SetupState | null {
  for (const step of setupSteps(facts)) {
    const state = stateAt(step, facts)
    if (state === null) return null
    if (!passes(state)) return state
    if (step === 'ready') return state
  }
  return null
}

/** Ready by the facts the steps read: a program that runs, a usable sign-in, no refused key. */
export function isReady(facts: SetupFacts): boolean | null {
  const state = firstToDo(facts)
  return state === null ? null : state.step === 'ready'
}

/**
 * Where Next lands after the facts were read again: on the step's own fact passing, the next step
 * that needs doing; after the install, the version step, so its result is seen. An earlier step
 * that stopped passing comes first. Otherwise the same step, as the facts now say it. `advanced`
 * says whether it moved on.
 */
export function afterNext(
  current: SetupState,
  facts: SetupFacts,
): { readonly state: SetupState; readonly advanced: boolean } {
  const first = firstToDo(facts)
  if (first !== null && stepOrder(first.step) < stepOrder(current.step)) {
    return { state: first, advanced: false }
  }
  const here = stateAt(current.step, facts) ?? current
  if (!passes(here) || here.step === 'ready' || first === null) {
    return { state: here, advanced: false }
  }
  if (current.step === 'install') {
    const version = stateAt('version', facts)
    if (version !== null) return { state: version, advanced: true }
  }
  return { state: first, advanced: true }
}

/** The step before, as the facts say it now. */
export function stepBefore(current: SetupState, facts: SetupFacts): SetupState | null {
  const steps = setupSteps(facts)
  const at = steps.indexOf(current.step)
  if (at <= 0) return null
  return stateAt(steps[at - 1]!, facts)
}
