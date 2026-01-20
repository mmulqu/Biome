import * as h3 from 'h3-js';
import type {
  Player,
  Observation,
  Tile,
  TileScore,
  INatObservation,
  INatObservationsResponse,
  IconicTaxon,
  BiomeType
} from '../types';
import {
  SCORING,
  H3_RESOLUTION,
  BIOME_BONUS_TAXA
} from '../types';

const INAT_API_BASE = 'https://api.inaturalist.org/v1';
const STORAGE_KEY_PREFIX = 'biome_game_';

// ============================================================================
// IndexedDB Setup for Large Data
// ============================================================================

const DB_NAME = 'biome_game_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains('players')) {
        db.createObjectStore('players', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('observations')) {
        const obsStore = db.createObjectStore('observations', { keyPath: 'id' });
        obsStore.createIndex('player_id', 'player_id', { unique: false });
        obsStore.createIndex('h3_index', 'h3_index', { unique: false });
      }

      if (!db.objectStoreNames.contains('tiles')) {
        db.createObjectStore('tiles', { keyPath: 'h3_index' });
      }

      if (!db.objectStoreNames.contains('tile_scores')) {
        const scoresStore = db.createObjectStore('tile_scores', { keyPath: ['h3_index', 'player_id'] });
        scoresStore.createIndex('h3_index', 'h3_index', { unique: false });
      }
    };
  });

  return dbPromise;
}

async function dbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut<T>(storeName: string, value: T): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function dbPutMany<T>(storeName: string, values: T[]): Promise<void> {
  if (values.length === 0) return;
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    values.forEach(value => store.put(value));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function dbGetByIndex<T>(storeName: string, indexName: string, key: IDBValidKey): Promise<T[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Legacy localStorage for simple settings
function getFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${key}`);
    if (stored) return JSON.parse(stored);
  } catch (e) {
    console.error('Storage read error:', e);
  }
  return defaultValue;
}

function setToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${key}`, JSON.stringify(value));
  } catch (e) {
    console.error('Storage write error:', e);
  }
}

// ============================================================================
// Scoring Functions
// ============================================================================

function calculateDataGapMultiplier(observationCount: number): number {
  for (const threshold of SCORING.DATA_GAP_THRESHOLDS) {
    if (observationCount <= threshold.max) {
      return threshold.multiplier;
    }
  }
  return 0.8;
}

function calculateTaxaMatchMultiplier(biomeType: BiomeType, iconicTaxon: IconicTaxon): number {
  const bonusTaxa = BIOME_BONUS_TAXA[biomeType] || [];
  return bonusTaxa.includes(iconicTaxon) ? SCORING.TAXA_MATCH_MULTIPLIER : 1.0;
}

function convertINatObservation(
  inatObs: INatObservation,
  tileObsCount: number,
  biomeType: BiomeType
): Observation | null {
  if (!inatObs.location) return null;

  const [lat, lng] = inatObs.location.split(',').map(Number);
  if (isNaN(lat) || isNaN(lng)) return null;

  const h3Index = h3.latLngToCell(lat, lng, H3_RESOLUTION);
  const iconicTaxon = (inatObs.taxon?.iconic_taxon_name || 'unknown') as IconicTaxon;
  const isResearchGrade = inatObs.quality_grade === 'research';

  const dataGapMultiplier = calculateDataGapMultiplier(tileObsCount);
  const taxaMatchMultiplier = calculateTaxaMatchMultiplier(biomeType, iconicTaxon);
  const researchGradeBonus = isResearchGrade ? SCORING.RESEARCH_GRADE_BONUS : 1.0;

  const totalPoints = Math.round(
    SCORING.BASE_POINTS * taxaMatchMultiplier * dataGapMultiplier * researchGradeBonus
  );

  return {
    id: String(inatObs.id),
    player_id: String(inatObs.user.id),
    username: inatObs.user.login,
    pfp_url: inatObs.user.icon_url || undefined,
    h3_index: h3Index,
    taxon_id: inatObs.taxon?.id || null,
    iconic_taxon: iconicTaxon,
    species_name: inatObs.taxon?.name || null,
    common_name: inatObs.taxon?.preferred_common_name || null,
    observed_at: inatObs.observed_on_string,
    latitude: lat,
    longitude: lng,
    is_research_grade: isResearchGrade,
    photo_url: inatObs.photos?.[0]?.url?.replace('square', 'medium') || null,
    inat_url: inatObs.uri,
    base_points: SCORING.BASE_POINTS,
    taxa_multiplier: taxaMatchMultiplier,
    data_gap_multiplier: dataGapMultiplier,
    research_grade_bonus: researchGradeBonus,
    total_points: totalPoints
  };
}

