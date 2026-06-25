import { AppConfig, loadConfig } from "./config.js";
import {
  claimFeesIfNeeded,
  createConnection,
  getFeeWalletBalance,
  loadFeeClaimKeypair,
  sweepSolToTreasury
} from "./solana.js";

type RunState = {
  inFlight: boolean;
  startedAt: string | null;
};

const runState: RunState = {
  inFlight: false,
  startedAt: null
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

function formatSol(value: number): number {
  return Number(value.toFixed(9));
}

export async function runOnce(config: AppConfig): Promise<void> {
  if (runState.inFlight) {
    log("warn", "run skipped because previous run is still in flight", {
      previousStartedAt: runState.startedAt
    });
    return;
  }

  runState.inFlight = true;
  runState.startedAt = new Date().toISOString();

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const actions = {
    claimAttempted: false,
    sweepAttempted: false
  };

  try {
    const connection = createConnection(config.rpcUrl);
    const feeWallet = loadFeeClaimKeypair(config.feeClaimPrivateKeyBase58);

    log("info", "run started", {
      runId,
      dryRun: config.dryRun,
      feeWallet: feeWallet.publicKey.toBase58(),
      treasurySolWallet: config.treasurySolWallet.toBase58(),
      minSweepSol: config.minSweepSol,
      gasBufferSol: config.gasBufferSol
    });

    actions.claimAttempted = true;
    const claimSignature = await claimFeesIfNeeded();
    log("info", "fee claim step completed", {
      runId,
      claimed: Boolean(claimSignature),
      claimSignature
    });

    const balanceSol = await getFeeWalletBalance(connection, feeWallet.publicKey);
    const availableToSweepSol = Math.max(balanceSol - config.gasBufferSol, 0);

    log("info", "fee wallet balance checked", {
      runId,
      balanceSol: formatSol(balanceSol),
      gasBufferSol: config.gasBufferSol,
      availableToSweepSol: formatSol(availableToSweepSol),
      minSweepSol: config.minSweepSol
    });

    if (availableToSweepSol >= config.minSweepSol) {
      actions.sweepAttempted = true;
      const sweepSignature = await sweepSolToTreasury({
        connection,
        feeWallet,
        treasurySolWallet: config.treasurySolWallet,
        amountSol: availableToSweepSol,
        dryRun: config.dryRun
      });

      log("info", "sweep step completed", {
        runId,
        dryRun: config.dryRun,
        swept: Boolean(sweepSignature),
        sweepSignature
      });
    } else {
      log("info", "below threshold; sweep skipped", {
        runId,
        availableToSweepSol: formatSol(availableToSweepSol),
        minSweepSol: config.minSweepSol
      });
    }

    log("info", "run completed", { runId, actions });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", "run failed", { runId, error: message, actions });
  } finally {
    runState.inFlight = false;
    runState.startedAt = null;
  }
}

export function mainLoop(config = loadConfig()): NodeJS.Timeout {
  const intervalMs = config.intervalMinutes * 60_000;

  log("info", "worker starting", {
    intervalMinutes: config.intervalMinutes,
    dryRun: config.dryRun,
    minSweepSol: config.minSweepSol,
    gasBufferSol: config.gasBufferSol
  });

  void runOnce(config);

  const interval = setInterval(() => {
    void runOnce(config);
  }, intervalMs);

  const shutdown = (signal: NodeJS.Signals): void => {
    log("info", "shutdown signal received", { signal });
    clearInterval(interval);
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return interval;
}

mainLoop();
