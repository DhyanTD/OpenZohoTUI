# OZC Command Reference

This document is the canonical reference for the `ozc` command-line interface.
It describes the commands currently implemented in `packages/cli/src/index.ts`.

> Maintenance rule: any change that adds, removes, renames, or changes an `ozc`
> command, argument, option, default, output mode, or exit code must update this
> file in the same change.

## General Usage

```sh
ozc [--json] [--no-input] <command>
ozc --help
ozc help [command]
ozc --version
```

Running `ozc` without a command opens the terminal UI.
When standard input or output is not attached to a terminal, OZC prints command
help and exits instead of attempting to render the TUI.

### Global Options

| Option | Meaning |
| --- | --- |
| `--json` | Emit machine-readable JSON. Errors are also emitted as JSON. |
| `--no-input` | Disable interactive prompts. Reserved for script-safe workflows; current commands do not prompt. |
| `-h, --help` | Display help for the selected command. |
| `-V, --version` | Display the installed OZC version. |

Use `ozc help [command]` or `<command> --help` to display built-in help for a
command group or individual command, for example `ozc help time` or
`ozc task create --help`.

Global options should be placed before the command, for example:

```sh
ozc --json task list
```

Task references accepted by task and time commands may be a Zoho task ID, a
visible task key, or an unambiguous task-name search.

## Terminal UI

```sh
ozc
```

The TUI is the primary interactive OZC experience. It opens the configured
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
lists. New tasks are assigned to the authenticated Zoho user by default. Select
the `[ Save ]` row and press `Enter` when a terminal does not report
`Ctrl+Shift+S`; validation and Zoho API failures remain visible in the form so
the entered values can be corrected. Timer stop and manual-time forms can save
locally or save and sync immediately. The active timer is durable and remains
running after the TUI exits.

Direct commands below remain available for scripting and automation.

## Authentication

### `ozc auth login`

Start Zoho's device authorization flow. OZC prints a verification URL and code,
waits for authorization, and stores the resulting credential locally.

```sh
ozc auth login
```

The broker URL must be configured first with `ozc config set brokerUrl URL`.

### `ozc auth status`

Report whether a local credential exists.

```sh
ozc auth status
```

### `ozc auth logout`

Ask the broker to revoke the refresh token, then delete the local credential.

```sh
ozc auth logout
```

## Initial Setup

### `ozc init`

Initialize the portal and optional project defaults.

```sh
ozc init --portal <id> [options]
```

| Option | Required | Meaning |
| --- | --- | --- |
| `--portal <id>` | Yes | Default Zoho Projects portal ID. |
| `--project <id>` | No | Default project ID. |
| `--tasklist <id>` | No | Default task-list ID. |
| `--billing <value>` | No | Default billing status: `Billable` or `Non Billable`. |
| `--timezone <iana>` | No | IANA timezone, such as `Asia/Kolkata` or `UTC`. |

Example:

```sh
ozc init \
  --portal 123456789 \
  --project 987654321 \
  --billing Billable \
  --timezone Asia/Kolkata
```

## Configuration

Supported configuration keys are:

| Key | Purpose |
| --- | --- |
| `brokerUrl` | Company OAuth broker base URL. This key cannot be unset. |
| `portalId` | Default Zoho Projects portal ID. |
| `projectId` | Default project ID. |
| `tasklistId` | Default task-list ID. |
| `billing` | `Billable` or `Non Billable`. |
| `timezone` | IANA timezone used when creating timer-derived logs. |
| `projectsApiOrigin` | Zoho Projects API origin override. |
| `accountsServer` | Zoho Accounts server override. |

### `ozc config get [key]`

Show one configuration value, or all configuration when `key` is omitted.

```sh
ozc config get
ozc config get projectId
```

### `ozc config set <key> <value>`

Set a supported configuration value.

```sh
ozc config set brokerUrl https://ozc-auth.example.com
ozc config set billing Billable
```

### `ozc config unset <key>`

Remove an optional configuration value. `brokerUrl` cannot be unset.

```sh
ozc config unset tasklistId
```

## Tasks

Task operations require `portalId`; showing, creating, updating, and moving a
task also require `projectId`.

### `ozc task list`

List tasks visible in the configured project. If no project is configured, list
tasks across the configured portal as supported by Zoho.

```sh
ozc task list
ozc --json task list
```

### `ozc task show <reference>`

Resolve a task reference and show its details.

