/** Formatação compartilhada entre HUD, parcial e tela de resultado. */

/** `mm:ss.mmm` com fontes tabulares. Tempos longos continuam válidos. */
export function formatTime(seconds: number): string {
  const totalMs = Math.floor(Math.max(seconds, 0) * 1000);
  const minutes = Math.floor(totalMs / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;

  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** Segundos com duas casas e vírgula decimal (ex.: `43,20 s`). */
export function formatSeconds(seconds: number, digits = 2): string {
  return `${Math.max(seconds, 0).toFixed(digits).replace('.', ',')} s`;
}

/**
 * Diferença assinada para a parcial: `+0,42` (vermelho) ou `-0,31` (verde).
 * Abaixo de 5 ms é tratado como empate para não exibir sinal ruidoso.
 */
export function formatDelta(seconds: number): string {
  if (!Number.isFinite(seconds) || Math.abs(seconds) < 0.005) {
    return '0,00';
  }

  const sign = seconds > 0 ? '+' : '-';
  return `${sign}${Math.abs(seconds).toFixed(2).replace('.', ',')}`;
}
