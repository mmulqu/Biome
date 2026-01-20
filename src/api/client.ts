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

// Storage helpers
function getStorageKey(key: string): string {
  return `${STORAGE_KEY_PREFIX}${key}`;
}

function getFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = localStorage.getItem(getStorageKey(key));
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Error reading from storage:', e);
  }
  return defaultValue;
}

function setToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(getStorageKey(key), JSON.stringify(value));
  } catch (e) {
    console.error('Error writing to storage:', e);
  }
}

// Calculate data gap multiplier based on tile observation count
function calculateDataGapMultiplier(observationCount: number): number {
  for (const threshold of SCORING.DATA_GAP_THRESHOLDS) {
    if (observationCount <= threshold.max) {
      return threshold.multiplier;
    }
  }
  return 0.8;
}

// Check if taxon matches biome bonus taxa
function calculateTaxaMatchMultiplier(biomeType: BiomeType, iconicTaxon: IconicTaxon): number {
  const bonusTaxa = BIOME_BONUS_TAXA[biomeType] || [];
  return bonusTaxa.includes(iconicTaxon) ? SCORING.TAXA_MATCH_MULTIPLIER : 1.0;
}

// Convert iNat observation to game observation
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
    SCORING.BASE_POINTS *
    taxaMatchMultiplier *
    dataGapMultiplier *
    researchGradeBonus
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

// Fetch ALL observations for a user with pagination
export async function fetchAllObservationsForUser(
  username: string,
  onProgress?: (fetched: number, total: number) => void,
  maxPages: number = 50 // Safety limit: 50 pages * 200 = 10,000 observations max
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

    // Check if we've fetched all observations
    if (allObservations.length >= totalResults || response.results.length < 200) {
      break;
    }

    page++;

    // Small delay to be nice to the API
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return allObservations;
}

