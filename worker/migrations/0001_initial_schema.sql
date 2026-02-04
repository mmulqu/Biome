-- Biome Game Database Schema
-- Migration 0001: Initial Schema

-- ============================================
-- SEASONS & TIME
-- ============================================

CREATE TABLE seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    theme TEXT,  -- e.g., "Fungi Foragers", "Pollinator Push"
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    is_active INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- FACTIONS & TEAMS
-- ============================================

CREATE TABLE factions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,  -- hex color for map display
    icon TEXT,
    description TEXT,
    season_id INTEGER REFERENCES seasons(id),
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE squads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tag TEXT,  -- short 3-4 char tag
    leader_id INTEGER,  -- references players(id), added after players table
    faction_id INTEGER REFERENCES factions(id),
    max_members INTEGER DEFAULT 5,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- PLAYERS
-- ============================================

CREATE TABLE players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inat_user_id INTEGER UNIQUE NOT NULL,
    inat_username TEXT NOT NULL,
    inat_display_name TEXT,
    inat_icon_url TEXT,

    -- Verification
    is_verified INTEGER DEFAULT 0,
    verification_code TEXT,
    verification_expires_at TEXT,
    verified_at TEXT,

    -- Class/Loadout
    class TEXT DEFAULT 'generalist' CHECK (class IN ('generalist', 'birder', 'botanist', 'bug_hunter', 'mycologist')),

    -- Team affiliations
    faction_id INTEGER REFERENCES factions(id),
    squad_id INTEGER REFERENCES squads(id),

    -- Stats (cached/computed)
    total_points INTEGER DEFAULT 0,
    total_observations INTEGER DEFAULT 0,
    tiles_owned INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,

    -- Season stats
    season_rank INTEGER,
    season_points INTEGER DEFAULT 0,

    -- Cosmetics
    title TEXT,
    nameplate TEXT,
    avatar_frame TEXT,
    hex_border_skin TEXT,

    -- AP (Action Points)
    action_points INTEGER DEFAULT 0,
    ap_earned_today INTEGER DEFAULT 0,
    last_ap_reset TEXT,

    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_players_inat_username ON players(inat_username);
CREATE INDEX idx_players_faction ON players(faction_id);
CREATE INDEX idx_players_season_rank ON players(season_rank);

