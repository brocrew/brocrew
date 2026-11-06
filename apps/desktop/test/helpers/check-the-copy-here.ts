import { checkTheCopy, type VerifyCopy } from '../../src/main/recovery/copy-check'

/**
 * A recovery copy's check, run in the test's own thread: the same check the app's worker runs, for
 * tests about what a checkpoint does with its answer rather than where it is run.
 */
export const checkTheCopyHere: VerifyCopy = (copy) => Promise.resolve(checkTheCopy(copy))
