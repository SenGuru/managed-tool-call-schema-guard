# Agent-in-the-loop black-box test

This test connects a real agent CLI to a local MCP mutation server. The server
runs every proposed downstream call through Schema Guard and invokes a strict
fake transfer tool only after an accepted decision. It logs hashes, shapes,
decisions, repairs, and execution state, never raw argument values.

Build first, then run both authenticated agent CLIs at medium effort:

```sh
npm run build
npm run agent-test:live
```

The runner starts isolated local MCP servers, configures Codex's test-tool
approval mode explicitly, gives each agent a separate JSONL log, and runs the
machine verifier after both sessions exit. It does not persist either agent
session. Running it can consume the user's existing Codex and Claude allowance.

To verify previously produced logs without calling either agent again:

```sh
npm run agent-test:verify -- work/codex-agent-live-....jsonl work/claude-agent-live-....jsonl
```

Expected result per agent: twelve calls observed, five safely executed after
normalization/validation/repair, five rejected without fake-tool execution, and
two schema revisions conservatively classified. The sensitive sentinel must not
occur in either audit log.
