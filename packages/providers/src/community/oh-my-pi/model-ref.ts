/**
 * Shape of a parsed oh-my-pi model reference.
 */
export interface OmpModelRef {
  /** Provider id, e.g. 'deepseek', 'openai', 'anthropic'. */
  provider: string;
  /** Model id (may contain slashes for namespaced models). */
  modelId: string;
}

/**
 * Parse a model ref in '<provider>/<modelId>' format.
 * Splits on the FIRST '/' so namespaced model ids work:
 *   'deepseek/deepseek-v4-flash' → { provider: 'deepseek', modelId: 'deepseek-v4-flash' }
 *
 * Returns undefined for malformed refs.
 */
export function parseOmpModelRef(raw: string): OmpModelRef | undefined {
  const idx = raw.indexOf('/');
  if (idx <= 0 || idx === raw.length - 1) return undefined;

  const provider = raw.slice(0, idx);
  const modelId = raw.slice(idx + 1);

  if (provider.length === 0 || modelId.length === 0) return undefined;

  return { provider, modelId };
}
