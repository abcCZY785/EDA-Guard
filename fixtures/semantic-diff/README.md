# Offline Semantic Diff Fixtures

The D0–D15 vectors are deliberately synthetic and deterministic. Their canonical before/after snapshots are constructed by `tests/semantic-diff.test.mjs` from one shared base, then refreshed with the same facet/snapshot hashing convention. This keeps the vectors readable and avoids duplicating a large board JSON fifteen times.

`index.json` is the reviewable acceptance manifest; the test file is the executable source of truth.
