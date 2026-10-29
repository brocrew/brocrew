<p align="center"><img src="docs/images/logo.png" alt="BroCrew's logo: a small white robot on a navy tile" width="128"></p>

# BroCrew

**Give one agent a project. Follow the team's work in one tree, answer requests in one queue, and get a report back.**

[![Latest release](https://img.shields.io/github/v/release/brocrew/brocrew)](https://github.com/brocrew/brocrew/releases/latest) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE) ![Platforms: macOS Apple Silicon and Windows beta](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon%20%C2%B7%20Windows%20beta-lightgrey)

![BroCrew: describe a project, watch agents hand work to each other, answer requests, read the result.](docs/images/hero.gif)

**[Download](https://github.com/brocrew/brocrew/releases/latest)** · [Install guide](#install) · [Run from source](docs/run-from-source.md)

BroCrew is an open-source desktop app that brings AI agents together on your computer. Give an agent a task and it can share the work with other agents, Claude and Codex in the same tree. Each agent keeps its own memory and rules across conversations. Use your own Anthropic or OpenAI API key, and the provider bills your usage ([requirements and cost](docs/requirements-and-cost.md)).

Additional providers are planned.

## What's new in 0.1.8

0.1.8 focuses on plugins. Removing one plugin no longer makes the others unavailable, and the plugin service gets more time to start on a slow or just-started Mac. Plugins are new and still early, so tell us if one misbehaves. [Release notes and downloads](https://github.com/brocrew/brocrew/releases/tag/v0.1.8).

## See it work

**1. Describe the project and the team.** Type what you want, and how you'd like the team set up.

![The New conversation page with a short request typed in.](docs/images/new-conversation.png)

**2. Follow agents as they hand work to each other.** Every request is a piece of work with an owner. The Graph draws the tree as it grows, and the panel on the right shows each agent's model, files and the agents it started.

![The Graph tab with BroBot, a project manager, a developer and a reviewer, and the agent panel on the right.](docs/images/graph-panel.png)

**3. Answer questions and review approval requests in one place.** Questions from agents appear in the conversation, and everything that needs you waits under **Waiting on you**.

![An agent's question about the confirmation wording, waiting for an answer.](docs/images/question.png)

![The Waiting on you list with a pending request.](docs/images/waiting-on-you.png)

Approval behaviour depends on the provider. In Ask mode, Claude asks when its permission system requires approval, and Codex can run commands inside its own sandbox without asking. When approval is needed, you see the request and its exact action before it runs. See [Safety](docs/safety.md).

![An approval request: the action is shown in full, with Approve, Deny and Cancel turn.](docs/images/approval.png)

**4. Read the result.** A finished piece of work comes back with its outcome, what was checked, what wasn't, and where the files are.

![A project manager's report: result, checks, what wasn't checked, and files.](docs/images/result.png)

## Not just code

Ask for any kind of project in the same conversation. You can ask for a manager and a crew for each new project, and the Graph grows as they are recruited, with Claude and Codex agents side by side.

![The Graph growing as a second project is recruited.](docs/images/growing-graph.gif)

## Install

Get the latest build from the [Releases page](https://github.com/brocrew/brocrew/releases/latest):

| Your computer                        | File                              |
| ------------------------------------ | --------------------------------- |
| Mac with Apple Silicon (M1 or later) | `BroCrew-<version>-arm64.dmg`     |
| Windows 10 or 11, 64-bit (beta)      | `BroCrew-Setup-<version>-x64.exe` |

The Mac download isn't notarized, and the Windows download isn't signed, so your computer will warn you the first time. Follow the [Mac install guide](docs/install-macos.md) or [Windows install guide](docs/install-windows.md) to open the app.

Prefer the terminal? [Run from source](docs/run-from-source.md).

## First steps

- For Claude in the downloaded app, install [Claude Code first](docs/first-steps.md). Codex is included.
- Open **Settings → Providers** and connect Claude or Codex with an API key. See [setup help](docs/first-steps.md).
- Choose **New conversation**, pick a model and type what you want done.

## Learn more

- [How it works](docs/how-it-works.md)
- [Plugins](docs/plugins.md)
- [Safety](docs/safety.md)
- [Requirements and cost](docs/requirements-and-cost.md)
- [Providers](docs/providers.md)
- [Updates](docs/updates.md)
- [Data folder](docs/data-folder.md)
- [Contributing](docs/development.md#contributing)

## License

BroCrew is licensed under [Apache-2.0](LICENSE).