// ============================================================================
// iNaturalist API Functions
// ============================================================================

export async function fetchUserByUsername(username: string): Promise<{
  id: number;
  login: string;
  name?: string;
  icon_url?: string;
  observations_count?: number;
} | null> {
  try {
    const response = await fetch(`${INAT_API_BASE}/users/autocomplete?q=${encodeURIComponent(username)}`);
    if (!response.ok) throw new Error('Failed to fetch user');

    const data = await response.json();
    const user = data.results?.find((u: { login: string }) =>
      u.login.toLowerCase() === username.toLowerCase()
    );

    return user || null;
  } catch (e) {
    console.error('Error fetching user:', e);
    return null;
  }
}

export async function fetchObservationsForUser(
  username: string,
  page: number = 1,
  perPage: number = 200
): Promise<INatObservationsResponse> {
  const url = new URL(`${INAT_API_BASE}/observations`);
  url.searchParams.set('user_login', username);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('page', String(page));
  url.searchParams.set('order_by', 'observed_on');
  url.searchParams.set('order', 'desc');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch observations: ${response.statusText}`);
  }

  return response.json();
}

export async function fetchAllObservationsForUser(
  username: string,
  onProgress?: (fetched: number, total: number) => void,
  maxPages: number = 50
): Promise<INatObservation[]> {
  const allObservations: INatObservation[] = [];
  let page = 1;
  let totalResults = 0;

  while (page <= maxPages) {
    const response = await fetchObservationsForUser(username, page, 200);

    if (page === 1) {
      totalResults = response.total_results;
    }

    allObservations.push(...response.results);

    if (onProgress) {
      onProgress(allObservations.length, totalResults);
    }

    if (allObservations.length >= totalResults || response.results.length < 200) {
      break;
    }

    page++;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return allObservations;
}

// ============================================================================
// Player Management (Multi-user Public Database)
// ============================================================================

export async function getTrackedPlayers(): Promise<Player[]> {
  return dbGetAll<Player>('players');
}

export async function getPlayer(playerId: string): Promise<Player | undefined> {
  return dbGet<Player>('players', playerId);
}

export async function addPlayer(
  username: string,
  onProgress?: (fetched: number, total: number) => void
): Promise<Player | null> {
  const user = await fetchUserByUsername(username);
  if (!user) return null;

  // Check if already tracked
  const existing = await dbGet<Player>('players', String(user.id));
  if (existing) {
    await syncPlayerObservations(existing, onProgress);
    const updated = await dbGet<Player>('players', String(user.id));
    return updated || existing;
  }

  const player: Player = {
    id: String(user.id),
    username: user.login,
    display_name: user.name || user.login,
    pfp_url: user.icon_url || '',
    total_points: 0,
    tiles_owned: 0,
    observation_count: 0,
    unique_species: 0,
    data_deserts_pioneered: 0
  };

  await dbPut('players', player);
  await syncPlayerObservations(player, onProgress);

  const updated = await dbGet<Player>('players', String(user.id));
  return updated || player;
}

export async function removePlayer(playerId: string): Promise<void> {
  await dbDelete('players', playerId);
}

export async function syncPlayerObservations(
  player: Player,
  onProgress?: (fetched: number, total: number) => void
): Promise<{ added: number; total: number }> {
  const inatObservations = await fetchAllObservationsForUser(player.username, onProgress);

  const existingObs = await dbGetByIndex<Observation>('observations', 'player_id', player.id);
  const existingIds = new Set(existingObs.map(o => o.id));

  const allTiles = await dbGetAll<Tile>('tiles');
  const tilesMap = new Map(allTiles.map(t => [t.h3_index, t]));

  const newObservations: Observation[] = [];
  const tilesToUpdate = new Map<string, Tile>();
  let added = 0;

  for (const inatObs of inatObservations) {
    if (!inatObs.location) continue;
    if (existingIds.has(String(inatObs.id))) continue;

    const [lat, lng] = inatObs.location.split(',').map(Number);
    if (isNaN(lat) || isNaN(lng)) continue;

    const h3Index = h3.latLngToCell(lat, lng, H3_RESOLUTION);

    let tile = tilesMap.get(h3Index) || tilesToUpdate.get(h3Index);
    if (!tile) {
      const [centerLat, centerLng] = h3.cellToLatLng(h3Index);
      tile = {
        h3_index: h3Index,
        biome_type: 'unknown' as BiomeType,
        center_lat: centerLat,
        center_lng: centerLng,
        total_observations: 0,
        unique_observers: 0,
        owner_id: null,
        owner_points: 0,
        is_rare: false
      };
    }

    const observation = convertINatObservation(inatObs, tile.total_observations, tile.biome_type);
    if (!observation) continue;

    newObservations.push(observation);
    tile.total_observations++;
    tilesToUpdate.set(h3Index, tile);
    added++;
  }

  if (newObservations.length > 0) {
    await dbPutMany('observations', newObservations);
  }

  if (tilesToUpdate.size > 0) {
    await dbPutMany('tiles', Array.from(tilesToUpdate.values()));
  }

  await updateTileScoresForPlayer(player.id);
  await updatePlayerStats(player.id);

  return { added, total: existingObs.length + added };
}

async function updateTileScoresForPlayer(playerId: string): Promise<void> {
  const playerObs = await dbGetByIndex<Observation>('observations', 'player_id', playerId);
  const player = await dbGet<Player>('players', playerId);
  if (!player) return;

  const tilePoints = new Map<string, { points: number; count: number }>();
  for (const obs of playerObs) {
    const existing = tilePoints.get(obs.h3_index) || { points: 0, count: 0 };
    existing.points += obs.total_points;
    existing.count++;
    tilePoints.set(obs.h3_index, existing);
  }

  const scores: TileScore[] = [];
  for (const [h3Index, data] of tilePoints) {
    scores.push({
      h3_index: h3Index,
      player_id: playerId,
      username: player.username,
      pfp_url: player.pfp_url,
      total_points: data.points,
      observation_count: data.count
    });
  }

  await dbPutMany('tile_scores', scores);

  for (const h3Index of tilePoints.keys()) {
    await updateTileOwnership(h3Index);
  }
}

async function updateTileOwnership(h3Index: string): Promise<void> {
  const scores = await dbGetByIndex<TileScore>('tile_scores', 'h3_index', h3Index);
  if (scores.length === 0) return;

  scores.sort((a, b) => b.total_points - a.total_points);
  const topScorer = scores[0];

  const tile = await dbGet<Tile>('tiles', h3Index);
  if (tile) {
    tile.owner_id = topScorer.player_id;
    tile.owner_username = topScorer.username;
    tile.owner_pfp = topScorer.pfp_url;
    tile.owner_points = topScorer.total_points;
    tile.unique_observers = new Set(scores.map(s => s.player_id)).size;
    await dbPut('tiles', tile);
  }
}

async function updatePlayerStats(playerId: string): Promise<void> {
  const player = await dbGet<Player>('players', playerId);
  if (!player) return;

  const playerObs = await dbGetByIndex<Observation>('observations', 'player_id', playerId);
  const allTiles = await dbGetAll<Tile>('tiles');

  player.observation_count = playerObs.length;
  player.total_points = playerObs.reduce((sum, o) => sum + o.total_points, 0);
  player.unique_species = new Set(playerObs.map(o => o.taxon_id).filter(Boolean)).size;
  player.tiles_owned = allTiles.filter(t => t.owner_id === playerId).length;

  await dbPut('players', player);
}

// ============================================================================
// Data Access Functions (Optimized for Performance)
// ============================================================================

export async function getObservationsInBounds(
  bounds: { north: number; south: number; east: number; west: number },
  limit: number = 200
): Promise<Observation[]> {
  const allObs = await dbGetAll<Observation>('observations');

  const inBounds = allObs.filter(obs =>
    obs.latitude >= bounds.south &&
    obs.latitude <= bounds.north &&
    obs.longitude >= bounds.west &&
    obs.longitude <= bounds.east
  );

  // Return limited set sorted by points (higher value obs shown first)
  inBounds.sort((a, b) => b.total_points - a.total_points);
  return inBounds.slice(0, limit);
}

export async function getTileDetails(h3Index: string): Promise<{
  tile: Tile | null;
  leaderboard: TileScore[];
  observations: Observation[];
}> {
  const tile = await dbGet<Tile>('tiles', h3Index);
  const scores = await dbGetByIndex<TileScore>('tile_scores', 'h3_index', h3Index);
  const observations = await dbGetByIndex<Observation>('observations', 'h3_index', h3Index);

  scores.sort((a, b) => b.total_points - a.total_points);
  observations.sort((a, b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime());

  if (!tile) {
    const [centerLat, centerLng] = h3.cellToLatLng(h3Index);
    return {
      tile: {
        h3_index: h3Index,
        biome_type: 'unknown',
        center_lat: centerLat,
        center_lng: centerLng,
        total_observations: observations.length,
        unique_observers: new Set(observations.map(o => o.player_id)).size,
        owner_id: scores[0]?.player_id || null,
        owner_username: scores[0]?.username,
        owner_pfp: scores[0]?.pfp_url,
        owner_points: scores[0]?.total_points || 0,
        is_rare: false
      },
      leaderboard: scores.slice(0, 10),
      observations: observations.slice(0, 20)
    };
  }

  return {
    tile,
    leaderboard: scores.slice(0, 10),
    observations: observations.slice(0, 20)
  };
}

export async function getTilesWithData(): Promise<Tile[]> {
  const allTiles = await dbGetAll<Tile>('tiles');
  return allTiles.filter(t => t.total_observations > 0);
}

export async function getLeaderboard(): Promise<Player[]> {
  const players = await dbGetAll<Player>('players');
  players.sort((a, b) => b.total_points - a.total_points);
  return players;
}

export async function getGlobalStats(): Promise<{
  totalObservations: number;
  totalTiles: number;
  totalPlayers: number;
  totalSpecies: number;
}> {
  const observations = await dbGetAll<Observation>('observations');
  const tiles = await dbGetAll<Tile>('tiles');
  const players = await dbGetAll<Player>('players');

  return {
    totalObservations: observations.length,
    totalTiles: tiles.filter(t => t.total_observations > 0).length,
    totalPlayers: players.length,
    totalSpecies: new Set(observations.map(o => o.taxon_id).filter(Boolean)).size
  };
}

// ============================================================================
// Migration from localStorage
// ============================================================================

export async function migrateFromLocalStorage(): Promise<boolean> {
  const migrated = getFromStorage<boolean>('migrated_to_indexeddb', false);
  if (migrated) return false;

  try {
    const oldPlayer = getFromStorage<Player | null>('current_player', null);
    if (oldPlayer) {
      await dbPut('players', oldPlayer);
    }

    const oldObs = getFromStorage<Observation[]>('observations', []);
    if (oldObs.length > 0) {
      await dbPutMany('observations', oldObs);
    }

    const oldTiles = getFromStorage<Record<string, Tile>>('tiles', {});
    if (Object.keys(oldTiles).length > 0) {
      await dbPutMany('tiles', Object.values(oldTiles));
    }

    setToStorage('migrated_to_indexeddb', true);

    localStorage.removeItem(`${STORAGE_KEY_PREFIX}observations`);
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}tiles`);
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}tile_scores`);

    return true;
  } catch (e) {
    console.error('Migration failed:', e);
    return false;
  }
}
