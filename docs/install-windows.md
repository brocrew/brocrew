# Installing BroCrew on Windows

BroCrew's Windows installer is not signed. Windows will warn you about it, and these steps get you past the warning and set up your API keys.

## Before you install

- **Windows 10 or 11, 64-bit (x64).**
- **Git for Windows, recommended.** Claude runs its commands best in Git Bash, so install Git for Windows from <https://git-scm.com/download/win> first, with the default options.
- **Claude Code, to use Claude agents.** Install Claude Code first, from Anthropic: <https://code.claude.com/docs/en/setup>. BroCrew does not include it: it runs the Claude Code installed on your PC. Codex comes with BroCrew.
- **An API key for each agent you want to use:**
  - Claude: an Anthropic API key, from <https://platform.claude.com/settings/keys>.
  - Codex: an OpenAI API key, from <https://platform.openai.com/api-keys>.

  What the agents do is billed to the account the key belongs to. See [API keys](api-keys.md).

## Install

1. Download `BroCrew-Setup-….exe` from the latest release on the repository's **Releases** page. If your browser says the file is not commonly downloaded, choose to keep it.
2. Open it. Windows shows **"Windows protected your PC"**, because the installer is not signed. Choose **More info**, then **Run anyway**.
3. When the installer asks who to install for, choose **Only for me**, so it does not ask for an administrator. Keep the suggested folder or pick another, and finish.
4. Open **BroCrew** from the Start menu or the desktop shortcut. The first start takes a little longer.

## Add your API keys

1. In BroCrew, open **Settings** in the left rail, then **Providers**. If the setup window opens first, choose **Use an API key instead** to reach the same tab.
2. On the **Claude** card, paste your Anthropic key under **API key** and press **Save key**.
3. On the **Codex** card, do the same with your OpenAI key.
4. Press **Check it works** on each card. Claude's check sends one short message, which costs a tiny amount; Codex's model-list check costs nothing.

BroCrew keeps each key encrypted for your Windows account. To change a key, save the new one in the same place. To stop using a key, remove it there.

## Your first conversation

Choose **New conversation** in the left rail, pick a Claude or Codex model, and type what you want done. It works in BroCrew's own workspace folder. To give an agent a folder of your own, open it on the **Team** page, choose **New conversation…**, then **Choose a folder…**.

## If something goes wrong

- **"No Anthropic API key is set"**: the Claude card in Providers has no key yet. Add it as above.
- **"BroCrew found no Claude Code where its installers put it"**: install Claude Code as above, then start the conversation again.
- **A key was refused**: press **Check it works** under **API key** on that card, and replace the key if the provider refuses it. See [API keys](api-keys.md#if-a-key-stops-working).
- **Anything else**: note what you did and what BroCrew said, and send it to whoever gave you the link.

## Updating and removing

- **Updates.** BroCrew checks GitHub for a newer version when it starts and once a day. GitHub sees your IP address and whether it is a Windows or a Mac BroCrew, and nothing else. Turn it off with **Check automatically**, in the menu that opens when you press the workspace name at the bottom of the left rail. When there is a new version, you choose to download it; BroCrew checks it against the SHA-512 checksum the release publishes, and installs it when you choose to restart, once nothing is running. You can also run a newer installer from the Releases page over the old one.
- **If you have BroBot or BroBot2 installed** (the beta's earlier names), the BroCrew installer replaces it. Your conversations, settings and saved keys stay, and the Start menu entry and desktop shortcut are now called BroCrew. The app keeps the folder the old one was installed in, and BroCrew goes in a folder inside it, such as `…\Programs\BroBot\BroCrew`: that is expected. If you pinned the old app to the taskbar, unpin it and pin BroCrew instead. If you installed it for all users rather than only for yourself, choose the same again, or uninstall it first: otherwise you get both.
- **If you also run BroCrew from source** on the same PC, both use the same data folder, so they share your conversations, settings and keys, and only one can run at a time. See [Where BroCrew keeps its data](data-folder.md). A BroCrew run from source never checks for updates; update it with `git pull`.
- **To remove BroCrew**, go to **Settings → Apps**, find BroCrew, and choose **Uninstall**. Your conversations and settings stay in `%APPDATA%\@brobot2\desktop`. Delete that folder too if you want nothing left behind.
