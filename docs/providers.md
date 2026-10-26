# Providers

- **Claude**, through Anthropic's Claude Agent SDK and Claude Code, with your Anthropic API key. A downloaded BroCrew uses the Claude Code you install; run from source, it uses the one that comes with the SDK.
- **Codex**, through the bundled Codex app server, with your OpenAI API key.

Either way, you bring your own key and pay the provider directly. Stable automatic update checks and their offered downloads start at brocrew.app; GitHub hosts the release files. See [Updates](updates.md) for fallback, beta and manual-check behavior. BroCrew also contacts GitHub for the plugin list and plugin downloads, and Anthropic or OpenAI when you press **Check it works** on a key. The Claude Code and Codex programs it runs talk to their own providers, and the WhatsApp plugin talks to WhatsApp.

## Included software

The downloadable builds also include the Codex CLI, Anthropic's Claude Agent SDK library and other components, each under its own license or terms. The Claude Agent SDK isn't open source: its use is subject to Anthropic's terms. Claude Code isn't included in the downloads; you install it from Anthropic. Running from source, `pnpm install` fetches these components, Claude Code included, from npm under their own terms. See [THIRD-PARTY-NOTICES.md](../apps/desktop/THIRD-PARTY-NOTICES.md) for all of them.

OpenAI and the OpenAI logo are trademarks of OpenAI. They are not covered by this project's licence.
