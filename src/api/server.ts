/**
 * Biome Server API Client
 * Connects to the Cloudflare Worker API for multiplayer features
 */

const API_BASE = import.meta.env.DEV
  ? 'http://localhost:8787/api'
  : '/api';

// ============================================
// Types
// ============================================

export interface ServerPlayer {
  id: number;
  inat_user_id: number;
  inat_username: string;
  inat_display_name: string | null;
  inat_icon_url: string | null;
  is_verified: boolean;
  class: 'generalist' | 'birder' | 'botanist' | 'bug_hunter' | 'mycologist';
  faction_id: number | null;
  squad_id: number | null;
  total_points: number;
  total_observations: number;
  tiles_owned: number;
  current_streak: number;
  season_points: number;
  action_points: number;
  title: string | null;
  nameplate: string | null;
  avatar_frame: string | null;
  created_at: string;
  updated_at: string;
}

export interface Faction {
  id: number;
  name: string;
  color: string;
  description: string;
  member_count?: number;
  tiles_owned?: number;
}

export interface ServerTile {
  id: number;
  h3_index: string;
  resolution: number;
  biome_type: string;
  tile_type: string;
  state: 'neutral' | 'claimed' | 'fortified' | 'contested';
  owner_id: number | null;
  owner_faction_id: number | null;
  capture_progress: number;
  defense_strength: number;
  contester_id: number | null;
  contest_progress: number;
  total_observations: number;
  unique_species: number;
}

export interface ActionResult {
  success: boolean;
  action_type: string;
  ap_spent: number;
  ap_remaining: number;
  progress_added: number;
  result: Record<string, unknown>;
}

export interface Quest {
  id: number;
  name: string;
  description: string;
  quest_type: 'daily' | 'weekly' | 'seasonal';
  requirements: string;
  rewards: string;
  progress?: number;
  target?: number;
  is_complete?: boolean;
}

export interface Achievement {
  id: number;
  name: string;
  description: string;
  category: string;
  tier: number;
  unlocked_at?: string;
}

export interface LeaderboardEntry {
  id: number;
  inat_username: string;
  inat_display_name: string | null;
  inat_icon_url: string | null;
  total_points?: number;
  season_points?: number;
  tiles_owned?: number;
  total_observations?: number;
  faction_id: number | null;
  class: string;
}

export interface ActivityLogEntry {
  id: number;
  event_type: string;
  player_id: number | null;
  tile_id: number | null;
  headline: string;
  details: string | null;
  created_at: string;
}

export interface GameStats {
  total_players: number;
  claimed_tiles: number;
  total_observations: number;
  faction_territories: Array<{ name: string; color: string; tiles: number }>;
}

// ============================================
// API Client
// ============================================

async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }

  return data as T;
}

// ============================================
// Health Check
// ============================================

export async function checkHealth(): Promise<{ status: string; timestamp: string }> {
  return apiCall('/health');
}

// ============================================
// Players
// ============================================

export async function getPlayer(username: string): Promise<ServerPlayer | null> {
  try {
    return await apiCall<ServerPlayer>(`/players/${username}`);
  } catch {
    return null;
  }
}

export async function getPlayerById(id: number): Promise<ServerPlayer | null> {
  try {
    return await apiCall<ServerPlayer>(`/players/id/${id}`);
  } catch {
    return null;
  }
}

