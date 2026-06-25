import { AppConfig, loadConfig } from "./config.js";
import {
  createHyperliquidContext,
  getSolUsdPrice,
  getSpotBalances,
  getSpotUsdcBalance,
  marketSellSolToUsdc,
  transferUsdcSpotToPerp
} from "./hyperliquid.js";

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

function formatNumber(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
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
    checkedSpotBalances: false,
    sellAttempted: false,
    transferAttempted: false
  };

  try {
    const context = createHyperliquidContext(config);

    log("info", "run started", {
      runId,
      dryRun: config.dryRun,
      hyperliquidAddress: config.hyperliquidAddress,
      hyperliquidChain: config.hyperliquidChain,
      minSwapUsd: config.minSwapUsd,
      maxSwapUsdPerRun: config.maxSwapUsdPerRun,
      usdcToPerpBuffer: config.usdcToPerpBuffer
    });

    actions.checkedSpotBalances = true;
    const balances = await getSpotBalances(context);
    const solAvailable = balances.sol?.available ?? 0;
    const solPrice = await getSolUsdPrice(context);
    const estimatedSolUsd = solAvailable * solPrice;

    log("info", "Hyperliquid spot SOL balance checked", {
      runId,
      solCoin: balances.sol?.coin ?? null,
      solAvailable: formatNumber(solAvailable, 9),
      solPriceUsd: formatNumber(solPrice, 6),
      estimatedSolUsd: formatNumber(estimatedSolUsd, 6),
      minSwapUsd: config.minSwapUsd
    });

    if (estimatedSolUsd < config.minSwapUsd) {
      log("info", "below threshold; spot SOL sell skipped", {
        runId,
        estimatedSolUsd: formatNumber(estimatedSolUsd, 6),
        minSwapUsd: config.minSwapUsd
      });
      log("info", "run completed", { runId, actions });
      return;
    }

    const targetSellUsd = Math.min(estimatedSolUsd, config.maxSwapUsdPerRun);
    const amountSolToSell = Math.min(solAvailable, targetSellUsd / solPrice);

    log("info", "spot SOL sell planned", {
      runId,
      targetSellUsd: formatNumber(targetSellUsd, 6),
      amountSolToSell: formatNumber(amountSolToSell, 9),
      cappedByMaxPerRun: estimatedSolUsd > config.maxSwapUsdPerRun
    });

    actions.sellAttempted = true;
    const sellResult = await marketSellSolToUsdc(context, amountSolToSell, config.dryRun);

    if (config.dryRun) {
      const currentUsdc = await getSpotUsdcBalance(context);
      const estimatedUsdcAfterSell = currentUsdc + targetSellUsd;
      const estimatedTransferableUsdc = Math.max(
        estimatedUsdcAfterSell - config.usdcToPerpBuffer,
        0
      );

      log("info", "dry run: estimated spot-to-perp USDC transfer after sell", {
        runId,
        currentSpotUsdc: formatNumber(currentUsdc, 6),
        estimatedUsdcAfterSell: formatNumber(estimatedUsdcAfterSell, 6),
        usdcToPerpBuffer: config.usdcToPerpBuffer,
        estimatedTransferableUsdc: formatNumber(estimatedTransferableUsdc, 6)
      });
      log("info", "run completed", { runId, actions });
      return;
    }

    log("info", "sell step completed", {
      runId,
      filled: Boolean(sellResult),
      filledSize: sellResult?.filledSize,
      averagePrice: sellResult?.averagePrice,
      orderId: sellResult?.orderId
    });

    const spotUsdc = await getSpotUsdcBalance(context);
    const transferableUsdc = Math.max(spotUsdc - config.usdcToPerpBuffer, 0);

    log("info", "spot USDC balance checked", {
      runId,
      spotUsdc: formatNumber(spotUsdc, 6),
      usdcToPerpBuffer: config.usdcToPerpBuffer,
      transferableUsdc: formatNumber(transferableUsdc, 6)
    });

    if (transferableUsdc <= 0) {
      log("info", "no USDC available above buffer; transfer skipped", {
        runId,
        spotUsdc: formatNumber(spotUsdc, 6),
        usdcToPerpBuffer: config.usdcToPerpBuffer
      });
      log("info", "run completed", { runId, actions });
      return;
    }

    actions.transferAttempted = true;
    await transferUsdcSpotToPerp(context, transferableUsdc, config.dryRun);

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
    hyperliquidAddress: config.hyperliquidAddress,
    hyperliquidChain: config.hyperliquidChain,
    minSwapUsd: config.minSwapUsd,
    maxSwapUsdPerRun: config.maxSwapUsdPerRun,
    usdcToPerpBuffer: config.usdcToPerpBuffer
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
