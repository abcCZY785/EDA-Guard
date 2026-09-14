# Intent Lock MVP

Intent Lock is EDA-Guard's change-authorization layer. It answers one question:

> Did the actual Semantic Diff stay within the changes authorized before the AI edit?

It does not judge electrical quality, placement quality, DRC, routing quality, or
whether a result is a good engineering choice. Those are Hardware Assertions.

```text
valid baseline + user declaration
             │ compile (before the edit)
             ▼
      compiled intent
             │
             ▼
after capture ──> Semantic Diff ──> Intent verification
                                      │
                                      ├─ PASS: every event authorized
                                      └─ FAIL: denied/unexpected/missing required
```

## Contract

The source declaration is `edaguard.intent.v1` and the verification result is
`edaguard.intent-result.v1` ([schemas/intent.schema.json](../schemas/intent.schema.json),
[schemas/intent-result.schema.json](../schemas/intent-result.schema.json)). Compilation
requires a valid Gate-A capture and freezes:

- `snapshot_hash`
- `project_uuid`, `document_uuid`, and `document_type`
- the capture profile

Selectors such as `C12` are resolved against the baseline by canonical identity
(`unique_id`, then `primitive_id`; designator is only an input selector). Unknown
or ambiguous selectors fail compilation. The compiled identity, not a later
designator, is used during verification.

Every policy is default-deny. `forbidden` has priority over `required`/`allowed`,
and an event matching no rule is `UNEXPECTED`. `required` is checked separately:
an authorized change that never happened still fails the intent. Overlapping
allow/required and forbidden scopes make the policy `INVALID_POLICY` before any
verification runs.

Rules are deterministic selectors over the existing Semantic Diff v1 event
types and may constrain `category`, `event`, `entity`/`component`, `field`, and
`net`. Intent Lock never calls EasyEDA and never saves, undoes, repairs, or
rolls back a design.

## CLI

Compile before making any edit:

```powershell
node src/cli.mjs intent compile intent.json before.json --out compiled-intent.json
```

Verify either two captures (the CLI computes the Semantic Diff) or an existing
Semantic Diff:

```powershell
node src/cli.mjs intent verify compiled-intent.json before.json after.json
node src/cli.mjs intent verify compiled-intent.json diff.json --json
```

The result retains each original `event_id`, matched rule IDs, decision, and
reason for auditability. Human output uses `REQUIRED CHANGES`, `ALLOWED CHANGES`,
`UNEXPECTED CHANGES`, and `SUMMARY`; `--json` emits the versioned result.

## Acceptance evidence

`tests/intent.test.mjs` covers I0–I18: no-op, required/allowed/forbidden rules,
default deny, pin reassignment, policy conflicts, baseline and identity
fail-closed behavior, selector failures, canonical identity after a designator
change, deterministic multi-change verification, and byte-stable replay.

The real EasyEDA demo uses the existing independent PCB test project. The FAIL
path combines a C12 move with U1 footprint, C17 supplier ID, and C12.2
connectivity changes; only the C12 move is authorized. The PASS path captures a
real move-only C12 edit. Both paths use `pcb-basic-v1`, repeated reads, explicit
window binding, and no EasyEDA save. The design is then reversed and read back
to the original clean canonical hash.

## Boundary after v0.1

Intent Lock is now frozen as a verification gate. Hardware Assertions MVP is
the downstream read-only quality layer and has passed its own gate. The next
phase is Public Alpha / GitHub Release Preparation. Gate B (advanced copper,
differential-pair/length semantics, physical stackup, and detailed DRC) remains
independent and does not block this authorization path.
