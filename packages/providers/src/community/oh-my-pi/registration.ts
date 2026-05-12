import { isRegisteredProvider, registerProvider } from '../../registry';
import { OMP_CAPABILITIES } from './capabilities';
import { OhMyPiProvider } from './provider';

/**
 * Register the oh-my-pi community provider.
 * Idempotent — safe to call multiple times.
 */
export function registerOhMyPiProvider(): void {
  if (isRegisteredProvider('oh-my-pi')) return;
  registerProvider({
    id: 'oh-my-pi',
    displayName: 'oh-my-pi (community)',
    factory: () => new OhMyPiProvider(),
    capabilities: OMP_CAPABILITIES,
    builtIn: false,
  });
}
