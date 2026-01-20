import { useState, useCallback } from 'react';
import GameMap from './components/GameMap';
import { AddPlayerPanel, PlayerList, GlobalStats, TileInfo, ScoringInfo } from './components/Sidebar';
import { usePlayers, useTilesWithData, useTile, useObservationsInBounds, useGlobalStats, useGeolocation } from './hooks';
import type { MapBounds } from './types';

export default function App() {
  const { players, loading: playersLoading, adding, progress, error, addPlayer, removePlayer, refreshPlayers } = usePlayers();
  const { tiles, refresh: refreshTiles } = useTilesWithData();
  const { stats, refresh: refreshStats } = useGlobalStats();
  const { position, requestLocation } = useGeolocation();

  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  // Fetch observations only in current viewport (performance optimization)
  const { observations } = useObservationsInBounds(bounds, 300);

  // Fetch selected tile details
  const { tile: selectedTileData, leaderboard: tileLeaderboard, observations: tileObservations } = useTile(selectedTile);

  const handleBoundsChange = useCallback((newBounds: MapBounds) => {
    setBounds(newBounds);
  }, []);

  const handleTileSelect = useCallback((h3Index: string | null) => {
    setSelectedTile(h3Index);
  }, []);

  const handleAddPlayer = useCallback(async (username: string) => {
    const result = await addPlayer(username);
    if (result) {
      // Refresh data after adding player
      await refreshTiles();
      await refreshStats();
    }
    return result;
  }, [addPlayer, refreshTiles, refreshStats]);

  const handleRemovePlayer = useCallback(async (playerId: string) => {
    await removePlayer(playerId);
    await refreshPlayers();
  }, [removePlayer, refreshPlayers]);

  // Get initial map center from first observation or geolocation
  const initialCenter: [number, number] | undefined =
    observations.length > 0
      ? [observations[0].latitude, observations[0].longitude]
      : position
        ? [position.lat, position.lng]
        : undefined;

  if (playersLoading) {
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
          {/* Global Stats */}
          <GlobalStats stats={stats} />

          {/* Add Player Form */}
          <AddPlayerPanel
            onAddPlayer={handleAddPlayer}
            adding={adding}
            progress={progress}
            error={error}
          />

          {/* Player Leaderboard */}
          <PlayerList
            players={players}
            onRemovePlayer={handleRemovePlayer}
          />

          {/* How it works button */}
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="btn btn-secondary"
          >
            {showInfo ? 'Hide Scoring Info' : 'How Scoring Works'}
          </button>

          {showInfo && <ScoringInfo />}
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
          observations={observations}
          tiles={tiles}
          selectedTile={selectedTile}
          onTileSelect={handleTileSelect}
          onBoundsChange={handleBoundsChange}
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

        {/* Observation count indicator */}
        <div className="map-info">
          {observations.length > 0 && `${observations.length} observations in view`}
        </div>

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