export async function fetchObservationsInBounds(
  bounds: { north: number; south: number; east: number; west: number },
  page: number = 1,
  perPage: number = 200
): Promise<INatObservationsResponse> {
  const url = new URL(`${INAT_API_BASE}/observations`);
  url.searchParams.set('nelat', String(bounds.north));
  url.searchParams.set('nelng', String(bounds.east));
  url.searchParams.set('swlat', String(bounds.south));
  url.searchParams.set('swlng', String(bounds.west));
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

// ============================================================================
// Local Game State Management
// ============================================================================

export function getCurrentPlayer(): Player | null {
  return getFromStorage<Player | null>('current_player', null);
}

export function setCurrentPlayer(player: Player | null): void {
  setToStorage('current_player', player);
}

export function getStoredObservations(): Observation[] {
  return getFromStorage<Observation[]>('observations', []);
}

export function setStoredObservations(observations: Observation[]): void {
  setToStorage('observations', observations);
}

export function getTileData(): Record<string, Tile> {
  return getFromStorage<Record<string, Tile>>('tiles', {});
}

export function setTileData(tiles: Record<string, Tile>): void {
  setToStorage('tiles', tiles);
}

export function getTileScores(): Record<string, TileScore[]> {
  return getFromStorage<Record<string, TileScore[]>>('tile_scores', {});
}

export function setTileScores(scores: Record<string, TileScore[]>): void {
  setToStorage('tile_scores', scores);
}

// ============================================================================
// Game Logic Functions
// ============================================================================

export async function loginWithUsername(username: string): Promise<Player | null> {
  const user = await fetchUserByUsername(username);
  if (!user) return null;

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

  // Load existing stats if any
  const existingPlayer = getCurrentPlayer();
  if (existingPlayer && existingPlayer.id === player.id) {
    player.total_points = existingPlayer.total_points;
    player.tiles_owned = existingPlayer.tiles_owned;
    player.observation_count = existingPlayer.observation_count;
    player.unique_species = existingPlayer.unique_species;
    player.data_deserts_pioneered = existingPlayer.data_deserts_pioneered;
  }

  setCurrentPlayer(player);
  return player;
}

export function logout(): void {
  setCurrentPlayer(null);
}

export async function syncObservations(
  onProgress?: (fetched: number, total: number) => void
): Promise<{ added: number; updated: number; total: number }> {
  const player = getCurrentPlayer();
  if (!player) throw new Error('Not logged in');

  // Fetch ALL observations from iNat with pagination
  const allINatObs = await fetchAllObservationsForUser(player.username, onProgress);

  const existingObs = getStoredObservations();
  const existingIds = new Set(existingObs.map(o => o.id));
  const tiles = getTileData();
  const tileScores = getTileScores();

  let added = 0;
  let updated = 0;

  for (const inatObs of allINatObs) {
    if (!inatObs.location) continue;

    const [lat, lng] = inatObs.location.split(',').map(Number);
    const h3Index = h3.latLngToCell(lat, lng, H3_RESOLUTION);

    // Get or create tile
    if (!tiles[h3Index]) {
      const [centerLat, centerLng] = h3.cellToLatLng(h3Index);
      tiles[h3Index] = {
        h3_index: h3Index,
        biome_type: 'unknown',
        center_lat: centerLat,
        center_lng: centerLng,
        total_observations: 0,
        unique_observers: 0,
        owner_id: null,
        owner_points: 0,
        is_rare: false
      };
    }

    const tile = tiles[h3Index];
    const observation = convertINatObservation(inatObs, tile.total_observations, tile.biome_type);
    if (!observation) continue;

    if (existingIds.has(observation.id)) {
      // Update existing observation
      const idx = existingObs.findIndex(o => o.id === observation.id);
      if (idx >= 0) {
        existingObs[idx] = observation;
        updated++;
      }
    } else {
      // Add new observation
      existingObs.push(observation);
      added++;

      // Update tile stats
      tile.total_observations++;

      // Check if this was a data desert (first observation)
      if (tile.total_observations === 1) {
        player.data_deserts_pioneered++;
      }
    }

    // Update tile scores for this player
    if (!tileScores[h3Index]) {
      tileScores[h3Index] = [];
    }

    let playerScore = tileScores[h3Index].find(s => s.player_id === player.id);
    if (!playerScore) {
      playerScore = {
        h3_index: h3Index,
        player_id: player.id,
        username: player.username,
        pfp_url: player.pfp_url,
        total_points: 0,
        observation_count: 0
      };
      tileScores[h3Index].push(playerScore);
    }
    playerScore.total_points += observation.total_points;
    playerScore.observation_count++;

    // Sort scores and update owner
    tileScores[h3Index].sort((a, b) => b.total_points - a.total_points);
    const topScorer = tileScores[h3Index][0];
    if (topScorer) {
      tile.owner_id = topScorer.player_id;
      tile.owner_username = topScorer.username;
      tile.owner_pfp = topScorer.pfp_url;
      tile.owner_points = topScorer.total_points;
    }
  }

  // Calculate player stats
  const playerObs = existingObs.filter(o => o.player_id === player.id);
  player.observation_count = playerObs.length;
  player.total_points = playerObs.reduce((sum, o) => sum + o.total_points, 0);
  player.unique_species = new Set(playerObs.map(o => o.taxon_id).filter(Boolean)).size;
  player.tiles_owned = Object.values(tiles).filter(t => t.owner_id === player.id).length;

  // Save everything
  setStoredObservations(existingObs);
  setTileData(tiles);
  setTileScores(tileScores);
  setCurrentPlayer(player);

  return { added, updated, total: player.observation_count };
}

// Get tile details including leaderboard
export function getTileDetails(h3Index: string): {
  tile: Tile | null;
  leaderboard: TileScore[];
  observations: Observation[];
} {
  const tiles = getTileData();
  const tileScores = getTileScores();
  const allObs = getStoredObservations();

  const tile = tiles[h3Index] || null;
  const leaderboard = tileScores[h3Index] || [];
  const observations = allObs.filter(o => o.h3_index === h3Index);

  // If tile doesn't exist, create a placeholder
  if (!tile) {
    const [centerLat, centerLng] = h3.cellToLatLng(h3Index);
    return {
      tile: {
        h3_index: h3Index,
        biome_type: 'unknown',
        center_lat: centerLat,
        center_lng: centerLng,
        total_observations: 0,
        unique_observers: 0,
        owner_id: null,
        owner_points: 0,
        is_rare: false
      },
      leaderboard: [],
      observations: []
    };
  }

  return { tile, leaderboard, observations };
}

// Get tiles in bounds
export function getTilesInBounds(bounds: { north: number; south: number; east: number; west: number }): Tile[] {
  const tiles = getTileData();
  const result: Tile[] = [];

  // Sample points within bounds to find hexes
  const step = 0.005;
  const seenHexes = new Set<string>();

  for (let lat = bounds.south; lat <= bounds.north; lat += step) {
    for (let lng = bounds.west; lng <= bounds.east; lng += step) {
      const h3Index = h3.latLngToCell(lat, lng, H3_RESOLUTION);
      if (!seenHexes.has(h3Index)) {
        seenHexes.add(h3Index);

        if (tiles[h3Index]) {
          result.push(tiles[h3Index]);
        } else {
          // Create empty tile
          const [centerLat, centerLng] = h3.cellToLatLng(h3Index);
          result.push({
            h3_index: h3Index,
            biome_type: 'unknown',
            center_lat: centerLat,
            center_lng: centerLng,
            total_observations: 0,
            unique_observers: 0,
            owner_id: null,
            owner_points: 0,
            is_rare: false
          });
        }
      }

      if (seenHexes.size >= 300) break;
    }
    if (seenHexes.size >= 300) break;
  }

  return result;
}

// Get observations for a player
export function getPlayerObservations(playerId: string): Observation[] {
  const allObs = getStoredObservations();
  return allObs.filter(o => o.player_id === playerId);
}

// Get global leaderboard
export function getLeaderboard(_type: 'global' | 'tiles' | 'explorer' | 'observations' = 'global'): Player[] {
  // In a real app, this would aggregate from all players
  // For now, just return current player if exists
  const player = getCurrentPlayer();
  if (!player) return [];
  return [player];
}
