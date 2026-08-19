# OpenZohoTui

`ozt` is a private team CLI for Zoho Projects v3 task and time-log workflows. The repository contains:

- `packages/cli`: command interface and Ink task browser
- `packages/core`: validated local configuration, encrypted credentials, and timer queue
- `packages/zoho-client`: runtime-validated Zoho Projects v3 client
- `packages/broker`: public OAuth device-flow and refresh broker backed by Redis

Documentation:

- [COMMANDS.md](./COMMANDS.md): complete CLI and TUI reference
- [DEPLOYMENT.md](./DEPLOYMENT.md): production broker and Redis deployment
- [PUBLISHING.md](./PUBLISHING.md): npm release and colleague installation
- [setup/local-setup.md](./setup/local-setup.md): local development setup

## Installation

After the packages have been published to npm, run the TUI without a permanent
installation:

```sh
npx --yes --package=@dhyantd/open-zoho-tui@latest ozt
```

Or install the CLI package globally:

```sh
npm install --global @dhyantd/open-zoho-tui
ozt --help
```

The OAuth broker is deployed as a service; it is not installed on user
machines. See [PUBLISHING.md](./PUBLISHING.md) before the first npm release.

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm run build
npm test
npm run typecheck
```

Run the CLI from source after building the workspace dependencies:

```sh
npm run dev:cli -- --help
```

Install a global development link:

```sh
npm run build
npm link --workspace @dhyantd/open-zoho-tui
ozt --help
```

Re-run `npm run build` after changing source files. The linked `ozt` command executes `packages/cli/dist/index.js`.

Non-secret state defaults to the platform application-data directory. Set
`OZT_DATA_DIR` during development or testing to isolate it. OZT generates a
private 256-bit credential-encryption key on first login. `OZT_CREDENTIAL_KEY`
is an optional override for centrally managed environments; when provided, it
must contain at least 16 characters and must remain consistent across runs.

## Broker

Copy `.env.example` to `.env`. The broker loads `.env` automatically, and
variables already exported by the shell take precedence.

The broker requires:

```text
ZOHO_CLIENT_ID
ZOHO_CLIENT_SECRET
REDIS_URL
```

Optional settings are `ZOHO_ACCOUNTS_SERVER`, `ZOHO_PROJECTS_API_ORIGIN`,
`BROKER_HOST`, `BROKER_PORT`, and `BROKER_TRUST_PROXY`. Deploy behind TLS. Set
`BROKER_TRUST_PROXY=true` only when the broker is reachable exclusively through
a trusted reverse proxy that replaces forwarded-client headers. Request bodies
and authorization headers are redacted from logs. Refresh and revoke requests
require the per-installation credential returned by a completed device login.

```sh
npm run dev:broker
```

To publish the npm CLI with a company broker URL already configured, set
`OZT_DEFAULT_BROKER_URL` in `.env` or export it while building:

```sh
OZT_DEFAULT_BROKER_URL=https://ozt-auth.example.com npm run build
```

An exported runtime `OZT_BROKER_URL` has highest priority, followed by a URL
saved through Settings, `ozt config set brokerUrl`, or `ozt init --broker-url`.
The embedded build URL is used next; an empty build value falls back to
`http://127.0.0.1:8787`.

## First Login

```sh
ozt auth login
ozt init --portal PORTAL_ID --project PROJECT_ID --billing Billable --timezone UTC
ozt task list
```

If the distributed package does not embed the correct broker, override it in
Settings or run `ozt config set brokerUrl URL` before login.

Running `ozt` with no arguments opens the interactive Tasks, Time Logs, and
Settings workspace. It provides searchable selectors for portals, projects,
tasks, task lists, and statuses, so normal TUI use does not require Zoho IDs.

The broker requests `ZohoProjects.tasklists.READ`,
`ZohoProjects.custom_fields.READ`, `ZohoProjects.users.READ`, and
`AaaServer.profile.Read` in addition to the portal, project, task, and timesheet
scopes. Existing users must run `ozt auth logout` and authenticate once after
deploying this version. The metadata scopes power named TUI forms; the user and
profile scopes let task creation assign the authenticated user when OZT can
match that account to an active project member. Otherwise, the task is created
unassigned.

The Projects API origin is broker-controlled because Zoho's OAuth `api_domain` and Projects API origin are not interchangeable. Validate `ZOHO_PROJECTS_API_ORIGIN`, scopes, task mutation methods, and time-log payloads against the company sandbox before production use.

## Timer Queue

```sh
ozt time start ABC-T12 --notes "Implementation"
ozt time stop
ozt time list
ozt time sync
```

Stopping a timer first creates an immutable local pending record. Failed submissions stay queued. Ambiguous network failures enter `uncertain` and are not retried automatically.
