import { AsyncLocalStorage } from 'async_hooks';
import { Request, Response, NextFunction } from 'express';

export enum LogSeverity {
  DEFAULT = 'DEFAULT',
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  NOTICE = 'NOTICE',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  CRITICAL = 'CRITICAL',
  ALERT = 'ALERT',
  EMERGENCY = 'EMERGENCY',
}

interface LogContext {
  trace?: string;
  spanId?: string;
  requestId?: string;
  userAgent?: string;
  method?: string;
  path?: string;
  [key: string]: string | undefined;
}

interface StructuredLogEntry {
  severity: LogSeverity;
  message: string;
  timestamp: string;
  'logging.googleapis.com/trace'?: string;
  'logging.googleapis.com/spanId'?: string;
  [key: string]: unknown;
}

class StructuredLogger {
  private asyncLocalStorage = new AsyncLocalStorage<LogContext>();
  private projectId: string | undefined;

  constructor() {
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
  }

  runWithContext<T>(context: LogContext, fn: () => T): T {
    return this.asyncLocalStorage.run(context, fn);
  }

  extractTraceContext(req: Request): LogContext {
    const context: LogContext = {};

    const traceHeader = req.header('X-Cloud-Trace-Context');
    if (traceHeader && this.projectId) {
      const [trace, spanId] = traceHeader.split('/');
      context.trace = `projects/${this.projectId}/traces/${trace}`;
      if (spanId) {
        context.spanId = spanId.split(';')[0];
      }
    }

    context.requestId = req.header('X-Request-Id');
    context.userAgent = req.header('User-Agent');
    context.method = req.method;
    context.path = req.path;

    return context;
  }

  middleware() {
    return (req: Request, _res: Response, next: NextFunction) => {
      const context = this.extractTraceContext(req);
      this.runWithContext(context, () => {
        next();
      });
    };
  }

  private log(severity: LogSeverity, message: string, metadata?: Record<string, unknown>) {
    const context = this.asyncLocalStorage.getStore() || {};

    const entry: StructuredLogEntry = {
      severity,
      message,
      timestamp: new Date().toISOString(),
      ...metadata,
    };

    if (context.trace) {
      entry['logging.googleapis.com/trace'] = context.trace;
    }
    if (context.spanId) {
      entry['logging.googleapis.com/spanId'] = context.spanId;
    }

    Object.keys(context).forEach((key) => {
      if (key !== 'trace' && key !== 'spanId') {
        entry[`context.${key}`] = context[key];
      }
    });

    console.log(JSON.stringify(entry));
  }

  debug(message: string, metadata?: Record<string, unknown>) {
    this.log(LogSeverity.DEBUG, message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>) {
    this.log(LogSeverity.INFO, message, metadata);
  }

  notice(message: string, metadata?: Record<string, unknown>) {
    this.log(LogSeverity.NOTICE, message, metadata);
  }

  warning(message: string, metadata?: Record<string, unknown>) {
    this.log(LogSeverity.WARNING, message, metadata);
  }

  error(message: string, error?: Error, metadata?: Record<string, unknown>) {
    const errorMetadata = {
      ...metadata,
      error: error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : undefined,
    };
    this.log(LogSeverity.ERROR, message, errorMetadata);
  }

  critical(message: string, metadata?: Record<string, unknown>) {
    this.log(LogSeverity.CRITICAL, message, metadata);
  }

  addContext(context: LogContext) {
    const currentContext = this.asyncLocalStorage.getStore();
    if (currentContext) {
      Object.assign(currentContext, context);
    }
  }
}

export const logger = new StructuredLogger();
export type { LogContext, StructuredLogEntry };