-- Add foreign key for squad leader
-- (SQLite doesn't support ALTER TABLE ADD CONSTRAINT, handled in app logic)

-- ============================================
-- TILES (Hexagons)
-- ============================================

CREATE TABLE tiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    h3_index TEXT UNIQUE NOT NULL,  -- H3 hex index
    resolution INTEGER NOT NULL,     -- H3 resolution (7, 8, etc.)

    -- Biome/type
    biome_type TEXT DEFAULT 'neutral' CHECK (biome_type IN (
        'neutral', 'forest', 'wetland', 'grassland', 'urban', 'coastal', 'desert', 'mountain'
    )),
    tile_type TEXT DEFAULT 'normal' CHECK (tile_type IN (
        'normal', 'landmark', 'hotspot', 'locked', 'wild'
    )),

    -- State
    state TEXT DEFAULT 'neutral' CHECK (state IN ('neutral', 'claimed', 'fortified', 'contested')),

    -- Ownership
    owner_id INTEGER REFERENCES players(id),
    owner_faction_id INTEGER REFERENCES factions(id),
    capture_progress INTEGER DEFAULT 0,  -- 0-100
    defense_strength INTEGER DEFAULT 0,  -- fortification level

    -- Contest tracking
    contester_id INTEGER REFERENCES players(id),
    contest_progress INTEGER DEFAULT 0,
    last_contested_at TEXT,

    -- Decay
    last_activity_at TEXT DEFAULT (datetime('now')),
    decay_rate REAL DEFAULT 1.0,  -- multiplier for decay speed

    -- Stats
    total_observations INTEGER DEFAULT 0,
    unique_species INTEGER DEFAULT 0,

    -- Special properties
    is_locked INTEGER DEFAULT 0,
    unlock_requirement TEXT,  -- JSON describing unlock quest
    hotspot_bonus REAL DEFAULT 1.0,  -- multiplier when tile is hotspot
    hotspot_expires_at TEXT,

    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_tiles_h3_index ON tiles(h3_index);
CREATE INDEX idx_tiles_owner ON tiles(owner_id);
CREATE INDEX idx_tiles_state ON tiles(state);
CREATE INDEX idx_tiles_biome ON tiles(biome_type);

-- ============================================
-- OBSERVATIONS (synced from iNaturalist)
-- ============================================

CREATE TABLE observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inat_observation_id INTEGER UNIQUE NOT NULL,
    player_id INTEGER NOT NULL REFERENCES players(id),

    -- Location
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    h3_index TEXT NOT NULL,  -- computed H3 index
    tile_id INTEGER REFERENCES tiles(id),

    -- Taxon info
    taxon_id INTEGER,
    taxon_name TEXT,
    taxon_common_name TEXT,
    taxon_iconic_group TEXT,  -- birds, plants, fungi, insects, etc.
    taxon_family TEXT,

    -- Quality
    quality_grade TEXT CHECK (quality_grade IN ('casual', 'needs_id', 'research')),
    quality_score REAL DEFAULT 1.0,  -- computed weight

    -- Rarity
    is_rare INTEGER DEFAULT 0,
    is_first_for_tile INTEGER DEFAULT 0,  -- uniqueness bonus

    -- Points/AP
    base_points INTEGER DEFAULT 1,
    bonus_points INTEGER DEFAULT 0,
    total_points INTEGER DEFAULT 1,
    ap_granted INTEGER DEFAULT 1,

    -- Metadata
    observed_at TEXT NOT NULL,
    photo_url TEXT,

    -- Processing
    processed INTEGER DEFAULT 0,
    processed_at TEXT,

    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_observations_player ON observations(player_id);
CREATE INDEX idx_observations_tile ON observations(tile_id);
CREATE INDEX idx_observations_h3 ON observations(h3_index);
CREATE INDEX idx_observations_observed_at ON observations(observed_at);

-- ============================================
-- ACTIONS (AP spending)
-- ============================================

CREATE TABLE actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id),
    tile_id INTEGER NOT NULL REFERENCES tiles(id),

    action_type TEXT NOT NULL CHECK (action_type IN ('claim', 'fortify', 'scout', 'contest')),
    ap_spent INTEGER NOT NULL DEFAULT 1,

    -- Result
    progress_added INTEGER DEFAULT 0,
    result TEXT,  -- JSON with action result details

    -- Combo tracking
    combo_type TEXT,  -- biome, diversity, adjacency, rarity
    combo_multiplier REAL DEFAULT 1.0,

    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_actions_player ON actions(player_id);
CREATE INDEX idx_actions_tile ON actions(tile_id);
CREATE INDEX idx_actions_type ON actions(action_type);
CREATE INDEX idx_actions_created ON actions(created_at);

-- ============================================
-- TILE HISTORY (ownership changes)
-- ============================================

CREATE TABLE tile_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tile_id INTEGER NOT NULL REFERENCES tiles(id),

    event_type TEXT NOT NULL CHECK (event_type IN (
        'claimed', 'lost', 'fortified', 'contested', 'decayed', 'unlocked'
    )),

    old_owner_id INTEGER REFERENCES players(id),
    new_owner_id INTEGER REFERENCES players(id),
    old_faction_id INTEGER REFERENCES factions(id),
    new_faction_id INTEGER REFERENCES factions(id),

    details TEXT,  -- JSON with extra info

    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_tile_history_tile ON tile_history(tile_id);
CREATE INDEX idx_tile_history_created ON tile_history(created_at);

-- ============================================
-- QUESTS
-- ============================================

CREATE TABLE quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,

    quest_type TEXT NOT NULL CHECK (quest_type IN ('daily', 'weekly', 'seasonal', 'special')),

    -- Requirements (JSON)
    requirements TEXT NOT NULL,  -- e.g., {"type": "observe", "count": 5, "taxon_group": "birds"}

    -- Rewards (JSON)
    rewards TEXT NOT NULL,  -- e.g., {"ap": 5, "points": 100, "cosmetic": "bird_watcher_title"}

    -- Availability
    season_id INTEGER REFERENCES seasons(id),
    start_date TEXT,
    end_date TEXT,
    is_active INTEGER DEFAULT 1,

    -- Limits
    max_completions INTEGER DEFAULT 1,  -- per player

    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE player_quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id),
    quest_id INTEGER NOT NULL REFERENCES quests(id),

    progress INTEGER DEFAULT 0,
    target INTEGER NOT NULL,
    is_complete INTEGER DEFAULT 0,
    completed_at TEXT,

    -- For daily/weekly reset tracking
    reset_period TEXT,  -- date string for when this instance expires

    created_at TEXT DEFAULT (datetime('now')),

    UNIQUE(player_id, quest_id, reset_period)
);

