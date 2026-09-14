# Security policy

EDA-Guard is an Alpha-stage local verification tool. The project has no hosted
service and does not need credentials for its offline workflows.

## Reporting a vulnerability

Please do not publish a private design, credential, token, or exploit details in
a public issue. Until a dedicated security contact is published, open a minimal
issue describing the affected version and reproduction without sensitive data,
or contact the maintainers privately through the repository's configured
security channel.

## Trust boundary

- Live Capture reads EasyEDA through the official Bridge and is intended to be read-only.
- Diff, Intent Lock, and Hardware Assertions operate on local JSON/YAML and do not execute design files or call the network.
- A PASS means only that the declared, supported state was observed; it is not ERC, DRC, SI/PI, EMI, or manufacturing sign-off.
- Treat snapshots and reports as potentially sensitive: they can contain project identity, component metadata, nets, and geometry.

Before sharing an artifact, run the public-release sanitization audit and inspect
the result. Never commit `Authorization` headers, API keys, cookies, private PCB
files, or live runtime dumps.
