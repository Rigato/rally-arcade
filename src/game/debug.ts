/**
 * Debug é opt-in por URL: `?debug=1` ou hash `#debug`.
 * Sem isso, o HUD de telemetria e o painel de tuning não aparecem.
 */
export function isDebugMode(): boolean {
  const debugParam = new URLSearchParams(window.location.search).get('debug');
  if (debugParam === '1') {
    return true;
  }

  const hash = window.location.hash.replace(/^#/, '').toLowerCase();
  return hash === 'debug' || hash.startsWith('debug=') || hash.startsWith('debug&');
}
