# OpenZohoConnect

`ozc` is a private team CLI for Zoho Projects v3 task and time-log workflows. The repository contains:

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
export OZC_CREDENTIAL_KEY='replace-with-a-long-local-secret'
npm run dev:cli -- --help
```

Install a global development link:

```sh
npm run build
npm link --workspace @company/open-zoho-connect
ozc --help
```

Re-run `npm run build` after changing source files. The linked `ozc` command executes `packages/cli/dist/index.js`.

Non-secret state defaults to the platform application-data directory. Set `OZC_DATA_DIR` during development or testing to isolate it.

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
ozc config set brokerUrl https://ozc-auth.example.com
ozc auth login
ozc init --portal PORTAL_ID --project PROJECT_ID --billing Billable --timezone UTC
ozc task list
```

The Projects API origin is broker-controlled because Zoho's OAuth `api_domain` and Projects API origin are not interchangeable. Validate `ZOHO_PROJECTS_API_ORIGIN`, scopes, task mutation methods, and time-log payloads against the company sandbox before production use.

## Timer Queue

```sh
ozc time start ABC-T12 --notes "Implementation"
ozc time stop
ozc time list
ozc time sync
```

Stopping a timer first creates an immutable local pending record. Failed submissions stay queued. Ambiguous network failures enter `uncertain` and are not retried automatically.
