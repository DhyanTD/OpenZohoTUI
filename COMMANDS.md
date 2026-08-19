# OZT Command Reference

This document is the canonical reference for the `ozt` command-line interface.
It describes the commands currently implemented in `packages/cli/src/index.ts`.

> Maintenance rule: any change that adds, removes, renames, or changes an `ozt`
> command, argument, option, default, output mode, or exit code must update this
> file in the same change.

## General Usage

```sh
ozt [--json] [--no-input] <command>
ozt --help
ozt help [command]
ozt --version
```

Running `ozt` without a command opens the terminal UI.
When standard input or output is not attached to a terminal, OZT prints command
help and exits instead of attempting to render the TUI.

### Global Options

| Option | Meaning |
| --- | --- |
| `--json` | Emit machine-readable JSON. Errors are also emitted as JSON. |
| `--no-input` | Disable interactive prompts. Reserved for script-safe workflows; current commands do not prompt. |
| `-h, --help` | Display help for the selected command. |
| `-V, --version` | Display the installed OZT version. |

Use `ozt help [command]` or `<command> --help` to display built-in help for a
command group or individual command, for example `ozt help time` or
`ozt task create --help`.

Global options should be placed before the command, for example:

```sh
ozt --json task list
```

Task references accepted by task and time commands may be a Zoho task ID, a
visible task key, or an unambiguous task-name search.

## Terminal UI

```sh
ozt
```

The TUI is the primary interactive OZT experience. It opens the configured
project and provides Tasks, Time Logs, and Settings workspaces. Project, task,
task-list, portal, and status choices are searchable by name; their Zoho IDs do
not need to be entered manually.

### Global Keys

| Key | Action |
| --- | --- |
| `1` | Open Tasks. |
| `2` | Open Time Logs. |
| `3` | Open Settings. |
| `p` | Open the searchable project selector. |
| `r` | Refresh the active workspace and bypass its cache. |
| `?` | Open context-sensitive help. |
| `q` / `Esc` | Quit when no dialog or form is open. |

### Task Keys

| Key | Action |
| --- | --- |
| `Up` / `Down` | Change the selected task. |
| `/` | Search by task name, key, status, or task-list name. |
| `Enter` | Load complete details for the selected task. |
| `n` | Create a task with a guided form. |
| `e` | Edit the selected task's name, status, or description. |
| `m` | Move the selected task using a named task-list selector. |
| `t` | Start a timer for the selected task. |
| `a` | Add manual time for the selected task. |
| `x` | Stop and review the active timer. |
| `Shift+X` | Cancel the active timer after confirmation. |

### Time Log Keys

| Key | Action |
| --- | --- |
| `Up` / `Down` | Change the selected local time-log record. |
| `a` | Select a task and add time manually. |
| `s` | Synchronize all pending logs with Zoho. |
| `x` | Stop and review the active timer. |
| `Shift+X` | Cancel the active timer after confirmation. |

### Settings Keys

| Key | Action |
| --- | --- |
| `Up` / `Down` | Change the selected setting. |
| `Enter` | Perform the selected action or edit the setting. |
| `Delete` | Reset a supported optional setting. |

Settings includes device login/logout, portal and project selectors, a default
task-list selector, billing, timezone, broker URL, and advanced Zoho origins.
When authentication, portal, or project configuration is missing, the TUI opens
Settings and guides the user through the missing choices.

### Forms and Selectors

| Key | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Move between form fields. |
| `Up` / `Down` | Move between form fields or selector results. |
| `Left` / `Right` | Change a choice field. |
| `Enter` | Choose a selector result, advance a text field, add a description newline, or submit while `[ Save ]` is selected. |
| `Ctrl+Shift+S` | Validate and submit a form in terminals with enhanced keyboard reporting. |
| `Alt+S` | Submit fallback for terminals that cannot distinguish `Ctrl+Shift+S` from `Ctrl+S`. |
| `Esc` | Close the current surface; dirty forms require discard confirmation. |

Task creation discovers task lists and custom-field metadata from Zoho. Custom
fields are shown by display label, with named choices for metadata-backed pick
lists. OZT assigns a new task to the authenticated Zoho user when that user can
be matched to an active project member; otherwise, it creates the task
unassigned. A task list is required; the configured default is preselected when
available. Select the `[ Save ]` row and press `Enter` when a terminal does not
report `Ctrl+Shift+S`; validation and Zoho API failures remain visible in the
form so the entered values can be corrected. Timer stop and manual-time forms
can save locally or save and sync immediately. The active timer is durable and
remains running after the TUI exits.

