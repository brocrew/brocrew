import { scene } from '../capture'
import { waitingPage } from '../fixtures/waiting'

scene('waiting-details', (stage) => waitingPage(stage, true))
