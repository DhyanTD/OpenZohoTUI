# OpenZohoTui deployment

This guide deploys the shared OAuth broker used by OpenZohoTui. users run
the TUI on their own computers; there is no central TUI or web application to
host.

## What must run centrally

```text
user's terminal ──HTTPS──> OAuth broker ──HTTPS──> Zoho Accounts
        │                         │
        │                         └────────────> Redis
        │
        └────────────────HTTPS────────────────> Zoho Projects API
```

Deploy these two components:

- the Node.js OAuth broker from `packages/broker`
- a persistent Redis instance reachable only by the broker

The broker keeps the Zoho client secret away from user machines. It handles
device login, token refresh, and token revocation. Normal Zoho Projects API
traffic goes directly from each user's TUI to Zoho, so the broker is not an API
proxy and should have modest bandwidth requirements.

## Production prerequisites

- Node.js 22 or newer
- a persistent Redis service, preferably with TLS and authentication
- an HTTPS hostname such as `ozt-auth.example.com`
- a Zoho **Non-browser application** client
- a deployment target that can run a long-lived Node.js process

The broker may be internet-reachable or limited to the company VPN. A VPN or
other network restriction is preferable for an internal tool. It does not need
to receive a callback from Zoho, but every user's terminal must be able to
reach it.

## 1. Create the Zoho OAuth client

1. Open the Zoho API Console for the datacenter where the application will be
   registered.
2. Create a **Non-browser application** (device authorization flow).
3. Enter a client name and homepage URL. This flow does not require a redirect
   URI.
4. Enable Zoho multi-datacenter support if users belong to more than one Zoho
   datacenter.
5. Save the Client ID and Client Secret in the deployment platform's secret
   manager.

