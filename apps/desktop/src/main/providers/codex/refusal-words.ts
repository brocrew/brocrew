export const refusalWords = {
  'sign-in': {
    lead: 'Ask a person to sign in on the Codex card in Providers, or to save an API key there: the Codex sign-in could not be used.',
    more: 'Codex agents on one account share one sign-in, so signing in once signs them all in. BroCrew does not need restarting.',
  },
  settings: {
    lead: 'Ask a person to correct that agent\u2019s Codex settings (config.toml): they could not be used.',
    more: '',
  },
  'no-sign-in-to-copy': {
    lead: 'Ask a person to sign in on the Codex card in Providers, or to save an API key there: there is no Codex sign-in for that agent to start on.',
    more: 'A new agent starts on the Codex sign-in BroBot\u2019s own uses. BroCrew does not need restarting.',
  },
} as const
