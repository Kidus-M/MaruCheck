# The agent gate

`maru verify --diff` only protects a change if somebody runs it. When an AI agent writes the code,
the person best placed to run it is the agent — and the agent is exactly who benefits from not
running it. The agent gate closes that hole: it registers verification as a Claude Code **Stop
hook**, so the agent cannot end a turn while the release gate is blocked.

```bash
maru init          # once per repository
maru hook install
```

That writes one entry into `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "command": "npx --no-install maru hook run",
            "statusMessage": "Verifying the change against approved Quality Contracts",
            "timeout": 600,
            "type": "command"
          }
        ]
      }
    ]
  }
}
```

## What the agent sees

When the agent tries to finish, Claude Code runs `maru hook run`. The command reads the hook payload
on stdin, verifies the working tree, and — if the gate is blocked — refuses the stop and hands the
verdict back as the reason:

```
MaruCheck gate: BLOCKED.
Risk critical (91). 2 requirement(s) failed, 0 inconclusive.

- 2 blocking requirements failed.

Blocking findings:
- usage-quota#QUOTA-001: QUOTA-001 verification failed
    expected:  Free plan users may perform at most 10 generations per calendar month.
    actual:    Received: 1000
    reproduce: maru verify --diff
- usage-quota#QUOTA-INV-001: QUOTA-INV-001 verification failed
    expected:  The plan tier used for a quota decision must be read from the stored
               subscription record and never from client-supplied request data.
    actual:    Received: 1000
    reproduce: maru verify --diff

Full evidence: .maru/artifacts/runs/2026-08-28T13-56-37-461Z/report.json
Change the code so the approved contract holds. Do not edit or re-approve the
contract to make this pass; if the contract itself is wrong, stop and tell the
human to run maru drift propose.
```

The last paragraph is deliberate. The cheapest way to make a failing contract pass is to edit the
contract, so the gate says out loud that this is not an available move. Approval remains a human
action: `maru contract approve` records an owner and a `version_hash`, and a contract whose meaning
should change goes through `maru drift propose` and a second human approval.

## Guarantees the gate makes

**It never wedges a session.** Only a *blocked gate* stops a turn. If the project is not initialized,
if the tree is not a Git repository, if verification itself throws — the hook exits 0 and the turn
ends normally, with a one-line note about why the gate did not run.

**It cannot loop forever.** A Stop hook that always blocks would trap the agent. The gate stops
blocking after `AGENT_GATE_MAX_CONSECUTIVE_BLOCKS` (3) consecutive blocks in the same session and
hands control back to the human, and it honours `stop_hook_active` from the hook payload. The count
lives in `.maru/generated/agent-gate.json` and resets as soon as the gate passes.

**It does not edit your settings.** `maru hook install` merges one entry and preserves every other
key and every hook already declared. It refuses to touch a `.claude/settings.json` it cannot parse,
and running it twice is a no-op. `maru hook uninstall` removes only the MaruCheck entry.

## Commands

| Command               | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `maru hook install`   | Register the Stop hook in `.claude/settings.json` (idempotent)           |
| `maru hook uninstall` | Remove the MaruCheck Stop hook and leave every other hook in place       |
| `maru hook run`       | The hook entrypoint: reads the payload on stdin, exits 2 to block a turn |

`maru hook run` is meant for Claude Code, but it is an ordinary command. To see what the agent would
receive:

```bash
echo '{"hook_event_name":"Stop","session_id":"local"}' | maru hook run; echo "exit=$?"
```

Exit code `2` means blocked; the reason is on stderr and the machine-readable decision on stdout.

## Cost

The gate runs a full `maru verify --diff` at the end of a turn, so it costs whatever the selected
tests cost — the same work you would do by hand, at the moment it is cheapest to act on. Verification
selects only the tests linked to the changed requirements, not the whole suite. The hook is given a
600-second timeout.

## Related

- [`examples/quota-app`](../../examples/quota-app/README.md) — the change this gate is designed to catch
- [Phase 7 evidence and findings](phase-7-evidence-and-findings.md) — where the verdict comes from
- [Phase 8 semantic drift](phase-8-semantic-drift.md) — the amendment path when the contract is the thing that is wrong
