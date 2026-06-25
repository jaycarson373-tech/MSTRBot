# MicroTragedy Fee Claim Worker

Railway worker for MicroTragedy SOL fee claiming and treasury sweeps.

## What It Does

Every `INTERVAL_MINUTES`:

1. Calls `claimFeesIfNeeded()`.
2. Checks the fee wallet SOL balance.
3. Leaves `0.01 SOL` in the fee wallet for gas.
4. Sweeps only if `balance - 0.01 >= MIN_SWEEP_SOL`.
5. Sends the available sweep amount to `TREASURY_SOL_WALLET`.

This worker never trades and does not connect to Hyperliquid.

The fee claim implementation is currently a placeholder:

```ts
async function claimFeesIfNeeded(): Promise<string | null> {
  // TODO: plug in real fee-claim instruction/API here
  // Return tx signature if claim happened, otherwise null
}
```

## Env Vars

Set these in Railway:

```bash
RPC_URL=
FEE_CLAIM_PRIVATE_KEY_BASE58=
TREASURY_SOL_WALLET=
MIN_SWEEP_SOL=0.15
INTERVAL_MINUTES=15
DRY_RUN=true
```

`FEE_CLAIM_PRIVATE_KEY_BASE58` can be a base58-encoded 64-byte Solana secret key or a 32-byte seed.

## Local Development

```bash
pnpm install
pnpm dev
```

Build locally:

```bash
pnpm build
pnpm start
```

## Railway Setup

1. Create a new Railway service from this repo/folder.
2. Set all env vars in Railway.
3. Use this start command:

```bash
pnpm start
```

4. Deploy with:

```bash
DRY_RUN=true
```

5. Watch logs for:
   - fee wallet public key
   - current SOL balance
   - available sweep amount
   - below-threshold skips
   - dry-run sweep previews

6. Only after logs look correct, set:

```bash
DRY_RUN=false
```

## Safety Notes

- Private keys must only live in env vars.
- The worker has an in-memory in-flight guard so overlapping runs are skipped.
- The worker attempts claim once and sweep once per run.
- RPC calls retry with exponential backoff.
- The sweep never sends 100% of wallet balance; it always leaves `0.01 SOL`.
- Keep `DRY_RUN=true` until the real claim integration is plugged in and verified.
