# OpenCode Project Notes

This directory contains OpenCode-oriented helpers.

- Commands live in `.opencode/commands/`.
- Repo agent conventions live in `AGENTS.md` and `CLAUDE.md`.

Useful commands:

- `health-check`: run repo-wide quality gates and print a summary table
- `tdd`: follow strict Red->Green->Refactor->Gates->Commit loop
- `quality-commit`: run staged-file gates then commit
- `doc-sync`: audit (or fix) documentation drift
- `oracle-migration`: generate a new migration file shell
- `phase-kickoff`: scaffold a new phase branch + roadmap + test shell
- `security-fuzz`: run CATS DAST against local API
- `test-related`: run the most likely matching Vitest test for a given file
- `circular-check`: run `madge --circular` for a workspace
