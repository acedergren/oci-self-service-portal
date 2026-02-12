# OpenCode Project Notes

This directory contains OpenCode-oriented helpers.

- Commands live in `.opencode/commands/`.
- Repo agent conventions live in `AGENTS.md` and `CLAUDE.md`.

Useful commands:

- `health-check`: run repo-wide quality gates and print a summary table
- `tdd`: follow strict Red->Green->Refactor->Gates->Commit loop
- `test-related`: run the most likely matching Vitest test for a given file
- `circular-check`: run `madge --circular` for a workspace
