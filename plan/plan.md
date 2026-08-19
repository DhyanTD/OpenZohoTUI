
# OpenZohoConnect Team CLI

## Summary

Yes, this is feasible. Zoho Projects v3 provides OAuth-authenticated APIs for reading projects, creating/updating tasks, changing status, moving tasks, and managing time logs. The CLI will respect each user’s existing Zoho permissions and approval rules. [Zoho Projects v3 API](https://projects.zoho.com/api-docs)

Build a TypeScript team CLI named `ozc`, distributed as a private npm package. It will provide scriptable commands, interactive prompts, and an Ink-based TUI. Use only v3 endpoints; the legacy v2 API reached end-of-life on June 30, 2026. [Zoho v3 announcement](https://help.zoho.com/portal/en/community/topic/explore-v3-apis-simplified-streamlined)

## User Flow and Commands

- Company admin registers a multi-datacenter, non-browser OAuth application and deploys the authentication broker.
- User installs with `npm install -g @company/open-zoho-connect`.
- `ozc auth login` displays Zoho’s verification URL/code. After one browser consent, later usage remains terminal-only.
- `ozc init` selects the default portal, project, billing preference, timezone, and optional task-list default.
- Running `ozc` without arguments opens the TUI:
  - Browse assigned tasks with project/status filters.
  - Fuzzy-search by task key or name.
  - View task details.
  - Start/stop a timer or add time manually.
  - Change status or task list.
  - Create a task.
- Direct command interface:
  - `ozc task list|show|create|update|move`
  - `ozc time start|status|stop|cancel|add|list|sync`
  - `ozc auth login|logout|status`
  - `ozc config get|set`
- Accept a visible task key or Zoho ID. Search by key/name when necessary; interactive mode asks on ambiguity, while non-interactive mode returns candidates and fails.
- Task creation supports standard fields and repeatable `--field api_name=value` custom fields. Interactive mode discovers and prompts for required layout fields.
- `task update --status` handles workflow movement; `task move --tasklist` handles movement between task lists, including another project where Zoho permissions permit it.
- Commands support `--json`, `--no-input`, and meaningful exit codes for scripting.

## Architecture and Data Flow

- Use an npm workspace with:
  - TypeScript, oclif, strict compiler settings, Zod validation, and native `fetch` for the CLI.
  - React + Ink for the TUI, Fuse.js for cached fuzzy search, and shared command services so TUI and commands behave identically.
  - Fastify plus Redis for the small OAuth broker.
- OAuth broker endpoints:
  - `POST /v1/oauth/device/start`
  - `GET /v1/oauth/device/:attemptId`
  - `POST /v1/oauth/refresh`
- The broker stores the Zoho client secret and short-lived device attempts in Redis. It returns successful tokens once, does not retain user refresh tokens, redacts request bodies, and rate-limits attempts.
- Request `ZohoProjects.portals.READ`, `ZohoProjects.projects.READ`, `ZohoProjects.users.READ`, `ZohoProjects.tasklists.READ`, `ZohoProjects.tasks.ALL`, `ZohoProjects.timesheets.ALL`, `ZohoProjects.custom_fields.READ`, and `AaaServer.profile.Read`. The task-list and custom-field scopes support named selectors and metadata-backed TUI forms; the user and profile scopes resolve the authenticated creator's project ZPUID for default assignment.
- Store refresh tokens in the OS credential vault through `@napi-rs/keyring`. Store non-secret configuration, cache, and timer state under the platform’s standard application-data directory with owner-only permissions.
- Always use the `api_domain` returned by Zoho instead of hardcoding a region. Access tokens expire after one hour and are refreshed through the broker. [Zoho device-token flow](https://www.zoho.com/developer/oauth/non-browser-apps/polling-request.html)
- Centralize v3 API access behind typed portal, project, task, metadata, and timesheet clients. Handle pagination, ISO-8601 dates, token refresh, permission errors, and `Retry-After`; Zoho documents a 200-request-per-endpoint/two-minute limit.
- Cache projects, task lists, statuses, layouts, and recently assigned tasks with a short TTL. Explicit refresh bypasses the cache.
- Timer behavior:
  - Permit one active local timer.
  - Persist it immediately so closing the terminal or rebooting does not lose it.
  - On stop, round to the nearest minute, show the calculated duration, and allow correction.
  - Convert the timer to an immutable pending time-log record before calling Zoho.
  - If offline, retain it for `ozc time sync`.
  - For an ambiguous timeout, inspect recent matching logs before retrying to prevent duplicates.
  - Starting another timer fails in non-interactive mode; interactive mode offers stop, cancel, or keep the existing timer.
- Never bypass Zoho permissions, required fields, blueprint transitions, timesheet locks, or approval rules. Surface Zoho’s actionable error and preserve pending time locally when submission fails.

## Delivery and Verification

- First validate the registered app against a company sandbox or low-risk project: login, portal discovery, assigned-task listing, task creation, status change, task-list move, manual log, and timer-generated log.
- Unit-test duration parsing, task-reference resolution, pagination, cache expiry, token refresh, timer recovery, billing defaults, and error mapping.
- Contract-test API clients with recorded/redacted v3 fixtures, including `401`, `403`, validation failures, `429`, `5xx`, and ambiguous time-log submission.
- Test commands and TUI navigation independently, including non-TTY and `--json` behavior.
- End-to-end test the broker/device flow with a fake Zoho OAuth server and Redis.
- Run CI on Linux, macOS, and Windows using supported Node LTS versions; publish signed, versioned releases to the company npm registry.
- Acceptance requires two different Zoho users to authenticate separately and see only permitted data, complete all core task/time operations, recover a timer after restart, and queue/synchronize a time log after simulated network failure.

## Assumptions and Defaults

- Initial scope is Zoho Projects tasks, not the Issues/Bugs module.
- This is a team-internal tool using one company-managed OAuth application and private npm distribution.
- The TUI covers browsing and core task/time actions; advanced automation remains available through direct commands.
- Billing has no hidden global assumption: onboarding requires each user to choose a default, and every command can override it.
- Destructive task deletion, attachments, comments, timesheet approval, and issue management are outside v1.
- The repository is currently empty, so the workspace, CLI, broker, documentation, and CI will be created from scratch.