Zoho documents the client type and login exchange in its
[Non-browser applications guide](https://www.zoho.com/developer/oauth/non-browser-apps/overview.html).
The polling exchange requires the client secret, which is why that secret stays
on the broker and is never bundled into npm.

The broker currently requests these scopes:

```text
ZohoProjects.portals.READ
ZohoProjects.projects.READ
ZohoProjects.users.READ
ZohoProjects.tasklists.READ
ZohoProjects.tasks.ALL
ZohoProjects.timesheets.ALL
ZohoProjects.custom_fields.READ
AaaServer.profile.Read
```

Changing that list requires a code change in `packages/broker/src/index.ts` and
users may need to log in again to grant the new scopes.

## 2. Configure production environment variables

The broker loads a `.env` file from its working directory if one exists.
Already-exported environment variables take precedence, so a hosting
platform's secrets override `.env` values.

| Variable | Required | Production value |
| --- | --- | --- |
| `ZOHO_CLIENT_ID` | yes | Client ID from the Zoho API Console |
| `ZOHO_CLIENT_SECRET` | yes | Client Secret from the Zoho API Console |
| `REDIS_URL` | yes | Authenticated `redis://` or TLS `rediss://` URL |
| `ZOHO_ACCOUNTS_SERVER` | no | Primary app datacenter; default `https://accounts.zoho.com` |
| `ZOHO_PROJECTS_API_ORIGIN` | no | Matching Projects API origin; default `https://projectsapi.zoho.com` |
| `BROKER_HOST` | no | `127.0.0.1` behind a same-host proxy; `0.0.0.0` in most containers |
| `BROKER_PORT` | no | Listening port; default `8787` |
| `BROKER_TRUST_PROXY` | no | `true` only behind a trusted proxy; default `false` |

Example for an India-datacenter deployment behind a same-host reverse proxy:

```dotenv
ZOHO_CLIENT_ID=replace-me
ZOHO_CLIENT_SECRET=replace-me
REDIS_URL=rediss://user:password@redis.internal.example:6379/0
ZOHO_ACCOUNTS_SERVER=https://accounts.zoho.in
ZOHO_PROJECTS_API_ORIGIN=https://projectsapi.zoho.in
BROKER_HOST=127.0.0.1
BROKER_PORT=8787
BROKER_TRUST_PROXY=true
```

Use `BROKER_TRUST_PROXY=true` only when clients cannot bypass the reverse proxy
and the proxy replaces forwarded-client headers. This lets Fastify rate-limit
the real client IP instead of treating all users as the proxy's IP.

`OZT_DEFAULT_BROKER_URL` is not a broker runtime setting. It is used later while
building the npm packages.

## 3. Build and start the broker

From the repository root:

```sh
npm ci
npm run build --workspace @dhyantd/open-zoho-tui-broker
npm run start:broker
```

For a managed application platform, use those as the install/build and start
commands. Configure its health check as `GET /health`, set `BROKER_HOST=0.0.0.0`
when the platform connects directly to the process, and map the platform port
to `BROKER_PORT`.

The process must remain running. Do not deploy it as a short-lived scheduled
job or scale it to zero if users need login or token refresh to work
without a cold-start delay.

### Example systemd service

On a Linux VM, build the repository in `/opt/open-zoho-tui`, put secrets in
`/etc/open-zoho-tui/broker.env`, and run the compiled broker under a dedicated
unprivileged account:

```ini
[Unit]
Description=OpenZohoTui OAuth broker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=openzoho
Group=openzoho
WorkingDirectory=/opt/open-zoho-tui
EnvironmentFile=/etc/open-zoho-tui/broker.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/open-zoho-tui/packages/broker/dist/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict

[Install]
WantedBy=multi-user.target
```

Replace `/usr/bin/node` with the result of `command -v node` on the server if
Node is installed elsewhere. Restrict the environment file to the service
account, then enable and inspect the service:

```sh
sudo chmod 600 /etc/open-zoho-tui/broker.env
sudo systemctl daemon-reload
sudo systemctl enable --now open-zoho-tui-broker
sudo systemctl status open-zoho-tui-broker
sudo journalctl -u open-zoho-tui-broker -f
```

## 4. Put HTTPS in front of the broker

Expose only HTTPS to users. Keep the Node port and Redis private. A minimal
Caddy reverse-proxy configuration is:

```caddyfile
ozt-auth.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Equivalent Nginx, a cloud load balancer, or a managed platform endpoint is
fine. The requirements are:

- a valid TLS certificate
- no caching of OAuth responses
- a request-body limit of at least 16 KiB
- an upstream timeout longer than 15 seconds
- replacement of untrusted `X-Forwarded-For` headers when proxy trust is on
- no direct public route to the broker's unproxied port

## 5. Verify the deployment

Check broker and Redis readiness through the public endpoint:

```sh
curl --fail --silent --show-error https://ozt-auth.example.com/health
```

Expected response:

```json
{"status":"ok"}
```

The endpoint returns HTTP 503 if Redis cannot be reached. After that check,
perform one end-to-end login from a clean local data directory:

```sh
OZT_BROKER_URL=https://ozt-auth.example.com \
OZT_DATA_DIR=/tmp/ozt-deployment-smoke \
ozt auth login
```

Complete the displayed Zoho verification flow, then run:

```sh
OZT_BROKER_URL=https://ozt-auth.example.com \
OZT_DATA_DIR=/tmp/ozt-deployment-smoke \
ozt portal list
```

Remove the temporary directory when the smoke test is complete. This test
validates the broker, Redis, Zoho client credentials, datacenter, requested
scopes, and Projects API access together.

## 6. Publish and roll out the TUI

Build the packages with the production broker URL embedded:

```sh
export OZT_DEFAULT_BROKER_URL=https://ozt-auth.example.com
npm run build
```

Then follow [PUBLISHING.md](./PUBLISHING.md). A user can run the published
TUI without a permanent installation:

```sh
npx --yes --package=@dhyantd/open-zoho-tui@latest ozt
```

Or install it once:

```sh
npm install --global @dhyantd/open-zoho-tui
ozt
```

Each user authenticates with their own Zoho account. Do not share local
OpenZohoTui data directories or credential files.

## Security and operations checklist

- Keep `ZOHO_CLIENT_SECRET`, Redis credentials, and `.env` out of git, images,
  npm packages, and logs.
- Prefer a secret manager or a root-readable environment file over shell
  history.
- Expose Redis only on a private network and require authentication.
- Restrict the broker to company VPN/IP ranges when practical. The device-start
  endpoint is intentionally unauthenticated so a new CLI can begin login.
- Monitor non-2xx responses, restarts, Redis availability, and unusual login
  traffic. Request bodies and authorization headers are redacted by the broker.
- OAuth refresh and revoke calls use the accounts-server origin stored by the
  broker during device login. Client-supplied and Redis-stored origins are
  rejected unless they exactly match an official or operator-configured origin.
- Preserve Redis across deploys. It contains short-lived device attempts and
  one-year hashes binding refresh tokens to individual installations. It does
  not retain completed users' plaintext refresh tokens. Losing Redis does not
  expose tokens, but every existing user must authenticate again.
- Back up Redis only if avoiding that reauthentication is important; protect
  backups as sensitive operational data.
- Rotate the Zoho client secret in the platform secret manager and restart the
  broker. Expect in-progress device logins to be restarted.
- Keep the same public broker URL where possible. A URL change requires a new
  npm build for the embedded default, although users can immediately override
  it with `OZT_BROKER_URL` or `ozt config set brokerUrl URL`.

## Updating and rolling back

For a broker update:

1. Build and test the intended git revision.
2. Deploy the new compiled broker while keeping the existing Redis data.
3. Restart the service and wait for `/health` to return HTTP 200.
4. Run the login/portal smoke test when OAuth behavior changed.
5. Roll back to the previous revision and rebuild if health or smoke tests fail.

Multiple broker instances can share the same Redis database, but rate limits
are currently maintained per process. Keep that in mind when changing replica
count or configuring alerts.