```sh
ozc task show ABC-T12
ozc task show 1234567890123
```

### `ozc task create`

Create a task in the configured project and assign it to the authenticated Zoho
user. The user must be an active member of the configured project.

```sh
ozc task create --name <name> [options]
```

| Option | Required | Meaning |
| --- | --- | --- |
| `--name <name>` | Yes | Task name. |
| `--tasklist <id>` | No | Destination task-list ID. |
| `--description <text>` | No | Task description. |
| `--field <name=value...>` | No | One or more custom field values. |

Examples:

```sh
ozc task create --name "Investigate login timeout"
ozc task create \
  --name "Prepare release" \
  --tasklist 123456789 \
  --description "Prepare version 1.2" \
  --field cf_priority=High cf_team=Platform
```

### `ozc task update <reference>`

Update one or more supported task fields.

```sh
ozc task update <reference> [options]
```

| Option | Meaning |
| --- | --- |
| `--name <name>` | Set the task name. |
| `--status <id>` | Set the task status by status ID. |
| `--description <text>` | Set the task description. |

Example:

```sh
ozc task update ABC-T12 --status 123456789 --name "Updated title"
```

### `ozc task move <reference>`

Move a task to another task list in the configured project.

```sh
ozc task move <reference> --tasklist <id>
```

## Time Tracking

OZC uses a durable local timer and pending-log queue. Stopping a timer or adding
time manually creates a local pending record; run `ozc time sync` to submit
pending records to Zoho.

Durations accept the forms supported by the duration parser, including minute
counts and hour/minute values such as `90m`, `1h`, and `1h30m`.

### `ozc time start <task>`

Start the single local timer for a task.

```sh
ozc time start <task> [options]
```

| Option | Meaning |
| --- | --- |
| `--notes <text>` | Notes saved with the eventual time log. |
| `--billing <value>` | Override billing with `Billable` or `Non Billable`. |

If billing is not supplied, OZC uses the configured default and then falls back
to `Non Billable`. Starting a timer while another timer is active fails.

Example:

```sh
ozc time start ABC-T12 --notes "Implementing API validation" --billing Billable
```

### `ozc time status`

Show the active timer, or `{ "active": false }` if no timer is running.

```sh
ozc time status
```

### `ozc time stop`

Stop the active timer and put the resulting time log in the pending queue.

```sh
ozc time stop [--duration <duration>]
```

Use `--duration` to override the elapsed time before the pending record is
created.

```sh
ozc time stop --duration 1h30m
```

### `ozc time cancel`

Discard the active timer without creating a pending time log.

```sh
ozc time cancel
```

### `ozc time add <task>`

Add a manual time entry to the local pending queue.

```sh
ozc time add <task> --duration <duration> [options]
```

| Option | Required | Meaning |
| --- | --- | --- |
| `--duration <duration>` | Yes | Time spent. |
| `--date <yyyy-mm-dd>` | No | Work date; defaults to the current UTC date. |
| `--notes <text>` | No | Time-log notes; defaults to an empty string. |
| `--billing <value>` | No | Override with `Billable` or `Non Billable`. |

Example:

```sh
ozc time add ABC-T12 \
  --duration 45m \
  --date 2026-08-18 \
  --notes "Code review" \
  --billing Billable
```

### `ozc time list`

List all locally stored pending-log records, including their queue states.

```sh
ozc time list
```

Queue states are:

| State | Meaning |
| --- | --- |
| `pending` | Waiting for submission or safe to retry. |
| `submitting` | Submission has started. |
| `submitted` | Zoho accepted the log; the record includes its Zoho ID. |
| `uncertain` | The request outcome was ambiguous and is not retried automatically. |
| `needs_review` | The record requires manual review before it can be submitted. |

### `ozc time sync`

Submit every `pending` record to Zoho. Successfully submitted records remain in
the local history with the `submitted` state. Failed records return to `pending`,
except ambiguous failures, which become `uncertain`. Retrying an existing
`pending` record is safe after correcting a validation or endpoint error; a
successful retry clears its previous error message.

```sh
ozc time sync
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
ozc config set brokerUrl https://ozc-auth.example.com
ozc auth login
ozc init --portal PORTAL_ID --project PROJECT_ID --billing Billable --timezone Asia/Kolkata

ozc task list
ozc time start ABC-T12 --notes "Implementation"
ozc time status
ozc time stop
ozc time sync
```
