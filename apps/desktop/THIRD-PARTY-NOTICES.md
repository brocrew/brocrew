# Third-party notices

BroCrew is licensed under the Apache License 2.0 (its `LICENSE`). It redistributes the third-party
software below. Every packaged build carries this file in its resources folder: in the macOS app
beside `LICENSE.electron.txt` and `LICENSES.chromium.html`, and in the Windows install folder's
`resources`, with those two files in the install folder itself.

OpenAI and the OpenAI logo are trademarks of OpenAI. They are not covered by this project's licence.

The part between the `GENERATED` markers is written by `node scripts/third-party-notices.mjs` from
the installed packages: run it again after a dependency changes (`--check` says whether it is up to
date). The rest is written by hand, from each component's own files.

- [Claude Agent SDK](#claude-agent-sdk)
- [Codex CLI, and what its package bundles](#codex-cli)
- [Electron and Chromium](#electron-and-chromium)
- [The Inter typeface](#the-inter-typeface)
- [Code derived from other projects](#code-derived-from-other-projects)
- [npm packages in the app](#npm-packages-in-the-app) (generated)
- [License texts](#license-texts)

## Claude Agent SDK

- **What ships:** the JavaScript of the npm package `@anthropic-ai/claude-agent-sdk`, unmodified, in
  the app's archive. BroCrew uses it to start Claude Code and talk to it. Its version is under
  "Bundled versions".
- **Claude Code itself does not ship with BroCrew.** A person installs it from Anthropic
  (<https://code.claude.com/docs/en/setup>), and it comes with its own license and terms.
- **It is not open-source software.** The package carries this license, quoted from its own
  `LICENSE.md`:

  > © Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here:
  > https://code.claude.com/docs/en/legal-and-compliance.

- **Terms:** the SDK's own README names Anthropic's
  [Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms) and
  [Privacy Policy](https://www.anthropic.com/legal/privacy).

## Codex CLI

- **What ships:** the native `codex` (`codex.exe` in the Windows build) and the tools its package
  carries beside it, copied unmodified from the npm package `@openai/codex` (its `darwin-arm64` and
  `win32-x64` builds) into the app's resources as `codex-vendor/`. Its version is under "Bundled
  versions".
- **Copyright** 2025 OpenAI. Source: <https://github.com/openai/codex>
- **License:** Apache License 2.0 — the text is under "License texts".
- **Its NOTICE file**, from the Codex repository at the tag of that version (`rust-v0.160.0`); the
  npm package does not carry it:

```text
OpenAI Codex
Copyright 2025 OpenAI

This project includes code derived from [Ratatui](https://github.com/ratatui/ratatui), licensed under the MIT license.
Copyright (c) 2016-2022 Florian Dehau
Copyright (c) 2023-2025 The Ratatui Developers
```

### What the Codex package bundles

- **ripgrep** — `codex-vendor/<platform>/codex-path/rg` (`rg.exe` in the Windows build); the macOS
  build reports `ripgrep 15.2.0`. Copyright (c) 2015 Andrew Gallant. Source:
  <https://github.com/BurntSushi/ripgrep>. Its `COPYING`, quoted:

  > This project is dual-licensed under the Unlicense and MIT licenses.
  >
  > You may use this code under the terms of either license.

  Both texts are under "License texts".
- **zsh** (macOS build only) — `codex-vendor/aarch64-apple-darwin/codex-resources/zsh/bin/zsh`, the
  shell binary alone, with none of zsh's shell-function files; it reports `zsh 5.9.0.3-test`. Its
  licence, as published with zsh 5.9, is under "License texts". Source: <https://www.zsh.org>
- **Voice libraries** — GStreamer, GLib, libintl, libffi, PCRE2, Opus and zlib, under
  `codex-vendor/<platform>/codex-resources/voice/`. Codex ships their notices and license texts with
  them, in that folder's `NOTICE.md` and `licenses/`, and both travel unchanged into the app.
- **Microsoft Visual C++ runtime** (Windows build only) —
  `codex-resources/voice/bin/vcruntime140.dll`, © Microsoft Corporation, under Microsoft's own
  license terms, which the `NOTICE.md` in that folder names.
- **OpenAI's own helpers** — `codex-code-mode-host` and `codex-voice-host`, and in the Windows build
  `codex-command-runner.exe` and `codex-windows-sandbox-setup.exe` — are part of Codex, under its
  license.

## Electron and Chromium

- **What ships:** Electron, which includes Chromium and Node.js, is the app's runtime. Its version is
  under "Bundled versions".
- **Electron's license** (MIT) is in `LICENSE.electron.txt`, and under "License texts".
- **The notices of Chromium, Node.js and everything else Electron includes** are in
  `LICENSES.chromium.html`, as Electron publishes them.

## The Inter typeface

- `InterVariable.woff2`, drawn in the window. Copyright (c) 2016 The Inter Project Authors
  (<https://github.com/rsms/inter>). SIL Open Font License 1.1 — the text is under "License texts".

## Code derived from other projects

- **Faker** (<https://github.com/faker-js/faker>). Copyright (c) 2022-2025 the Faker contributors,
  and faker.js Copyright (c) 2011-2020 Marak Squires. The first names BroCrew gives new agents
  (`apps/desktop/src/shared/agent-first-names.json`) are copied from the person data of 35 of
  Faker's locales, version 10.6.0; Faker itself is not in the app.
- **License:** the MIT License. The text is under "License texts", quoted from Faker's `LICENSE`.

## npm packages in the app

<!-- BEGIN GENERATED: node scripts/third-party-notices.mjs -->

### Bundled versions

- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) 0.3.287
- Codex CLI 0.160.0
- Electron 43.2.0

### npm packages in the app

Every npm package the app’s archive (`app.asar`) carries, by the license its `package.json`
declares, with the copyright lines of its own license file. Each package’s license file travels
with it inside the archive; a package that ships none says so.

#### Apache-2.0 (1)

- `drizzle-orm` 0.45.2 — ships no license file

#### BSD-2-Clause (3)

- `entities` 4.5.0 — Copyright (c) Felix Böhm
- `entities` 7.0.1 — Copyright (c) Felix Böhm
- `json-schema-typed` 8.0.2 — no copyright line in its `LICENSE.md`

#### BSD-3-Clause (5)

- `d3-ease` 3.0.1 — Copyright 2010-2021 Mike Bostock · Copyright 2001 Robert Penner
- `fast-uri` 3.1.4 — Copyright (c) 2011-2021, Gary Court until https://github.com/garycourt/uri-js/commit/a1acf730b4bba3f1097c9f52e7d9d3aba8cdcaae · Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team>
- `qs` 6.15.3 — Copyright (c) 2014, Nathan LaFreniere and other [contributors](https://github.com/ljharb/qs/graphs/contributors)
- `smol-toml` 1.7.0 — Copyright (c) Squirrel Chat et al., All rights reserved.
- `source-map-js` 1.2.1 — Copyright (c) 2009-2011, Mozilla Foundation and contributors

#### BlueOak-1.0.0 (1)

- `sax` 1.6.1 — copyright in it.

#### ISC (18)

- `d3-color` 3.1.0 — Copyright 2010-2022 Mike Bostock
- `d3-dispatch` 3.0.1 — Copyright 2010-2021 Mike Bostock
- `d3-drag` 3.0.0 — Copyright 2010-2021 Mike Bostock
- `d3-interpolate` 3.0.1 — Copyright 2010-2021 Mike Bostock
- `d3-selection` 3.0.0 — Copyright 2010-2021 Mike Bostock
- `d3-timer` 3.0.1 — Copyright 2010-2021 Mike Bostock
- `d3-transition` 3.0.1 — Copyright 2010-2021 Mike Bostock
- `d3-zoom` 3.0.0 — Copyright 2010-2021 Mike Bostock
- `graceful-fs` 4.2.11 — Copyright (c) 2011-2022 Isaac Z. Schlueter, Ben Noordhuis, and Contributors
- `inherits` 2.0.4 — Copyright (c) Isaac Z. Schlueter
- `isexe` 2.0.0 — Copyright (c) Isaac Z. Schlueter and Contributors
- `once` 1.4.0 — Copyright (c) Isaac Z. Schlueter and Contributors
- `picocolors` 1.1.1 — Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov
- `semver` 7.7.4 — Copyright (c) Isaac Z. Schlueter and Contributors
- `setprototypeof` 1.2.0 — Copyright (c) 2015, Wes Todd
- `which` 2.0.2 — Copyright (c) Isaac Z. Schlueter and Contributors
- `wrappy` 1.0.2 — Copyright (c) Isaac Z. Schlueter and Contributors
- `zod-to-json-schema` 3.25.2 — Copyright (c) 2020, Stefan Terdell

#### MIT (127)

- `@babel/helper-string-parser` 7.29.7 — Copyright (c) 2014-present Sebastian McKenzie and other contributors
- `@babel/helper-validator-identifier` 7.29.7 — Copyright (c) 2014-present Sebastian McKenzie and other contributors
- `@babel/parser` 7.29.7 — Copyright (C) 2012-2014 by various contributors (see AUTHORS)
- `@babel/types` 7.29.7 — Copyright (c) 2014-present Sebastian McKenzie and other contributors
- `@dagrejs/dagre` 3.1.1 — Copyright (c) 2012-2014 Chris Pettitt
- `@dagrejs/graphlib` 4.0.5 — Copyright (c) 2012-2014 Chris Pettitt
- `@hono/node-server` 1.19.14 — Copyright (c) 2022 - present, Yusuke Wada and Hono contributors
- `@jridgewell/sourcemap-codec` 1.5.5 — Copyright 2024 Justin Ridgewell <justin@ridgewell.name>
- `@modelcontextprotocol/sdk` 1.29.0 — Copyright (c) 2024 Anthropic, PBC
- `@types/web-bluetooth` 0.0.20 — Copyright (c) Microsoft Corporation.
- `@vue-flow/core` 1.48.2 — Copyright (c) 2019-2025 webkid GmbH · Copyright (c) 2021-2025 Burak Cakmakoglu
- `@vue/compiler-core` 3.5.40 — Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/compiler-dom` 3.5.40 — Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/compiler-sfc` 3.5.40 — Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/compiler-ssr` 3.5.40 — Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/reactivity` 3.5.40 — Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/runtime-core` 3.5.40 — Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/runtime-dom` 3.5.40 — Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/server-renderer` 3.5.40 — Copyright (c) 2018-present, Yuxi (Evan) You
- `@vue/shared` 3.5.40 — Copyright (c) 2018-present, Yuxi (Evan) You
- `@vueuse/core` 10.11.1 — Copyright (c) 2019-PRESENT Anthony Fu<https://github.com/antfu>
- `@vueuse/metadata` 10.11.1 — Copyright (c) 2019-PRESENT Anthony Fu<https://github.com/antfu>
- `@vueuse/shared` 10.11.1 — Copyright (c) 2019-PRESENT Anthony Fu<https://github.com/antfu>
- `accepts` 2.0.0 — Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> · Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com>
- `ajv` 8.20.0 — Copyright (c) 2015-2021 Evgeny Poberezkin
- `ajv-formats` 3.0.1 — Copyright (c) 2020 Evgeny Poberezkin
- `better-sqlite3` 13.0.1 — Copyright (c) 2017 Joshua Wise
- `body-parser` 2.3.0 — Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> · Copyright (c) 2014-2015 Douglas Christopher Wilson <doug@somethingdoug.com>
- `builder-util-runtime` 9.7.0 — Copyright (c) 2015 Loopline Systems
- `bytes` 3.1.2 — Copyright (c) 2012-2014 TJ Holowaychuk <tj@vision-media.ca> · Copyright (c) 2015 Jed Watson <jed.watson@me.com>
- `call-bind-apply-helpers` 1.0.2 — Copyright (c) 2024 Jordan Harband
- `call-bound` 1.0.4 — Copyright (c) 2024 Jordan Harband
- `content-disposition` 1.1.0 — Copyright (c) 2014-2017 Douglas Christopher Wilson
- `content-type` 1.0.5 — Copyright (c) 2015 Douglas Christopher Wilson
- `content-type` 2.0.0 — Copyright (c) 2015 Douglas Christopher Wilson
- `cookie` 0.7.2 — Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com> · Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com>
- `cookie-signature` 1.2.2 — Copyright (c) 2012–2024 LearnBoost <tj@learnboost.com> and other contributors;
- `cors` 2.8.6 — Copyright (c) 2013 Troy Goode <troygoode@gmail.com>
- `cross-spawn` 7.0.6 — Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio>
- `csstype` 3.2.3 — Copyright (c) 2017-2018 Fredrik Nicol
- `debug` 4.4.3 — Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca> · Copyright (c) 2018-2021 Josh Junon
- `depd` 2.0.0 — Copyright (c) 2014-2018 Douglas Christopher Wilson
- `dunder-proto` 1.0.1 — Copyright (c) 2024 ECMAScript Shims
- `ee-first` 1.1.1 — Copyright (c) 2014 Jonathan Ong me@jongleberry.com
- `electron-updater` 6.8.10 — Copyright (c) 2015 Loopline Systems
- `encodeurl` 2.0.0 — Copyright (c) 2016 Douglas Christopher Wilson
- `es-define-property` 1.0.1 — Copyright (c) 2024 Jordan Harband
- `es-errors` 1.3.0 — Copyright (c) 2024 Jordan Harband
- `es-object-atoms` 1.1.2 — Copyright (c) 2024 Jordan Harband
- `escape-html` 1.0.3 — Copyright (c) 2012-2013 TJ Holowaychuk · Copyright (c) 2015 Andreas Lubbe · Copyright (c) 2015 Tiancheng "Timothy" Gu
- `estree-walker` 2.0.2 — Copyright (c) 2015-20 [these people](https://github.com/Rich-Harris/estree-walker/graphs/contributors)
- `etag` 1.8.1 — Copyright (c) 2014-2016 Douglas Christopher Wilson
- `eventsource` 3.0.7 — Copyright (c) EventSource GitHub organisation
- `eventsource-parser` 3.1.0 — Copyright (c) 2026 Espen Hovlandsdal <espen@hovlandsdal.com>
- `express` 5.2.1 — Copyright (c) 2009-2014 TJ Holowaychuk <tj@vision-media.ca> · Copyright (c) 2013-2014 Roman Shtylman <shtylman+expressjs@gmail.com> · Copyright (c) 2014-2015 Douglas Christopher Wilson <doug@somethingdoug.com>
- `express-rate-limit` 8.6.0 — Copyright 2023 Nathan Friedly, Vedant K
- `fast-deep-equal` 3.1.3 — Copyright (c) 2017 Evgeny Poberezkin
- `finalhandler` 2.1.1 — Copyright (c) 2014-2022 Douglas Christopher Wilson <doug@somethingdoug.com>
- `forwarded` 0.2.0 — Copyright (c) 2014-2017 Douglas Christopher Wilson
- `fresh` 2.0.0 — Copyright (c) 2012 TJ Holowaychuk <tj@vision-media.ca> · Copyright (c) 2016-2017 Douglas Christopher Wilson <doug@somethingdoug.com>
- `fs-extra` 10.1.0 — Copyright (c) 2011-2017 JP Richardson
- `function-bind` 1.1.2 — Copyright (c) 2013 Raynos.
- `get-intrinsic` 1.3.0 — Copyright (c) 2020 Jordan Harband
- `get-proto` 1.0.1 — Copyright (c) 2025 Jordan Harband
- `gopd` 1.2.0 — Copyright (c) 2022 Jordan Harband
- `has-symbols` 1.1.0 — Copyright (c) 2016 Jordan Harband
- `hasown` 2.0.4 — Copyright (c) Jordan Harband and contributors
- `hono` 4.12.31 — Copyright (c) 2021 - present, Yusuke Wada and Hono contributors
- `http-errors` 2.0.1 — Copyright (c) 2014 Jonathan Ong me@jongleberry.com · Copyright (c) 2016 Douglas Christopher Wilson doug@somethingdoug.com
- `iconv-lite` 0.7.3 — Copyright (c) 2011 Alexander Shtuchkin
- `ip-address` 10.2.0 — Copyright (C) 2011 by Beau Gunderson
- `ipaddr.js` 1.9.1 — Copyright (C) 2011-2017 whitequark <whitequark@whitequark.org>
- `is-promise` 4.0.0 — Copyright (c) 2014 Forbes Lindesay
- `jose` 6.2.4 — Copyright (c) 2018 Filip Skokan
- `js-yaml` 4.3.1 — Copyright (C) 2011-2015 by Vitaly Puzrin
- `json-schema-traverse` 1.0.0 — Copyright (c) 2017 Evgeny Poberezkin
- `jsonfile` 6.2.1 — Copyright (c) 2012-2015, JP Richardson <jprichardson@gmail.com>
- `lazy-val` 1.0.5 — ships no license file
- `linkify-it` 5.0.2 — Copyright (c) 2015 Vitaly Puzrin.
- `lodash.escaperegexp` 4.1.2 — Copyright jQuery Foundation and other contributors <https://jquery.org/> · Copyright and related rights for sample code are waived via CC0. Sample
- `lodash.isequal` 4.5.0 — Copyright JS Foundation and other contributors <https://js.foundation/> · Copyright and related rights for sample code are waived via CC0. Sample
- `magic-string` 0.30.21 — Copyright 2018 Rich Harris
- `markdown-it` 14.3.0 — Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.
- `math-intrinsics` 1.1.0 — Copyright (c) 2024 ECMAScript Shims
- `mdurl` 2.1.0 — Copyright (c) 2015 Vitaly Puzrin, Alex Kocharin. · Copyright Joyent, Inc. and other Node contributors. All rights reserved.
- `media-typer` 1.1.0 — Copyright (c) 2014-2017 Douglas Christopher Wilson
- `merge-descriptors` 2.0.0 — Copyright (c) Jonathan Ong <me@jongleberry.com> · Copyright (c) Douglas Christopher Wilson <doug@somethingdoug.com> · Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
- `mime-db` 1.54.0 — Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> · Copyright (c) 2015-2022 Douglas Christopher Wilson <doug@somethingdoug.com>
- `mime-types` 3.0.2 — Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> · Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com>
- `ms` 2.1.3 — Copyright (c) 2020 Vercel, Inc.
- `nanoid` 3.3.16 — Copyright 2017 Andrey Sitnik <andrey@sitnik.ru>
- `negotiator` 1.0.0 — Copyright (c) 2012-2014 Federico Romero · Copyright (c) 2012-2014 Isaac Z. Schlueter · Copyright (c) 2014-2015 Douglas Christopher Wilson
- `node-addon-api` 8.9.0 — Copyright (c) 2017 [Node.js API collaborators](https://github.com/nodejs/node-addon-api#collaborators)
- `object-assign` 4.1.1 — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- `object-inspect` 1.13.4 — Copyright (c) 2013 James Halliday
- `on-finished` 2.4.1 — Copyright (c) 2013 Jonathan Ong <me@jongleberry.com> · Copyright (c) 2014 Douglas Christopher Wilson <doug@somethingdoug.com>
- `parseurl` 1.3.3 — Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> · Copyright (c) 2014-2017 Douglas Christopher Wilson <doug@somethingdoug.com>
- `path-key` 3.1.1 — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- `path-to-regexp` 8.4.2 — Copyright (c) 2014 Blake Embrey (hello@blakeembrey.com)
- `pkce-challenge` 5.0.1 — Copyright (c) 2019
- `postcss` 8.5.22 — Copyright 2013 Andrey Sitnik <andrey@sitnik.es>
- `proxy-addr` 2.0.7 — Copyright (c) 2014-2016 Douglas Christopher Wilson
- `punycode.js` 2.3.1 — Copyright Mathias Bynens <https://mathiasbynens.be/>
- `range-parser` 1.3.0 — Copyright (c) 2012-2014 TJ Holowaychuk <tj@vision-media.ca> · Copyright (c) 2015-2016 Douglas Christopher Wilson <doug@somethingdoug.com
- `raw-body` 3.0.2 — Copyright (c) 2013-2014 Jonathan Ong <me@jongleberry.com> · Copyright (c) 2014-2022 Douglas Christopher Wilson <doug@somethingdoug.com>
- `require-from-string` 2.0.2 — Copyright (c) Vsevolod Strukchinsky <floatdrop@gmail.com> (github.com/floatdrop)
- `router` 2.2.0 — Copyright (c) 2013 Roman Shtylman · Copyright (c) 2014-2022 Douglas Christopher Wilson
- `safer-buffer` 2.1.2 — Copyright (c) 2018 Nikita Skovoroda <chalkerx@gmail.com>
- `send` 1.2.1 — Copyright (c) 2012 TJ Holowaychuk · Copyright (c) 2014-2022 Douglas Christopher Wilson
- `serve-static` 2.2.1 — Copyright (c) 2010 Sencha Inc. · Copyright (c) 2011 LearnBoost · Copyright (c) 2011 TJ Holowaychuk
- `shebang-command` 2.0.0 — Copyright (c) Kevin Mårtensson <kevinmartensson@gmail.com> (github.com/kevva)
- `shebang-regex` 3.0.0 — Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
- `side-channel` 1.1.1 — Copyright (c) 2019 Jordan Harband
- `side-channel-list` 1.0.1 — Copyright (c) 2024 Jordan Harband
- `side-channel-map` 1.0.1 — Copyright (c) 2024 Jordan Harband
- `side-channel-weakmap` 1.0.2 — Copyright (c) 2019 Jordan Harband
- `statuses` 2.0.2 — Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> · Copyright (c) 2016 Douglas Christopher Wilson <doug@somethingdoug.com>
- `tiny-typed-emitter` 2.1.0 — Copyright (c) 2020 Zurab Benashvili (binier) <zura.bena@gmail.com>
- `toidentifier` 1.0.1 — Copyright (c) 2016 Douglas Christopher Wilson <doug@somethingdoug.com>
- `type-is` 2.1.0 — Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> · Copyright (c) 2014-2015 Douglas Christopher Wilson <doug@somethingdoug.com>
- `uc.micro` 2.1.0 — Copyright Mathias Bynens <https://mathiasbynens.be/>
- `universalify` 2.0.1 — Copyright (c) 2017, Ryan Zimmerman <opensrc@ryanzim.com>
- `unpipe` 1.0.0 — Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com>
- `vary` 1.1.2 — Copyright (c) 2014-2017 Douglas Christopher Wilson
- `vue` 3.5.40 — Copyright (c) 2018-present, Yuxi (Evan) You
- `vue-demi` 0.14.10 — Copyright (c) 2020-present, Anthony Fu
- `zod` 4.4.3 — Copyright (c) 2025 Colin McDonnell

#### Python-2.0 (1)

- `argparse` 2.0.1 — Copyright (c) 1991 - 1995, Stichting Mathematisch Centrum Amsterdam,

<!-- END GENERATED -->

## License texts

### Apache License 2.0

Codex's license, quoted from its repository's `LICENSE`. It is also the license of the npm
packages listed under Apache-2.0 above; `drizzle-orm` ships no license file of its own.

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1.  Definitions.

    "License" shall mean the terms and conditions for use, reproduction,
    and distribution as defined by Sections 1 through 9 of this document.

    "Licensor" shall mean the copyright owner or entity authorized by
    the copyright owner that is granting the License.

    "Legal Entity" shall mean the union of the acting entity and all
    other entities that control, are controlled by, or are under common
    control with that entity. For the purposes of this definition,
    "control" means (i) the power, direct or indirect, to cause the
    direction or management of such entity, whether by contract or
    otherwise, or (ii) ownership of fifty percent (50%) or more of the
    outstanding shares, or (iii) beneficial ownership of such entity.

    "You" (or "Your") shall mean an individual or Legal Entity
    exercising permissions granted by this License.

    "Source" form shall mean the preferred form for making modifications,
    including but not limited to software source code, documentation
    source, and configuration files.

    "Object" form shall mean any form resulting from mechanical
    transformation or translation of a Source form, including but
    not limited to compiled object code, generated documentation,
    and conversions to other media types.

    "Work" shall mean the work of authorship, whether in Source or
    Object form, made available under the License, as indicated by a
    copyright notice that is included in or attached to the work
    (an example is provided in the Appendix below).

    "Derivative Works" shall mean any work, whether in Source or Object
    form, that is based on (or derived from) the Work and for which the
    editorial revisions, annotations, elaborations, or other modifications
    represent, as a whole, an original work of authorship. For the purposes
    of this License, Derivative Works shall not include works that remain
    separable from, or merely link (or bind by name) to the interfaces of,
    the Work and Derivative Works thereof.

    "Contribution" shall mean any work of authorship, including
    the original version of the Work and any modifications or additions
    to that Work or Derivative Works thereof, that is intentionally
    submitted to Licensor for inclusion in the Work by the copyright owner
    or by an individual or Legal Entity authorized to submit on behalf of
    the copyright owner. For the purposes of this definition, "submitted"
    means any form of electronic, verbal, or written communication sent
    to the Licensor or its representatives, including but not limited to
    communication on electronic mailing lists, source code control systems,
    and issue tracking systems that are managed by, or on behalf of, the
    Licensor for the purpose of discussing and improving the Work, but
    excluding communication that is conspicuously marked or otherwise
    designated in writing by the copyright owner as "Not a Contribution."

    "Contributor" shall mean Licensor and any individual or Legal Entity
    on behalf of whom a Contribution has been received by Licensor and
    subsequently incorporated within the Work.

2.  Grant of Copyright License. Subject to the terms and conditions of
    this License, each Contributor hereby grants to You a perpetual,
    worldwide, non-exclusive, no-charge, royalty-free, irrevocable
    copyright license to reproduce, prepare Derivative Works of,
    publicly display, publicly perform, sublicense, and distribute the
    Work and such Derivative Works in Source or Object form.

3.  Grant of Patent License. Subject to the terms and conditions of
    this License, each Contributor hereby grants to You a perpetual,
    worldwide, non-exclusive, no-charge, royalty-free, irrevocable
    (except as stated in this section) patent license to make, have made,
    use, offer to sell, sell, import, and otherwise transfer the Work,
    where such license applies only to those patent claims licensable
    by such Contributor that are necessarily infringed by their
    Contribution(s) alone or by combination of their Contribution(s)
    with the Work to which such Contribution(s) was submitted. If You
    institute patent litigation against any entity (including a
    cross-claim or counterclaim in a lawsuit) alleging that the Work
    or a Contribution incorporated within the Work constitutes direct
    or contributory patent infringement, then any patent licenses
    granted to You under this License for that Work shall terminate
    as of the date such litigation is filed.

4.  Redistribution. You may reproduce and distribute copies of the
    Work or Derivative Works thereof in any medium, with or without
    modifications, and in Source or Object form, provided that You
    meet the following conditions:

    (a) You must give any other recipients of the Work or
    Derivative Works a copy of this License; and

    (b) You must cause any modified files to carry prominent notices
    stating that You changed the files; and

    (c) You must retain, in the Source form of any Derivative Works
    that You distribute, all copyright, patent, trademark, and
    attribution notices from the Source form of the Work,
    excluding those notices that do not pertain to any part of
    the Derivative Works; and

    (d) If the Work includes a "NOTICE" text file as part of its
    distribution, then any Derivative Works that You distribute must
    include a readable copy of the attribution notices contained
    within such NOTICE file, excluding those notices that do not
    pertain to any part of the Derivative Works, in at least one
    of the following places: within a NOTICE text file distributed
    as part of the Derivative Works; within the Source form or
    documentation, if provided along with the Derivative Works; or,
    within a display generated by the Derivative Works, if and
    wherever such third-party notices normally appear. The contents
    of the NOTICE file are for informational purposes only and
    do not modify the License. You may add Your own attribution
    notices within Derivative Works that You distribute, alongside
    or as an addendum to the NOTICE text from the Work, provided
    that such additional attribution notices cannot be construed
    as modifying the License.

    You may add Your own copyright statement to Your modifications and
    may provide additional or different license terms and conditions
    for use, reproduction, or distribution of Your modifications, or
    for any such Derivative Works as a whole, provided Your use,
    reproduction, and distribution of the Work otherwise complies with
    the conditions stated in this License.

5.  Submission of Contributions. Unless You explicitly state otherwise,
    any Contribution intentionally submitted for inclusion in the Work
    by You to the Licensor shall be under the terms and conditions of
    this License, without any additional terms or conditions.
    Notwithstanding the above, nothing herein shall supersede or modify
    the terms of any separate license agreement you may have executed
    with Licensor regarding such Contributions.

6.  Trademarks. This License does not grant permission to use the trade
    names, trademarks, service marks, or product names of the Licensor,
    except as required for reasonable and customary use in describing the
    origin of the Work and reproducing the content of the NOTICE file.

7.  Disclaimer of Warranty. Unless required by applicable law or
    agreed to in writing, Licensor provides the Work (and each
    Contributor provides its Contributions) on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
    implied, including, without limitation, any warranties or conditions
    of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
    PARTICULAR PURPOSE. You are solely responsible for determining the
    appropriateness of using or redistributing the Work and assume any
    risks associated with Your exercise of permissions under this License.

8.  Limitation of Liability. In no event and under no legal theory,
    whether in tort (including negligence), contract, or otherwise,
    unless required by applicable law (such as deliberate and grossly
    negligent acts) or agreed to in writing, shall any Contributor be
    liable to You for damages, including any direct, indirect, special,
    incidental, or consequential damages of any character arising as a
    result of this License or out of the use or inability to use the
    Work (including but not limited to damages for loss of goodwill,
    work stoppage, computer failure or malfunction, or any and all
    other commercial damages or losses), even if such Contributor
    has been advised of the possibility of such damages.

9.  Accepting Warranty or Additional Liability. While redistributing
    the Work or Derivative Works thereof, You may choose to offer,
    and charge a fee for, acceptance of support, warranty, indemnity,
    or other liability obligations and/or rights consistent with this
    License. However, in accepting such obligations, You may act only
    on Your own behalf and on Your sole responsibility, not on behalf
    of any other Contributor, and only if You agree to indemnify,
    defend, and hold each Contributor harmless for any liability
    incurred by, or claims asserted against, such Contributor by reason
    of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

Copyright 2025 OpenAI

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### MIT License (ripgrep)

```text
The MIT License (MIT)

Copyright (c) 2015 Andrew Gallant

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### The Unlicense (ripgrep)

```text
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org/>
```

### Zsh licence

```text
Unless otherwise noted in the header of specific files, files in this
distribution have the licence shown below.

However, note that certain shell functions are licensed under versions
of the GNU General Public Licence.  Anyone distributing the shell as a
binary including those files needs to take account of this.  Search
shell functions for "Copyright" for specific copyright information.
None of the core functions are affected by this, so those files may
simply be omitted.

--

The Z Shell is copyright (c) 1992-2017 Paul Falstad, Richard Coleman,
Zoltán Hidvégi, Andrew Main, Peter Stephenson, Sven Wischnowsky, and
others.  All rights reserved.  Individual authors, whether or not
specifically named, retain copyright in all changes; in what follows, they
are referred to as `the Zsh Development Group'.  This is for convenience
only and this body has no legal status.  The Z shell is distributed under
the following licence; any provisions made in individual files take
precedence.

Permission is hereby granted, without written agreement and without
licence or royalty fees, to use, copy, modify, and distribute this
software and to distribute modified versions of this software for any
purpose, provided that the above copyright notice and the following
two paragraphs appear in all copies of this software.

In no event shall the Zsh Development Group be liable to any party for
direct, indirect, special, incidental, or consequential damages arising out
of the use of this software and its documentation, even if the Zsh
Development Group have been advised of the possibility of such damage.

The Zsh Development Group specifically disclaim any warranties, including,
but not limited to, the implied warranties of merchantability and fitness
for a particular purpose.  The software provided hereunder is on an "as is"
basis, and the Zsh Development Group have no obligation to provide
maintenance, support, updates, enhancements, or modifications.
```

### Electron's license (MIT)

```text
Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### SIL Open Font License 1.1 (Inter)

```text
Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL

-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION AND CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### Faker's license (MIT)

```text
Faker - Copyright (c) 2022-2025

This software consists of voluntary contributions made by many individuals.
For exact contribution history, see the revision history
available at https://github.com/faker-js/faker

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

===

From: https://github.com/faker-js/faker/commit/a9f98046c7d5eeaabe12fc587024c06d683800b8
To: https://github.com/faker-js/faker/commit/29234378807c4141588861f69421bf20b5ac635e

Based on faker.js, copyright Marak Squires and contributor, what follows below is the original license.

===

faker.js - Copyright (c) 2011-2020
Marak Squires
http://github.com/marak/faker.js/

faker.js was inspired by and has used data definitions from:

 * https://github.com/stympy/faker/ - Copyright (c) 2007-2010 Benjamin Curtis
 * http://search.cpan.org/~jasonk/Data-Faker-0.07/ - Copyright 2004-2005 by Jason Kohles

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```
