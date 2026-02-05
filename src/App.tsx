import { useState, useCallback } from 'react';
import GameMap from './components/GameMap';
import { AddPlayerPanel, PlayerList, GlobalStats, TileInfo, ScoringInfo, VerificationPanel } from './components/Sidebar';
import { usePlayers, useTilesInBounds, useTile, useObservationsInBounds, useGlobalStats, useGeolocation, useCurrentUser, useFactions, useBiomeData, type MapViewState } from './hooks';
import { MIN_ZOOM_FOR_OBSERVATIONS, getResolutionForZoom } from './types';
import type { ServerPlayer } from './api/server';

// ============================================================================
// Current User Profile Component
// ============================================================================
interface CurrentUserProfileProps {
  user: ServerPlayer;
  onSignOut: () => void;
  onJoinFaction: (factionId: number) => void;
}

function CurrentUserProfile({ user, onSignOut, onJoinFaction }: CurrentUserProfileProps) {
  const { factions } = useFactions();
  const [showFactionPicker, setShowFactionPicker] = useState(false);
  const [confirmFaction, setConfirmFaction] = useState<{ id: number; name: string; color: string } | null>(null);

  const currentFaction = factions.find(f => f.id === user.faction_id);

  const handleFactionClick = (faction: { id: number; name: string; color: string }) => {
    setConfirmFaction(faction);
  };

  const handleConfirmJoin = () => {
    if (confirmFaction) {
      onJoinFaction(confirmFaction.id);
      setConfirmFaction(null);
      setShowFactionPicker(false);
    }
  };

  const handleCancelJoin = () => {
    setConfirmFaction(null);
  };

  return (
    <div className="current-user-profile">
      <div className="user-header">
        {user.inat_icon_url && (
          <img src={user.inat_icon_url} alt="" className="user-avatar" />
        )}
        <div className="user-info">
          <span className="user-name">
            {user.inat_display_name || user.inat_username}
          </span>
          <span className="user-username">@{user.inat_username}</span>
        </div>
        <button onClick={onSignOut} className="sign-out-btn" title="Sign out">
          ↪
        </button>
      </div>

      <div className="user-stats">
        <div className="stat-item">
          <span className="stat-value">{user.action_points}</span>
          <span className="stat-label">AP</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{user.tiles_owned}</span>
          <span className="stat-label">Tiles</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{user.total_points.toLocaleString()}</span>
          <span className="stat-label">Points</span>
        </div>
      </div>

      {/* Faction */}
      <div className="user-faction">
        {currentFaction ? (
          <div
            className="faction-badge"
            style={{ borderColor: currentFaction.color }}
          >
            <span
              className="faction-dot"
              style={{ backgroundColor: currentFaction.color }}
            />
            <span className="faction-name">{currentFaction.name}</span>
          </div>
        ) : (
          <button
            onClick={() => setShowFactionPicker(!showFactionPicker)}
            className="btn btn-secondary btn-sm"
          >
            {showFactionPicker ? 'Cancel' : 'Join a Faction'}
          </button>
        )}
      </div>

      {/* Faction Confirmation Dialog */}
      {confirmFaction && (
        <div className="faction-confirm-overlay">
          <div className="faction-confirm-dialog">
            <div className="confirm-header">
              <span
                className="faction-dot large"
                style={{ backgroundColor: confirmFaction.color }}
              />
              <span className="confirm-faction-name">{confirmFaction.name}</span>
            </div>
            <p className="confirm-message">
              Are you sure you want to join this faction?
            </p>
            <p className="confirm-note">
              Faction membership resets every season (3 months).
            </p>
            <div className="confirm-buttons">
              <button onClick={handleCancelJoin} className="btn btn-secondary">
                No
              </button>
              <button onClick={handleConfirmJoin} className="btn btn-primary">
                Yes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Faction Picker */}
      {showFactionPicker && !currentFaction && !confirmFaction && (
        <div className="faction-picker">
          <p className="faction-picker-title">Choose your faction:</p>
          {factions.map(faction => (
            <button
              key={faction.id}
              onClick={() => handleFactionClick(faction)}
              className="faction-option"
              style={{ borderColor: faction.color }}
            >
              <span
                className="faction-dot"
                style={{ backgroundColor: faction.color }}
              />
              <div className="faction-details">
                <span className="faction-name">{faction.name}</span>
                <span className="faction-desc">{faction.description}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {!user.is_verified && (
        <div className="verification-warning">
          Account not verified. Complete verification to play competitively.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main App Component
// ============================================================================
export default function App() {
  const { players, loading: playersLoading, adding, progress, error, addPlayer, removePlayer } = usePlayers();
  const { stats, refresh: refreshStats } = useGlobalStats();
  const { position, requestLocation } = useGeolocation();
  const {
    currentUser,
    loading: userLoading,
    isSignedIn,
    signIn,
    signOut,
    joinFaction,
  } = useCurrentUser();

  // View state with zoom level for smart data loading
  const [viewState, setViewState] = useState<MapViewState | null>(null);
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [flyRequestId, setFlyRequestId] = useState(0);

  // Fetch tiles and observations only in current viewport (zoom-aware)
  const { tiles: rawTiles } = useTilesInBounds(viewState, 150);
  const { tiles } = useBiomeData(rawTiles); // Enrich tiles with biome data from server
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

  const handleVerified = useCallback((player: ServerPlayer) => {
    signIn(player);
    // Also add this player to the tracked players for local viewing
    addPlayer(player.inat_username);
  }, [signIn, addPlayer]);

  // Get initial map center from geolocation or default
  const initialCenter: [number, number] | undefined =
    position ? [position.lat, position.lng] : undefined;

  if (playersLoading || userLoading) {
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
          {/* Current User Profile or Verification */}
          {isSignedIn && currentUser ? (
            <CurrentUserProfile
              user={currentUser}
              onSignOut={signOut}
              onJoinFaction={joinFaction}
            />
          ) : (
            <VerificationPanel onVerified={handleVerified} />
          )}

          <div className="sidebar-divider" />

          {/* Global Stats */}
          <GlobalStats stats={stats} />

          {/* Add Player Form - for viewing other players */}
          <div className="track-others-section">
            <h3 className="section-title">Track Other Players</h3>
            <AddPlayerPanel
              onAddPlayer={handleAddPlayer}
              adding={adding}
              progress={progress}
              error={error}
            />
          </div>

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
          flyToPosition={position ? [position.lat, position.lng] : null}
          flyRequestId={flyRequestId}
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
          onClick={() => {
            requestLocation();
            setFlyRequestId(id => id + 1);
          }}
          className="locate-btn"
          title="Find my location"
        >
          📍
        </button>
      </div>
    </div>
  );
}
