# Contributing

We accept PRs. This repo is the hackathon build; the actively-maintained mainline lives across the InvoiceMate + DeFa Tech monorepo, but functional fixes and additions here are welcome and get merged upstream.

## Ground rules

1. **One concern per PR.** Bug fixes and features go in separate PRs. Cosmetic-only changes don't get merged with functional ones.
2. **Tests come with code.** Every fix ships with a regression test — Foundry (contracts) or `node --test` (server).
3. **No secrets in commits.** `.env` and any `*.pem`, `*.key`, or `AGENT_PRIVATE_KEY=…` value must not land in the diff.
4. **Explain the "why".** Commit messages get read; format them like: `<scope>: <what changed>. <why it needed changing>.`

## Local dev

Full walkthrough in [`docs/LOCAL_E2E.md`](docs/LOCAL_E2E.md). Short version:

```bash
anvil --chain-id 31337                                   # terminal 1
cd contracts && forge script script/Deploy.s.sol         # terminal 2, note the 3 addresses
cd server && cp .env.example .env && npm install && npm run dev            # terminal 3
cd client && cp .env.example .env && npm install && npm run dev            # terminal 4
cd client-legacy && cp .env.example .env && npm install && npm run dev     # terminal 5
```

## Running tests

- **Contracts**: `cd contracts && forge test`
- **Server**: `cd server && npm run test:all` (38 integration tests — E2E, lifecycle, onchain)

CI runs both suites on every PR.

## Sign a PR

Every PR must:

- Pass CI (linting, tests, security scan).
- Have a clear title. `fix(client): swap Solana wallet-adapter for wagmi` is good; `fix bug` is not.
- Include a "Test plan" section in the PR description with concrete steps a reviewer can execute.

## Questions

Open a GitHub issue (not for security — see `SECURITY.md`). Or reach out to the team via the DeFa Discord (link in the main [invoicemate.net](https://invoicemate.net) site).
