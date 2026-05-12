import type { OhMyPiProviderDefaults } from '../../types';

export type { OhMyPiProviderDefaults };

/**
 * Parse raw YAML-derived config into typed oh-my-pi defaults.
 * Defensive: invalid fields are dropped silently — never throws,
 * so broken user config can't prevent provider registration.
 */
export function parseOmpConfig(raw: Record<string, unknown>): OhMyPiProviderDefaults {
  const result: OhMyPiProviderDefaults = {};

  if (typeof raw.model === 'string') {
    result.model = raw.model;
  }

  if (typeof raw.binaryPath === 'string') {
    result.binaryPath = raw.binaryPath;
  }

  return result;
}
