import { inject, provide, shallowRef, type App, type InjectionKey, type Ref } from 'vue'

/** Takes a person to one conversation, through the screen's one door; `null` where none can. */
export type ConversationDoor = Readonly<Ref<((conversation: string) => void) | null>>

const DOOR: InjectionKey<ConversationDoor> = Symbol('conversation door')

/** The screen gives the surfaces it mounts its door. */
export function provideConversationDoor(door: ConversationDoor): void {
  provide(DOOR, door)
}

/** Gives a whole app one door; for an app that mounts surfaces without the screen. */
export function provideConversationDoorTo(app: App, door: ConversationDoor): void {
  app.provide(DOOR, door)
}

/**
 * The door above this component, or one that is always `null`: a surface mounted with no screen
 * above it draws no press, because nothing would make it work.
 */
export function useConversationDoor(): ConversationDoor {
  return inject(DOOR, null) ?? shallowRef(null)
}
