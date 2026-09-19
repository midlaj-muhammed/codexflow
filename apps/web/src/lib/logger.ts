type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogValue = boolean | number | string | null | undefined;
export type LogContext = Record<string, LogValue>;

const sensitiveKeyPattern = /authorization|cookie|key|password|secret|token/i;

export type Logger = {
  [Level in LogLevel]: (message: string, context?: LogContext) => void;
};

export function redactLogContext(context: LogContext = {}): LogContext {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      sensitiveKeyPattern.test(key) ? '[REDACTED]' : value,
    ]),
  );
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, context) => writeLog('debug', scope, message, context),
    info: (message, context) => writeLog('info', scope, message, context),
    warn: (message, context) => writeLog('warn', scope, message, context),
    error: (message, context) => writeLog('error', scope, message, context),
  };
}

function writeLog(level: LogLevel, scope: string, message: string, context?: LogContext): void {
  const record = {
    level,
    scope,
    message,
    context: redactLogContext(context),
    timestamp: new Date().toISOString(),
  };

  console[level](JSON.stringify(record));
}
