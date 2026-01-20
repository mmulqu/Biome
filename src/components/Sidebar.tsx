import { useState } from 'react';
import type { Player, Tile, TileScore, Observation, IconicTaxon } from '../types';
import { TAXA_COLORS, BIOME_COLORS } from '../types';

// ============================================================================
// Login Panel
// ============================================================================
interface LoginPanelProps {
  onLogin: (username: string) => Promise<Player | null>;
}

export function LoginPanel({ onLogin }: LoginPanelProps) {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setLoading(true);
    setError(null);

    try {
      await onLogin(username.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-panel">
      <div className="login-header">
        <h2>Welcome to Biome</h2>
        <p>Enter your iNaturalist username to start playing</p>
      </div>

      <form onSubmit={handleSubmit} className="login-form">
        <input
          type="text"
          placeholder="iNaturalist username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={loading}
          className="login-input"
        />

        <button
          type="submit"
          disabled={loading || !username.trim()}
          className="btn btn-primary"
        >
          {loading ? 'Connecting...' : 'Connect Account'}
        </button>

        {error && <p className="login-error">{error}</p>}
      </form>

      <div className="login-info">
        <h3>How it works</h3>
        <ul>
          <li>Make observations on iNaturalist</li>
          <li>Sync your observations to earn points</li>
          <li>Conquer hexagonal territory tiles</li>
          <li>Compete for the leaderboard</li>
        </ul>
      </div>
    </div>
  );
}

// ============================================================================
// Player Stats Panel
// ============================================================================
interface PlayerStatsProps {
  player: Player;
  onSync: () => Promise<void>;
  syncing: boolean;
}

export function PlayerStats({ player, onSync, syncing }: PlayerStatsProps) {
  return (
    <div className="player-stats">
      <div className="player-header">
        {player.pfp_url && (
          <img
            src={player.pfp_url}
            alt={player.display_name}
            className="player-avatar"
          />
        )}
        <div className="player-info">
          <h2 className="player-name">{player.display_name}</h2>
          <p className="player-username">@{player.username}</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-item">
          <span className="stat-value">{player.total_points.toLocaleString()}</span>
          <span className="stat-label">Total Points</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{player.tiles_owned}</span>
          <span className="stat-label">Tiles Owned</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{player.observation_count}</span>
          <span className="stat-label">Observations</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{player.unique_species}</span>
          <span className="stat-label">Species</span>
        </div>
      </div>

      <button
        onClick={onSync}
        disabled={syncing}
        className="btn btn-primary sync-btn"
      >
        {syncing ? 'Syncing...' : 'Sync Observations'}
      </button>
    </div>
  );
}

// ============================================================================
// Tile Info Panel
// ============================================================================
interface TileInfoProps {
  tile: Tile;
  leaderboard: TileScore[];
  observations: Observation[];
  onClose: () => void;
}

export function TileInfo({ tile, leaderboard, observations, onClose }: TileInfoProps) {
  const biomeColor = BIOME_COLORS[tile.biome_type] || BIOME_COLORS.unknown;

  return (
    <div className="tile-info">
      <div className="tile-header">
        <div>
          <h3 className="tile-title">Tile Details</h3>
          <div
            className="tile-biome"
            style={{ color: biomeColor }}
          >
            {tile.biome_type.charAt(0).toUpperCase() + tile.biome_type.slice(1)}
          </div>
        </div>
        <button onClick={onClose} className="close-btn">&times;</button>
      </div>

      <div className="tile-stats">
        <div className="tile-stat">
          <span className="tile-stat-value">{tile.total_observations}</span>
          <span className="tile-stat-label">Observations</span>
        </div>
        <div className="tile-stat">
          <span className="tile-stat-value">{tile.unique_observers}</span>
          <span className="tile-stat-label">Observers</span>
        </div>
      </div>

      {tile.owner_id && (
        <div className="tile-owner">
          <span className="tile-owner-label">Current Owner</span>
          <div className="tile-owner-info">
            {tile.owner_pfp && (
              <img src={tile.owner_pfp} alt="" className="owner-avatar" />
            )}
            <span className="owner-name">@{tile.owner_username}</span>
            <span className="owner-points">{tile.owner_points} pts</span>
          </div>
        </div>
      )}

      {leaderboard.length > 0 && (
        <div className="tile-leaderboard">
          <h4>Tile Leaderboard</h4>
          <ul>
            {leaderboard.slice(0, 5).map((score, idx) => (
              <li key={score.player_id} className="leaderboard-entry">
                <span className="leaderboard-rank">#{idx + 1}</span>
                {score.pfp_url && (
                  <img src={score.pfp_url} alt="" className="leaderboard-avatar" />
                )}
                <span className="leaderboard-name">@{score.username}</span>
                <span className="leaderboard-points">{score.total_points} pts</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {observations.length > 0 && (
        <div className="tile-observations">
          <h4>Recent Observations</h4>
          <ul>
            {observations.slice(0, 5).map(obs => (
              <li key={obs.id} className="obs-entry">
                <div
                  className="obs-taxa"
                  style={{
                    backgroundColor: TAXA_COLORS[obs.iconic_taxon as IconicTaxon] || TAXA_COLORS.unknown
                  }}
                />
                <div className="obs-info">
                  <span className="obs-name">
                    {obs.common_name || obs.species_name || 'Unknown'}
                  </span>
                  <span className="obs-user">@{obs.username}</span>
                </div>
                <span className="obs-points">+{obs.total_points}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Leaderboard Panel
// ============================================================================
interface LeaderboardPanelProps {
  currentPlayerId?: string;
}

export function LeaderboardPanel({ currentPlayerId: _currentPlayerId }: LeaderboardPanelProps) {
  // For MVP, we just show a placeholder since we don't have a real backend
  // In a full implementation, this would fetch from the API

  return (
    <div className="leaderboard-panel">
      <h3>Leaderboard</h3>
      <p className="leaderboard-placeholder">
        Coming soon! Sync your observations to start competing.
      </p>
    </div>
  );
}

// ============================================================================
// Scoring Info Panel
// ============================================================================
export function ScoringInfo() {
  return (
    <div className="scoring-info">
      <h3>Scoring</h3>

      <div className="scoring-section">
        <h4>Base Points</h4>
        <p>Each observation earns <strong>10 base points</strong></p>
      </div>

      <div className="scoring-section">
        <h4>Multipliers</h4>
        <ul className="multiplier-list">
          <li>
            <span className="multiplier">×1.5</span>
            <span>Taxa matches biome bonus</span>
          </li>
          <li>
            <span className="multiplier">×3.0</span>
            <span>First observation in tile</span>
          </li>
          <li>
            <span className="multiplier">×2.0</span>
            <span>Tile has &lt;10 observations</span>
          </li>
          <li>
            <span className="multiplier">×1.5</span>
            <span>Tile has &lt;50 observations</span>
          </li>
          <li>
            <span className="multiplier">×1.25</span>
            <span>Research Grade observation</span>
          </li>
        </ul>
      </div>

      <div className="scoring-section">
        <h4>Biome Bonuses</h4>
        <ul className="biome-list">
          <li><span style={{color: BIOME_COLORS.forest}}>Forest</span> — Plants, Fungi, Birds, Insects</li>
          <li><span style={{color: BIOME_COLORS.wetland}}>Wetland</span> — Amphibians, Birds, Plants</li>
          <li><span style={{color: BIOME_COLORS.coastal}}>Coastal</span> — Birds, Mollusks, Fish</li>
          <li><span style={{color: BIOME_COLORS.desert}}>Desert</span> — Reptiles, Arachnids, Plants</li>
        </ul>
      </div>
    </div>
  );
}
