import { HttpTransport } from "@nktkas/hyperliquid";
import {
  order,
  usdClassTransfer,
  type OrderSuccessResponse,
  type UsdClassTransferSuccessResponse
} from "@nktkas/hyperliquid/api/exchange";
import {
  spotClearinghouseState,
  spotMetaAndAssetCtxs,
  type SpotClearinghouseStateResponse,
  type SpotMetaAndAssetCtxsResponse
} from "@nktkas/hyperliquid/api/info";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { privateKeyToAccount } from "viem/accounts";
import { type AppConfig, type HexAddress } from "./config.js";

const SOL_SPOT_SYMBOLS = new Set(["SOL", "USOL"]);
const USDC_SYMBOL = "USDC";
const MARKET_SELL_PRICE_MULTIPLIER = 0.95;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 750;
const USDC_DECIMALS = 6;

type HyperliquidWallet = ReturnType<typeof privateKeyToAccount>;

export type HyperliquidContext = {
  transport: HttpTransport;
  wallet: HyperliquidWallet;
  userAddress: HexAddress;
  signatureChainId: AppConfig["signatureChainId"];
  hyperliquidChain: AppConfig["hyperliquidChain"];
};

export type SpotBalance = {
  coin: string;
  token?: number;
  total: number;
  hold: number;
  available: number;
  rawTotal: string;
  rawHold: string;
};

export type SpotBalances = {
  sol: SpotBalance | null;
  usdc: SpotBalance | null;
  all: SpotBalance[];
};

type SolSpotMarket = {
  assetId: number;
  pairName: string;
  price: number;
  szDecimals: number;
  rawMarketName: string;
};

export type SellResult = {
  response: OrderSuccessResponse;
  filledSize: number;
  averagePrice: number;
  orderId: number;
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

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);

      if (attempt === MAX_RETRIES) break;

      const backoffMs = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
      log("warn", "Hyperliquid request failed; retrying", {
        label,
        attempt,
        maxRetries: MAX_RETRIES,
        backoffMs,
        error: message
      });
      await sleep(backoffMs);
    }
  }

  throw lastError;
}

