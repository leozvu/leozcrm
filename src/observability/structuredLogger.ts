import { randomBytes, randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogSink = (line: string) => void;

const SECRET_KEY = /(authorization|cookie|token|secret|password|credential|api.?key|database.?url|bearer)/i;

function safeValue(value: unknown, key = '', depth = 0): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (depth > 4) return '[TRUNCATED]';
  if (typeof value === 'string') return value.length <= 512 ? value : `${value.slice(0, 509)}...`;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => safeValue(item, key, depth + 1));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [
      name, safeValue(item, name, depth + 1),
    ]));
  }
  return String(value);
}

export class StructuredLogger {
  constructor(private readonly sink: LogSink = (line) => process.stdout.write(`${line}\n`)) {}

  log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    const sanitized = safeValue(fields) as Record<string, unknown>;
    this.sink(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...sanitized,
    }));
  }
}

function routeGroup(pathname: string): string {
  const segment = pathname.split('/').filter(Boolean)[0];
  return segment && ['health', 'ready', 'startup', 'v1', 'cockpit', 'internal'].includes(segment)
    ? `/${segment}`
    : '/other';
}

function traceContext(header: string | undefined): { traceId: string; traceparent: string } {
  const match = header?.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i);
  const traceId = match && !/^0+$/.test(match[1]) ? match[1].toLowerCase() : randomBytes(16).toString('hex');
  const flags = match ? match[3].toLowerCase() : '01';
  return { traceId, traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-${flags}` };
}

export function requestObservability(logger: StructuredLogger): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const requestIdHeader = req.header('x-request-id');
    const requestId = requestIdHeader && /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/.test(requestIdHeader)
      ? requestIdHeader
      : randomUUID();
    const trace = traceContext(req.header('traceparent'));
    const started = process.hrtime.bigint();
    res.setHeader('x-request-id', requestId);
    res.setHeader('traceparent', trace.traceparent);
    res.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      logger.log(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'http_request_completed', {
        request_id: requestId,
        trace_id: trace.traceId,
        method: req.method,
        route_group: routeGroup(req.path),
        status_code: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100,
      });
    });
    next();
  };
}
