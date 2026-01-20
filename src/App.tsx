import { useState, useCallback, useMemo } from 'react';
import GameMap from './components/GameMap';
import { PlayerStats, TileInfo, LeaderboardPanel, LoginPanel, ScoringInfo } from './components/Sidebar';
import { useAuth, useTiles, useTile, useSync, usePlayerObservations, useGeolocation } from './hooks';
import type { MapBounds } from './types';

export default function App() {
  const { isAuthenticated, player, loading: authLoading, login, logout, refreshPlayer } = useAuth();
  const { sync, syncing, progress, lastSync } = useSync();
  const { position, requestLocation } = useGeolocation();

  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  // Fetch tiles for current viewport
  const { tiles, loading: tilesLoading } = useTiles(bounds);

  // Fetch selected tile details
  const { tile: selectedTileData, leaderboard: tileLeaderboard, observations: tileObservations } = useTile(selectedTile);

  // Fetch current player's observations for display
  const { observations: playerObservations } = usePlayerObservations(player?.id || null);

  // All observations to show on map
  const mapObservations = useMemo(() => {
    const obsMap = new Map();

    // Add tile observations
    tileObservations.forEach(obs => obsMap.set(obs.id, obs));

    // Add player's observations
    playerObservations.forEach(obs => obsMap.set(obs.id, obs));

    return Array.from(obsMap.values());
  }, [tileObservations, playerObservations]);

  const handleBoundsChange = useCallback((newBounds: MapBounds) => {
    setBounds(newBounds);
  }, []);

  const handleTileSelect = useCallback((h3Index: string | null) => {
    setSelectedTile(h3Index);
  }, []);

  const handleSync = useCallback(async () => {
    try {
      await sync();
      await refreshPlayer();
    } catch (error) {
      console.error('Sync failed:', error);
    }
  }, [sync, refreshPlayer]);

  const handleLogin = useCallback(async (username: string) => {
    const result = await login(username);
    if (result) {
      // After login, try to sync observations
      try {
        await sync();
        await refreshPlayer();
      } catch (e) {
        console.error('Initial sync failed:', e);
      }
    }
    return result;
  }, [login, sync, refreshPlayer]);

  // Get initial map center from player's observations or geolocation
  const initialCenter = useMemo((): [number, number] | undefined => {
    if (playerObservations.length > 0) {
      const recent = playerObservations[0];
      return [recent.latitude, recent.longitude];
    }
    if (position) {
      return [position.lat, position.lng];
    }
    return undefined;
  }, [playerObservations, position]);

  if (authLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-icon">🌿</div>
          <div className="loading-text">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Sidebar */}
      <div className="sidebar">
        {/* Header */}
        <div className="sidebar-header">
          <div className="logo">
            <span className="logo-icon">🌿</span>
            <div className="logo-text">
              <h1>BIOME</h1>
              <p>Citizen Science Territory Game</p>
            </div>
          </div>
        </div>

        <div className="sidebar-content">
          {isAuthenticated && player ? (
            <>
              <PlayerStats
                player={player}
                onSync={handleSync}
                syncing={syncing}
              />

              {progress && (
                <div className="sync-progress">
                  Fetching observations... {progress.fetched} / {progress.total}
                </div>
              )}

              {lastSync && !syncing && (
                <div className="sync-result">
                  Synced {lastSync.total.toLocaleString()} observations ({lastSync.added} new)
                </div>
              )}

              <LeaderboardPanel currentPlayerId={player.id} />

              <button
                onClick={() => setShowInfo(!showInfo)}
                className="btn btn-secondary"
              >
                {showInfo ? 'Hide Scoring Info' : 'How Scoring Works'}
              </button>

              {showInfo && <ScoringInfo />}

              <button
                onClick={logout}
                className="btn btn-logout"
              >
                Logout
              </button>
            </>
          ) : (
            <LoginPanel onLogin={handleLogin} />
          )}
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          <a
            href="https://www.inaturalist.org"
            target="_blank"
            rel="noopener noreferrer"
          >
            Powered by iNaturalist
          </a>
        </div>
      </div>

      {/* Map */}
      <div className="map-container">
        <GameMap
          observations={mapObservations}
          tiles={tiles}
          selectedTile={selectedTile}
          onTileSelect={handleTileSelect}
          onBoundsChange={handleBoundsChange}
          currentPlayerId={player?.id}
          initialCenter={initialCenter}
        />

        {/* Selected tile panel */}
        {selectedTileData && (
          <div className="tile-panel">
            <TileInfo
              tile={selectedTileData}
              leaderboard={tileLeaderboard}
              observations={tileObservations}
              onClose={() => setSelectedTile(null)}
            />
          </div>
        )}

        {/* Loading indicator */}
        {tilesLoading && (
          <div className="map-loading">
            Loading tiles...
          </div>
        )}

        {/* Locate me button */}
        <button
          onClick={requestLocation}
          className="locate-btn"
          title="Find my location"
        >
          📍
        </button>
      </div>
    </div>
  );
}
