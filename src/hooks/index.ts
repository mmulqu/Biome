import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api/client';
import type { Player, Observation, Tile, TileScore, MapBounds } from '../types';

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
// Observations in Viewport Hook (Performance optimized)
// ============================================================================
export function useObservationsInBounds(bounds: MapBounds | null, limit: number = 200) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(false);
  const boundsRef = useRef<MapBounds | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!bounds) return;

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    // Check if bounds changed significantly
    const prev = boundsRef.current;
    if (prev &&
        Math.abs(prev.north - bounds.north) < 0.002 &&
        Math.abs(prev.south - bounds.south) < 0.002 &&
        Math.abs(prev.east - bounds.east) < 0.002 &&
        Math.abs(prev.west - bounds.west) < 0.002) {
      return;
    }

    timeoutRef.current = window.setTimeout(async () => {
      boundsRef.current = bounds;
      setLoading(true);
      try {
        const result = await api.getObservationsInBounds(bounds, limit);
        setObservations(result);
      } catch (e) {
        console.error('Error fetching observations:', e);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [bounds, limit]);

  return { observations, loading };
}

// ============================================================================
// Tiles with Data Hook
// ============================================================================
export function useTilesWithData() {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getTilesWithData();
      setTiles(result);
    } catch (e) {
      console.error('Error fetching tiles:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { tiles, loading, refresh };
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
