/**
 * Client telemetry — the pure pieces.
 *
 * These cover the properties that decide whether telemetry is safe to have
 * on the critical path at all: it must not throw on weird input, it must not
 * flood, and it must not leak.
 */

import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  truncate,
  describeError,
  errorSignature,
  buildErrorEvent,
  shouldReport,
  __resetTelemetryForTests,
} from '../../src/lib/telemetry';

beforeEach(() => {
  __resetTelemetryForTests();
});

describe('truncate', () => {
  test('leaves a short string untouched', () => {
    expect(truncate('abc', 10)).toBe('abc');
  });

  test('marks how much was dropped when it cuts', () => {
    const out = truncate('a'.repeat(20), 5);
    expect(out).toBe('aaaaa…[+15 chars]');
  });
});

describe('describeError', () => {
  test('extracts name, message and stack from an Error', () => {
    // Arrange
    const err = new TypeError('cannot read x of undefined');

    // Act
    const d = describeError(err);

    // Assert
    expect(d.name).toBe('TypeError');
    expect(d.message).toBe('cannot read x of undefined');
    expect(d.stack).toBeTypeOf('string');
  });

  test('handles a thrown string', () => {
    expect(describeError('boom')).toMatchObject({ name: 'Error', message: 'boom' });
  });

  test('handles a thrown object', () => {
    const d = describeError({ code: 42 });
    expect(d.message).toContain('42');
  });

  test('does not throw on a circular object', () => {
    // Arrange — JSON.stringify would throw here.
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    // Act + Assert
    expect(() => describeError(circular)).not.toThrow();
  });

  test('caps a huge message', () => {
    const d = describeError(new Error('x'.repeat(5000)));
    expect(d.message.length).toBeLessThan(600);
  });

  test('caps a huge stack', () => {
    // Arrange
    const err = new Error('short');
    err.stack = 'y'.repeat(50_000);

    // Act
    const d = describeError(err);

    // Assert
    expect(d.stack!.length).toBeLessThan(3100);
  });
});

describe('errorSignature', () => {
  test('groups the same error from the same route together', () => {
    const a = { source: 'boundary' as const, name: 'TypeError', message: 'x', path: '/cart' };
    const b = { source: 'boundary' as const, name: 'TypeError', message: 'x', path: '/cart' };
    expect(errorSignature(a)).toBe(errorSignature(b));
  });

  test('separates the same error on a different route', () => {
    const a = { source: 'boundary' as const, name: 'TypeError', message: 'x', path: '/cart' };
    const b = { source: 'boundary' as const, name: 'TypeError', message: 'x', path: '/checkout' };
    expect(errorSignature(a)).not.toBe(errorSignature(b));
  });
});

describe('buildErrorEvent', () => {
  test('records source and a fixed timestamp', () => {
    // Arrange
    const now = new Date('2026-07-16T12:00:00.000Z');

    // Act
    const e = buildErrorEvent(new Error('nope'), 'rejection', undefined, now);

    // Assert
    expect(e.source).toBe('rejection');
    expect(e.at).toBe('2026-07-16T12:00:00.000Z');
    expect(e.message).toBe('nope');
  });

  test('omits an empty context rather than sending a bare object', () => {
    const e = buildErrorEvent(new Error('nope'), 'manual', {});
    expect(e.context).toBeUndefined();
  });

  test('keeps a supplied context', () => {
    const e = buildErrorEvent(new Error('nope'), 'boundary', { componentStack: 'at Foo' });
    expect(e.context).toEqual({ componentStack: 'at Foo' });
  });

  test('runs without window or navigator (node env)', () => {
    // Guards the SSR/test path: no globals, no throw, empty strings.
    const e = buildErrorEvent(new Error('nope'), 'manual');
    expect(e.path).toBe('');
    expect(e.userAgent).toBe('');
  });
});

describe('shouldReport', () => {
  test('allows an unseen signature', () => {
    expect(shouldReport('a|b|c|/x')).toBe(true);
  });
});

/**
 * The send path, with a configured backend. Needs a fresh module import
 * because the env vars are read once at module scope, mirroring how the
 * bundled app reads them.
 */
describe('captureError — send path', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let telemetry: typeof import('../../src/lib/telemetry');

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 202 })));
    vi.stubGlobal('fetch', fetchMock);
    telemetry = await import('../../src/lib/telemetry');
    telemetry.__resetTelemetryForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('posts the event to the report-error function', () => {
    // Act
    telemetry.captureError(new Error('kaboom'), 'boundary');

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.supabase.co/functions/v1/report-error');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      source: 'boundary',
      name: 'Error',
      message: 'kaboom',
    });
  });

  test('reports an identical error only once per session', () => {
    // Arrange — a render loop throwing the same error repeatedly.
    for (let i = 0; i < 5; i++) telemetry.captureError(new Error('same'), 'boundary');

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('still reports a genuinely different error', () => {
    telemetry.captureError(new Error('first'), 'boundary');
    telemetry.captureError(new Error('second'), 'boundary');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('caps the session so a crash loop cannot flood the sink', () => {
    // Arrange — 50 distinct errors against a cap of 20.
    for (let i = 0; i < 50; i++) telemetry.captureError(new Error(`err-${i}`), 'window');

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  test('never throws when the network rejects', () => {
    // Arrange
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));

    // Act + Assert — a telemetry failure must not surface to the caller.
    expect(() => telemetry.captureError(new Error('kaboom'), 'boundary')).not.toThrow();
  });
});
