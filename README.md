# OpenZohoTui

`ozt` is a private team CLI for Zoho Projects v3 task and time-log workflows. The repository contains:

- `packages/cli`: command interface and Ink task browser
- `packages/core`: validated local configuration, encrypted credentials, and timer queue
- `packages/zoho-client`: runtime-validated Zoho Projects v3 client
- `packages/broker`: public OAuth device-flow and refresh broker backed by Redis

See [COMMANDS.md](./COMMANDS.md) for the complete command reference.

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
export OZT_CREDENTIAL_KEY='replace-with-a-long-local-secret'
npm run dev:cli -- --help
```

Install a global development link:

```sh
npm run build
npm link --workspace @company/open-zoho-tui
ozt --help
```

Re-run `npm run build` after changing source files. The linked `ozt` command executes `packages/cli/dist/index.js`.

Non-secret state defaults to the platform application-data directory. Set `OZT_DATA_DIR` during development or testing to isolate it.

## Broker

The broker requires:

```text
ZOHO_CLIENT_ID
ZOHO_CLIENT_SECRET
REDIS_URL
ZOHO_ACCOUNTS_SERVER
ZOHO_PROJECTS_API_ORIGIN
```

Optional settings are `BROKER_HOST` and `BROKER_PORT`. Deploy behind TLS. Request bodies and authorization headers are redacted from logs. Refresh and revoke requests require the per-installation credential returned by a completed device login.

```sh
npm run dev:broker
```

## First Login

```sh
ozt config set brokerUrl https://ozt-auth.example.com
ozt auth login
ozt init --portal PORTAL_ID --project PROJECT_ID --billing Billable --timezone UTC
ozt task list
```

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
