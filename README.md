# MicroTragedy Hyperliquid Worker

Railway worker that checks the Hyperliquid spot wallet every 15 minutes, market-sells spot SOL into USDC when the configured threshold is met, then moves available USDC from the spot wallet to the perp wallet.

This worker is intentionally narrow:

- Assumes SOL is already inside the Hyperliquid spot wallet.
- Does not touch a Solana wallet.
- Does not open any MSTR short.
- Defaults to `DRY_RUN=true`.
- Never sells more than `MAX_SWAP_USD_PER_RUN`.
- Never transfers the full USDC spot balance; it leaves `USDC_TO_PERP_BUFFER`.
- Has a single-run lock so overlapping intervals cannot double-send.
- Retries Hyperliquid API failures with backoff.

## Files

- `src/config.ts` loads and validates env vars.
- `src/hyperliquid.ts` contains Hyperliquid balance, price, spot sell, and spot-to-perp transfer helpers.
- `src/index.ts` runs the interval worker.

## Environment Variables

```env
HYPERLIQUID_PRIVATE_KEY=
HYPERLIQUID_ADDRESS=
HYPERLIQUID_API_URL=https://api.hyperliquid.xyz
HYPERLIQUID_CHAIN=Mainnet
SIGNATURE_CHAIN_ID=0xa4b1
MIN_SWAP_USD=25
MAX_SWAP_USD_PER_RUN=250
USDC_TO_PERP_BUFFER=1
INTERVAL_MINUTES=15
DRY_RUN=true
```

`HYPERLIQUID_PRIVATE_KEY` must be the Hyperliquid signer/API wallet private key. Do not commit it.

## Railway Setup

1. Create a new Railway service from this repo.
2. Set the env vars above in Railway.
3. Keep `DRY_RUN=true` for the first deploy.
4. Set the start command to:

```bash
pnpm start
```

5. Watch logs. You should see the spot SOL balance, SOL price, planned sell amount, and planned USDC spot-to-perp transfer.
6. After logs look correct, set:

```env
DRY_RUN=false
```

7. Redeploy.

## Local Development

```bash
pnpm install
pnpm dev
```

## Behavior

On each run:

1. Reads the Hyperliquid spot balances.
2. Finds the SOL-like spot token (`SOL` or `USOL`) and its USDC market.
3. Skips if estimated SOL value is below `MIN_SWAP_USD`.
4. Sells at most `MAX_SWAP_USD_PER_RUN` worth of spot SOL using an IOC order.
5. Checks spot USDC after the sell.
6. Transfers `spot USDC - USDC_TO_PERP_BUFFER` to the perp wallet.

If `DRY_RUN=true`, the worker only logs what it would do and never signs or sends.
