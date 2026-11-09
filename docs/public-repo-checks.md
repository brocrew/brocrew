# The public repository's own checks

Three checks run only in the public repository: private names, a secret scan, and a daily record of release downloads. They are written for it, and they do nothing in any other repository.

## Where they run

Each job runs whenever the repository is public, whatever its name and owner, and never on a private one. So there is nothing to switch on in a new public repository, and nothing names it. The daily download job asks GitHub whether the repository is public first, since a scheduled run names no repository.

| workflow | jobs | when |
|---|---|---|
| `.github/workflows/public-checks.yml` | private names; secret scan | every push and pull request, and by hand |
| `.github/workflows/download-counts.yml` | the day's download counts | every day at 04:17 UTC, and by hand |

## Private names

`scripts/leak-check.mjs` fails when a tracked file, a tracked file's name, or a commit in the range it is given carries a name from `BROBOT_LEAK_PATTERNS`. A commit's message, author and committer are also checked against `BROBOT_COMMIT_PATTERNS`: names the tree may carry but a commit may not. Both are secrets, one fixed string per line, matched in any case. It prints only paths and short commit ids, and GitHub masks the secrets themselves in the log. With `BROBOT_LEAK_PATTERNS` empty it fails.

It runs in `public-checks.yml` on every push and on a pull request from a branch of this repository. A pull request from a fork gets no secrets, so the push its merge makes is checked instead. It also runs in `release.yml`, and publication waits for it.

To run it before pushing, with the names in the environment:

```sh
node scripts/leak-check.mjs origin/main..HEAD
```

A commit that fails was made before it was pushed. Reword it, then push again.

## The secret scan

gitleaks, a pinned version checked against the sha256 its release publishes, scans the whole history with its own rules and `--redact`. In the public repository that history begins at its first commit, the fresh export. The old history is never pushed there.

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
| `BROBOT_LEAK_PATTERNS` | secret | the names the repository and its commits must not carry, one per line |
| `BROBOT_COMMIT_PATTERNS` | secret | the names a commit must not carry, one per line |

Set both before the repository's first push.