Direct commands below remain available for scripting and automation.

## Authentication

### `ozt auth login`

Start Zoho's device authorization flow. OZT prints a verification URL and code,
waits for authorization, and stores the resulting credential locally.

```sh
ozt auth login
```

OZT uses the packaged broker URL by default. It can be overridden through
Settings, `ozt config set brokerUrl URL`, `ozt init --broker-url URL`, or the
runtime `OZT_BROKER_URL` environment variable.

On first login, OZT generates a private local key to encrypt the stored Zoho
credential. Users do not need to enter a key. `OZT_CREDENTIAL_KEY` is an
optional managed override; blank or unset uses the generated local key.

### `ozt auth status`

Report whether a local credential exists.

```sh
ozt auth status
```

### `ozt auth logout`

Ask the broker to revoke the refresh token, then delete the local credential.

```sh
ozt auth logout
```

## Initial Setup

### `ozt init`

Initialize the portal and optional project defaults.

```sh
ozt init --portal <id> [options]
```

| Option | Required | Meaning |
| --- | --- | --- |
| `--portal <id>` | Yes | Default Zoho Projects portal ID. |
| `--project <id>` | No | Default project ID. |
| `--tasklist <id>` | No | Default task-list ID. |
| `--broker-url <url>` | No | Override the broker URL packaged with the CLI. |
| `--billing <value>` | No | Default billing status: `Billable` or `Non Billable`. |
| `--timezone <iana>` | No | IANA timezone, such as `Asia/Kolkata` or `UTC`. |

Example:

```sh
ozt init \
  --portal 123456789 \
  --project 987654321 \
  --billing Billable \
  --timezone Asia/Kolkata
```

## Configuration

Supported configuration keys are:

| Key | Purpose |
| --- | --- |
| `brokerUrl` | Company OAuth broker base URL. Defaults to the URL embedded when the npm package was built. This key cannot be unset. |
| `portalId` | Default Zoho Projects portal ID. |
| `projectId` | Default project ID. |
| `tasklistId` | Default task-list ID. |
| `billing` | `Billable` or `Non Billable`. |
| `timezone` | IANA timezone used when creating timer-derived logs. |
| `projectsApiOrigin` | Zoho Projects API origin override. |
| `accountsServer` | Zoho Accounts server override. |

### `ozt config get [key]`

Show one configuration value, or all configuration when `key` is omitted.

```sh
ozt config get
ozt config get projectId
```

### `ozt config set <key> <value>`

Set a supported configuration value.

```sh
ozt config set brokerUrl https://ozt-auth.example.com
ozt config set billing Billable
```

### `ozt config unset <key>`

Remove an optional configuration value. `brokerUrl` cannot be unset.

```sh
ozt config unset tasklistId
```

Broker URL precedence is: runtime `OZT_BROKER_URL`, saved `brokerUrl`, embedded
`OZT_DEFAULT_BROKER_URL`, then `http://127.0.0.1:8787`. The default is embedded
by the package maintainer during `npm run build`; it is not read dynamically
from the maintainer's environment after installation.

## Tasks

Task operations require `portalId`; showing, creating, updating, and moving a
task also require `projectId`.

### `ozt task list`

List tasks visible in the configured project. If no project is configured, list
tasks across the configured portal as supported by Zoho.

```sh
ozt task list
ozt --json task list
```

### `ozt task show <reference>`

Resolve a task reference and show its details.

```sh
ozt task show ABC-T12
ozt task show 1234567890123
```

### `ozt task create`

Create a task in the configured project. OZT assigns it to the authenticated
Zoho user when that user matches an active project member, and otherwise creates
it unassigned.

```sh
ozt task create --name <name> [options]
```

| Option | Required | Meaning |
| --- | --- | --- |
| `--name <name>` | Yes | Task name. |
| `--tasklist <id>` | Conditional | Destination task-list ID. Uses the configured `tasklistId` when omitted; one of them is required. |
| `--description <text>` | No | Task description. |
| `--field <name=value...>` | No | One or more v3 custom-field API names and values. |

