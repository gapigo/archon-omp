import type { ProviderCapabilities } from '../../types';

/**
 * oh-my-pi capabilities — intentionally conservative. The omp CLI is
 * spawned as a subprocess, so features like MCP, hooks, skills, and
 * session resume are not wired in v1. Only envInjection is supported
 * (env vars passed to the subprocess).
 */
export const OMP_CAPABILITIES: ProviderCapabilities = {
  sessionResume: false,
  mcp: false,
  hooks: false,
  skills: false,
  agents: false,
  toolRestrictions: false,
  structuredOutput: false,
  envInjection: true,
  costControl: false,
  effortControl: false,
  thinkingControl: false,
  fallbackModel: false,
  sandbox: false,
};
