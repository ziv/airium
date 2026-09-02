/**
 * Runtime configuration resolved from Vite environment variables.
 * Kept free of Cesium imports so it can be unit-tested in plain Node.
 */
export interface AppConfig {
  /** Cesium Ion access token, or null when running token-free. */
  ionToken: string | null;
}

/** Environment shape we depend on; matches `import.meta.env` keys we read. */
export interface RawEnv {
  VITE_CESIUM_ION_TOKEN?: string;
}

/**
 * Normalises a raw token value. Empty and whitespace-only values are treated
 * as "not configured" so a blank `.env` line does not break the fallback.
 */
export function resolveIonToken(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function loadConfig(env: RawEnv): AppConfig {
  return {
    ionToken: resolveIonToken(env.VITE_CESIUM_ION_TOKEN),
  };
}
