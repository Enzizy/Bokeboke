import type { MapDefinition } from './MapDefinition';
import { crossfire } from './crossfire';
import { miniArena } from './miniArena';

/** Every playable map, keyed by id. New maps are added here and nowhere else. */
const maps: readonly MapDefinition[] = [miniArena, crossfire];

export function getMap(id: string): MapDefinition {
  const map = maps.find((m) => m.id === id);
  if (!map) throw new Error(`Unknown map "${id}"`);
  return map;
}

export function listMaps(): readonly MapDefinition[] {
  return maps;
}

export const DEFAULT_MAP_ID = miniArena.id;

/** True when the id names a map we actually have; network input is checked with this. */
export function isMapId(id: unknown): id is string {
  return typeof id === 'string' && maps.some((m) => m.id === id);
}
