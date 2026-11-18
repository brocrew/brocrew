import type { KeptFold, SnapshotFoldAnswers } from './ledger-fold-state'

/** Estimates strings, containers and their entries without serializing a fold. */
function retainedBytes(value: unknown, limit: number): number {
  const seen = new Set<object>()
  let bytes = 0
  const visit = (held: unknown): void => {
    if (bytes > limit) return
    if (typeof held === 'string') bytes += held.length * 2
    else if (typeof held === 'function') bytes = limit + 1
    else if (held === null || typeof held !== 'object') bytes += 8
    else if (!seen.has(held)) {
      seen.add(held)
      bytes += 64
      if (held instanceof Map) {
        bytes += held.size * 48
        if (bytes > limit) return
        for (const [key, entry] of held) {
          visit(key)
          visit(entry)
          if (bytes > limit) return
        }
      } else if (held instanceof Set) {
        bytes += held.size * 32
        if (bytes > limit) return
        for (const entry of held) {
          visit(entry)
          if (bytes > limit) return
        }
      } else if (Array.isArray(held)) {
        bytes += held.length * 8
        if (bytes > limit) return
        for (const entry of held) {
          visit(entry)
          if (bytes > limit) return
        }
      } else {
        for (const key in held) {
          if (!Object.hasOwn(held, key)) continue
          bytes += key.length * 2 + 16
          visit((held as Record<string, unknown>)[key])
          if (bytes > limit) return
        }
      }
    }
  }
  visit(value)
  return bytes
}

/** One shared retained-byte budget; dropping an answer leaves its canonical fold available. */
export function windowFoldCache(limit = 128 * 1024 * 1024): SnapshotFoldAnswers {
  type Answer = KeptFold<unknown>
  type Slot = { owner: string; fold: Answers; bytes: number }
  const oldest = new Map<Slot, true>()
  const measured = new WeakMap<Answer, number>()
  let bytes = 0

  class Answers extends Map<string, Answer> {
    private readonly slots = new Map<string, Slot>()

    override set(owner: string, answer: Answer): this {
      this.delete(owner)
      let size = measured.get(answer)
      if (size === undefined) {
        size = retainedBytes(answer, limit)
        measured.set(answer, size)
      }
      const cost = size + owner.length * 2 + 128
      if (cost > limit) return this
      while (bytes + cost > limit) {
        const first = oldest.keys().next().value!
        first.fold.delete(first.owner)
      }
      const slot = { owner, fold: this, bytes: cost }
      this.slots.set(owner, slot)
      oldest.set(slot, true)
      bytes += cost
      return super.set(owner, answer)
    }

    override delete(owner: string): boolean {
      const slot = this.slots.get(owner)
      if (slot !== undefined) {
        bytes -= slot.bytes
        oldest.delete(slot)
        this.slots.delete(owner)
      }
      return super.delete(owner)
    }

    override clear(): void {
      for (const owner of this.keys()) this.delete(owner)
    }
  }

  class Folds extends Map<string, Map<string, Answer>> {
    override get(name: string): Answers {
      let answers = super.get(name) as Answers | undefined
      if (answers === undefined) {
        answers = new Answers()
        super.set(name, answers)
      }
      return answers
    }

    override clear(): void {
      for (const answers of this.values()) answers.clear()
      super.clear()
    }
  }
  return new Folds()
}