export async function registerPlayer(data: {
  inat_user_id: number;
  inat_username: string;
  inat_display_name?: string;
  inat_icon_url?: string;
}): Promise<ServerPlayer> {
  return apiCall<ServerPlayer>('/players', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePlayerClass(
  playerId: number,
  playerClass: ServerPlayer['class']
): Promise<ServerPlayer> {
  return apiCall<ServerPlayer>(`/players/${playerId}/class`, {
    method: 'PUT',
    body: JSON.stringify({ class: playerClass }),
  });
}

export async function joinFaction(
  playerId: number,
  factionId: number
): Promise<ServerPlayer> {
  return apiCall<ServerPlayer>(`/players/${playerId}/faction`, {
    method: 'PUT',
    body: JSON.stringify({ faction_id: factionId }),
  });
}

// ============================================
// Verification
// ============================================

export async function generateVerificationCode(
  playerId: number
): Promise<{ verification_code: string; instructions: string }> {
  return apiCall(`/players/${playerId}/verification/generate`, {
    method: 'POST',
  });
}

export async function verifyPlayer(
  playerId: number
): Promise<{ verified: boolean; player?: ServerPlayer; message?: string }> {
  return apiCall(`/players/${playerId}/verification/verify`, {
    method: 'POST',
  });
}

// ============================================
// Observations
// ============================================

export interface ObservationSyncData {
  inat_observation_id: number;
  latitude: number;
  longitude: number;
  h3_index: string;
  taxon_id?: number;
  taxon_name?: string;
  taxon_common_name?: string;
  taxon_iconic_group?: string;
  taxon_family?: string;
  quality_grade: string;
  observed_at: string;
  photo_url?: string;
}

export async function syncObservations(
  playerId: number,
  observations: ObservationSyncData[]
): Promise<{ synced: number; skipped: number; ap_earned: number }> {
  return apiCall(`/players/${playerId}/observations/sync`, {
    method: 'POST',
    body: JSON.stringify({ observations }),
  });
}

export async function getPlayerObservations(
  playerId: number,
  limit = 100,
  offset = 0
): Promise<unknown[]> {
  return apiCall(`/players/${playerId}/observations?limit=${limit}&offset=${offset}`);
}

// ============================================
// Tiles
// ============================================

export async function getTile(h3Index: string): Promise<ServerTile | null> {
  try {
    return await apiCall<ServerTile>(`/tiles/${h3Index}`);
  } catch {
    return null;
  }
}

export async function getTiles(h3Indices: string[]): Promise<ServerTile[]> {
  if (h3Indices.length === 0) return [];
  return apiCall(`/tiles?h3_indices=${h3Indices.join(',')}`);
}

export async function getOrCreateTile(data: {
  h3_index: string;
  resolution: number;
  biome_type?: string;
}): Promise<ServerTile> {
  return apiCall('/tiles', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getPlayerTiles(playerId: number): Promise<ServerTile[]> {
  return apiCall(`/players/${playerId}/tiles`);
}

// ============================================
// Actions
// ============================================

export async function performAction(data: {
  player_id: number;
  tile_h3_index: string;
  action_type: 'claim' | 'fortify' | 'scout' | 'contest';
}): Promise<ActionResult> {
  return apiCall('/actions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ============================================
// Quests
// ============================================

export async function getPlayerQuests(playerId: number): Promise<Quest[]> {
  return apiCall(`/players/${playerId}/quests`);
}

export async function updateQuestProgress(
  playerId: number,
  questId: number,
  progress: number
): Promise<{ progress: number; target: number; is_complete: boolean }> {
  return apiCall(`/players/${playerId}/quests/${questId}/progress`, {
    method: 'POST',
    body: JSON.stringify({ progress }),
  });
}

// ============================================
// Achievements
// ============================================

export async function getPlayerAchievements(playerId: number): Promise<Achievement[]> {
  return apiCall(`/players/${playerId}/achievements`);
}

export async function checkAchievements(
  playerId: number
): Promise<{ newly_unlocked: string[] }> {
  return apiCall(`/players/${playerId}/achievements/check`, {
    method: 'POST',
  });
}

// ============================================
// Factions
// ============================================

export async function getFactions(): Promise<Faction[]> {
  return apiCall('/factions');
}

export async function getFaction(
  factionId: number
): Promise<Faction & { top_members: LeaderboardEntry[] }> {
  return apiCall(`/factions/${factionId}`);
}

// ============================================
// Leaderboards
// ============================================

export type LeaderboardType = 'global' | 'season' | 'tiles' | 'observations' | 'factions';

export async function getLeaderboard(
  type: LeaderboardType,
  limit = 50
): Promise<LeaderboardEntry[]> {
  return apiCall(`/leaderboards/${type}?limit=${limit}`);
}

// ============================================
// Activity Feed
// ============================================

export async function getActivityFeed(
  limit = 50,
  globalOnly = true
): Promise<ActivityLogEntry[]> {
  return apiCall(`/activity?limit=${limit}&global=${globalOnly}`);
}

// ============================================
// Stats
// ============================================

export async function getGameStats(): Promise<GameStats> {
  return apiCall('/stats');
}

// ============================================
// Current Season
// ============================================

export async function getCurrentSeason(): Promise<{
  id: number;
  name: string;
  theme: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}> {
  return apiCall('/seasons/current');
}
