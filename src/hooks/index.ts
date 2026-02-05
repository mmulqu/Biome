import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api/client';
import * as serverApi from '../api/server';
import type { Player, Observation, Tile, TileScore, MapBounds, BiomeType } from '../types';
import { MIN_ZOOM_FOR_OBSERVATIONS } from '../types';

// Extended bounds type with zoom
export interface MapViewState extends MapBounds {
  zoom: number;
}

// ============================================================================
// Players Hook (Multi-user support)
// ============================================================================
export function usePlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [progress, setProgress] = useState<{ fetched: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load players and migrate from localStorage on mount
  useEffect(() => {
    async function init() {
      try {
        await api.migrateFromLocalStorage();
        const result = await api.getTrackedPlayers();
        setPlayers(result);
      } catch (e) {
        console.error('Failed to load players:', e);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const addPlayer = useCallback(async (username: string) => {
    setAdding(true);
    setError(null);
    setProgress(null);
    try {
      const player = await api.addPlayer(username, (fetched, total) => {
        setProgress({ fetched, total });
      });
      if (!player) {
        throw new Error('User not found on iNaturalist');
      }
      // Clear caches after adding new data
      api.clearCaches();
      // Refresh player list
      const updated = await api.getTrackedPlayers();
      setPlayers(updated);
      setProgress(null);
      return player;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to add player';
      setError(msg);
      throw e;
    } finally {
      setAdding(false);
    }
  }, []);

  const removePlayer = useCallback(async (playerId: string) => {
    try {
      await api.removePlayer(playerId);
      api.clearCaches();
      const updated = await api.getTrackedPlayers();
      setPlayers(updated);
    } catch (e) {
      console.error('Failed to remove player:', e);
    }
  }, []);

  const refreshPlayers = useCallback(async () => {
    const result = await api.getTrackedPlayers();
    setPlayers(result);
  }, []);

  return {
    players,
    loading,
    adding,
    progress,
    error,
    addPlayer,
    removePlayer,
    refreshPlayers
  };
}

// ============================================================================
// Observations in Viewport Hook (Performance optimized with zoom awareness)
// ============================================================================
export function useObservationsInBounds(viewState: MapViewState | null, limit: number = 100) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef<string>('');
  const timeoutRef = useRef<number | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    if (!viewState) return;

    // Only show observations at very high zoom (zoomed in)
    if (viewState.zoom < MIN_ZOOM_FOR_OBSERVATIONS) {
      setObservations([]);
      return;
    }

    // Create a key for this fetch to detect stale requests
    const fetchKey = `${viewState.north.toFixed(3)},${viewState.south.toFixed(3)},${viewState.east.toFixed(3)},${viewState.west.toFixed(3)},${viewState.zoom}`;

    // Skip if same as last fetch
    if (fetchKey === lastFetchRef.current) {
      return;
    }

    // Clear pending timeout
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    // Longer debounce at lower zoom levels (more data)
    const debounceMs = viewState.zoom < 12 ? 500 : 300;

    timeoutRef.current = window.setTimeout(async () => {
      abortRef.current = false;
      lastFetchRef.current = fetchKey;
      setLoading(true);

      try {
        const result = await api.getObservationsInBounds(
          {
            north: viewState.north,
            south: viewState.south,
            east: viewState.east,
            west: viewState.west
          },
          limit,
          viewState.zoom
        );

        // Only update if not aborted
        if (!abortRef.current) {
          setObservations(result);
        }
      } catch (e) {
        console.error('Error fetching observations:', e);
      } finally {
        if (!abortRef.current) {
          setLoading(false);
        }
      }
    }, debounceMs);

    return () => {
      abortRef.current = true;
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [viewState, limit]);

  return { observations, loading };
}

// ============================================================================
// Tiles in Viewport Hook (Performance optimized)
// ============================================================================
export function useTilesInBounds(viewState: MapViewState | null, limit: number = 150) {
  const [tiles, setTiles] = useState<(Tile & { boundary?: [number, number][] })[]>([]);
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef<string>('');
  const timeoutRef = useRef<number | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    if (!viewState) return;

    // Tiles are shown at all zoom levels (regional/local/super-local based on zoom)
    const fetchKey = `tiles_${viewState.north.toFixed(3)},${viewState.south.toFixed(3)},${viewState.east.toFixed(3)},${viewState.west.toFixed(3)},${viewState.zoom}`;

    if (fetchKey === lastFetchRef.current) {
      return;
    }

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    const debounceMs = viewState.zoom < 13 ? 500 : 300;

    timeoutRef.current = window.setTimeout(async () => {
      abortRef.current = false;
      lastFetchRef.current = fetchKey;
      setLoading(true);

      try {
        const result = await api.getTilesInBounds(
          {
            north: viewState.north,
            south: viewState.south,
            east: viewState.east,
            west: viewState.west
          },
          limit,
          viewState.zoom
        );

        if (!abortRef.current) {
          setTiles(result);
        }
      } catch (e) {
        console.error('Error fetching tiles:', e);
      } finally {
        if (!abortRef.current) {
          setLoading(false);
        }
      }
    }, debounceMs);

    return () => {
      abortRef.current = true;
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [viewState, limit]);

  return { tiles, loading };
}

// ============================================================================
// Single Tile Hook
// ============================================================================
export function useTile(h3Index: string | null) {
  const [tile, setTile] = useState<Tile | null>(null);
  const [leaderboard, setLeaderboard] = useState<TileScore[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!h3Index) {
      setTile(null);
      setLeaderboard([]);
      setObservations([]);
      return;
    }

    setLoading(true);
    api.getTileDetails(h3Index)
      .then(result => {
        setTile(result.tile);
        setLeaderboard(result.leaderboard);
        setObservations(result.observations);
      })
      .catch(e => {
        console.error('Error fetching tile:', e);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [h3Index]);

  return { tile, leaderboard, observations, loading };
}

// ============================================================================
// Leaderboard Hook
// ============================================================================
export function useLeaderboard() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await api.getLeaderboard();
      setPlayers(result);
    } catch (e) {
      console.error('Error fetching leaderboard:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { players, loading, refresh };
}

// ============================================================================
// Global Stats Hook
// ============================================================================
export function useGlobalStats() {
  const [stats, setStats] = useState<{
    totalObservations: number;
    totalTiles: number;
    totalPlayers: number;
    totalSpecies: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await api.getGlobalStats();
      setStats(result);
    } catch (e) {
      console.error('Error fetching stats:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { stats, loading, refresh };
}

// ============================================================================
// Geolocation Hook
// ============================================================================
export function useGeolocation() {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }

    setLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  }, []);

  return { position, error, loading, requestLocation };
}

// ============================================================================
// Debounced Value Hook (utility)
// ============================================================================
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

// ============================================================================
// Server API Hooks (Multiplayer Features)
// ============================================================================

// Factions Hook
export function useFactions() {
  const [factions, setFactions] = useState<serverApi.Faction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await serverApi.getFactions();
      setFactions(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load factions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { factions, loading, error, refresh };
}

// Server Leaderboard Hook
export function useServerLeaderboard(type: serverApi.LeaderboardType = 'global', limit = 50) {
  const [entries, setEntries] = useState<serverApi.LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await serverApi.getLeaderboard(type, limit);
      setEntries(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, [type, limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, loading, error, refresh };
}

// Activity Feed Hook
export function useActivityFeed(limit = 50) {
  const [activities, setActivities] = useState<serverApi.ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await serverApi.getActivityFeed(limit);
      setActivities(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity feed');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { activities, loading, error, refresh };
}

// Server Game Stats Hook
export function useServerStats() {
  const [stats, setStats] = useState<serverApi.GameStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await serverApi.getGameStats();
      setStats(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { stats, loading, error, refresh };
}

// Current Season Hook
export function useCurrentSeason() {
  const [season, setSeason] = useState<{
    id: number;
    name: string;
    theme: string;
    start_date: string;
    end_date: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    serverApi.getCurrentSeason()
      .then(setSeason)
      .catch(e => console.warn('Failed to load season:', e))
      .finally(() => setLoading(false));
  }, []);

  return { season, loading };
}

// Server Player Hook (for multiplayer profile)
export function useServerPlayer(username: string | null) {
  const [player, setPlayer] = useState<serverApi.ServerPlayer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!username) {
      setPlayer(null);
      return;
    }

    setLoading(true);
    serverApi.getPlayer(username)
      .then(setPlayer)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load player'))
      .finally(() => setLoading(false));
  }, [username]);

  const joinFaction = useCallback(async (factionId: number) => {
    if (!player) return;
    try {
      const updated = await serverApi.joinFaction(player.id, factionId);
      setPlayer(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join faction');
    }
  }, [player]);

  const updateClass = useCallback(async (playerClass: serverApi.ServerPlayer['class']) => {
    if (!player) return;
    try {
      const updated = await serverApi.updatePlayerClass(player.id, playerClass);
      setPlayer(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update class');
    }
  }, [player]);

  const performAction = useCallback(async (
    tileH3Index: string,
    actionType: 'claim' | 'fortify' | 'scout' | 'contest'
  ) => {
    if (!player) return null;
    try {
      const result = await serverApi.performAction({
        player_id: player.id,
        tile_h3_index: tileH3Index,
        action_type: actionType,
      });
      // Refresh player to get updated AP
      const updated = await serverApi.getPlayerById(player.id);
      if (updated) setPlayer(updated);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
      return null;
    }
  }, [player]);

  return { player, loading, error, joinFaction, updateClass, performAction };
}

// Player Quests Hook
export function usePlayerQuests(playerId: number | null) {
  const [quests, setQuests] = useState<serverApi.Quest[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!playerId) {
      setQuests([]);
      return;
    }

    setLoading(true);
    serverApi.getPlayerQuests(playerId)
      .then(setQuests)
      .catch(e => console.warn('Failed to load quests:', e))
      .finally(() => setLoading(false));
  }, [playerId]);

  return { quests, loading };
}

// Player Achievements Hook
export function usePlayerAchievements(playerId: number | null) {
  const [achievements, setAchievements] = useState<serverApi.Achievement[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!playerId) {
      setAchievements([]);
      return;
    }

    setLoading(true);
    serverApi.getPlayerAchievements(playerId)
      .then(setAchievements)
      .catch(e => console.warn('Failed to load achievements:', e))
      .finally(() => setLoading(false));
  }, [playerId]);

  return { achievements, loading };
}

// ============================================================================
// Current User Session Hook (with localStorage persistence)
// ============================================================================
const CURRENT_USER_KEY = 'biome_current_user';

interface StoredUser {
  id: number;
  inat_username: string;
  inat_user_id: number;
}

export function useCurrentUser() {
  const [currentUser, setCurrentUser] = useState<serverApi.ServerPlayer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load user from localStorage and verify on mount
  useEffect(() => {
    async function loadStoredUser() {
      try {
        const stored = localStorage.getItem(CURRENT_USER_KEY);
        if (!stored) {
          setLoading(false);
          return;
        }

        const storedUser: StoredUser = JSON.parse(stored);

        // Verify user still exists and is verified on server
        const player = await serverApi.getPlayer(storedUser.inat_username);

        if (player && player.is_verified) {
          setCurrentUser(player);
        } else {
          // User no longer verified, clear storage
          localStorage.removeItem(CURRENT_USER_KEY);
        }
      } catch (e) {
        console.warn('Failed to restore user session:', e);
        localStorage.removeItem(CURRENT_USER_KEY);
      } finally {
        setLoading(false);
      }
    }

    loadStoredUser();
  }, []);

  // Sign in (called after successful verification)
  const signIn = useCallback((player: serverApi.ServerPlayer) => {
    const storedUser: StoredUser = {
      id: player.id,
      inat_username: player.inat_username,
      inat_user_id: player.inat_user_id,
    };
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(storedUser));
    setCurrentUser(player);
  }, []);

  // Sign out
  const signOut = useCallback(() => {
    localStorage.removeItem(CURRENT_USER_KEY);
    setCurrentUser(null);
  }, []);

  // Refresh current user data from server
  const refresh = useCallback(async () => {
    if (!currentUser) return;

    try {
      const player = await serverApi.getPlayerById(currentUser.id);
      if (player) {
        setCurrentUser(player);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh');
    }
  }, [currentUser]);

  // Join faction
  const joinFaction = useCallback(async (factionId: number) => {
    if (!currentUser) return;
    try {
      const updated = await serverApi.joinFaction(currentUser.id, factionId);
      setCurrentUser(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join faction');
    }
  }, [currentUser]);

  // Update class
  const updateClass = useCallback(async (playerClass: serverApi.ServerPlayer['class']) => {
    if (!currentUser) return;
    try {
      const updated = await serverApi.updatePlayerClass(currentUser.id, playerClass);
      setCurrentUser(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update class');
    }
  }, [currentUser]);

  // Perform tile action
  const performAction = useCallback(async (
    tileH3Index: string,
    actionType: 'claim' | 'fortify' | 'scout' | 'contest'
  ) => {
    if (!currentUser) return null;
    try {
      const result = await serverApi.performAction({
        player_id: currentUser.id,
        tile_h3_index: tileH3Index,
        action_type: actionType,
      });
      // Refresh to get updated AP
      await refresh();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
      return null;
    }
  }, [currentUser, refresh]);

  return {
    currentUser,
    loading,
    error,
    isSignedIn: !!currentUser,
    isVerified: currentUser?.is_verified ?? false,
    signIn,
    signOut,
    refresh,
    joinFaction,
    updateClass,
    performAction,
  };
}

// ============================================================================
// Biome Data Hook
// ============================================================================

// Global biome cache (persists across component re-renders)
const biomeCache = new Map<string, { biome: string; code: number }>();
let biomeCacheLoading = false;

export function useBiomeData(tiles: Tile[]) {
  const [biomeTiles, setBiomeTiles] = useState<Tile[]>(tiles);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tiles || tiles.length === 0) {
      setBiomeTiles([]);
      return;
    }

    // Get H3 indices that need biome data
    const needsLookup = tiles.filter(t =>
      t.biome_type === 'unknown' && !biomeCache.has(t.h3_index)
    );

    // Apply cached biome data
    const applyCache = () => {
      let updatedCount = 0;
      const updated = tiles.map(tile => {
        const cached = biomeCache.get(tile.h3_index);
        if (cached) {
          if (tile.biome_type === 'unknown') {
            updatedCount++;
            return { ...tile, biome_type: cached.biome as BiomeType };
          } else {
            console.log(`[Biome] Tile ${tile.h3_index} already has biome: ${tile.biome_type}`);
          }
        }
        return tile;
      });
      console.log(`[Biome] Applied cache: ${updatedCount} tiles updated, cache size: ${biomeCache.size}`);
      if (updatedCount > 0) {
        console.log(`[Biome] Sample updated tile:`, updated.find(t => t.biome_type !== 'unknown'));
      }
      setBiomeTiles(updated);
    };

    // If we have nothing to look up, just apply cache
    if (needsLookup.length === 0) {
      applyCache();
      return;
    }

    // Fetch biome data from server
    const fetchBiomes = async () => {
      if (biomeCacheLoading) {
        // Wait and retry
        setTimeout(applyCache, 500);
        return;
      }

      setLoading(true);
      biomeCacheLoading = true;

      try {
        const h3Indices = needsLookup.map(t => t.h3_index);
        console.log(`[Biome] Looking up ${h3Indices.length} tiles, sample:`, h3Indices.slice(0, 3));

        const biomeData = await serverApi.lookupBiomes(h3Indices);
        const foundCount = Object.keys(biomeData).length;
        console.log(`[Biome] Server returned ${foundCount} biome records`);

        // Update cache
        for (const [h3, data] of Object.entries(biomeData)) {
          biomeCache.set(h3, data);
        }

        // Apply updated cache
        applyCache();
      } catch (e) {
        console.warn('Failed to fetch biome data:', e);
        setBiomeTiles(tiles);
      } finally {
        setLoading(false);
        biomeCacheLoading = false;
      }
    };

    fetchBiomes();
  }, [tiles]);

  return { tiles: biomeTiles, loading };
}
