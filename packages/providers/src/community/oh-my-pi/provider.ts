import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type {
  IAgentProvider,
  MessageChunk,
  ProviderCapabilities,
  SendQueryOptions,
} from '../../types';
import { OMP_CAPABILITIES } from './capabilities';
import { parseOmpConfig } from './config';
import { bridgeOmpProcess } from './event-bridge';
import { parseOmpModelRef } from './model-ref';

/**
 * Resolve the omp binary path following the priority order:
 * 1. assistants["oh-my-pi"].binaryPath from .archon/config.yaml
 * 2. OMP_BIN_PATH env var
 * 3. `which omp` on PATH
 * 4. node_modules/.bin/omp.cmd (Windows fallback)
 */
function resolveBinaryPath(configuredPath?: string): string {
  // Priority 1: configured path
  if (configuredPath && configuredPath !== 'auto') {
    return configuredPath;
  }

  // Priority 2: env var
  const envPath = process.env.OMP_BIN_PATH;
  if (envPath) {
    return envPath;
  }

  // Priority 3: which omp on PATH (handled by spawn directly)
  // Return 'omp' and let the OS resolve via PATH.
  return 'omp';
}

/**
 * Find an omp binary in node_modules/.bin as a Windows fallback.
 */
function findNodeModulesBin(): string | undefined {
  // Try common locations for node_modules/.bin/omp.cmd
  const candidates = [
    join(process.cwd(), 'node_modules', '.bin', 'omp.cmd'),
    join(process.cwd(), '..', 'node_modules', '.bin', 'omp.cmd'),
    join(process.cwd(), '..', '..', 'node_modules', '.bin', 'omp.cmd'),
    join(process.env.HOME || process.env.USERPROFILE || '', 'node_modules', '.bin', 'omp.cmd'),
    join(process.env.HOME || process.env.USERPROFILE || '', 'node_modules', '.bin', 'omp'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * oh-my-pi community provider — wraps the `omp` CLI (from can1357/oh-my-pi)
 * as an AI assistant backend. Each `sendQuery()` call spawns omp as a
 * subprocess in non-interactive mode and streams stdout lines as text chunks.
 *
 * Binary resolution order:
 * 1. assistants["oh-my-pi"].binaryPath from .archon/config.yaml
 * 2. OMP_BIN_PATH env var
 * 3. `which omp` on PATH
 * 4. node_modules/.bin/omp.cmd (Windows fallback)
 */
export class OhMyPiProvider implements IAgentProvider {
  private readonly binaryPath: string;

  constructor(binaryPath?: string) {
    this.binaryPath = binaryPath ?? resolveBinaryPath();
  }

  async *sendQuery(
    prompt: string,
    cwd: string,
    _resumeSessionId?: string,
    requestOptions?: SendQueryOptions
  ): AsyncGenerator<MessageChunk> {
    const assistantConfig = requestOptions?.assistantConfig ?? {};
    const ompConfig = parseOmpConfig(assistantConfig);

    // 1. Resolve model ref: request → config default
    const modelRef = requestOptions?.model ?? ompConfig.model;
    if (!modelRef) {
      throw new Error(
        'oh-my-pi provider requires a model. Set `model` on the workflow node or ' +
          '`assistants.oh-my-pi.model` in .archon/config.yaml. ' +
          "Format: '<provider>/<modelId>' (e.g. 'deepseek/deepseek-v4-flash')."
      );
    }

    const parsed = parseOmpModelRef(modelRef);
    if (!parsed) {
      throw new Error(
        `Invalid oh-my-pi model ref: '${modelRef}'. Expected format '<provider>/<modelId>' (e.g. 'deepseek/deepseek-v4-flash').`
      );
    }

    // 2. Resolve binary path
    const binaryPathOrName =
      ompConfig.binaryPath && ompConfig.binaryPath !== 'auto'
        ? ompConfig.binaryPath
        : this.binaryPath;

    // Check if it's a simple name or a path
    const isSimpleName =
      !binaryPathOrName.includes('/') &&
      !binaryPathOrName.includes('\\') &&
      !binaryPathOrName.includes('.exe') &&
      !binaryPathOrName.includes('.cmd');

    const resolvedBin = isSimpleName
      ? (findNodeModulesBin() ?? binaryPathOrName)
      : binaryPathOrName;

    // 3. Build args
    const fullModelRef = `${parsed.provider}/${parsed.modelId}`;
    const args = ['--model', fullModelRef, '-p', prompt];

    // 4. Spawn subprocess
    const child = spawn(resolvedBin, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...requestOptions?.env,
        // Suppress CLI warnings about interactive-only features
        OMP_NONINTERACTIVE: '1',
      },
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    // Collect stdout
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    // Collect stderr
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    try {
      // Wait for process to complete
      const exitCode = await new Promise<number>((resolve, reject) => {
        child.on('close', code => {
          resolve(code ?? 1);
        });
        child.on('error', err => {
          reject(err);
        });

        // Handle abort signal
        if (requestOptions?.abortSignal) {
          const onAbort = (): void => {
            child.kill('SIGTERM');
            requestOptions.abortSignal?.removeEventListener('abort', onAbort);
          };
          requestOptions.abortSignal.addEventListener('abort', onAbort);
        }
      });

      // Bridge results to chunk stream
      yield* bridgeOmpProcess(stdout, stderr, exitCode);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield {
        type: 'result',
        isError: true,
        errorSubtype: 'process_spawn_error',
        errors: [`Failed to spawn omp process: ${message}`],
      };
    }
  }

  getType(): string {
    return 'oh-my-pi';
  }

  getCapabilities(): ProviderCapabilities {
    return OMP_CAPABILITIES;
  }
}
