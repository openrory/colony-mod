# Implementation Plan: Shared Summaries Are Never Mistaken for Sessions

**Branch**: `004-ignore-own-summaries` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

## Summary

`parsePeer` (src/peers.ts) accepts any JSON record with a `sessionId` and a timestamp. A shared summary (spec 002) has both, so when the sessions folder and the shared folder are the same, each summary becomes a phantom peer with an unknown state, and an ended marker lingers as one for up to six hours. Fix: `parsePeer` returns null for any record that has the shape of a shared summary. No option, default or file format changes.

## Technical Context

**Language/Version**: TypeScript in the existing mod. **Dependencies**: none new. **Storage**: none. **Testing**: `claude plugin test`. **Scope**: one function and its tests.

## Constitution Check

The constitution is still the unfilled template; no gates. Self-imposed: pure code with tests, nothing beyond the spec. PASS.

## Design

- A shared summary is recognised by shape: `Array.isArray(record.agents)`. Claude Code's session files have no `agents` list, and they do have a string `version` field, so `version` alone cannot be the test. An ended marker (`agents: []`) is covered by the same test.
- The check lives in `parsePeer`, the one place that turns a file into a peer, so every caller (the 5 s fallback poll and the 1 s shared poll) is protected.
- `mergeSessions` already shows a session once when it is both shared and a peer (spec 002 T016); no change there.

## Project Structure

```text
specs/004-ignore-own-summaries/   spec.md, plan.md, tasks.md, checklists/
src/peers.ts                      parsePeer ignores summary-shaped records
tests/peers.test.ts               new cases
```

No data model, contracts or quickstart changes are needed; the behaviour is covered by the acceptance scenarios and automated tests. Live check: one line in the manual walk (README sharing section stays accurate).
