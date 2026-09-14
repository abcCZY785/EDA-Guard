# Offline demo

This synthetic capture needs no EasyEDA, Bridge, network, or private design.
It represents a user request to move C12 closer to U1 and an AI response that
also changed three unrelated design facts.

From the repository root:

```powershell
npm install
node src/cli.mjs diff examples/demo/before.snapshot.json examples/demo/after.snapshot.json
node src/cli.mjs intent compile examples/demo/intent.json examples/demo/before.snapshot.json --out examples/demo/compiled-intent.json
node src/cli.mjs intent verify examples/demo/compiled-intent.json examples/demo/before.snapshot.json examples/demo/after.snapshot.json
node src/cli.mjs test examples/demo/hardware-contract.yaml examples/demo/after.snapshot.json
```

The Diff command reports the observed changes. Intent Lock and the hardware
contract intentionally return a failing verdict because the example includes
the forbidden footprint, BOM, and connectivity mutations. The non-zero exit
code is the useful CI signal; it is not a broken example.
