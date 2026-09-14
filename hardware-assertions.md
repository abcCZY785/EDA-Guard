# Hardware Assertions MVP

Hardware Assertions is the first offline design-quality layer after Capture,
Semantic Diff, and Intent Lock. It is intentionally a small, deterministic
“hardware pytest”: it reads only a `valid_snapshot=true` Capture envelope and
does not connect to EasyEDA, invoke MCP/Bridge, reparse raw facets, save, or
repair a design.

## Contract

```text
capture envelope (valid_snapshot=true)
              │
              ▼
   compile selectors + freeze identity
              │  compiled-assertions.json
              ▼
      evaluate canonical snapshot
              │
              ▼
 PASS / FAIL / UNVERIFIABLE per rule
```

The source contract is [`edaguard.assertions.v1`](../schemas/assertions.schema.json).
Every rule has an `id`, `type`, `description`, and `severity` (`INFO`,
`WARNING`, `ERROR`, or `CRITICAL`). Severity is evidence metadata; it does not
turn an unknown result into a pass. The result contract is
[`edaguard.assertion-result.v1`](../schemas/assertion-result.schema.json).

`PASS` means the canonical evidence proves the expectation. `FAIL` means the
canonical evidence proves the expectation is false (for example, an explicitly
missing component). `UNVERIFIABLE` means the required identity or capability
is absent, unsupported, ambiguous, or incomplete. With the default `strict:
true`, either FAIL or UNVERIFIABLE fails the suite. With `strict: false`, an
UNVERIFIABLE result is a warning, while a proven FAIL still blocks the suite.

Selectors are compiled against the target capture before evaluation. A missing
component is retained for existence rules so `component_exists` can fail and
`component_not_exists` can pass. An ambiguous selector is never guessed; it is
reported as `UNVERIFIABLE`. The compiled identity binds project UUID, document
UUID, and document type. A later capture may have a different design hash, but
must have the same design identity.

## MVP rule set

- `component_exists`, `component_not_exists`
- `property_present`, `property_equals`, `property_matches` (bounded native
  regular expression; no expression evaluation)
- `valid_lcsc_id`, `footprint_present`, `bom_field_present`
- `net_exists`, `net_contains`, `net_not_contains`, `pin_connected`,
  `pins_same_net`, `pins_different_net`
- `component_distance` (integer nanometres, component center/reference
  position)
- `component_near_board_edge` (integer nanometres, reliable canonical outline)
- `component_count` (exact/min/max)

Connectivity assertions use the snapshot’s preferred canonical source only. A
network name without pin-membership evidence can prove `net_exists`, but not a
pin membership assertion. Board-edge assertions require a usable canonical
outline. Copper, arcs, differential pairs, impedance, stackup, detailed DRC,
true pin-to-pin distance, and repair/rollback remain outside this MVP and are
never faked as supported.

## CLI

```powershell
node src/cli.mjs assert compile rules/basic-integrity.yaml snapshot.json --out compiled-assertions.json
node src/cli.mjs assert run compiled-assertions.json snapshot.json
node src/cli.mjs assert run compiled-assertions.json snapshot.json --json --out assertion-result.json
node src/cli.mjs test rules/basic-integrity.yaml snapshot.json
```

The CLI exits `0` only for a passing suite and `2` for a failed, unverifiable,
aborted, or invalid-policy run. Human output starts with
`EDA-GUARD HARDWARE ASSERTIONS`; an invalid capture is visibly reported as
`ASSERTION RUN ABORTED`.

The first reviewable rule pack is
[`rules/basic-integrity.yaml`](../rules/basic-integrity.yaml). Its designators
and net names are an example and must be compiled against the intended board.

## Evidence boundary

Offline H0–H22 covers empty suites, existence, properties, BOM, connectivity,
distance, edge geometry, invalid captures, unsupported types, ambiguity,
deterministic replay, and strict-mode handling. The live acceptance uses an
independent EasyEDA test board for a passing capture and a temporary failing
capture, then restores the original state and verifies the original canonical
hash. Assertions themselves perform no EasyEDA mutation.
