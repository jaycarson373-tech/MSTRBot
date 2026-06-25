import "dotenv/config";
import { PublicKey } from "@solana/web3.js";

export type AppConfig = {
  rpcUrl: string;
  feeClaimPrivateKeyBase58: string;
  treasurySolWallet: PublicKey;
  minSweepSol: number;
  intervalMinutes: number;
  dryRun: boolean;
  gasBufferSol: number;
};

const DEFAULT_MIN_SWEEP_SOL = 0.15;
const DEFAULT_INTERVAL_MINUTES = 15;
const GAS_BUFFER_SOL = 0.01;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
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

function parseBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y"].includes(raw)) return true;
  if (["0", "false", "no", "n"].includes(raw)) return false;

  throw new Error(`${name} must be true or false`);
}

export function loadConfig(): AppConfig {
  const treasurySolWalletRaw = requireEnv("TREASURY_SOL_WALLET");

  return {
    rpcUrl: requireEnv("RPC_URL"),
    feeClaimPrivateKeyBase58: requireEnv("FEE_CLAIM_PRIVATE_KEY_BASE58"),
    treasurySolWallet: new PublicKey(treasurySolWalletRaw),
    minSweepSol: parsePositiveNumber("MIN_SWEEP_SOL", DEFAULT_MIN_SWEEP_SOL),
    intervalMinutes: parsePositiveNumber("INTERVAL_MINUTES", DEFAULT_INTERVAL_MINUTES),
    dryRun: parseBoolean("DRY_RUN", true),
    gasBufferSol: GAS_BUFFER_SOL
  };
}
