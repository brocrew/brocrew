import { scene } from '../capture'
import { waitingList } from '../fixtures/waiting-lists'

scene('waiting-list-approvals', (stage) => waitingList(stage, 'approvals'))
