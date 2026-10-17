/**
 * Allocate each live-step wait the smaller of its requested bound and remaining step time.
 * When none remains, throw the step's expiry instead of starting another wait. This does
 * not interrupt a wait already running; the outer `withinLiveDeadline` race ends the step.
 *
 * @param {{ deadlineAt: number, expire: () => Error, now?: () => number }} clock
 * @returns {(wanted: number) => number}
 */
export function budgetClock({ deadlineAt, expire, now = () => Date.now() }) {
  return (wanted) => {
    const left = deadlineAt - now()
    if (left <= 0) throw expire()
    return Math.min(wanted, left)
  }
}
