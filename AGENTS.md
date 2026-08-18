# Repository Instructions

## CLI Documentation

`COMMANDS.md` is the canonical user-facing reference for OZC commands. Whenever
changing `packages/cli/src/index.ts` or another file that affects CLI or TUI
behavior, update `COMMANDS.md` in the same change if any command, argument,
option, default, output format, exit code, or key binding changes.

Do not document planned commands as currently available. Clearly label planned
behavior when it is useful to mention it.
