import "dotenv/config";

export type HexString = `0x${string}`;
export type HexAddress = `0x${string}`;
export type HyperliquidChain = "Mainnet" | "Testnet";

export type AppConfig = {
  hyperliquidPrivateKey: HexString;
  hyperliquidAddress: HexAddress;
  hyperliquidApiUrl: string;
  hyperliquidChain: HyperliquidChain;
  signatureChainId: HexString;
  minSwapUsd: number;
  maxSwapUsdPerRun: number;
  usdcToPerpBuffer: number;
  dryRun: boolean;
  intervalMinutes: number;
};

const DEFAULT_HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz";
const DEFAULT_HYPERLIQUID_CHAIN: HyperliquidChain = "Mainnet";
const DEFAULT_SIGNATURE_CHAIN_ID: HexString = "0xa4b1";
const DEFAULT_MIN_SWAP_USD = 25;
const DEFAULT_MAX_SWAP_USD_PER_RUN = 250;
const DEFAULT_USDC_TO_PERP_BUFFER = 1;
const DEFAULT_INTERVAL_MINUTES = 15;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function parsePositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return value;
}

function parseNonNegativeNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be zero or a positive number`);
  }

  return value;
}

function parseBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y"].includes(raw)) return true;
  if (["0", "false", "no", "n"].includes(raw)) return false;

  throw new Error(`${name} must be true or false`);
}

function normalizeHexPrivateKey(raw: string): HexString {
  const value = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("HYPERLIQUID_PRIVATE_KEY must be a 32-byte hex private key");
  }

  return value as HexString;
}

function normalizeHexAddress(name: string, raw: string): HexAddress {
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error(`${name} must be a 20-byte 0x-prefixed address`);
  }

  return raw as HexAddress;
}

function normalizeHexString(name: string, raw: string): HexString {
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(`${name} must be a 0x-prefixed hex string`);
  }

  return raw as HexString;
}

function parseChain(raw: string): HyperliquidChain {
  if (raw === "Mainnet" || raw === "Testnet") return raw;
  throw new Error("HYPERLIQUID_CHAIN must be Mainnet or Testnet");
}

export function loadConfig(): AppConfig {
  const minSwapUsd = parsePositiveNumber("MIN_SWAP_USD", DEFAULT_MIN_SWAP_USD);
  const maxSwapUsdPerRun = parsePositiveNumber(
    "MAX_SWAP_USD_PER_RUN",
    DEFAULT_MAX_SWAP_USD_PER_RUN
  );

  if (maxSwapUsdPerRun < minSwapUsd) {
    throw new Error("MAX_SWAP_USD_PER_RUN must be greater than or equal to MIN_SWAP_USD");
  }

  return {
    hyperliquidPrivateKey: normalizeHexPrivateKey(requireEnv("HYPERLIQUID_PRIVATE_KEY")),
    hyperliquidAddress: normalizeHexAddress(
      "HYPERLIQUID_ADDRESS",
      requireEnv("HYPERLIQUID_ADDRESS")
    ),
    hyperliquidApiUrl: optionalEnv("HYPERLIQUID_API_URL", DEFAULT_HYPERLIQUID_API_URL),
    hyperliquidChain: parseChain(optionalEnv("HYPERLIQUID_CHAIN", DEFAULT_HYPERLIQUID_CHAIN)),
    signatureChainId: normalizeHexString(
      "SIGNATURE_CHAIN_ID",
      optionalEnv("SIGNATURE_CHAIN_ID", DEFAULT_SIGNATURE_CHAIN_ID)
    ),
    minSwapUsd,
    maxSwapUsdPerRun,
    usdcToPerpBuffer: parseNonNegativeNumber(
      "USDC_TO_PERP_BUFFER",
      DEFAULT_USDC_TO_PERP_BUFFER
    ),
    dryRun: parseBoolean("DRY_RUN", true),
    intervalMinutes: parsePositiveNumber("INTERVAL_MINUTES", DEFAULT_INTERVAL_MINUTES)
  };
}
