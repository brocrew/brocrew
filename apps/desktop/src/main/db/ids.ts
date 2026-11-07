import { randomUUID } from 'node:crypto'

export const newProviderSessionId = (): string => `sess_${randomUUID()}`
export const newEventId = (): string => `evt_${randomUUID()}`
export const newTurnId = (): string => `turn_${randomUUID()}`
export const newWorkId = (): string => `work_${randomUUID()}`

export const newResourceId = (): string => `res_${randomUUID().replaceAll('-', '')}`

export const newAskedQuestionId = (): string => `req_${randomUUID()}`

export const newInstructionAskId = (): string => `iprop_${randomUUID()}`

/** `msreq_<uuid>`: one request an agent made for the person to register an MCP server. */
export const newMcpServerRequestId = (): string => `msreq_${randomUUID()}`
