import { useState } from 'react';
import type { Player, Tile, TileScore, Observation, IconicTaxon } from '../types';
import { TAXA_COLORS, BIOME_COLORS } from '../types';

// ============================================================================
// Add Player Panel (No login required - just add any iNat username)
// ============================================================================
interface AddPlayerPanelProps {
  onAddPlayer: (username: string) => Promise<Player | null>;
  adding: boolean;
  progress: { fetched: number; total: number } | null;
  error: string | null;
}

export function AddPlayerPanel({ onAddPlayer, adding, progress, error }: AddPlayerPanelProps) {
  const [username, setUsername] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || adding) return;

    try {
      await onAddPlayer(username.trim());
      setUsername('');
    } catch {
      // Error is handled by parent
    }
  };

  return (
    <div className="add-player-panel">
      <form onSubmit={handleSubmit} className="add-player-form">
        <input
          type="text"
          placeholder="iNaturalist username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={adding}
          className="login-input"
        />
        <button
          type="submit"
          disabled={adding || !username.trim()}
          className="btn btn-primary"
        >
          {adding ? 'Adding...' : 'Add Player'}
        </button>
      </form>

      {progress && (
        <div className="sync-progress">
          Fetching observations... {progress.fetched.toLocaleString()} / {progress.total.toLocaleString()}
        </div>
      )}

      {error && <p className="login-error">{error}</p>}
    </div>
  );
}

// ============================================================================
// Player List Panel
// ============================================================================
interface PlayerListProps {
  players: Player[];
  onRemovePlayer: (playerId: string) => void;
}

export function PlayerList({ players, onRemovePlayer }: PlayerListProps) {
  if (players.length === 0) {
    return (
      <div className="player-list-empty">
        <p>No players added yet. Add an iNaturalist username to get started!</p>
      </div>
    );
  }

  return (
    <div className="player-list">
      <h3>Tracked Players ({players.length})</h3>
      <ul>
        {players.map((player, idx) => (
          <li key={player.id} className="player-list-item">
            <span className="player-rank">#{idx + 1}</span>
            {player.pfp_url && (
              <img src={player.pfp_url} alt="" className="player-list-avatar" />
            )}
            <div className="player-list-info">
              <span className="player-list-name">@{player.username}</span>
              <span className="player-list-stats">
                {player.total_points.toLocaleString()} pts · {player.observation_count.toLocaleString()} obs
              </span>
            </div>
            <button
              onClick={() => onRemovePlayer(player.id)}
              className="remove-player-btn"
              title="Remove player"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
// Global Stats Panel
// ============================================================================
interface GlobalStatsProps {
  stats: {
    totalObservations: number;
    totalTiles: number;
    totalPlayers: number;
    totalSpecies: number;
  } | null;
}

export function GlobalStats({ stats }: GlobalStatsProps) {
  if (!stats) return null;

  return (
    <div className="global-stats">
      <div className="stats-grid">
        <div className="stat-item">
          <span className="stat-value">{stats.totalObservations.toLocaleString()}</span>
          <span className="stat-label">Observations</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.totalTiles.toLocaleString()}</span>
          <span className="stat-label">Tiles</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.totalPlayers}</span>
          <span className="stat-label">Players</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{stats.totalSpecies.toLocaleString()}</span>
          <span className="stat-label">Species</span>
        </div>
      </div>
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
          <div className="tile-biome" style={{ color: biomeColor }}>
            {tile.biome_type.charAt(0).toUpperCase() + tile.biome_type.slice(1)}
          </div>
        </div>
        <button onClick={onClose} className="close-btn">×</button>
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

// Re-export VerificationPanel for convenience
export { VerificationPanel } from './VerificationPanel';
