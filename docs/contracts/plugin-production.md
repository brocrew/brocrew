# Plugin package sources and installation

The production plugin controller uses the same source operations as Settings:
`list(source?)`, `inspect(ref)`, `install(ref)` and `update(pluginId, ref)`.
A package reference identifies selected bytes:

```ts
{ source: 'http://127.0.0.1:8080/fictional-oven.tar.gz', sha256: '<archive SHA-256>', bytes: 5120 }
```

`source` can be an ordinary HTTP(S) URL, a file URL or a local path. Fetch handles
redirects, HTTP decoding and unsupported URL schemes normally. A publisher,
repository, signing key, matching list in another window, or development build
is not required. The default repository list is a discovery convenience.

Settings accepts a package location directly. **Show package details** reads it
without executing code, computes its byte reference and shows the package's
authors and declared permissions. The subsequent **Install** or **Update** action
uses those exact bytes. A supplied reference must match its archive hash and
byte count. The decoded manifest and each declared file must also match; extra
or missing payload files are errors. Tar and gzip are detected from the bytes,
so a public reference does not need a compression field. Ordinary tar names and
PAX long names are supported. A path that would write outside the code directory
cannot be extracted there.

Platform and minimum app version checks use the running application's target
and version. A missing resource or failing runtime is reported as an operation
error. Package version ordering, previous archive history and data schema
changes do not authorize or refuse an update. The package receives the prior
version and data schema in its bootstrap and owns any data migration.

## Lists

Each window can select its own list with **Load plugin list**. Existing format-1
and format-2 lists remain readable. A generic format-3 list contains `entries`
with `id`, `name`, `description`, `version`, optional `authors`, optional
`minAppVersion` and `targets`. Each target names `os`, `cpu`, `url`, `sha256`,
`bytes`, `manifestSha256` and `compression` (`tar` or `tar.gz`). Source commits
are optional metadata. Author names are ordinary display strings.

The list's target and minimum version filter discovery for the current app.
Inspection still reads the actual package and displays its own authors and
permissions. An unavailable default list leaves the controller available for
local packages and installed packages. Explicit list and download failures are
reported, with HTTP status or operation details when available.

## Installed bytes and updates

The package vault keeps the exact archive and its release descriptor. It can
load an installed package offline without a current list or source proof. The
legacy reader obtains a descriptor from an older saved catalogue without using
its signature as an admission test.

Install and update keep the existing serialized mutation and atomic code
publication path. An update stops the previous run before starting replacement
code. Workspace enablement still controls contributions and tools. A code
update retains the plugin's existing data locations and opaque data files;
uninstall cleanup remains a separate lifecycle operation. A different list in
another window does not replace the selected reference or prevent an action.

Source tests use inert fictional packages and process peers. They exercise the
real Settings/person-control path without opening browser profiles, accounts or
pairing data. Packaged application and native platform qualification are
separate checks.
