# Reports

Reports in this directory are evidence, not design inputs.

The checked-in reports are sanitized gate summaries and deterministic test
results. Live captures and Bridge manifests may contain project identifiers,
component metadata, and geometry; `.gitignore` keeps those local artifacts out
of a public release. Run `npm run release:audit` before sharing a fixture.

Public release reports:

- `capture-reliability-gate.json` — Basic Capture / Gate A evidence.
- `semantic-diff-gate.json` — Basic Semantic Diff evidence.
- `intent-lock-gate.json` — Intent Lock evidence.
- `hardware-assertions-gate.json` — Hardware Assertions evidence.
- `public-release-sanitization.json` — publishable-tree scan.
- `public-release-naming.json` — repository/package availability check.
- `public-alpha-release-gate.json` — local Release Candidate acceptance.
