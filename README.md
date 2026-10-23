<p align="center"><img src="docs/images/logo.png" alt="BroCrew's logo: a small white robot on a navy tile" width="128"></p>

# BroCrew

**An open-source desktop app where AI agents hand work to each other — and you decide how much they do on their own.**

[![Latest release](https://img.shields.io/github/v/release/brocrew/brocrew)](https://github.com/brocrew/brocrew/releases/latest) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE) ![Platforms: macOS Apple Silicon and Windows beta](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon%20%C2%B7%20Windows%20beta-lightgrey)

## What it is

BroCrew brings AI agents together on your computer.
Give an agent a task, and it can share the work with other agents.
Each agent keeps its own memory and rules across conversations.
Use it for coding, writing, research or other projects, with your own Anthropic or OpenAI API key.

![BroCrew's Graph: one request turns into a tree of agents, each holding its own piece of work.](docs/images/graph-demo.gif)

## See it work

**One request becomes a tree of work.** You ask BroBot, the first agent, for two projects. It starts a project manager for each, and they bring in developers and reviewers. Every box is an agent and every line is work handed down. Claude and Codex agents sit in the same tree.

![The Graph tab showing BroBot, two project managers and their developers and reviewers.](docs/images/graph.png)

**You decide how far they go.** In the default "ask" mode, an agent stops and asks before it runs a command or changes a file. Everything that needs you waits in one list, **Waiting on you**.

![An approval card: the agent wants to run a build and waits for Approve or Deny.](docs/images/conversation.png)

**Work comes back with a result.** When a piece of work is finished, its owner reports what was fixed, what wasn't checked, and where the files are.

![A project manager's report: what was fixed, what wasn't checked, and where the report is.](docs/images/hand-back-summary.png)

## Why BroCrew

- **You can see who is doing what.** Every request is a piece of work with an owner. Agents can hand pieces on to other agents, and the Graph draws the tree as it grows. An agent can run on Claude or on Codex, in the same tree.
- **You stay in charge.** Approvals, questions and stalled work all land in one place, so you don't hunt through tabs to find the agent that is waiting for you.
- **Agents that last.** Each agent keeps its own memory and standing rules, so it doesn't start from nothing every time you talk to it.

> In one real run, BroBot reported: "Chen (Claude) and Felix (Codex) each wrote their own audit, then checked the other's findings against the code, and Chen combined both into one report."

## Install

Get the latest build from the [Releases page](https://github.com/brocrew/brocrew/releases/latest):

| Your computer                        | File                              |
| ------------------------------------ | --------------------------------- |
| Mac with Apple Silicon (M1 or later) | `BroCrew-<version>-arm64.dmg`     |
| Windows 10 or 11, 64-bit (beta)      | `BroCrew-Setup-<version>-x64.exe` |

The downloads aren't signed yet, so your computer will warn you the first time. Follow the [Mac install guide](docs/install-macos.md) or [Windows install guide](docs/install-windows.md) to open the app.

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