CREATE INDEX idx_player_quests_player ON player_quests(player_id);
CREATE INDEX idx_player_quests_complete ON player_quests(is_complete);

-- ============================================
-- ACHIEVEMENTS
-- ============================================

CREATE TABLE achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    icon TEXT,

    category TEXT CHECK (category IN ('explorer', 'naturalist', 'guardian', 'trailblazer', 'social')),
    tier INTEGER DEFAULT 1 CHECK (tier BETWEEN 1 AND 5),  -- bronze to diamond

    -- Requirements (JSON)
    requirements TEXT NOT NULL,

    -- Rewards (JSON)
    rewards TEXT,

    -- Display
    is_hidden INTEGER DEFAULT 0,  -- secret achievements

    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE player_achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id),
    achievement_id INTEGER NOT NULL REFERENCES achievements(id),

    unlocked_at TEXT DEFAULT (datetime('now')),

    UNIQUE(player_id, achievement_id)
);

CREATE INDEX idx_player_achievements_player ON player_achievements(player_id);

-- ============================================
-- COSMETICS
-- ============================================

CREATE TABLE cosmetics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,

    cosmetic_type TEXT NOT NULL CHECK (cosmetic_type IN (
        'title', 'nameplate', 'avatar_frame', 'hex_border', 'map_accent'
    )),

    -- Unlock source
    source TEXT CHECK (source IN ('achievement', 'season', 'quest', 'rarity', 'tiles', 'landmark', 'purchase')),
    source_id INTEGER,  -- references achievement_id, quest_id, etc.

    -- Display
    preview_url TEXT,
    rarity TEXT DEFAULT 'common' CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),

    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE player_cosmetics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id),
    cosmetic_id INTEGER NOT NULL REFERENCES cosmetics(id),

    is_equipped INTEGER DEFAULT 0,
    unlocked_at TEXT DEFAULT (datetime('now')),

    UNIQUE(player_id, cosmetic_id)
);

CREATE INDEX idx_player_cosmetics_player ON player_cosmetics(player_id);

-- ============================================
-- COMBOS & STREAKS
-- ============================================

CREATE TABLE player_combos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id),

    combo_type TEXT NOT NULL CHECK (combo_type IN ('biome', 'diversity', 'adjacency', 'rarity')),

    current_count INTEGER DEFAULT 0,
    max_count INTEGER DEFAULT 0,
    multiplier REAL DEFAULT 1.0,

    -- Tracking
    last_contribution_id INTEGER,  -- observation or action id
    expires_at TEXT,  -- combos expire after inactivity

    updated_at TEXT DEFAULT (datetime('now')),

    UNIQUE(player_id, combo_type)
);

CREATE INDEX idx_player_combos_player ON player_combos(player_id);

-- ============================================
-- RATE LIMITING & ANTI-SPAM
-- ============================================

CREATE TABLE player_daily_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id),
    tile_id INTEGER NOT NULL REFERENCES tiles(id),

    date TEXT NOT NULL,  -- YYYY-MM-DD

    actions_count INTEGER DEFAULT 0,
    observations_count INTEGER DEFAULT 0,
    contest_count INTEGER DEFAULT 0,

    -- Diminishing returns tracking
    effective_contribution REAL DEFAULT 0,

    UNIQUE(player_id, tile_id, date)
);

CREATE INDEX idx_daily_limits_player_date ON player_daily_limits(player_id, date);

-- ============================================
-- BATTLE LOG / ACTIVITY FEED
-- ============================================

CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    event_type TEXT NOT NULL,  -- tile_captured, tile_contested, achievement_unlocked, etc.

    player_id INTEGER REFERENCES players(id),
    tile_id INTEGER REFERENCES tiles(id),

    headline TEXT NOT NULL,  -- "PlayerX captured Tile Y!"
    details TEXT,  -- JSON with full event data

    -- For filtering
    is_global INTEGER DEFAULT 0,  -- show on global feed
    faction_id INTEGER REFERENCES factions(id),

    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_activity_log_created ON activity_log(created_at DESC);
CREATE INDEX idx_activity_log_player ON activity_log(player_id);
CREATE INDEX idx_activity_log_global ON activity_log(is_global, created_at DESC);

-- ============================================
-- LEADERBOARDS (cached)
-- ============================================

