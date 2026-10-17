import { computed, ref, shallowReactive, watch, type ComputedRef, type Ref } from 'vue'
import {
  MAX_MESSAGE_PATH_LENGTH,
  MAX_MESSAGE_PATHS,
  type MessagePath,
} from '../../../shared/runtime-ipc'
import { answerFor, fileManagerWord, pressFailedWords, type PathCalls } from '../lib/message-paths'
import { escaped } from '../lib/named-in-a-reply'
import {
  markPathsIn,
  pathClicked,
  pathsNamedIn,
  type PathWords,
} from '../lib/the-paths-a-message-names'

/**
 * What a pane hands its messages so a path in them can be pressed: one conversation, main's answers
 * for it so far, and the two presses.
 */
export interface PathsHere {
  readonly sessionId: string | null
  readonly words: PathWords
  /** Main's answer for a text, or undefined while it has not answered. Reactive. */
  known(text: string): MessagePath | undefined
  /** Asks main about the texts it has not been asked about yet, in one call. */
  ask(texts: readonly string[]): void
  /** Opens or shows the path a text names. Resolves to the line to show when it did not work. */
  press(text: string, pressed: 'open' | 'show'): Promise<string | null>
}

/**
 * The main window's calls. Null where the bridge does not carry them, which only a test's stand-in
 * bridge does; every path then stays plain text.
 */
export function runtimePathCalls(): PathCalls | null {
  const runtime = typeof window === 'undefined' ? undefined : window.api?.runtime
  if (typeof runtime?.resolveMessagePaths !== 'function') return null
  return {
    resolve: (ask) => runtime.resolveMessagePaths(ask),
    reveal: (target) => runtime.revealMessagePath(target),
    open: (target) => runtime.openMessagePath(target),
  }
}

function fileManagerHere(): string {
  return fileManagerWord(typeof navigator === 'undefined' ? '' : navigator.platform)
}

/**
 * One pane's paths: asked once per text and conversation, kept for as long as the pane lives, and
 * never asked again on a timer.
 *
 * @param calls the window's calls, or null while it may not ask; every path is then plain text.
 *   Without an open call the main control shows too.
 */
export function useMessagePaths(
  sessionId: () => string | null,
  calls: () => PathCalls | null,
): ComputedRef<PathsHere | null> {
  const answers = shallowReactive(new Map<string, MessagePath>())
  const asking = new Set<string>()
  const fileManager = fileManagerHere()
  const keyOf = (session: string | null, text: string): string => `${session ?? ''}\n${text}`

  return computed(() => {
    const here = calls()
    if (here === null) return null
    const session = sessionId()
    const words: PathWords = { canOpen: here.open !== null, fileManager }
    const known = (text: string): MessagePath | undefined => answers.get(keyOf(session, text))

    const settle = (texts: readonly string[], said: readonly MessagePath[]): void => {
      texts.forEach((text, index) => {
        answers.set(keyOf(session, text), answerFor(text, said[index]))
        asking.delete(keyOf(session, text))
      })
    }

    return {
      sessionId: session,
      words,
      known,
      ask(texts) {
        const fresh = [...new Set(texts)]
          .filter((text) => text !== '' && text.length <= MAX_MESSAGE_PATH_LENGTH)
          .filter((text) => !answers.has(keyOf(session, text)) && !asking.has(keyOf(session, text)))
          .slice(0, MAX_MESSAGE_PATHS)
        if (fresh.length === 0) return
        for (const text of fresh) asking.add(keyOf(session, text))
        // A refused or failed call leaves those texts plain, and they are not asked again.
        here.resolve({ sessionId: session, texts: fresh }).then(
          (said) => settle(fresh, said),
          () => settle(fresh, []),
        )
      },
      async press(text, pressed) {
        if (text === '') return null
        const answer = known(text)
        const kind = answer?.found === true ? answer.kind : 'file'
        const opening = pressed === 'open' && here.open !== null
        try {
          if (opening && here.open !== null) {
            const did = await here.open({ sessionId: session, text })
            return did.ok ? null : pressFailedWords(did.reason, kind, fileManager, 'open')
          }
          const shown = await here.reveal({ sessionId: session, text })
          return shown.ok ? null : pressFailedWords(shown.reason, kind, fileManager, 'show')
        } catch {
          return pressFailedWords('failed', kind, fileManager, opening ? 'open' : 'show')
        }
      },
    }
  })
}

/** One message's paths: what to draw, the line under it, and its one click handler. */
export interface PathsInAMessage {
  /** The message's rendered HTML with every found path marked. */
  mark(html: string): string
  /** Plain text as HTML with its found paths marked, or null when it has none to mark. */
  markText(text: string): string | null
  /** What the last press did not manage, in plain words. */
  readonly failure: Ref<string | null>
  /** Delegated: bind it once on the element holding the message. */
  clicked(event: MouseEvent): void
}

/**
 * Asks about one message's paths once it has settled, and only again if its texts change.
 *
 * @param htmls the message's rendered HTML pieces, or an empty list while it is still streaming.
 */
export function usePathsIn(
  paths: () => PathsHere | null | undefined,
  htmls: () => readonly string[],
): PathsInAMessage {
  const failure = ref<string | null>(null)
  const texts = computed(() => {
    if (!paths()) return []
    return [...new Set(htmls().flatMap(pathsNamedIn))].slice(0, MAX_MESSAGE_PATHS)
  })

  watch(
    [() => paths() ?? null, () => texts.value.join('\n')],
    ([here]) => {
      if (here !== null && texts.value.length > 0) here.ask(texts.value)
    },
    { immediate: true },
  )

  const mark = (html: string): string => {
    const here = paths()
    return here ? markPathsIn(html, here.known, here.words) : html
  }

  return {
    mark,
    markText(text) {
      if (!paths()) return null
      const html = escaped(text)
      const marked = mark(html)
      return marked === html ? null : marked
    },
    failure,
    clicked(event) {
      const here = paths()
      const hit = here ? pathClicked(event.target) : null
      if (!here || hit === null) return
      event.preventDefault()
      failure.value = null
      void here.press(hit.text, hit.pressed).then((said) => {
        failure.value = said
      })
    },
  }
}
