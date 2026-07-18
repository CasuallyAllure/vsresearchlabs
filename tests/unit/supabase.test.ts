/**
 * Unit tests for src/lib/supabase.ts — the client bootstrap + requireSupabase().
 *
 * The client is built once at import time from import.meta.env, so every test
 * resets the module registry, stubs the env, and re-imports fresh.
 * '@supabase/supabase-js' is mocked — no real client, no network (and the
 * offline guard in tests/setup.ts would kill it anyway). Pins: a valid env
 * builds the client with session persistence, any missing/garbage env
 * degrades to a null client with a console warning (never a throw at import
 * time), a createClient explosion is contained the same way, and
 * requireSupabase() is the one place that throws — with the typed error.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const seam = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ fake: 'client' })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: seam.createClient,
}));

type SupabaseModule = typeof import('../../src/lib/supabase');

async function importWithEnv(url: string, key: string): Promise<SupabaseModule> {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', url);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', key);
  return import('../../src/lib/supabase');
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  seam.createClient.mockClear();
  seam.createClient.mockImplementation(() => ({ fake: 'client' }));
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('client bootstrap', () => {
  test('builds the client from a valid https env with session persistence', async () => {
    const mod = await importWithEnv('https://example.supabase.co', 'anon-key');

    expect(seam.createClient).toHaveBeenCalledWith('https://example.supabase.co', 'anon-key', {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    expect(mod.supabase).toEqual({ fake: 'client' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('accepts a plain http:// url (local dev)', async () => {
    const mod = await importWithEnv('http://localhost:54321', 'anon-key');

    expect(mod.supabase).toEqual({ fake: 'client' });
  });

  test('degrades to a null client when the url env is missing', async () => {
    const mod = await importWithEnv('', 'anon-key');

    expect(mod.supabase).toBeNull();
    expect(seam.createClient).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Supabase env missing or placeholder — client not initialized',
    );
  });

  test('rejects a placeholder url that is not http(s)', async () => {
    const mod = await importWithEnv('YOUR_SUPABASE_URL', 'anon-key');

    expect(mod.supabase).toBeNull();
    expect(seam.createClient).not.toHaveBeenCalled();
  });

  test('degrades to a null client when the anon key is missing', async () => {
    const mod = await importWithEnv('https://example.supabase.co', '');

    expect(mod.supabase).toBeNull();
    expect(seam.createClient).not.toHaveBeenCalled();
  });

  test('contains a createClient explosion — warns and runs without backend', async () => {
    seam.createClient.mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    const mod = await importWithEnv('https://example.supabase.co', 'anon-key');

    expect(mod.supabase).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      'Supabase client init failed — running without backend:',
      expect.any(Error),
    );
  });
});

describe('requireSupabase', () => {
  test('returns the client when configured', async () => {
    const mod = await importWithEnv('https://example.supabase.co', 'anon-key');

    expect(mod.requireSupabase()).toEqual({ fake: 'client' });
  });

  test('throws the typed error when not configured', async () => {
    const mod = await importWithEnv('', '');

    expect(() => mod.requireSupabase()).toThrow(mod.SupabaseNotConfiguredError);
    expect(() => mod.requireSupabase()).toThrow(
      'Supabase backend is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    );
  });

  test('the typed error carries its own name for telemetry grouping', async () => {
    const mod = await importWithEnv('', '');

    expect(new mod.SupabaseNotConfiguredError().name).toBe('SupabaseNotConfiguredError');
  });
});
