import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api/client';
import type { Player, Observation, Tile, TileScore, MapBounds } from '../types';
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
