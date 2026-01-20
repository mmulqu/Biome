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
  H3_RESOLUTIONS,
  BIOME_BONUS_TAXA,
  MIN_ZOOM_FOR_OBSERVATIONS,
  getResolutionForZoom
} from '../types';

const INAT_API_BASE = 'https://api.inaturalist.org/v1';
const STORAGE_KEY_PREFIX = 'biome_game_';

// ============================================================================
// IndexedDB Setup with Hierarchical Tiles
// ============================================================================

const DB_NAME = 'biome_game_db';
const DB_VERSION = 3; // Bumped for hierarchical tiles

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

      // Observations store
      if (!db.objectStoreNames.contains('observations')) {
        const obsStore = db.createObjectStore('observations', { keyPath: 'id' });
        obsStore.createIndex('player_id', 'player_id', { unique: false });
        obsStore.createIndex('h3_index', 'h3_index', { unique: false });
        obsStore.createIndex('grid_bucket', 'grid_bucket', { unique: false });
      }

      // Tiles store with resolution index
      if (!db.objectStoreNames.contains('tiles')) {
        const tilesStore = db.createObjectStore('tiles', { keyPath: 'h3_index' });
        tilesStore.createIndex('grid_bucket', 'grid_bucket', { unique: false });
        tilesStore.createIndex('resolution', 'resolution', { unique: false });
      }

      // Tile scores
      if (!db.objectStoreNames.contains('tile_scores')) {
        const scoresStore = db.createObjectStore('tile_scores', { keyPath: ['h3_index', 'player_id'] });
        scoresStore.createIndex('h3_index', 'h3_index', { unique: false });
        scoresStore.createIndex('player_id', 'player_id', { unique: false });
      }
    };
  });

  return dbPromise;
}

// Grid bucket for spatial indexing (1 degree = ~111km cells)
function getGridBucket(lat: number, lng: number): string {
  const latBucket = Math.floor(lat);
  const lngBucket = Math.floor(lng);
  return `${latBucket},${lngBucket}`;
}

function getGridBucketsInBounds(bounds: { north: number; south: number; east: number; west: number }): string[] {
  const buckets: string[] = [];
  const minLat = Math.floor(bounds.south);
  const maxLat = Math.floor(bounds.north);
  const minLng = Math.floor(bounds.west);
  const maxLng = Math.floor(bounds.east);

  for (let lat = minLat; lat <= maxLat; lat++) {
    for (let lng = minLng; lng <= maxLng; lng++) {
      buckets.push(`${lat},${lng}`);
    }
  }
  return buckets;
}

// ============================================================================
// IndexedDB Helper Functions
// ============================================================================

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

