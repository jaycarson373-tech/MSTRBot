import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import bs58 from "bs58";

type RetryOptions = {
  retries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
};

function log(level: "info" | "warn" | "error", message: string, meta?: Record<string, unknown>): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {})
  };

  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  label: string,
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 5_000;

  let attempt = 0;
  let delayMs = initialDelayMs;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      const message = error instanceof Error ? error.message : String(error);

      if (attempt > retries) {
        log("error", `${label} failed after retries`, { attempts: attempt, error: message });
        throw error;
      }

      log("warn", `${label} failed, retrying`, { attempt, retries, delayMs, error: message });
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, maxDelayMs);
    }
  }
}

export function createConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000
  });
}

export function loadFeeClaimKeypair(privateKeyBase58: string): Keypair {
  const decoded = bs58.decode(privateKeyBase58);

  if (decoded.length === 64) {
    return Keypair.fromSecretKey(decoded);
  }

  if (decoded.length === 32) {
    return Keypair.fromSeed(decoded);
  }

  throw new Error(
    `FEE_CLAIM_PRIVATE_KEY_BASE58 decoded to ${decoded.length} bytes; expected 32-byte seed or 64-byte secret key`
  );
}

export async function getFeeWalletBalance(
  connection: Connection,
  feeWallet: PublicKey
): Promise<number> {
  const lamports = await withRetry("get fee wallet balance", () =>
    connection.getBalance(feeWallet, "confirmed")
  );

  return lamports / LAMPORTS_PER_SOL;
}

export async function claimFeesIfNeeded(): Promise<string | null> {
  // TODO: plug in real fee-claim instruction/API here.
  // Return tx signature if claim happened, otherwise null.
  log("info", "fee claim placeholder skipped");
  return null;
}

export async function sweepSolToTreasury(params: {
  connection: Connection;
  feeWallet: Keypair;
  treasurySolWallet: PublicKey;
  amountSol: number;
  dryRun: boolean;
}): Promise<string | null> {
  const { connection, feeWallet, treasurySolWallet, amountSol, dryRun } = params;
  const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  if (lamports <= 0) {
    log("info", "sweep skipped because computed lamports were zero", { amountSol, lamports });
    return null;
  }

  if (dryRun) {
    log("info", "dry run: would sweep SOL to treasury", {
      from: feeWallet.publicKey.toBase58(),
      to: treasurySolWallet.toBase58(),
      amountSol,
      lamports
    });
    return null;
  }

  return withRetry("sweep SOL to treasury", async () => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({
      feePayer: feeWallet.publicKey,
      blockhash,
      lastValidBlockHeight
    }).add(
      SystemProgram.transfer({
        fromPubkey: feeWallet.publicKey,
        toPubkey: treasurySolWallet,
        lamports
      })
    );

    const signature = await sendAndConfirmTransaction(connection, transaction, [feeWallet], {
      commitment: "confirmed"
    });

    log("info", "swept SOL to treasury", {
      signature,
      from: feeWallet.publicKey.toBase58(),
      to: treasurySolWallet.toBase58(),
      amountSol,
      lamports
    });

    return signature;
  });
}
