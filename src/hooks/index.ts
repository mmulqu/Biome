import { useState, useEffect, useCallback, useRef } from 'react';
import * as api from '../api/client';
import type { Player, Observation, Tile, TileScore, MapBounds } from '../types';

// ============================================================================
// Auth Hook
// ============================================================================
export function useAuth() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load player from storage on mount
  useEffect(() => {
    const stored = api.getCurrentPlayer();
    setPlayer(stored);
    setLoading(false);
  }, []);

  const login = useCallback(async (username: string) => {
    setLoading(true);
    setError(null);
    try {
      const player = await api.loginWithUsername(username);
      if (!player) {
        throw new Error('User not found on iNaturalist');
      }
      setPlayer(player);
      return player;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Login failed';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    api.logout();
    setPlayer(null);
  }, []);

  const refreshPlayer = useCallback(() => {
    const stored = api.getCurrentPlayer();
    setPlayer(stored);
  }, []);

  return {
    player,
    loading,
    error,
    isAuthenticated: !!player,
    login,
    logout,
    refreshPlayer
  };
}

// ============================================================================
// Sync Hook
// ============================================================================
export function useSync() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<{ added: number; updated: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const result = await api.syncObservations();
      setLastSync(result);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed';
      setError(msg);
      throw e;
    } finally {
      setSyncing(false);
    }
  }, []);

  return {
    sync,
    syncing,
    lastSync,
    error
  };
}

// ============================================================================
// Tiles Hook
// ============================================================================
export function useTiles(bounds: MapBounds | null) {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [loading, setLoading] = useState(false);
  const boundsRef = useRef<MapBounds | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!bounds) return;

    // Debounce tile fetching
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    // Check if bounds changed significantly
    const prev = boundsRef.current;
    if (prev &&
        Math.abs(prev.north - bounds.north) < 0.001 &&
        Math.abs(prev.south - bounds.south) < 0.001 &&
        Math.abs(prev.east - bounds.east) < 0.001 &&
        Math.abs(prev.west - bounds.west) < 0.001) {
      return;
    }

    timeoutRef.current = window.setTimeout(() => {
      boundsRef.current = bounds;
      setLoading(true);

      try {
        const result = api.getTilesInBounds(bounds);
        setTiles(result);
      } catch (e) {
        console.error('Error fetching tiles:', e);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [bounds]);

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
    try {
      const result = api.getTileDetails(h3Index);
      setTile(result.tile);
      setLeaderboard(result.leaderboard);
      setObservations(result.observations);
    } catch (e) {
      console.error('Error fetching tile:', e);
    } finally {
      setLoading(false);
    }
  }, [h3Index]);

  return { tile, leaderboard, observations, loading };
}

// ============================================================================
// Player Observations Hook
// ============================================================================
export function usePlayerObservations(playerId: string | null) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!playerId) {
      setObservations([]);
      return;
    }

    setLoading(true);
    try {
      const result = api.getPlayerObservations(playerId);
      setObservations(result);
    } catch (e) {
      console.error('Error fetching observations:', e);
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  // Refresh when storage changes
  useEffect(() => {
    const handleStorage = () => {
      if (playerId) {
        const result = api.getPlayerObservations(playerId);
        setObservations(result);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [playerId]);

  return { observations, loading };
}

// ============================================================================
// Leaderboard Hook
// ============================================================================
export function useLeaderboard(type: 'global' | 'tiles' | 'explorer' | 'observations' = 'global') {
  const [entries, setEntries] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    try {
      const result = api.getLeaderboard(type);
      setEntries(result);
    } catch (e) {
      console.error('Error fetching leaderboard:', e);
    } finally {
      setLoading(false);
    }
  }, [type]);

  return { entries, loading };
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
