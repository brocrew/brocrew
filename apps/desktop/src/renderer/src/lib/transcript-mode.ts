import type { TranscriptItem } from './transcript'

/** Keep conversation content and actionable notices visible; unknown events need Debug mode. */
export function isVisibleIn(item: TranscriptItem, debug = false): boolean {
  switch (item.kind) {
    case 'assistant':
      return item.streaming || item.text.trim() !== '' || (item.questions?.length ?? 0) > 0
    case 'notice':
      return item.level !== 'info' || item.wokenByAJob === true
    case 'unknown':
      return debug && item.category === 'unrecognized'
    case 'tool':
      return item.superseded !== true
    case 'continuation':
      return true
    case 'appNotice':
      return true
    case 'workReport':
      return true
    case 'relayed':
      return true
    case 'memoryNote':
      return true
    case 'memoryRecall':
      return true
    case 'memoryLoaded':
      return true
    case 'reset':
    case 'user':
    case 'queued':
    case 'permission':
    case 'userInput':
    case 'thinking':
    case 'plan':
    case 'subAgent':
    case 'image':
    case 'compaction':
      return true
    default: {
      const exhaustive: never = item
      void exhaustive
      return true
    }
  }
}

export function visibleItems(items: TranscriptItem[], debug = false): TranscriptItem[] {
  return items.filter((item) => isVisibleIn(item, debug))
}