async function dbGetByGridBuckets<T>(storeName: string, buckets: string[]): Promise<T[]> {
  if (buckets.length === 0) return [];
  const db = await getDB();

  const results: T[] = [];
  for (const bucket of buckets) {
    const items = await new Promise<T[]>((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      try {
        const index = store.index('grid_bucket');
        const request = index.getAll(bucket);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
    results.push(...items);
  }
  return results;
}

// Legacy localStorage
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
// H3 Helper Functions
// ============================================================================

function computeH3Boundary(h3Index: string): [number, number][] {
  const boundary = h3.cellToBoundary(h3Index);
  return boundary.map(([lat, lng]) => [lat, lng] as [number, number]);
}

// Get parent cell at a coarser resolution
function getParentCell(h3Index: string, parentResolution: number): string {
  return h3.cellToParent(h3Index, parentResolution);
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
): (Observation & { grid_bucket: string }) | null {
  if (!inatObs.location) return null;

  const [lat, lng] = inatObs.location.split(',').map(Number);
  if (isNaN(lat) || isNaN(lng)) return null;

  const h3Index = h3.latLngToCell(lat, lng, H3_RESOLUTIONS.SUPER_LOCAL);
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
    total_points: totalPoints,
    grid_bucket: getGridBucket(lat, lng)
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
// Player Management
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

// ============================================================================
// Sync Observations and Build Hierarchical Tiles
// ============================================================================

export async function syncPlayerObservations(
  player: Player,
  onProgress?: (fetched: number, total: number) => void
): Promise<{ added: number; total: number }> {
  const inatObservations = await fetchAllObservationsForUser(player.username, onProgress);

  const existingObs = await dbGetByIndex<Observation>('observations', 'player_id', player.id);
  const existingIds = new Set(existingObs.map(o => o.id));

  const allTiles = await dbGetAll<Tile>('tiles');
  const tilesMap = new Map(allTiles.map(t => [t.h3_index, t]));

  const newObservations: (Observation & { grid_bucket: string })[] = [];
  const tilesToUpdate = new Map<string, Tile>();
  let added = 0;

  // Process observations and create super-local tiles (resolution 9)
  for (const inatObs of inatObservations) {
    if (!inatObs.location) continue;
    if (existingIds.has(String(inatObs.id))) continue;

    const [lat, lng] = inatObs.location.split(',').map(Number);
    if (isNaN(lat) || isNaN(lng)) continue;

    const h3Index = h3.latLngToCell(lat, lng, H3_RESOLUTIONS.SUPER_LOCAL);

    let tile = tilesMap.get(h3Index) || tilesToUpdate.get(h3Index);
    if (!tile) {
      const [centerLat, centerLng] = h3.cellToLatLng(h3Index);
      tile = {
        h3_index: h3Index,
        resolution: H3_RESOLUTIONS.SUPER_LOCAL,
        biome_type: 'unknown' as BiomeType,
        center_lat: centerLat,
        center_lng: centerLng,
        total_observations: 0,
        unique_observers: 0,
        owner_id: null,
        owner_points: 0,
        is_rare: false,
        boundary: computeH3Boundary(h3Index),
        grid_bucket: getGridBucket(centerLat, centerLng)
      };
    }

    const observation = convertINatObservation(inatObs, tile.total_observations, tile.biome_type);
    if (!observation) continue;

    newObservations.push(observation);
    tile.total_observations++;
    tilesToUpdate.set(h3Index, tile);
    added++;
  }

  // Batch write observations
  const CHUNK_SIZE = 500;
  for (let i = 0; i < newObservations.length; i += CHUNK_SIZE) {
    const chunk = newObservations.slice(i, i + CHUNK_SIZE);
    await dbPutMany('observations', chunk);
  }

  // Save super-local tiles
  if (tilesToUpdate.size > 0) {
    await dbPutMany('tiles', Array.from(tilesToUpdate.values()));
  }

  // Update tile scores and ownership
  await updateTileScoresForPlayer(player.id);

  // Build hierarchical tiles (local and regional) from super-local tiles
  await buildHierarchicalTiles();

  await updatePlayerStats(player.id);

  return { added, total: existingObs.length + added };
}

// Build local (res 6) and regional (res 4) tiles from super-local (res 9) tiles
async function buildHierarchicalTiles(): Promise<void> {
  const allTiles = await dbGetAll<Tile>('tiles');
  const superLocalTiles = allTiles.filter(t => t.resolution === H3_RESOLUTIONS.SUPER_LOCAL);

  const localTiles = new Map<string, Tile>();
  const regionalTiles = new Map<string, Tile>();

  // Aggregate super-local tiles into local and regional
  for (const tile of superLocalTiles) {
    // Get local parent (resolution 6)
    const localH3 = getParentCell(tile.h3_index, H3_RESOLUTIONS.LOCAL);
    // Get regional parent (resolution 4)
    const regionalH3 = getParentCell(tile.h3_index, H3_RESOLUTIONS.REGIONAL);

    // Aggregate into local tile
    let localTile = localTiles.get(localH3);
    if (!localTile) {
      const [centerLat, centerLng] = h3.cellToLatLng(localH3);
      localTile = {
        h3_index: localH3,
        resolution: H3_RESOLUTIONS.LOCAL,
        biome_type: 'unknown' as BiomeType,
        center_lat: centerLat,
        center_lng: centerLng,
        total_observations: 0,
        unique_observers: 0,
        owner_id: null,
        owner_points: 0,
        is_rare: false,
        boundary: computeH3Boundary(localH3),
        grid_bucket: getGridBucket(centerLat, centerLng),
        child_tiles_total: 0,
        child_tiles_owned: 0
      };
      localTiles.set(localH3, localTile);
    }
    localTile.total_observations += tile.total_observations;
    localTile.child_tiles_total = (localTile.child_tiles_total || 0) + 1;

    // Aggregate into regional tile
    let regionalTile = regionalTiles.get(regionalH3);
    if (!regionalTile) {
      const [centerLat, centerLng] = h3.cellToLatLng(regionalH3);
      regionalTile = {
        h3_index: regionalH3,
        resolution: H3_RESOLUTIONS.REGIONAL,
        biome_type: 'unknown' as BiomeType,
        center_lat: centerLat,
        center_lng: centerLng,
        total_observations: 0,
        unique_observers: 0,
        owner_id: null,
        owner_points: 0,
        is_rare: false,
        boundary: computeH3Boundary(regionalH3),
        grid_bucket: getGridBucket(centerLat, centerLng),
        child_tiles_total: 0,
        child_tiles_owned: 0
      };
      regionalTiles.set(regionalH3, regionalTile);
    }
    regionalTile.total_observations += tile.total_observations;
  }

  // Compute ownership for local tiles (aggregate scores from super-local children)
  for (const [localH3, localTile] of localTiles) {
    const childTiles = superLocalTiles.filter(t =>
      getParentCell(t.h3_index, H3_RESOLUTIONS.LOCAL) === localH3
    );

    // Aggregate player scores from all child tiles
    const playerScores = new Map<string, { points: number; username: string; pfp?: string; tilesOwned: number }>();

    for (const child of childTiles) {
      if (child.owner_id) {
        const existing = playerScores.get(child.owner_id) || {
          points: 0,
          username: child.owner_username || '',
          pfp: child.owner_pfp,
          tilesOwned: 0
        };
        existing.points += child.owner_points;
        existing.tilesOwned++;
        playerScores.set(child.owner_id, existing);
      }
    }

    // Find player with most points in this area
    let topPlayer: { id: string; points: number; username: string; pfp?: string; tilesOwned: number } | null = null;
    for (const [playerId, data] of playerScores) {
      if (!topPlayer || data.points > topPlayer.points) {
        topPlayer = { id: playerId, ...data };
      }
    }

    if (topPlayer) {
      localTile.owner_id = topPlayer.id;
      localTile.owner_username = topPlayer.username;
      localTile.owner_pfp = topPlayer.pfp;
      localTile.owner_points = topPlayer.points;
      localTile.child_tiles_owned = topPlayer.tilesOwned;
    }

    localTile.unique_observers = playerScores.size;
  }

  // Compute ownership for regional tiles (aggregate from local children)
  for (const [regionalH3, regionalTile] of regionalTiles) {
    const childLocalTiles = Array.from(localTiles.values()).filter(t =>
      getParentCell(t.h3_index, H3_RESOLUTIONS.REGIONAL) === regionalH3
    );

    const playerScores = new Map<string, { points: number; username: string; pfp?: string; tilesOwned: number }>();

    for (const child of childLocalTiles) {
      if (child.owner_id) {
        const existing = playerScores.get(child.owner_id) || {
          points: 0,
          username: child.owner_username || '',
          pfp: child.owner_pfp,
          tilesOwned: 0
        };
        existing.points += child.owner_points;
        existing.tilesOwned++;
        playerScores.set(child.owner_id, existing);
      }
    }

    let topPlayer: { id: string; points: number; username: string; pfp?: string; tilesOwned: number } | null = null;
    for (const [playerId, data] of playerScores) {
      if (!topPlayer || data.points > topPlayer.points) {
        topPlayer = { id: playerId, ...data };
      }
    }

    if (topPlayer) {
      regionalTile.owner_id = topPlayer.id;
      regionalTile.owner_username = topPlayer.username;
      regionalTile.owner_pfp = topPlayer.pfp;
      regionalTile.owner_points = topPlayer.points;
      regionalTile.child_tiles_owned = topPlayer.tilesOwned;
    }

    regionalTile.child_tiles_total = childLocalTiles.length;
    regionalTile.unique_observers = playerScores.size;
  }

  // Save hierarchical tiles
  await dbPutMany('tiles', Array.from(localTiles.values()));
  await dbPutMany('tiles', Array.from(regionalTiles.values()));
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

  // Update super-local tile ownership
  const h3Indices = Array.from(tilePoints.keys());
  for (let i = 0; i < h3Indices.length; i += 100) {
    const batch = h3Indices.slice(i, i + 100);
    await Promise.all(batch.map(h3Index => updateTileOwnership(h3Index)));
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

  // Count only super-local tiles for player ownership
  const superLocalTiles = allTiles.filter(t => t.resolution === H3_RESOLUTIONS.SUPER_LOCAL);

  player.observation_count = playerObs.length;
  player.total_points = playerObs.reduce((sum, o) => sum + o.total_points, 0);
  player.unique_species = new Set(playerObs.map(o => o.taxon_id).filter(Boolean)).size;
  player.tiles_owned = superLocalTiles.filter(t => t.owner_id === playerId).length;

  await dbPut('players', player);
}

// ============================================================================
// Data Access Functions (Zoom-Aware)
// ============================================================================

const observationCache = new Map<string, { data: Observation[]; timestamp: number }>();
const tileCache = new Map<string, { data: Tile[]; timestamp: number }>();
const CACHE_TTL = 5000;

export async function getObservationsInBounds(
  bounds: { north: number; south: number; east: number; west: number },
  limit: number = 100,
  zoom: number = 14
): Promise<Observation[]> {
  // Only show observations at high zoom (very zoomed in)
  if (zoom < MIN_ZOOM_FOR_OBSERVATIONS) {
    return [];
  }

  const cacheKey = `obs_${bounds.north.toFixed(3)},${bounds.south.toFixed(3)},${bounds.east.toFixed(3)},${bounds.west.toFixed(3)},${limit}`;
  const cached = observationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const buckets = getGridBucketsInBounds(bounds);
  let observations: Observation[];

  try {
    observations = await dbGetByGridBuckets<Observation>('observations', buckets);
  } catch {
    observations = await dbGetAll<Observation>('observations');
  }

  const inBounds = observations.filter(obs =>
    obs.latitude >= bounds.south &&
    obs.latitude <= bounds.north &&
    obs.longitude >= bounds.west &&
    obs.longitude <= bounds.east
  );

  inBounds.sort((a, b) => b.total_points - a.total_points);
  const result = inBounds.slice(0, limit);

  observationCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

export async function getTilesInBounds(
  bounds: { north: number; south: number; east: number; west: number },
  limit: number = 300,
  zoom: number = 14
): Promise<Tile[]> {
  // Determine which resolution to show based on zoom
  const { resolution } = getResolutionForZoom(zoom);

  const cacheKey = `tiles_${resolution}_${bounds.north.toFixed(3)},${bounds.south.toFixed(3)},${bounds.east.toFixed(3)},${bounds.west.toFixed(3)},${limit}`;
  const cached = tileCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // Get all tiles and filter by resolution
  let tiles: Tile[];
  try {
    tiles = await dbGetByIndex<Tile>('tiles', 'resolution', resolution);
  } catch {
    const allTiles = await dbGetAll<Tile>('tiles');
    tiles = allTiles.filter(t => t.resolution === resolution);
  }

  // Filter to bounds and with observations
  const inBounds = tiles.filter(tile =>
    tile.total_observations > 0 &&
    tile.center_lat >= bounds.south &&
    tile.center_lat <= bounds.north &&
    tile.center_lng >= bounds.west &&
    tile.center_lng <= bounds.east
  );

  // Sort by observations and limit
  inBounds.sort((a, b) => b.total_observations - a.total_observations);
  const result = inBounds.slice(0, limit);

  // Ensure boundaries exist
  for (const tile of result) {
    if (!tile.boundary) {
      tile.boundary = computeH3Boundary(tile.h3_index);
    }
  }

  tileCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
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
    const resolution = h3.getResolution(h3Index);
    const [centerLat, centerLng] = h3.cellToLatLng(h3Index);
    return {
      tile: {
        h3_index: h3Index,
        resolution,
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

  // Count super-local tiles only for stats
  const superLocalTiles = tiles.filter(t =>
    t.resolution === H3_RESOLUTIONS.SUPER_LOCAL && t.total_observations > 0
  );

  return {
    totalObservations: observations.length,
    totalTiles: superLocalTiles.length,
    totalPlayers: players.length,
    totalSpecies: new Set(observations.map(o => o.taxon_id).filter(Boolean)).size
  };
}

export function clearCaches(): void {
  observationCache.clear();
  tileCache.clear();
}

// ============================================================================
// Migration
// ============================================================================

export async function migrateFromLocalStorage(): Promise<boolean> {
  const migrated = getFromStorage<boolean>('migrated_to_indexeddb_v3', false);
  if (migrated) return false;

  try {
    // Clear old data and rebuild
    setToStorage('migrated_to_indexeddb_v3', true);
    return true;
  } catch (e) {
    console.error('Migration failed:', e);
    return false;
  }
}