Examples:

```sh
ozt task create --name "Investigate login timeout"
ozt task create \
  --name "Prepare release" \
  --tasklist 123456789 \
  --description "Prepare version 1.2" \
  --field cf_priority=High cf_team=Platform
```

### `ozt task update <reference>`

Update one or more supported task fields.

```sh
ozt task update <reference> [options]
```

| Option | Meaning |
| --- | --- |
| `--name <name>` | Set the task name. |
| `--status <id>` | Set the task status by status ID. |
| `--description <text>` | Set the task description. |

Example:

```sh
ozt task update ABC-T12 --status 123456789 --name "Updated title"
```

### `ozt task move <reference>`

Move a task to another task list in the configured project.

```sh
ozt task move <reference> --tasklist <id>
```

## Time Tracking

OZT uses a durable local timer and pending-log queue. Stopping a timer or adding
time manually creates a local pending record; run `ozt time sync` to submit
pending records to Zoho.

Durations accept the forms supported by the duration parser, including minute
counts and hour/minute values such as `90m`, `1h`, and `1h30m`.

### `ozt time start <task>`

Start the single local timer for a task.

```sh
ozt time start <task> [options]
```

| Option | Meaning |
| --- | --- |
| `--notes <text>` | Notes saved with the eventual time log. |
| `--billing <value>` | Override billing with `Billable` or `Non Billable`. |

If billing is not supplied, OZT uses the configured default and then falls back
to `Non Billable`. Starting a timer while another timer is active fails.

Example:

```sh
ozt time start ABC-T12 --notes "Implementing API validation" --billing Billable
```

### `ozt time status`

Show the active timer, or `{ "active": false }` if no timer is running.

```sh
ozt time status
```

### `ozt time stop`

Stop the active timer and put the resulting time log in the pending queue.

```sh
ozt time stop [--duration <duration>]
```

Use `--duration` to override the elapsed time before the pending record is
created.

```sh
ozt time stop --duration 1h30m
```

### `ozt time cancel`

Discard the active timer without creating a pending time log.

```sh
ozt time cancel
```

### `ozt time add <task>`

Add a manual time entry to the local pending queue.

```sh
ozt time add <task> --duration <duration> [options]
```

| Option | Required | Meaning |
| --- | --- | --- |
| `--duration <duration>` | Yes | Time spent. |
| `--date <yyyy-mm-dd>` | No | Work date; defaults to the current UTC date. |
| `--notes <text>` | No | Time-log notes; defaults to an empty string. |
| `--billing <value>` | No | Override with `Billable` or `Non Billable`. |

Example:

```sh
ozt time add ABC-T12 \
  --duration 45m \
  --date 2026-08-18 \
  --notes "Code review" \
  --billing Billable
```

### `ozt time list`

List all locally stored pending-log records, including their queue states.

```sh
ozt time list
```

Queue states are:

| State | Meaning |
| --- | --- |
| `pending` | Waiting for submission or safe to retry. |
| `submitting` | Submission has started. |
| `submitted` | Zoho accepted the log; the record includes its Zoho ID. |
| `uncertain` | The request outcome was ambiguous and is not retried automatically. |
| `needs_review` | The record requires manual review before it can be submitted. |

### `ozt time sync`

Submit every `pending` record to Zoho. Successfully submitted records remain in
the local history with the `submitted` state. Failed records return to `pending`,
except ambiguous failures, which become `uncertain`. Retrying an existing
`pending` record is safe after correcting a validation or endpoint error; a
successful retry clears its previous error message.

```sh
ozt time sync
```

## Output and Exit Codes

- Normal human-readable output is written to standard output; errors are written
  to standard error.
- With `--json`, normal output and errors are serialized as JSON on standard
  output.
- Exit code `0` means success.
- Exit code `1` means a usage, validation, authentication, configuration, or
  non-retryable Zoho error.
- Exit code `75` means Zoho reported a retryable error.

## Typical Workflow

```sh
ozt config set brokerUrl https://ozt-auth.example.com
ozt auth login
ozt init --portal PORTAL_ID --project PROJECT_ID --billing Billable --timezone Asia/Kolkata

ozt task list
ozt time start ABC-T12 --notes "Implementation"
ozt time status
ozt time stop
ozt time sync
```
