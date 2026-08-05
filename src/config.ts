/**
 * Configuration — Steel Browser connection settings + CLI flag parsing.
 *
 * Steel Browser is self-hosted (Apache-2.0, free). The REST API runs on :3000
 * and the CDP websocket proxy on :9223. Self-hosted Steel has NO auth by
 * default — you are the gatekeeper (add a reverse proxy if exposed).
 *
 * Config sources (in priority order):
 *   1. CLI flags (--steel, --proxy, --user-agent, --headless/--no-headless)
 *   2. Environment variables (STEEL_API_URL, STEEL_API_KEY, STEEL_PROXY_URL)
 *   3. Defaults (no Steel → local Chrome backend)
 */

export interface AppConfig {
  /** Force the Steel backend even if local Chrome would work. */
  useSteel: boolean;
  /** Steel API base URL (e.g. http://localhost:3000). */
  steelApiUrl: string;
  /** Optional Steel API key (self-hosted usually has none). */
  steelApiKey: string | null;
  /** Per-session proxy URL (http://user:pass@host:port or socks5://host:port). */
  proxyUrl: string | null;
  /** Custom User-Agent string for the browser session. */
  userAgent: string | null;
  /** Run browser in headless mode. */
  headless: boolean;
  /** Steel session timeout in ms (0 = no timeout). */
  timeout: number;
}

/** Load config from environment variables (called once at startup). */
export function loadEnvConfig(): Partial<AppConfig> {
  const config: Partial<AppConfig> = {};

  if (process.env.STEEL_API_URL) {
    config.steelApiUrl = process.env.STEEL_API_URL.replace(/\/$/, ''); // strip trailing slash
    config.useSteel = true;
  }
  if (process.env.STEEL_API_KEY) {
    config.steelApiKey = process.env.STEEL_API_KEY;
  }
  if (process.env.STEEL_PROXY_URL) {
    config.proxyUrl = process.env.STEEL_PROXY_URL;
  }
  if (process.env.STEEL_HEADLESS !== undefined) {
    config.headless = process.env.STEEL_HEADLESS !== 'false';
  }

  return config;
}

/** Default config — local Chrome, no Steel, headless. */
export function defaultConfig(): AppConfig {
  return {
    useSteel: false,
    steelApiUrl: 'http://localhost:3000',
    steelApiKey: null,
    proxyUrl: null,
    userAgent: null,
    headless: true,
    timeout: 0,
  };
}

/**
 * Merge config sources: defaults < env vars < CLI flags.
 * CLI flags take the highest priority.
 */
export function resolveConfig(cliOverrides: Partial<AppConfig>): AppConfig {
  const env = loadEnvConfig();
  return { ...defaultConfig(), ...env, ...cliOverrides };
}

/**
 * Parse global CLI flags and return them + the remaining command args.
 * Extracts: --steel, --proxy <url>, --user-agent <str>, --headless, --no-headless
 * Leaves the rest (command + command args + --session) in remainingArgs.
 */
export interface ParsedFlags {
  flags: Partial<AppConfig>;
  remainingArgs: string[];
}

export function parseFlags(rawArgs: string[]): ParsedFlags {
  const flags: Partial<AppConfig> = {};
  const remainingArgs: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (arg === '--steel') {
      flags.useSteel = true;
    } else if (arg === '--proxy' && i + 1 < rawArgs.length) {
      flags.proxyUrl = rawArgs[++i];
    } else if (arg === '--user-agent' && i + 1 < rawArgs.length) {
      flags.userAgent = rawArgs[++i];
    } else if (arg === '--headless') {
      flags.headless = true;
    } else if (arg === '--no-headless') {
      flags.headless = false;
    } else {
      remainingArgs.push(arg);
    }
  }

  return { flags, remainingArgs };
}
