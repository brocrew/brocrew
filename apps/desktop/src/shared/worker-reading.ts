/** A normal worker's stable identity; this says nothing about whether it is free or working. */
export interface WorkerBindingReading {
  readonly identity: string
  readonly giver: string
  readonly number: number
  readonly bornAs: string
}
