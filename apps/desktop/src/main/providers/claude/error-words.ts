export const STALE_AUTH_NOTICE =
  'The sign-in this conversation was launched with is no longer valid, so it cannot continue on ' +
  'it. Its transcript is kept. If your machine’s Claude login was renewed elsewhere on this computer, ' +
  'this app carries it on with the new login by itself, and a line below says so. Otherwise, send ' +
  'it a message to carry on: that reads your machine login again, and says so if that login has ' +
  'expired too. It carries on without its “Allow for this conversation” approvals or ' +
  'anything that was running in the background.'

export const STALE_KEY_NOTICE =
  'Anthropic refused the API key this conversation was started with, so it cannot continue on it. ' +
  'Its transcript is kept. Press “Check it works” under “API key” on the Claude card in Providers, and ' +
  'replace the key if it is refused; then send this conversation a message to carry on, which ' +
  'starts it again and reads the key afresh. It carries on without its “Allow for this ' +
  'conversation” approvals or anything that was running in the background.'
