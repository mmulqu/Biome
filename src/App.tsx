import { useState, useCallback } from 'react';
import GameMap from './components/GameMap';
import { AddPlayerPanel, PlayerList, GlobalStats, TileInfo, ScoringInfo } from './components/Sidebar';
import { usePlayers, useTilesInBounds, useTile, useObservationsInBounds, useGlobalStats, useGeolocation, type MapViewState } from './hooks';
import { MIN_ZOOM_FOR_OBSERVATIONS, getResolutionForZoom } from './types';

export default function App() {
  const { players, loading: playersLoading, adding, progress, error, addPlayer, removePlayer } = usePlayers();
  const { stats, refresh: refreshStats } = useGlobalStats();
  const { position, requestLocation } = useGeolocation();

  // View state with zoom level for smart data loading
  const [viewState, setViewState] = useState<MapViewState | null>(null);
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  // Fetch tiles and observations only in current viewport (zoom-aware)
  const { tiles } = useTilesInBounds(viewState, 150);
  const { observations } = useObservationsInBounds(viewState, 100);

  // Fetch selected tile details
  const { tile: selectedTileData, leaderboard: tileLeaderboard, observations: tileObservations } = useTile(selectedTile);

  const handleViewStateChange = useCallback((newViewState: MapViewState) => {
    setViewState(newViewState);
  }, []);

  const handleTileSelect = useCallback((h3Index: string | null) => {
    setSelectedTile(h3Index);
  }, []);

  const handleAddPlayer = useCallback(async (username: string) => {
    const result = await addPlayer(username);
    if (result) {
      await refreshStats();
    }
    return result;
  }, [addPlayer, refreshStats]);

  const handleRemovePlayer = useCallback(async (playerId: string) => {
    await removePlayer(playerId);
    await refreshStats();
  }, [removePlayer, refreshStats]);

  // Get initial map center from geolocation or default
  const initialCenter: [number, number] | undefined =
    position ? [position.lat, position.lng] : undefined;

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
          onViewStateChange={handleViewStateChange}
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

        {/* Map info indicator - shows current tile level and observation hint */}
        {viewState && (
          <div className="map-info">
            {(() => {
              const { type } = getResolutionForZoom(viewState.zoom);
              const levelName = type === 'regional' ? 'Regional' : type === 'local' ? 'Local' : 'Super Local';
              const tileCount = tiles.length;
              const obsCount = observations.length;

              if (viewState.zoom < MIN_ZOOM_FOR_OBSERVATIONS) {
                return `${levelName} tiles (${tileCount}) | Zoom in for observations`;
              }
              return `${levelName} tiles (${tileCount}) | ${obsCount} observations`;
            })()}
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
