# OpenZohoTui

### Zoho Projects tasks and time logs, without moving out of your terminal

[![CI](https://github.com/DhyanTD/OpenZohoTUI/actions/workflows/ci.yml/badge.svg)](https://github.com/DhyanTD/OpenZohoTUI/actions/workflows/ci.yml)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

`ozt` is an open-source CLI and interactive terminal UI for working with Zoho
Projects v3 tasks, timers, and time logs.

## The origin story

OpenZohoTui was born from a very sophisticated engineering process:

1. Spend nearly the entire day in a terminal.
2. Remember that time still needs to be logged in Zoho Projects.
3. Open the browser.
4. Find the correct project, task, and timesheet screen.
5. Forget how much time was supposed to be logged.
6. Whisper, “there has to be another way.”

In other words, this project exists because opening a browser to record twelve
minutes of work should not itself require eight minutes of work.

```text
                    The traditional ritual

  terminal ──> browser ──> project ──> task ──> time log ──> existential pause
      │
      │   frustration, now with type safety
      ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ OpenZohoTui                              Project: Website Redesign   │
  │  1 Tasks   2 Time Logs   3 Settings                 Timer: 01h 12m  │
  │                                                                      │
  │  Search: login                                                       │
  │  ▶ WEB-T42  Fix login timeout          In Progress   Development    │
  │    WEB-T51  Improve session handling    Open          Backlog        │
  │                                                                      │
  │  t start timer · a add time · e edit · m move · n new · ? help     │
  └──────────────────────────────────────────────────────────────────────┘
```

Zoho Projects remains the source of truth. OpenZohoTui simply gives it a
keyboard-friendly front door.

## What it can do

- Browse and fuzzy-search project tasks without memorizing Zoho IDs.
- View task details and create, edit, or move tasks.
- Select projects, task lists, statuses, portals, and metadata-backed custom
  fields by name.
- Start, stop, review, and cancel a durable local timer.
- Add task-linked or general time manually and synchronize pending logs with
  Zoho—meetings count even when they did not have the courtesy to become a ticket.
- Preserve failed time submissions locally instead of quietly eating your
  Tuesday afternoon.
- Use direct commands with JSON output for scripts and automation.
- Authenticate each user through Zoho's device flow without distributing the
  OAuth client secret.

When a newly created task can be matched to the authenticated user's active
project membership, OZT assigns it to that user. Otherwise, it creates the task
unassigned—because a useful ticket is better than a dramatic save failure.

OpenZohoTui currently focuses on **Zoho Projects tasks and time logs**. The
Issues/Bugs module, comments, attachments, task deletion, and timesheet approval
are not part of the current release.

## How it works

```text
                         authentication only
  ┌─────────────────┐  HTTPS  ┌──────────────────┐  HTTPS  ┌───────────────┐
  │ ozt on your     │ ──────> │ OAuth broker     │ ──────> │ Zoho Accounts │
  │ computer        │         │ client secret    │         └───────────────┘
  │                 │         │ stays here       │
  │ config + timer  │         └────────┬─────────┘
  │ queue + tokens  │                  │
  └────────┬────────┘                  ▼
           │                      ┌─────────┐
           │                      │ Redis   │
           │                      └─────────┘
           │ normal task and time-log API traffic
           ▼
  ┌─────────────────┐
  │ Zoho Projects   │
  └─────────────────┘
```

The TUI runs locally. Only the small OAuth broker and Redis need to be deployed
centrally. After authentication, task and time-log API calls go directly from
the user's computer to Zoho Projects.

The browser still appears once during device authorization. Even terminal
maximalism must occasionally negotiate with reality.

## Requirements

- Node.js 22 or newer
- access to a deployed OpenZohoTui OAuth broker
- a Zoho Projects account with permission to access the intended portal and
  projects
- a terminal that supports interactive input for the TUI

Self-hosters also need Redis and a Zoho **Non-browser application** Client ID
and Client Secret. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the complete broker
runbook.

## Installation

### From npm

When a release is available on npm, run it without a permanent installation:

```sh
npx --yes --package=@dhyantd/open-zoho-tui@latest ozt
```

Or install the `ozt` command globally:

```sh
npm install --global @dhyantd/open-zoho-tui
ozt --help
```

The npm package contains the local CLI/TUI, not the broker. Follow
[PUBLISHING.md](./PUBLISHING.md) if you are publishing a release.

### From source

```sh
git clone https://github.com/DhyanTD/OpenZohoTUI.git
cd OpenZohoTUI
npm ci
npm run build
npm link --workspace @dhyantd/open-zoho-tui
ozt --help
```

For development without a global link:

```sh
npm run dev:cli -- --help
```

## First login

If your package does not include a broker URL, configure your trusted broker
before logging in:

```sh
ozt config set brokerUrl https://ozt-auth.example.com
ozt auth login
ozt
```

OZT displays Zoho's verification URL and code. Complete that one browser step,
then return to the terminal. The TUI guides you through selecting a portal and
project; normal interactive use does not require copying their IDs.

For script-oriented setup:

```sh
ozt init \
  --portal PORTAL_ID \
  --project PROJECT_ID \
  --billing Billable \
  --timezone Asia/Kolkata
```

Broker URL precedence is:

1. runtime `OZT_BROKER_URL`
2. the URL saved through Settings or `ozt config set brokerUrl`
3. the URL embedded at build time through `OZT_DEFAULT_BROKER_URL`
4. `http://127.0.0.1:8787`

Only use a broker you trust. OAuth refresh credentials are necessarily sent to
that broker so it can exchange them without exposing the Zoho Client Secret.

## A tiny tour

Open the interactive workspace:

```sh
ozt
```

Useful TUI keys:

| Key | Action |
| --- | --- |
| `1` / `2` / `3` | Open Tasks, Time Logs, or Settings. |
| `/` | Search tasks. |
| `n` / `e` / `m` | Create, edit, or move a task. |
| `t` | Start a timer for the selected task. |
| `a` | Add task-linked or general time manually. |
| `x` / `Shift+X` | Stop or cancel the active timer. |
| `p` | Select a project by name. |
| `r` | Refresh the active workspace. |
| `?` | Open context-sensitive help. |
| `q` / `Esc` | Leave the current surface or quit. |

The direct CLI is useful when fingers know what they want before the rest of
the brain has caught up:

```sh
ozt task list
ozt task show WEB-T42
ozt task create --name "Investigate login timeout"
ozt time start WEB-T42 --notes "Debugging session expiry"
ozt time stop
ozt time add --general "Team meeting" --duration 30m
ozt time sync
ozt --json time list
```

See [COMMANDS.md](./COMMANDS.md) for every implemented command, option, output
mode, exit behavior, and key binding.

## Timer safety

The active timer and pending time-log queue are local and durable. Stopping a
timer first creates an immutable pending record, then OZT attempts to send it to
Zoho. Failed submissions remain queued for `ozt time sync`.

Ambiguous network failures are marked `uncertain` and are not retried
automatically. That is deliberate: duplicate time entries are a surprisingly
expensive way to prove that retry logic works.

## Security model

- The Zoho Client Secret exists only on the OAuth broker.
- The CLI stores its Zoho credential encrypted with AES-256-GCM in the user's
  application-data directory.
- By default, the local encryption key is generated separately with owner-only
  permissions. `OZT_CREDENTIAL_KEY` is available as a managed override.
- The broker redacts authorization headers and request/response bodies from
  logs.
- Redis stores short-lived device attempts and hashes binding refresh tokens to
  individual installations; it does not retain completed users' plaintext
  refresh tokens.
- OAuth token exchange destinations are restricted to official or
  operator-configured trusted origins.

Local encryption protects credentials from accidental plaintext disclosure; it
does not protect against an attacker who can already read the user's account
and both local credential files. Deploy the broker behind HTTPS, keep Redis
private, and treat the broker URL as a trust boundary.

## Repository layout

```text
packages/
├── cli/          Commander commands and the React/Ink TUI
├── core/         Configuration, encrypted credentials, timer, and local queue
├── zoho-client/  Runtime-validated Zoho Projects v3 API client
└── broker/       Fastify OAuth device-flow, refresh, and revoke service
```

The repository is an npm workspace written in TypeScript. Zod validates local
state and remote API responses; Vitest covers core, client, service, TUI, and
broker behavior.

## Development

```sh
npm ci
npm run build
npm test
npm run typecheck
```

The CI workflow runs on Linux, macOS, and Windows with Node.js 22 and 24.

When changing a command, option, output format, exit code, or TUI key binding,
update [COMMANDS.md](./COMMANDS.md) in the same change. It is the canonical
user-facing command reference.

## Documentation

- [Command reference](./COMMANDS.md)
- [Broker deployment guide](./DEPLOYMENT.md)
- [npm publishing guide](./PUBLISHING.md)
- [Local development setup](./setup/local-setup.md)

## Contributing

Issues, bug reports, and pull requests are welcome. A good contribution usually
starts by reproducing the behavior, keeps the CLI and TUI on shared services,
adds or updates tests, and leaves `npm test` plus `npm run typecheck` green.

Please do not include Zoho tokens, Client Secrets, Redis credentials, real
portal/project/task IDs, or unredacted API fixtures in issues or commits. The
browser has already caused enough paperwork.

## Acknowledgments

OpenZohoTui began with [DhyanTD](https://github.com/DhyanTD)'s frustration,
idea, product direction, and willingness to keep testing one more Zoho payload.
It was designed and built in collaboration with OpenAI's **ChatGPT and Codex**,
which helped with research, planning, implementation, debugging, security
review, tests, and documentation.

Put simply: a human got tired of the browser, AI joined the rebellion, and
OpenZohoTui became possible.

## License

OpenZohoTui is available under the [MIT License](./LICENSE).

## Disclaimer

OpenZohoTui is an independent open-source project. It is not affiliated with,
endorsed by, or sponsored by Zoho Corporation. Zoho and Zoho Projects are
trademarks of their respective owner.
