import type { MessageChunk } from '../../types';

/**
 * Yield result chunk from omp subprocess output.
 * Parses stdout lines as text content deltas and yields them as
 * MessageChunk assistant chunks. On non-zero exit, yields an error chunk.
 */
export async function* bridgeOmpProcess(
  stdout: string,
  stderr: string,
  exitCode: number | null
): AsyncGenerator<MessageChunk> {
  // Yield accumulated stdout as assistant content chunks.
  // Split by newlines and yield each non-empty line.
  if (stdout.length > 0) {
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.length > 0) {
        yield { type: 'assistant', content: line };
      }
    }
  }

  // On non-zero exit, yield error chunk with stderr content.
  if (exitCode !== 0) {
    const errorMessage =
      stderr.length > 0
        ? `omp process exited with code ${exitCode}: ${stderr.trim()}`
        : `omp process exited with code ${exitCode}`;
    yield {
      type: 'result',
      isError: true,
      errorSubtype: 'process_exit_error',
      errors: [errorMessage],
    };
  } else {
    // Successful completion
    yield { type: 'result' };
  }
}