CREATE TABLE leaderboards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    leaderboard_type TEXT NOT NULL,  -- global, faction, weekly, tiles_owned, etc.
    period TEXT,  -- for time-based boards: YYYY-MM-DD or YYYY-WW

    player_id INTEGER NOT NULL REFERENCES players(id),

    rank INTEGER NOT NULL,
    score INTEGER NOT NULL,

    updated_at TEXT DEFAULT (datetime('now')),

    UNIQUE(leaderboard_type, period, player_id)
);

CREATE INDEX idx_leaderboards_type_rank ON leaderboards(leaderboard_type, period, rank);

-- ============================================
-- INITIAL DATA
-- ============================================

-- Default season
INSERT INTO seasons (name, theme, start_date, end_date, is_active)
VALUES ('Season 1', 'Spring Awakening', '2025-02-01', '2025-03-15', 1);

-- Default factions
INSERT INTO factions (name, color, description, season_id) VALUES
('Verdant Circle', '#22c55e', 'Guardians of forests and plant life', 1),
('Azure Wing', '#3b82f6', 'Champions of birds and sky dwellers', 1),
('Crimson Hive', '#ef4444', 'Protectors of insects and pollinators', 1),
('Amber Spore', '#f59e0b', 'Seekers of fungi and decomposers', 1);

-- Sample achievements
INSERT INTO achievements (name, description, category, tier, requirements, rewards) VALUES
('First Steps', 'Submit your first observation', 'explorer', 1, '{"type": "observations", "count": 1}', '{"title": "Newcomer"}'),
('Local Explorer', 'Claim your first tile', 'explorer', 1, '{"type": "tiles_claimed", "count": 1}', '{"ap": 5}'),
('Dedicated Observer', 'Submit 100 observations', 'naturalist', 2, '{"type": "observations", "count": 100}', '{"title": "Dedicated Observer", "nameplate": "observer_bronze"}'),
('Territory Master', 'Own 10 tiles simultaneously', 'guardian', 2, '{"type": "tiles_owned", "count": 10}', '{"hex_border": "golden_edge"}'),
('Diversity Champion', 'Observe 50 different species', 'naturalist', 3, '{"type": "unique_species", "count": 50}', '{"title": "Biodiversity Champion"}'),
('Streak Warrior', 'Maintain a 7-day observation streak', 'trailblazer', 2, '{"type": "streak", "count": 7}', '{"avatar_frame": "flame_border"}'),
('Landmark Defender', 'Successfully defend a landmark tile', 'guardian', 3, '{"type": "landmarks_defended", "count": 1}', '{"title": "Landmark Guardian"}');

-- Sample daily quests
INSERT INTO quests (name, description, quest_type, requirements, rewards, is_active) VALUES
('Daily Observer', 'Submit 3 observations today', 'daily', '{"type": "observations", "count": 3}', '{"ap": 3, "points": 50}', 1),
('Claim Stake', 'Perform 2 claim actions', 'daily', '{"type": "actions", "action_type": "claim", "count": 2}', '{"ap": 2, "points": 30}', 1),
('Scout Duty', 'Scout 1 new tile', 'daily', '{"type": "actions", "action_type": "scout", "count": 1}', '{"ap": 1, "points": 20}', 1);

-- Sample weekly quests
INSERT INTO quests (name, description, quest_type, requirements, rewards, is_active) VALUES
('Weekly Explorer', 'Visit and observe in 5 different tiles', 'weekly', '{"type": "unique_tiles_observed", "count": 5}', '{"ap": 10, "points": 200}', 1),
('Team Player', 'Contribute to 3 faction-owned tiles', 'weekly', '{"type": "faction_contributions", "count": 3}', '{"ap": 5, "points": 150}', 1),
('Diversity Week', 'Observe 10 different species', 'weekly', '{"type": "unique_species_week", "count": 10}', '{"ap": 8, "points": 250}', 1);

-- Sample cosmetics
INSERT INTO cosmetics (name, description, cosmetic_type, source, rarity) VALUES
('Newcomer', 'A fresh face in the field', 'title', 'achievement', 'common'),
('Dedicated Observer', 'Proven commitment to science', 'title', 'achievement', 'uncommon'),
('Biodiversity Champion', 'Master of species diversity', 'title', 'achievement', 'rare'),
('Landmark Guardian', 'Defender of important places', 'title', 'achievement', 'epic'),
('Observer Bronze', 'Bronze tier observer nameplate', 'nameplate', 'achievement', 'uncommon'),
('Golden Edge', 'Prestigious hex border', 'hex_border', 'achievement', 'rare'),
('Flame Border', 'For streak warriors', 'avatar_frame', 'achievement', 'uncommon');
