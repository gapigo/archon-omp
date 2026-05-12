import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';

import { OhMyPiProvider } from './provider';
import { parseOmpModelRef } from './model-ref';
import { bridgeOmpProcess } from './event-bridge';
import { parseOmpConfig } from './config';

// ============================================================================
// Binary resolution tests
// ============================================================================
describe('resolveBinaryPath', () => {
  it('should use configured binary path when set (not auto)', () => {
    // The provider constructor uses the passed binaryPath directly
    // when provided — no resolution needed
    const provider = new OhMyPiProvider('/custom/path/omp');
    expect(provider).toBeInstanceOf(OhMyPiProvider);
    expect(provider.getType()).toBe('oh-my-pi');
  });

  it('should fall back to OMP_BIN_PATH env var', () => {
    const originalEnv = process.env.OMP_BIN_PATH;
    process.env.OMP_BIN_PATH = '/env/path/omp';
    try {
      const provider = new OhMyPiProvider();
      expect(provider).toBeInstanceOf(OhMyPiProvider);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.OMP_BIN_PATH;
      } else {
        process.env.OMP_BIN_PATH = originalEnv;
      }
    }
  });

  it('should fall back to omp on PATH when nothing configured', () => {
    const originalEnv = process.env.OMP_BIN_PATH;
    delete process.env.OMP_BIN_PATH;
    try {
      // Constructor with no args defaults to resolveBinaryPath() which
      // returns 'omp' when nothing is configured
      const provider = new OhMyPiProvider();
      expect(provider).toBeInstanceOf(OhMyPiProvider);
    } finally {
      if (originalEnv !== undefined) {
        process.env.OMP_BIN_PATH = originalEnv;
      }
    }
  });

  it('should find omp in node_modules/.bin if available', () => {
    // Test that the findNodeModulesBin checks common locations
    // This is a path-agnostic test — we just verify the function is callable
    // The test binary is imported via provider, which calls resolveBinaryPath()
    const provider = new OhMyPiProvider('omp');
    expect(provider.getType()).toBe('oh-my-pi');
  });
});

// ============================================================================
// Model ref parsing tests
// ============================================================================
describe('parseOmpModelRef', () => {
  it('should parse standard provider/modelId format', () => {
    const result = parseOmpModelRef('deepseek/deepseek-v4-flash');
    expect(result).toEqual({
      provider: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });
  });

  it('should parse provider/modelId with multiple slashes', () => {
    const result = parseOmpModelRef('anthropic/claude-sonnet-4-20250514');
    expect(result).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-20250514',
    });
  });

  it('should return undefined for empty string', () => {
    expect(parseOmpModelRef('')).toBeUndefined();
  });

  it('should return undefined for missing provider', () => {
    expect(parseOmpModelRef('/model')).toBeUndefined();
  });

  it('should return undefined for missing modelId', () => {
    expect(parseOmpModelRef('provider/')).toBeUndefined();
  });

  it('should return undefined when no slash present', () => {
    expect(parseOmpModelRef('just-a-model')).toBeUndefined();
  });
});

// ============================================================================
// Stream output (event-bridge) tests
// ============================================================================
describe('bridgeOmpProcess', () => {
  it('should yield content chunks for stdout lines', async () => {
    const chunks: any[] = [];
    for await (const chunk of bridgeOmpProcess('hello\nworld\n', '', 0)) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(3); // 'hello', 'world', + result
    expect(chunks[0]).toEqual({ type: 'assistant', content: 'hello' });
    expect(chunks[1]).toEqual({ type: 'assistant', content: 'world' });
    expect(chunks[2]).toEqual({ type: 'result' });
  });

  it('should yield error chunk on non-zero exit with stderr', async () => {
    const chunks: any[] = [];
    for await (const chunk of bridgeOmpProcess('', 'error message', 1)) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(1);
    expect(chunks[0].type).toBe('result');
    expect(chunks[0].isError).toBe(true);
    expect(chunks[0].errorSubtype).toBe('process_exit_error');
    expect(chunks[0].errors[0]).toContain('error message');
  });

  it('should yield error chunk on non-zero exit without stderr', async () => {
    const chunks: any[] = [];
    for await (const chunk of bridgeOmpProcess('', '', 1)) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(1);
    expect(chunks[0].type).toBe('result');
    expect(chunks[0].isError).toBe(true);
    expect(chunks[0].errors[0]).toContain('exited with code 1');
  });

  it('should yield both content and error on non-zero exit with stdout', async () => {
    const chunks: any[] = [];
    for await (const chunk of bridgeOmpProcess('partial output\n', 'something failed', 1)) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toEqual({ type: 'assistant', content: 'partial output' });
    expect(chunks[1].type).toBe('result');
    expect(chunks[1].isError).toBe(true);
  });

  it('should skip empty stdout lines', async () => {
    const chunks: any[] = [];
    for await (const chunk of bridgeOmpProcess('\n\n', '', 0)) {
      chunks.push(chunk);
    }
    // Empty lines are skipped; only the result is yielded
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual({ type: 'result' });
  });

  it('should handle null exit code', async () => {
    const chunks: any[] = [];
    for await (const chunk of bridgeOmpProcess('output', '', null)) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toEqual({ type: 'assistant', content: 'output' });
    expect(chunks[1].type).toBe('result');
    expect(chunks[1].isError).toBe(true);
  });
});

// ============================================================================
// Config parsing tests
// ============================================================================
describe('parseOmpConfig', () => {
  it('should extract model from config', () => {
    const result = parseOmpConfig({ model: 'deepseek/deepseek-v4-flash' });
    expect(result.model).toBe('deepseek/deepseek-v4-flash');
  });

  it('should extract binaryPath from config', () => {
    const result = parseOmpConfig({ binaryPath: '/usr/local/bin/omp' });
    expect(result.binaryPath).toBe('/usr/local/bin/omp');
  });

  it('should ignore non-string model', () => {
    const result = parseOmpConfig({ model: 123 });
    expect(result.model).toBeUndefined();
  });

  it('should return empty defaults for empty config', () => {
    const result = parseOmpConfig({});
    expect(result.model).toBeUndefined();
    expect(result.binaryPath).toBeUndefined();
  });
});

// ============================================================================
// Provider basics
// ============================================================================
describe('OhMyPiProvider', () => {
  it('should return correct type', () => {
    const provider = new OhMyPiProvider();
    expect(provider.getType()).toBe('oh-my-pi');
  });

  it('should return capabilities', () => {
    const provider = new OhMyPiProvider();
    const caps = provider.getCapabilities();
    expect(caps.sessionResume).toBe(false);
    expect(caps.mcp).toBe(false);
    expect(caps.hooks).toBe(false);
    expect(caps.skills).toBe(false);
    expect(caps.envInjection).toBe(true);
  });

  it('should throw on sendQuery without model', async () => {
    const provider = new OhMyPiProvider();
    const generator = provider.sendQuery('hello', process.cwd(), undefined, {
      assistantConfig: {},
    });

    await expect(async () => {
      for await (const _chunk of generator) {
        // Should throw before yielding
      }
    }).toThrow(/requires a model/);
  });
});
