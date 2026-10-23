export const refusalWords = {
  'sign-in': {
    lead: 'Ask a person to save an API key on the Codex card in Providers, or to sign that agent in from one of its conversations: its Codex sign-in could not be used.',
    more: 'Each agent has its own Codex sign-in, and the Codex card signs in only BroBot\u2019s own; in one of that agent\u2019s conversations, a refused message shows its sign-in buttons. BroCrew does not need restarting.',
  },
  settings: {
    lead: 'Ask a person to correct that agent\u2019s Codex settings (config.toml): they could not be used.',
    more: '',
  },
  'no-sign-in-to-copy': {
    lead: 'Ask a person to sign in on the Codex card in Providers, or to save an API key there: there is no Codex sign-in for that agent to start on.',
    more: 'A new agent starts on a copy of the Codex sign-in this computer keeps or, where it keeps none, of BroBot\u2019s own. BroCrew does not need restarting.',
  },
} as const
