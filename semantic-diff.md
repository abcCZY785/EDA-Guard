# Basic Semantic Diff MVP

Semantic Diff is the first consumer of the Gate-A canonical snapshot. It does not call EasyEDA and it does not decide whether a change is allowed or electrically acceptable.

```text
Capture          What IS the design?
   ↓
Semantic Diff    What CHANGED?
   ↓
Intent Lock     Was it ALLOWED?
   ↓
Assertions      Is it ACCEPTABLE?
```

## Contract

`src/diff.mjs` consumes either a canonical snapshot or a capture envelope containing one. Capture envelopes must attest `validity.valid_snapshot === true`; a missing/invalid identity or snapshot hash fails closed. Before and after must have the same `(project_uuid, document_uuid, document_type)`.

The machine-readable result is versioned as `edaguard.semantic-diff.v1` and follows [schemas/semantic-diff.schema.json](../schemas/semantic-diff.schema.json). The renderer is deliberately separate from the data model:

```powershell
node src/cli.mjs diff before.json after.json
node src/cli.mjs diff before.json after.json --json
```

## Supported semantic events

- Components: identity-safe added/removed matching, movement, and rotation.
- Properties: designator, value, footprint, manufacturer, supplier, supplier/LCSC ID, library identity, and selected canonical attributes. Informational fields are labelled `INFO`; runtime fields are ignored.
- BOM: item add/remove, value, footprint, manufacturer, supplier, and LCSC ID changes.
- Connectivity: preferred snapshot source, net/member add/remove, and pin reassignment aggregation. Raw member events remain available in `raw_connectivity_events`.
- Board/rules: bounds, outline, basic layer metadata, and observed rule leaves. No quality judgement is made.
- Routing: per-net segment/via/length/layer summaries. When a reliable net summary is unavailable, a conservative `routing_changed: true` fallback is emitted.

Component matching uses `unique_id`, then `primitive_id`. A designator is never a successful identity match; unresolved duplicates produce `code: "AMBIGUOUS_MATCH"`.

The JSON result also exposes `connectivity.before/after` with the selected `source`, its `source_detail`, and normalized nets using `net_name` plus `members[]`. The legacy `name` alias is retained for compatibility with the first MVP draft.

Every event receives a deterministic `event_id` (`EVT-001`, …) and an
`INFO`, `NOTICE`, `WARNING`, or `CRITICAL` severity. A zero result is rendered
as `NO DESIGN CHANGES`; facet-level hash comparison is still included so a
canonicalization/runtime leak can be investigated instead of being hidden.

## Offline acceptance matrix

`tests/semantic-diff.test.mjs` covers D0–D15: zero diff, movement/rotation, properties, BOM, connectivity, pin reassignment, board/rules, routing, simultaneous changes, ambiguous identity, invalid envelopes, runtime metadata isolation, deterministic ordering, schema shape, and human rendering.

## Live EasyEDA acceptance

The offline vectors are complemented by a real before/after run against an independent populated PCB test project. Both captures used `pcb-basic-v1`, returned `valid_snapshot=true`, passed two-repeat core reads, and carried the same project/document/type identity. The live mutation set was:

| Change | Observed Diff |
|---|---|
| Move C12 by 300 mil | `component_moved` (`NOTICE`) |
| Clear C17 `supplierId=C1525` | component `property_changed` plus BOM `bom_supplier_id_changed` (`WARNING`) |
| Remove C12.2 from `$1N12` | `connectivity_member_removed` (`CRITICAL`) |
| Change U1 `otherProperty.Footprint` | `property_changed` (`WARNING`) |

The renderer reports five events because the supplier ID is intentionally visible in both the component-property and BOM views. The current EasyEDA API exposes a Footprint getter but no documented association setter. The demo therefore edits the documented `otherProperty.Footprint` field through `pcb_PrimitiveComponent.modify`; the association UUID is retained and the limitation is recorded rather than inferred away. No EasyEDA save was called. The demo state was reversed through documented API mutations and read back to the exact original canonical hash; the restoration comparison renders `NO DESIGN CHANGES`.

The sanitized gate record is [reports/semantic-diff-gate.json](../reports/semantic-diff-gate.json). Raw live captures and manifests remain local and are ignored by default.

Intent authorization is a consumer of this contract. See
[Intent Lock MVP](intent-lock.md): it consumes this versioned diff, never calls
EasyEDA, and decides only whether each observed event was authorized. Hardware
Assertions, AI judgement, quality scoring, automatic repair, advanced copper
semantics, differential-pair/RF analysis, placement correctness, and autorouting
remain outside Semantic Diff.
