import type { TranscriptItem } from './transcript'

/** Keep conversation content, actionable notices and unrecognized events visible. */
export function isVisibleIn(item: TranscriptItem): boolean {
  switch (item.kind) {
    case 'assistant':
      return item.streaming || item.text.trim() !== '' || (item.questions?.length ?? 0) > 0
    case 'notice':
      return item.level !== 'info' || item.wokenByAJob === true
    case 'unknown':
      if (item.label === 'dev_intent') return false
      return item.category === 'unrecognized'
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

export function visibleItems(items: TranscriptItem[]): TranscriptItem[] {
  return items.filter(isVisibleIn)
}
