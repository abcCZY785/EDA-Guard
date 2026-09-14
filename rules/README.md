# Basic Integrity rule pack

`basic-integrity.yaml` is the first Hardware Assertions rule pack. It is a
small, reviewable example covering component existence, footprint/BOM
identity, net existence, center-to-center distance, and board-edge distance.
Selectors are compiled against the supplied capture; change the designators
and net names when applying it to another board. The MVP accepts this simple
YAML subset and JSON with the same fields.

The rule engine is read-only. It never connects to EasyEDA and never repairs,
saves, or rolls back a design.
