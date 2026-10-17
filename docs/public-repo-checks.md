# The public repository's own checks

Three checks run only in the public repository: its commits, a secret scan, and a daily record of release downloads. They are written for it, and they do nothing in any other repository.

## Where they run

Each job runs whenever the repository is public, whatever its name and owner, and never on a private one. So there is nothing to switch on in a new public repository, and nothing names it. Where a check's secrets are missing on a public repository, it fails rather than skips (`--require-patterns`). The daily download job asks GitHub whether the repository is public first, since a scheduled run names no repository.

| workflow | jobs | when |
|---|---|---|
| `.github/workflows/public-checks.yml` | commit messages and identities, the tree and its file names; secret scan | every push and pull request, and by hand |
| `.github/workflows/download-counts.yml` | the day's download counts | every day at 04:17 UTC, and by hand |

## The commits: plain words, and the public identity

In a public repository a commit's message, author and committer are public. `node scripts/leak-check.mjs --commits <revisions>` fails a commit when:

- its message carries a card id: a decision (`D-0NN`), a piece label (`W4`, `W4.NN`), a feature card (`FNNN`), a hand-over (`HO-NNN`), a screen card (`UI-NNN`), an extension card (`EXT-NNN`), a task card (`T-NNN`) or a ruling (`RNN`). Messages are plain words; ids belong in the team's reports.
- its message, author or committer carries a leak pattern (the names the tree must not carry, as for `pnpm run leak:check`) or a commit pattern (the names a message must not carry, which the tree does carry).
- on a push, its author or committer is not listed in `BROBOT_COMMIT_IDENTITIES`. GitHub's own identities, for a pull request merged on the site and for a workflow's own commits, are always allowed.

It never prints a pattern: it names the commit, the part and the kind of problem, and a card id, which is nobody's secret.

It also reads:

- **an annotated tag's tagger and message**, on a tag push (`--tag <name>`). A lightweight tag carries neither.
- **a pull request's title and branch name** (`--pull-request`, from `PR_TITLE` and `PR_BRANCH`). A squash merge makes the title a commit message, and a merge commit names the branch, after which neither can be reworded without rewriting history.

Where the secrets reach (a push, a run by hand, a pull request from a branch of this repository) the patterns are required: `--require-patterns` fails rather than skip when the leak or commit patterns are missing, and on a push `--require-identities` fails when `BROBOT_COMMIT_IDENTITIES` is. A pull request from a fork gets no secrets, so it is checked for card ids alone, and its merge is checked whole by the push it makes.

The check runs after a push, so it finds a problem rather than prevents it. Run it before pushing:

```sh
node scripts/leak-check.mjs --require-patterns --require-identities --commits origin/main..HEAD
```

A merged outside contribution keeps its author's identity, which the identity check fails on the push to main. Merge it as a squash under the public identity, or expect that one failure.

Locally, the same check runs as `node scripts/leak-check.mjs --commits origin/main..HEAD`, with the patterns read from `~/.config/brobot/leak-patterns` and `~/.config/brobot/commit-patterns`.

A commit that fails was made before it was pushed. Reword it, or make it again through the public identity, then push again.

## The tree, and its file names

`pnpm run leak:check` reads every tracked file's text for the leak patterns, and every tracked file's name. A name that carries one fails too, printed with the pattern hidden. The patterns are never in the repository: they come from `BROBOT_LEAK_PATTERNS`, the file `BROBOT_LEAK_PATTERNS_FILE` names, or `~/.config/brobot/leak-patterns`.

With no patterns configured the guard skips and says so, so a fork is not blocked. With `--require-patterns` it fails instead. The public repository's checks (where the secret reaches), every release (`release.yml` on a `v*` tag, and the beta releases `windows.yml` and `macos.yml` publish) and the public export pass it:

```sh
node scripts/leak-check.mjs --require-patterns
```

Run that on the fresh export before its first push.

## The secret scan

gitleaks, a pinned version checked against the sha256 its release publishes, scans the whole history with its own rules and `--redact`. In the public repository that history begins at its first commit, the fresh export. The old history is never pushed there.

Before it scans anything, `scripts/secret-scan-redaction-check.mjs` makes a secret-shaped value that exists nowhere else, scans a folder holding only it, and stops the job unless gitleaks found it and hid it, in its output and in its report.

The scan itself runs without `--verbose`, which would print the text around a finding: the log carries gitleaks' summary, and a finding is printed from its redacted report as rule, file, line and commit. A scan that read no commit fails, since it would prove nothing.

A made-up value that gitleaks' rules match is allowed narrowly:

- on its line, with `gitleaks:allow` and the reason (a test's made-up key);
- in `.gitleaks.toml`, by its exact shape, when the file cannot carry a comment (a recorded fixture).

To move to a newer gitleaks, change the version and the sha256 in `public-checks.yml` together, reading the sha256 from that release's `checksums.txt`.

## Download counts

GitHub counts the downloads of every file a release carries and keeps only the running total. Once a day the job writes each file's total down, one row per file per day, in `downloads.csv` on the `download-counts` branch: the day, the release's tag, the file's name and its count. A day's downloads are the difference between two rows. It records only that, and GitHub tells nothing about who downloaded a file.

The job writes only that branch. A second run on one day replaces that day's rows.

## What the public repository needs set

| name | kind | holds |
|---|---|---|
| `BROBOT_LEAK_PATTERNS` | secret | the names the tree must not carry, one per line (the same secret CI's `leak:check` reads) |
| `BROBOT_COMMIT_PATTERNS` | secret | the names a commit message must not carry, one per line |
| `BROBOT_COMMIT_IDENTITIES` | variable | the identities commits are made under, `Name <email>`, one per line |

Set all three before the repository's first push: where the secrets reach, the checks require them and fail without them. A release requires `BROBOT_LEAK_PATTERNS` too. Card ids are always checked.
