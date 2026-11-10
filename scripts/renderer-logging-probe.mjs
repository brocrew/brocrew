import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'
import { rendererLoggingProbe } from '../apps/desktop/scripts/renderer-logging-probe.mjs'

await rendererLoggingProbe([HIDDEN_LAUNCH_ARG])
