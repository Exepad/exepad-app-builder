/**
 * Structured logger for the runtime worker.
 *
 * Provides consistent JSON-structured logging with request trace IDs,
 * log-level gating, and contextual metadata. In development mode all
 * levels are emitted; in production only 'warn' and 'error' are shown.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  level: LogLevel;
  msg: string;
  requestId?: string;
  appId?: string;
  [key: string]: unknown;
}

let globalMinLevel: LogLevel = 'warn'; // default for production

export function setLogLevel(level: LogLevel): void {
  globalMinLevel = level;
}

export function initLogLevel(environment: string): void {
  globalMinLevel = environment === 'development' ? 'debug' : 'warn';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[globalMinLevel];
}

function emit(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return;

  const output = {
    ts: new Date().toISOString(),
    ...entry,
  };

  switch (entry.level) {
    case 'error':
      console.error(JSON.stringify(output));
      break;
    case 'warn':
      console.warn(JSON.stringify(output));
      break;
    default:
      console.log(JSON.stringify(output));
  }
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Create a logger bound to a specific request context.
 */
export function createLogger(context?: { requestId?: string; appId?: string }): Logger {
  const base = {
    requestId: context?.requestId,
    appId: context?.appId,
  };

  return {
    debug(msg, meta) {
      emit({ level: 'debug', msg, ...base, ...meta });
    },
    info(msg, meta) {
      emit({ level: 'info', msg, ...base, ...meta });
    },
    warn(msg, meta) {
      emit({ level: 'warn', msg, ...base, ...meta });
    },
    error(msg, meta) {
      emit({ level: 'error', msg, ...base, ...meta });
    },
  };
}

/**
 * Module-level logger without request context (for startup/config).
 */
export const log = createLogger();
