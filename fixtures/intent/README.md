# Intent Lock fixtures

`move-c12.json` is a source declaration, not a compiled intent. Compile it
against a trusted, valid `pcb-basic-v1` capture before any edit:

```powershell
node src/cli.mjs intent compile fixtures/intent/move-c12.json before.json --out compiled-intent.json
node src/cli.mjs intent verify compiled-intent.json before.json after.json
```

The declaration is default-deny: only the C12 move is authorized. Connectivity,
BOM, component add/remove, and footprint changes are explicitly forbidden.
