# Phase 2: Quality Contracts

Quality Contracts turn product intent into reviewed, versioned YAML stored in `.maru/contracts/`. Draft creation and validation are deterministic and local; no source code, requirements, or contract content is sent to a cloud service.

## Create a draft

```bash
maru contract create --from requirements.md
maru contract create --from requirements.md --id subscription-management --title "Subscription Management"
```

The generator extracts requirements and supplies review prompts for invariants, edge cases, security, and data integrity. Generated contracts always remain `draft` until a person explicitly approves them. Treat generated statements as a starting point, not as approved product intent.

## Inspect and validate

```bash
maru contract list
maru contract show subscription-management
maru contract validate
maru contract validate .maru/contracts/subscription-management.yml
```

Validation reports exact field paths. Approved contracts require an approver, approval timestamp, and a SHA-256 version hash. Blocking requirement references must resolve to declared requirement or invariant IDs.

## Review changes and approve

```bash
maru contract diff subscription-management proposed-subscription.yml
maru contract approve subscription-management --by product-owner
```

Changes to product behavior, requirements, invariants, ownership, evidence policy, and quality checks are semantic. Title, lifecycle state, and approval metadata are mechanical. Approval writes the current file and a hash-addressed snapshot under:

```text
.maru/contracts/.history/<contract-id>/<version-hash>.yml
```

An approved version cannot be approved again. Amend its content and return it through review before approving another version.

## Supported YAML and safety rules

The parser supports mappings, sequences, nested objects, quoted and plain scalars, comments, and folded or literal text blocks required by the documented contract schema. It rejects duplicate keys, anchors, aliases, tags, merge keys, tabs, unsafe IDs, paths outside the project root, and documents larger than 1 MiB.

See `examples/contracts/subscription-management.yml` for a complete contract.
