export const refusalWords = {
  'sign-in': {
    lead: 'Ask a person to sign in on the Codex card in Providers, or to save an API key there: the Codex sign-in could not be used.',
    more: 'Every Codex agent in this workspace uses that one sign-in, so signing in once signs them all in. BroCrew does not need restarting.',
  },
  settings: {
    lead: 'Ask a person to correct that agent\u2019s Codex settings (config.toml): they could not be used.',
    more: '',
  },
  'no-sign-in-to-copy': {
    lead: 'Ask a person to sign in on the Codex card in Providers, or to save an API key there: there is no Codex sign-in for that agent to start on.',
    more: 'Every Codex agent in this workspace uses the sign-in on the Codex card. BroCrew does not need restarting.',
  },
} as const