function parseNumber(value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function floorToDecimals(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.floor(value * multiplier) / multiplier;
}

function formatUsdAmount(value: number): string {
  const floored = floorToDecimals(value, USDC_DECIMALS);
  return floored.toFixed(USDC_DECIMALS).replace(/\.?0+$/, "");
}

function toSpotBalance(
  balance: SpotClearinghouseStateResponse["balances"][number]
): SpotBalance {
  const rawTotal = balance.total;
  const rawHold = balance.hold;
  const total = parseNumber(rawTotal);
  const spotHold = "spotHold" in balance ? balance.spotHold : undefined;
  const hold = Math.max(parseNumber(rawHold), parseNumber(spotHold));
  const available = Math.max(total - hold, 0);

  return {
    coin: balance.coin,
    token: "token" in balance ? balance.token : undefined,
    total,
    hold,
    available,
    rawTotal,
    rawHold
  };
}

function getPrimaryOrderStatus(
  response: OrderSuccessResponse
): OrderSuccessResponse["response"]["data"]["statuses"][number] {
  const status = response.response.data.statuses[0];
  if (!status) {
    throw new Error("Hyperliquid order returned no status");
  }

  if (typeof status !== "string" && "error" in status) {
    throw new Error(`Hyperliquid order failed: ${status.error}`);
  }

  return status;
}

function extractSellResult(response: OrderSuccessResponse): SellResult {
  const status = getPrimaryOrderStatus(response);

  if (typeof status === "string") {
    throw new Error(`Hyperliquid order did not confirm a fill: ${status}`);
  }

  if ("resting" in status) {
    throw new Error(`IOC sell order unexpectedly rested: ${status.resting.oid}`);
  }

  const filledSize = parseNumber(status.filled.totalSz);
  const averagePrice = parseNumber(status.filled.avgPx);

  return {
    response,
    filledSize,
    averagePrice,
    orderId: status.filled.oid
  };
}

export function createHyperliquidContext(config: AppConfig): HyperliquidContext {
  const wallet = privateKeyToAccount(config.hyperliquidPrivateKey);

  if (wallet.address.toLowerCase() !== config.hyperliquidAddress.toLowerCase()) {
    throw new Error("HYPERLIQUID_ADDRESS does not match HYPERLIQUID_PRIVATE_KEY signer");
  }

  return {
    transport: new HttpTransport({
      apiUrl: config.hyperliquidApiUrl,
      isTestnet: config.hyperliquidChain === "Testnet"
    }),
    wallet,
    userAddress: config.hyperliquidAddress,
    signatureChainId: config.signatureChainId,
    hyperliquidChain: config.hyperliquidChain
  };
}

export async function getSpotBalances(context: HyperliquidContext): Promise<SpotBalances> {
  const state = await withRetry("spotClearinghouseState", () =>
    spotClearinghouseState(
      { transport: context.transport },
      {
        user: context.userAddress
      }
    )
  );

  const all = state.balances.map(toSpotBalance);
  const sol = all.find((balance) => SOL_SPOT_SYMBOLS.has(balance.coin.toUpperCase())) ?? null;
  const usdc = all.find((balance) => balance.coin.toUpperCase() === USDC_SYMBOL) ?? null;

  return { sol, usdc, all };
}

async function getSolSpotMarket(context: HyperliquidContext): Promise<SolSpotMarket> {
  const [meta, assetCtxs]: SpotMetaAndAssetCtxsResponse = await withRetry(
    "spotMetaAndAssetCtxs",
    () => spotMetaAndAssetCtxs({ transport: context.transport })
  );

  const tokensByIndex = new Map(meta.tokens.map((token) => [token.index, token]));
  const market = meta.universe
    .map((universe, arrayIndex) => {
      const [baseTokenIndex, quoteTokenIndex] = universe.tokens;
      return {
        universe,
        arrayIndex,
        baseToken: tokensByIndex.get(baseTokenIndex),
        quoteToken: tokensByIndex.get(quoteTokenIndex)
      };
    })
    .find(({ baseToken, quoteToken }) => {
      return (
        Boolean(baseToken && SOL_SPOT_SYMBOLS.has(baseToken.name.toUpperCase())) &&
        quoteToken?.name.toUpperCase() === USDC_SYMBOL
      );
    });

  if (!market?.baseToken || !market.quoteToken) {
    throw new Error("Could not find Hyperliquid SOL/USDC spot market");
  }

  const assetContext = assetCtxs[market.arrayIndex];
  const rawPrice = assetContext?.midPx ?? assetContext?.markPx;
  const price = parseNumber(rawPrice);

  if (price <= 0) {
    throw new Error("Could not read a valid SOL spot price from Hyperliquid");
  }

  return {
    assetId: 10_000 + market.universe.index,
    pairName: `${market.baseToken.name}/${market.quoteToken.name}`,
    price,
    szDecimals: market.baseToken.szDecimals,
    rawMarketName: market.universe.name
  };
}

export async function getSolUsdPrice(context: HyperliquidContext): Promise<number> {
  const market = await getSolSpotMarket(context);
  return market.price;
}

export async function marketSellSolToUsdc(
  context: HyperliquidContext,
  amountSol: number,
  dryRun: boolean
): Promise<SellResult | null> {
  const market = await getSolSpotMarket(context);
  const size = formatSize(amountSol, market.szDecimals);
  const limitPrice = formatPrice(market.price * MARKET_SELL_PRICE_MULTIPLIER, market.szDecimals, "spot");

  if (dryRun) {
    log("info", "dry run: would market sell spot SOL into USDC", {
      pairName: market.pairName,
      rawMarketName: market.rawMarketName,
      assetId: market.assetId,
      amountSol: size,
      estimatedPrice: market.price,
      iocLimitPrice: limitPrice
    });
    return null;
  }

  const response = await withRetry("marketSellSolToUsdc", () =>
    order(
      {
        transport: context.transport,
        wallet: context.wallet,
        signatureChainId: context.signatureChainId
      },
      {
        orders: [
          {
            a: market.assetId,
            b: false,
            p: limitPrice,
            s: size,
            r: false,
            t: { limit: { tif: "Ioc" } }
          }
        ],
        grouping: "na"
      }
    )
  );

  const result = extractSellResult(response);
  log("info", "spot SOL sell filled", {
    pairName: market.pairName,
    amountSol: result.filledSize,
    averagePrice: result.averagePrice,
    orderId: result.orderId
  });

  return result;
}

export async function getSpotUsdcBalance(context: HyperliquidContext): Promise<number> {
  const balances = await getSpotBalances(context);
  return balances.usdc?.available ?? 0;
}

export async function transferUsdcSpotToPerp(
  context: HyperliquidContext,
  amountUsd: number,
  dryRun: boolean
): Promise<UsdClassTransferSuccessResponse | null> {
  const amount = formatUsdAmount(amountUsd);

  if (Number(amount) <= 0) {
    throw new Error("USDC transfer amount must be greater than zero");
  }

  if (dryRun) {
    log("info", "dry run: would transfer USDC from spot to perp", {
      amount,
      toPerp: true
    });
    return null;
  }

  const response = await withRetry("transferUsdcSpotToPerp", () =>
    usdClassTransfer(
      {
        transport: context.transport,
        wallet: context.wallet,
        signatureChainId: context.signatureChainId
      },
      {
        amount,
        toPerp: true
      }
    )
  );

  log("info", "USDC transferred from spot to perp", {
    amount,
    toPerp: true,
    status: response.status
  });

  return response;
}
