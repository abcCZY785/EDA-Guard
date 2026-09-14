# Contributing to EDA-Guard

Thanks for helping make AI-assisted PCB work more observable and reviewable.

## Development setup

```powershell
npm install
npm test
npm run release:example
npm run release:audit
npm pack --dry-run
```

EDA-Guard is an ES module and requires Node.js 20 or newer. The offline test
suite does not need EasyEDA, a Bridge, network access, or a private PCB.

## Design boundaries

- `src/canonical.mjs` is the only place that defines design-state normalization and hashes.
- `src/diff.mjs`, `src/intent.mjs`, and `src/assertions.mjs` consume canonical envelopes and remain offline.
- EasyEDA access is isolated in the capture/Bridge adapter. Do not call EasyEDA from Diff, Intent Lock, or Assertions.
- A selector must resolve to a stable canonical identity; ambiguous or missing evidence must not become an accidental PASS.

## Pull requests

Every behavior change should include a small deterministic fixture and a test that would fail before the change. For a new assertion type, include compile, PASS, FAIL, and UNVERIFIABLE coverage where applicable. Keep a deliberate FAIL→PASS replay in the fixture matrix; never weaken a test merely to make it green.

Do not commit live captures, private project identifiers, Bridge sessions,
credentials, or raw EasyEDA dumps. Run `npm test`, `npm run release:audit`, and
`npm pack --dry-run` before opening a pull request.
