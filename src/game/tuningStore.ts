import {
  BODY_TUNING,
  CAMERA_TUNING,
  CAR_TUNING,
  DUST_TUNING,
  INPUT_TUNING,
  POWERUP_TUNING,
  RACE_TUNING,
  SURFACES,
} from './config';
import type {
  BodyTuning,
  CameraTuning,
  CarTuning,
  InputTuning,
  PowerupTuning,
  RaceTuning,
  SurfaceDef,
  SurfaceId,
} from './types';

/** Chave única no localStorage. O sufixo permite migrar o formato no futuro. */
export const TUNING_STORAGE_KEY = 'rally.tuning.v4';

interface TuningSnapshot {
  car: CarTuning;
  body: BodyTuning;
  camera: CameraTuning;
  input: InputTuning;
  surfaces: Record<SurfaceId, SurfaceDef>;
  dust: typeof DUST_TUNING;
  powerups: PowerupTuning;
  race: RaceTuning;
}

const SURFACE_IDS = Object.keys(SURFACES) as SurfaceId[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Snapshot imutável dos defaults, tirado no carregamento do módulo — antes de
 * qualquer override do localStorage. `resetTuning()` sempre volta para cá.
 */
const DEFAULTS: TuningSnapshot = structuredClone({
  car: CAR_TUNING,
  body: BODY_TUNING,
  camera: CAMERA_TUNING,
  input: INPUT_TUNING,
  surfaces: SURFACES,
  dust: DUST_TUNING,
  powerups: POWERUP_TUNING,
  race: RACE_TUNING,
});

/** Cópia rasa dos objetos vivos; usada para salvar/exportar. */
function currentSnapshot(): TuningSnapshot {
  return structuredClone({
    car: CAR_TUNING,
    body: BODY_TUNING,
    camera: CAMERA_TUNING,
    input: INPUT_TUNING,
    surfaces: SURFACES,
    dust: DUST_TUNING,
    powerups: POWERUP_TUNING,
    race: RACE_TUNING,
  });
}

/**
 * Copia apenas os campos numéricos de `defaults` para `target`.
 *
 * - Campo ausente, `NaN`, `Infinity` ou de outro tipo → usa o default.
 * - Campos string (`id`, `label`) são ignorados aqui.
 * - Campos novos em `target` que não existam em `defaults` são preservados.
 * - As referências de `target` nunca são trocadas.
 */
function applyNumericFields<T extends object>(target: T, defaults: T, source: unknown): void {
  const targetRecord = target as unknown as Record<string, unknown>;
  const defaultsRecord = defaults as unknown as Record<string, unknown>;
  const sourceRecord = isRecord(source) ? source : {};

  for (const key of Object.keys(defaultsRecord)) {
    const fallback = defaultsRecord[key];

    if (typeof fallback !== 'number') {
      continue;
    }

    const candidate = sourceRecord[key];
    targetRecord[key] =
      typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback;
  }
}

/**
 * Aplica um objeto de tuning (vindo do JSON salvo) sobre os objetos vivos.
 * O merge é tolerante: qualquer seção ausente ou inválida vira default.
 */
function applySnapshot(data: unknown): void {
  const root = isRecord(data) ? data : {};

  applyNumericFields(CAR_TUNING, DEFAULTS.car, root.car);
  applyNumericFields(BODY_TUNING, DEFAULTS.body, root.body);
  applyNumericFields(CAMERA_TUNING, DEFAULTS.camera, root.camera);
  applyNumericFields(INPUT_TUNING, DEFAULTS.input, root.input);
  applyNumericFields(POWERUP_TUNING, DEFAULTS.powerups, root.powerups);
  applyNumericFields(RACE_TUNING, DEFAULTS.race, root.race);
  applyNumericFields(DUST_TUNING, DEFAULTS.dust, root.dust);
  if (isRecord(root.dust) && typeof root.dust.enabled === 'boolean') {
    DUST_TUNING.enabled = root.dust.enabled;
  }
  applyNumericFields(
    RACE_TUNING.medals,
    DEFAULTS.race.medals,
    isRecord(root.race) ? root.race.medals : undefined,
  );

  const surfacesData = isRecord(root.surfaces) ? root.surfaces : {};
  for (const id of SURFACE_IDS) {
    applyNumericFields(SURFACES[id], DEFAULTS.surfaces[id], surfacesData[id]);
  }
}

function readStorage(): string | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    return localStorage.getItem(TUNING_STORAGE_KEY);
  } catch {
    // Modo privado / cookies bloqueados: o jogo segue com os defaults.
    return null;
  }
}

/**
 * Lê o tuning salvo (`TUNING_STORAGE_KEY`) e aplica sobre os objetos mutáveis
 * exportados por `config.ts`, mantendo as referências.
 *
 * JSON inválido é ignorado (mantém o estado atual, geralmente os defaults).
 * Retorna `true` quando havia um JSON válido aplicado.
 */
export function loadTuning(): boolean {
  const raw = readStorage();
  if (!raw) {
    return false;
  }

  try {
    applySnapshot(JSON.parse(raw) as unknown);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serializa o tuning atual e grava no localStorage. Nunca lança:
 * em modo privado com storage indisponível apenas retorna `false`.
 */
export function saveTuning(): boolean {
  try {
    if (typeof localStorage === 'undefined') {
      return false;
    }

    localStorage.setItem(TUNING_STORAGE_KEY, JSON.stringify(currentSnapshot()));
    return true;
  } catch {
    return false;
  }
}

/** Restaura os defaults nos mesmos objetos e apaga a chave salva. */
export function resetTuning(): void {
  applySnapshot(DEFAULTS);

  try {
    localStorage.removeItem(TUNING_STORAGE_KEY);
  } catch {
    // Storage indisponível: os defaults já foram aplicados em memória.
  }
}

/** JSON legível do tuning atual, pronto para copiar/colar ou versionar. */
export function exportTuningJson(): string {
  return JSON.stringify(currentSnapshot(), null, 2);
}
