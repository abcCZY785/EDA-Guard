# Roadmap

The roadmap is capability-led rather than date-led. Gate B remains independent
from the Basic Diff path.

## v0.1 Alpha (current)

- EasyEDA-first Basic Snapshot Profile with identity and canonical repeatability checks.
- Basic Semantic Diff for observable component, property, BOM, connectivity, geometry, rules, layers, and routing summaries.
- Baseline-bound Intent Lock with default-deny decisions.
- Deterministic Hardware Assertions with PASS/FAIL/UNVERIFIABLE results.
- Offline fixtures, CI, and public-release sanitization.

## Next gates

- Gate B: copper/pour, arcs, differential pairs and length groups, stackup, impedance, and detailed DRC evidence where the upstream API is stable.
- More precise geometry and routing semantics without weakening the fail-closed contract.
- Additional rule-pack examples for power, clocks, and connector safety.

## Later

- A second design-file adapter (for example KiCad) behind the same canonical contracts.
- Optional MCP/agent integrations that preserve the read-only capture and human approval boundary.
- Versioned CI contracts and machine-readable review artifacts for project repositories.

The roadmap does not promise that EDA-Guard replaces an EDA tool, ERC/DRC,
signal-integrity analysis, or manufacturing review.
