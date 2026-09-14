# EDA-Guard

**Safety checks for AI-generated PCB designs.**

> Your AI changed the PCB. EDA-Guard tells you what it actually changed.

EDA-Guard turns an AI-assisted PCB edit into a reviewable chain:

```text
AI request
   │
   ▼
Read-only Capture ──► Canonical Snapshot ──► Semantic Diff
                                                │
                                                ▼
                         Intent Lock ──► Hardware Assertions ──► CI / human review
```

It is deliberately narrow: observe the design state, explain the delta, check
whether the delta was authorized, then evaluate only the hardware facts you
actually declared.

## 60-second offline demo

No EasyEDA, Bridge, network, or private design is needed:

```powershell
npm install

node src/cli.mjs diff examples/demo/before.snapshot.json examples/demo/after.snapshot.json
node src/cli.mjs intent compile examples/demo/intent.json examples/demo/before.snapshot.json --out examples/demo/compiled-intent.json
node src/cli.mjs intent verify examples/demo/compiled-intent.json examples/demo/before.snapshot.json examples/demo/after.snapshot.json
node src/cli.mjs test examples/demo/hardware-contract.yaml examples/demo/after.snapshot.json
```

The synthetic request is “move C12 closer to U1”. The observed result also
changes U1's footprint, removes C17's LCSC ID, and disconnects C12.2. Diff
explains all seven semantic events; Intent Lock and the hardware contract
return the expected failing verdict. A failing verdict exits with code `2`,
which is the useful CI signal here.

```text
Requested: Move C12 closer to U1
Observed:  C12 moved; U1 footprint changed; C17 LCSC ID removed; C12.2 disconnected
Intent:   FAIL (expected)
Hardware: FAIL (expected)
```

Run `npm run release:example` for a deterministic machine-readable replay.
The complete fixture is in [`examples/demo`](examples/demo/README.md).

## Why this boundary?

- **Diff is semantic.** Stable component identity and normalized units matter
  more than EasyEDA runtime primitive IDs or array order.
- **Intent is default-deny.** A policy is compiled against a baseline hash and
  canonical identity before it sees a proposed change.
- **Assertions are evidence checks.** `PASS`, `FAIL`, and `UNVERIFIABLE` are
  distinct. Missing capability is never guessed into a pass.
- **Runtime is not design.** Window IDs, Bridge sessions, timestamps, and
  process metadata stay in audit manifests and do not enter the design hash.

## Current Alpha status

The four basic layers have independent evidence-backed gates:

| Layer | Status | Scope |
| --- | --- | --- |
| Basic Capture / canonical repeatability | PASS | EasyEDA-first `pcb-basic-v1` snapshot |
| Basic Semantic Diff | PASS | Components, properties, BOM, connectivity, geometry, rules, layers, routing summary |
| Intent Lock MVP | PASS | Baseline-bound default-deny policy |
| Hardware Assertions MVP | PASS | Declared component, BOM, connectivity, geometry, and count facts |

The gate reports and replay evidence are checked into [`reports`](reports),
including the [Public Alpha Release Candidate gate](reports/public-alpha-release-gate.json).
The current offline suite contains 84 passing tests; run `npm test` to verify
the number on your checkout.

## EasyEDA workflow

Live capture is read-only and requires EasyEDA plus the official Bridge. Bind a
specific connected window; do not rely on an implicit “active” window:

```powershell
node src/cli.mjs doctor --window-id <window-id>
node src/cli.mjs capture --window-id <window-id> --profile pcb-basic-v1 --repeat 2 --out reports/my-capture.json --manifest-out reports/my-capture.manifest.json
node src/cli.mjs diff before.json after.json --json
```

Capture fails closed when project/document identity changes, a required facet is
not readable, or repeated critical reads disagree. Raw live captures can contain
private design data and are ignored by default; sanitize a fixture before sharing
it.

## CLI contract

```text
edaguard diff <before.json> <after.json> [--json]
edaguard intent compile <intent.json> <before.json> [--out file] [--json]
edaguard intent verify <compiled-intent.json> <before.json> <after.json> [--out file] [--json]
edaguard assert compile <rules.yaml|json> <snapshot.json> [--out file] [--json]
edaguard assert run <compiled-assertions.json> <snapshot.json> [--out file] [--json]
edaguard test <rules.yaml|json> <snapshot.json> [--out file] [--json]
edaguard doctor --window-id <id> [--bridge <url>] [--json]
```

Exit codes are stable for the Alpha CLI: `0` means the command completed with
a passing/valid result, `1` means usage, I/O, or runtime error, and `2` means a
valid evaluation produced a failing or invalid verification result.

## Repository map

```text
src/          canonicalization, capture adapter, Diff, Intent Lock, Assertions, CLI
schemas/      versioned JSON contracts
rules/        reviewable hardware rule packs
fixtures/     offline contract matrices
examples/     sanitized, runnable public examples
tests/        deterministic unit and release-audit tests
docs/         architecture and capability contracts
reports/      sanitized gate evidence; raw live artifacts stay local
```

Start with the [capture architecture](docs/capture-architecture.md), then read
the [semantic Diff contract](docs/semantic-diff.md), [Intent Lock contract](docs/intent-lock.md),
and [Hardware Assertions contract](docs/hardware-assertions.md).

## Limitations

This is a public Alpha, not a claim that a PCB is correct.

- EasyEDA is the first adapter. A live run needs the documented API/Bridge and
  an explicit window binding.
- The Basic Snapshot Profile is frozen after Gate A. Copper/pours, complete arc
  semantics, differential pairs and length groups, physical stackup/impedance,
  and detailed DRC remain the independent Gate B.
- EDA-Guard is not a replacement for ERC/DRC, signal/power integrity, EMI,
  thermal analysis, manufacturing checks, or human sign-off.
- Assertions prove only the supported, declared properties in the input
  snapshot. They do not infer missing electrical meaning.
- The package metadata intentionally leaves `repository`, `bugs`, and
  `homepage` unset until the final GitHub owner is confirmed. See the
  [naming audit](reports/public-release-naming.json).

## Development and release checks

```powershell
npm test
npm run release:example
npm run release:audit
npm pack --dry-run
```

The release audit scans publishable files for absolute local paths, credentials,
runtime UUIDs, and private project-file references. It records intentionally
excluded local evidence without putting that evidence in the package. GitHub
Actions runs the same checks in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md),
[ROADMAP.md](ROADMAP.md), and [CHANGELOG.md](CHANGELOG.md) before proposing a
new capture capability.

## License

EDA-Guard is released under the [Apache-2.0 license](LICENSE). There are no
runtime npm dependencies; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
