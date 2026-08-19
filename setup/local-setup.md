# Local Setup

This guide runs OpenZohoTui locally with Redis, the OAuth broker, and the globally linked `ozt` CLI.

## Prerequisites

- Node.js 22 or newer
- npm
- Docker, or a locally installed Redis server
- A Zoho non-browser OAuth application

## Register the Zoho Application

Open the [Zoho API Console](https://api-console.zoho.com/) and create a client with the **Non-browser Applications** type.

1. Enable every Zoho datacenter your users require in the application settings.
2. Record the client ID and client secret.
3. Keep the client secret private. It belongs only on the broker.

A redirect URL is not required because OpenZohoTui uses Zoho's device authorization flow.

## Install Dependencies

From the repository root:

```bash
npm install
npm run build
npm test
npm run typecheck
```

## Install the Local CLI

Create a global development link:

```bash
npm link --workspace @company/open-zoho-tui
```

Verify the command:

```bash
ozt --version
ozt --help
```

The linked command runs `packages/cli/dist/index.js`. Rebuild after changing source code:

```bash
npm run build
```

Remove the global link when it is no longer needed:

```bash
npm unlink -g @company/open-zoho-tui
```

## Start Redis

Run Redis in the foreground with Docker:

```bash
docker run --rm \
  --name ozt-redis \
  -p 6379:6379 \
  redis:7-alpine
```

Leave that terminal running. To run Redis in the background instead:

```bash
docker run -d \
  --name ozt-redis \
  -p 6379:6379 \
  redis:7-alpine
```

Confirm Redis is running:

```bash
docker ps
```

Stop a background Redis container with:

```bash
docker stop ozt-redis
```

## Configure the Broker

Open another terminal in the repository and export the broker settings:

```bash
export ZOHO_CLIENT_ID='your-zoho-client-id'
export ZOHO_CLIENT_SECRET='your-zoho-client-secret'
export REDIS_URL='redis://127.0.0.1:6379'

export ZOHO_ACCOUNTS_SERVER='https://accounts.zoho.com'
export ZOHO_PROJECTS_API_ORIGIN='https://projectsapi.zoho.com'

export BROKER_HOST='127.0.0.1'
export BROKER_PORT='8787'
```

`ZOHO_ACCOUNTS_SERVER` should initially match the datacenter where the OAuth application was registered. The broker handles Zoho's `other_dc` response for users in other enabled datacenters.

### Datacenter Examples

For Europe:

```bash
export ZOHO_ACCOUNTS_SERVER='https://accounts.zoho.eu'
export ZOHO_PROJECTS_API_ORIGIN='https://projectsapi.zoho.eu'
```

For India:

```bash
export ZOHO_ACCOUNTS_SERVER='https://accounts.zoho.in'
export ZOHO_PROJECTS_API_ORIGIN='https://projectsapi.zoho.in'
```

## Start the Broker

Start the Fastify broker from the repository root:

```bash
npm run dev:broker
```

Keep this terminal running. By default, the broker listens at `http://127.0.0.1:8787`.

Check its health from another terminal:

```bash
curl http://127.0.0.1:8787/health
```

Expected response:

```json
{"status":"ok"}
```

## Configure the CLI

The CLI encrypts the local Zoho refresh token. Set a development credential key containing at least 16 characters:

```bash
export OZT_CREDENTIAL_KEY='local-development-secret-at-least-16-characters'
```

Use the same value in future terminal sessions. A different value cannot decrypt credentials created with the original key.

To isolate local test data from normal application state, optionally set:

```bash
export OZT_DATA_DIR=/tmp/ozt-local
```

Point the CLI at the local broker:

```bash
ozt config set brokerUrl http://127.0.0.1:8787
```

## Authenticate

Start the Zoho device login:

```bash
ozt auth login
```

The command displays a Zoho verification URL and code. Open the URL, enter the code if requested, and approve access.

Check authentication afterward:

```bash
ozt auth status
```

Expected result:

```json
{
  "authenticated": true
}
```

## Initialize a Project

Configure a real portal and low-risk project:

```bash
ozt init \
  --portal YOUR_PORTAL_ID \
  --project YOUR_PROJECT_ID \
  --billing Billable \
  --timezone Asia/Kolkata
```

Test read-only commands first:

```bash
ozt config get
ozt task list
ozt task show YOUR_TASK_KEY
```

Then test a short time entry in the low-risk project:

```bash
ozt time add YOUR_TASK_KEY \
  --duration 5m \
  --notes "ozt local test"

ozt time list
ozt time sync
```

## Use an Environment File

The broker does not load `.env` files itself. Create a repository-root `.env` file if desired:

```dotenv
ZOHO_CLIENT_ID=your-client-id
ZOHO_CLIENT_SECRET=your-client-secret
REDIS_URL=redis://127.0.0.1:6379
ZOHO_ACCOUNTS_SERVER=https://accounts.zoho.com
ZOHO_PROJECTS_API_ORIGIN=https://projectsapi.zoho.com
BROKER_HOST=127.0.0.1
BROKER_PORT=8787
```

Load it through the shell before starting the broker:

```bash
set -a
source .env
set +a
npm run dev:broker
```

The repository ignores `.env`. Never commit or share the file because it contains the Zoho client secret.

## Troubleshooting

### `Error: fetch failed`

The broker is unavailable at the configured URL. Confirm both services are running:

```bash
docker ps
curl http://127.0.0.1:8787/health
ozt config get brokerUrl
```

### Broker Exits Immediately

Confirm all required variables are present:

```bash
env | rg '^(ZOHO_|REDIS_URL|BROKER_)'
```

Do not share that output because it may include the Zoho client secret.

### CLI Cannot Decrypt Credentials

Restore the same `OZT_CREDENTIAL_KEY` used during login. To discard the isolated local test state and authenticate again:

```bash
rm -rf /tmp/ozt-local
```

Only run that command when `OZT_DATA_DIR` is set to `/tmp/ozt-local` and the test state is no longer needed.

### Linked CLI Runs Old Code

Rebuild the compiled packages:

```bash
npm run build
ozt --help
```
