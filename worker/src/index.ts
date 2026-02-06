/**
 * Biome Game API Worker
 * Cloudflare Worker with D1 Database
 */

export interface Env {
  DB: D1Database;
  BIOME_TILES: R2Bucket;
  ENVIRONMENT: string;
}

// In-memory cache for R2 chunks (persists across requests in same isolate)
const r2ChunkCache = new Map<string, { data: Record<string, { code: number; biome: string }>; timestamp: number }>();
const R2_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// CORS headers for the frontend
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// JSON response helper
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

// Error response helper
function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

// Route handler type
type RouteHandler = (
  request: Request,
  env: Env,
  params: Record<string, string>
) => Promise<Response>;

// Simple router
class Router {
  private routes: Array<{
    method: string;
    pattern: RegExp;
    paramNames: string[];
    handler: RouteHandler;
  }> = [];

  add(method: string, path: string, handler: RouteHandler) {
    const paramNames: string[] = [];
    const pattern = new RegExp(
      '^' +
        path.replace(/:([^/]+)/g, (_, name) => {
          paramNames.push(name);
          return '([^/]+)';
        }) +
        '$'
    );
    this.routes.push({ method, pattern, paramNames, handler });
  }

  get(path: string, handler: RouteHandler) {
    this.add('GET', path, handler);
  }

  post(path: string, handler: RouteHandler) {
    this.add('POST', path, handler);
  }

  put(path: string, handler: RouteHandler) {
    this.add('PUT', path, handler);
  }

  delete(path: string, handler: RouteHandler) {
    this.add('DELETE', path, handler);
  }

  async handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '') || '/';
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    for (const route of this.routes) {
      if (route.method !== method) continue;

      const match = path.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          params[name] = match[i + 1];
        });
        try {
          return await route.handler(request, env, params);
        } catch (e) {
          console.error('Route error:', e);
          return error('Internal server error', 500);
        }
      }
    }

    return error('Not found', 404);
  }
}

const router = new Router();

// ============================================
// HEALTH CHECK
// ============================================

router.get('/health', async () => {
  return json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================
// PLAYERS
// ============================================

// Get player by iNat username
router.get('/players/:username', async (request, env, params) => {
  const player = await env.DB.prepare(
    `SELECT * FROM players WHERE inat_username = ?`
  )
    .bind(params.username)
    .first();

  if (!player) {
    return error('Player not found', 404);
  }

  return json(player);
});

// Get player by ID
router.get('/players/id/:id', async (request, env, params) => {
  const player = await env.DB.prepare(`SELECT * FROM players WHERE id = ?`)
    .bind(params.id)
    .first();

  if (!player) {
    return error('Player not found', 404);
  }

  return json(player);
});

// Register/update player from iNat data
router.post('/players', async (request, env) => {
  const body = await request.json() as {
    inat_user_id: number;
    inat_username: string;
    inat_display_name?: string;
    inat_icon_url?: string;
  };

  const { inat_user_id, inat_username, inat_display_name, inat_icon_url } = body;

  if (!inat_user_id || !inat_username) {
    return error('inat_user_id and inat_username are required');
  }

  // Upsert player
  const result = await env.DB.prepare(
    `INSERT INTO players (inat_user_id, inat_username, inat_display_name, inat_icon_url)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(inat_user_id) DO UPDATE SET
       inat_username = excluded.inat_username,
       inat_display_name = excluded.inat_display_name,
       inat_icon_url = excluded.inat_icon_url,
       updated_at = datetime('now')
     RETURNING *`
  )
    .bind(inat_user_id, inat_username, inat_display_name || null, inat_icon_url || null)
    .first();

  return json(result, 201);
});

// Update player class
router.put('/players/:id/class', async (request, env, params) => {
  const body = await request.json() as { class: string };
  const validClasses = ['generalist', 'birder', 'botanist', 'bug_hunter', 'mycologist'];

  if (!validClasses.includes(body.class)) {
    return error(`Invalid class. Must be one of: ${validClasses.join(', ')}`);
  }

  const result = await env.DB.prepare(
    `UPDATE players SET class = ?, updated_at = datetime('now')
     WHERE id = ? RETURNING *`
  )
    .bind(body.class, params.id)
    .first();

  if (!result) {
    return error('Player not found', 404);
  }

  return json(result);
});

// Join faction
router.put('/players/:id/faction', async (request, env, params) => {
  const body = await request.json() as { faction_id: number };

  const result = await env.DB.prepare(
    `UPDATE players SET faction_id = ?, updated_at = datetime('now')
     WHERE id = ? RETURNING *`
  )
    .bind(body.faction_id, params.id)
    .first();

  if (!result) {
    return error('Player not found', 404);
  }

  return json(result);
});

// ============================================
// VERIFICATION
// ============================================

// Generate verification code
router.post('/players/:id/verification/generate', async (request, env, params) => {
  const code = 'BIOME-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min

  // Get player info for the profile URL
  const player = await env.DB.prepare(
    `SELECT inat_user_id, inat_username FROM players WHERE id = ?`
  )
    .bind(params.id)
    .first<{ inat_user_id: number; inat_username: string }>();

  if (!player) {
    return error('Player not found', 404);
  }

  const result = await env.DB.prepare(
    `UPDATE players
     SET verification_code = ?, verification_expires_at = ?, updated_at = datetime('now')
     WHERE id = ? RETURNING id, inat_username, verification_code, verification_expires_at`
  )
    .bind(code, expiresAt, params.id)
    .first();

  if (!result) {
    return error('Player not found', 404);
  }

  return json({
    ...result,
    inat_user_id: player.inat_user_id,
    profile_url: `https://www.inaturalist.org/people/${player.inat_user_id}`,
    edit_profile_url: `https://www.inaturalist.org/users/edit`,
    instructions: `Add this code anywhere in your iNaturalist profile bio: ${code}`,
    expires_in_minutes: 30,
  });
});

// Verify player (check if code appears in iNat profile)
router.post('/players/:id/verification/verify', async (request, env, params) => {
  const player = await env.DB.prepare(
    `SELECT * FROM players WHERE id = ?`
  )
    .bind(params.id)
    .first<{
      id: number;
      inat_username: string;
      verification_code: string | null;
      verification_expires_at: string | null;
    }>();

  if (!player) {
    return error('Player not found', 404);
  }

  if (!player.verification_code) {
    return error('No verification code generated. Generate one first.');
  }

  if (
    player.verification_expires_at &&
    new Date(player.verification_expires_at) < new Date()
  ) {
    return error('Verification code expired. Generate a new one.');
  }

  // Fetch iNaturalist profile to check for code (using v2 API)
  try {
    const inatResponse = await fetch(
      `https://api.inaturalist.org/v2/users/${player.inat_username}?fields=description`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );
    const inatData = await inatResponse.json() as {
      results?: Array<{ description?: string }>;
    };

    if (!inatData.results?.[0]) {
      return error('Could not fetch iNaturalist profile. Make sure your profile is public.');
    }

    const profile = inatData.results[0];
    const bio = profile.description || '';

    if (bio.includes(player.verification_code)) {
      // Verified!
      const result = await env.DB.prepare(
        `UPDATE players
         SET is_verified = 1, verified_at = datetime('now'),
             verification_code = NULL, verification_expires_at = NULL,
             updated_at = datetime('now')
         WHERE id = ? RETURNING *`
      )
        .bind(params.id)
        .first();

      // Log activity
      await env.DB.prepare(
        `INSERT INTO activity_log (event_type, player_id, headline, is_global)
         VALUES ('player_verified', ?, ?, 1)`
      )
        .bind(params.id, `${player.inat_username} has been verified!`)
        .run();

      return json({ verified: true, player: result });
    } else {
      return json({
        verified: false,
        message: `Code "${player.verification_code}" not found in iNaturalist bio`,
      });
    }
  } catch (e) {
    return error('Failed to check iNaturalist profile');
  }
});

// ============================================
// TILES
// ============================================

// Get tile by H3 index
router.get('/tiles/:h3Index', async (request, env, params) => {
  const tile = await env.DB.prepare(`SELECT * FROM tiles WHERE h3_index = ?`)
    .bind(params.h3Index)
    .first();

  if (!tile) {
    return error('Tile not found', 404);
  }

  return json(tile);
});

// Get tiles in bounds (for map view)
router.get('/tiles', async (request, env) => {
  const url = new URL(request.url);
  const h3Indices = url.searchParams.get('h3_indices')?.split(',') || [];

  if (h3Indices.length === 0) {
    return error('h3_indices query parameter required');
  }

  if (h3Indices.length > 500) {
    return error('Maximum 500 tiles per request');
  }

  const placeholders = h3Indices.map(() => '?').join(',');
  const tiles = await env.DB.prepare(
    `SELECT * FROM tiles WHERE h3_index IN (${placeholders})`
  )
    .bind(...h3Indices)
    .all();

  return json(tiles.results);
});

// Get or create tile
router.post('/tiles', async (request, env) => {
  const body = await request.json() as {
    h3_index: string;
    resolution: number;
    biome_type?: string;
  };

  const { h3_index, resolution, biome_type } = body;

  if (!h3_index || !resolution) {
    return error('h3_index and resolution are required');
  }

  // Try to get existing tile
  let tile = await env.DB.prepare(`SELECT * FROM tiles WHERE h3_index = ?`)
    .bind(h3_index)
    .first();

  if (!tile) {
    // Create new tile
    tile = await env.DB.prepare(
      `INSERT INTO tiles (h3_index, resolution, biome_type)
       VALUES (?, ?, ?)
       RETURNING *`
    )
      .bind(h3_index, resolution, biome_type || 'neutral')
      .first();
  }

  return json(tile);
});

// Get tiles owned by player
router.get('/players/:id/tiles', async (request, env, params) => {
  const tiles = await env.DB.prepare(
    `SELECT * FROM tiles WHERE owner_id = ? ORDER BY updated_at DESC`
  )
    .bind(params.id)
    .all();

  return json(tiles.results);
});

// ============================================
// OBSERVATIONS
// ============================================

// Sync observations from iNaturalist
router.post('/players/:id/observations/sync', async (request, env, params) => {
  const body = await request.json() as {
    observations: Array<{
      inat_observation_id: number;
      latitude: number;
      longitude: number;
      h3_index: string;
      taxon_id?: number;
      taxon_name?: string;
      taxon_common_name?: string;
      taxon_iconic_group?: string;
      taxon_family?: string;
      quality_grade: string;
      observed_at: string;
      photo_url?: string;
    }>;
  };

  const playerId = parseInt(params.id);
  const { observations } = body;

  if (!observations || !Array.isArray(observations)) {
    return error('observations array required');
  }

  if (observations.length === 0) {
    return json({ synced: 0, skipped: 0, ap_earned: 0 });
  }

  // Step 1: Get all existing iNat observation IDs in one query
  const inatIds = observations.map(o => o.inat_observation_id);

  // Query in chunks to avoid SQL parameter limits (max ~999 params)
  const CHUNK_SIZE = 500;
  const existingIds = new Set<number>();

  for (let i = 0; i < inatIds.length; i += CHUNK_SIZE) {
    const chunk = inatIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await env.DB.prepare(
      `SELECT inat_observation_id FROM observations WHERE inat_observation_id IN (${placeholders})`
    )
      .bind(...chunk)
      .all<{ inat_observation_id: number }>();

    for (const row of result.results) {
      existingIds.add(row.inat_observation_id);
    }
  }

  // Filter to only new observations
  const newObservations = observations.filter(o => !existingIds.has(o.inat_observation_id));
  const skipped = observations.length - newObservations.length;

  if (newObservations.length === 0) {
    return json({ synced: 0, skipped, ap_earned: 0 });
  }

  // Step 2: Get unique h3 indices and ensure tiles exist
  const uniqueH3Indices = [...new Set(newObservations.map(o => o.h3_index))];

  // Check which tiles already exist
  const existingTiles = new Map<string, number>();
  for (let i = 0; i < uniqueH3Indices.length; i += CHUNK_SIZE) {
    const chunk = uniqueH3Indices.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await env.DB.prepare(
      `SELECT id, h3_index FROM tiles WHERE h3_index IN (${placeholders})`
    )
      .bind(...chunk)
      .all<{ id: number; h3_index: string }>();

    for (const row of result.results) {
      existingTiles.set(row.h3_index, row.id);
    }
  }

  // Create missing tiles in batch
  const missingH3Indices = uniqueH3Indices.filter(h3 => !existingTiles.has(h3));
  if (missingH3Indices.length > 0) {
    const tileInsertStmts = missingH3Indices.map(h3 =>
      env.DB.prepare(`INSERT OR IGNORE INTO tiles (h3_index, resolution) VALUES (?, 9)`)
        .bind(h3)
    );

    // Execute in smaller batches to avoid timeouts
    for (let i = 0; i < tileInsertStmts.length; i += 50) {
      const batch = tileInsertStmts.slice(i, i + 50);
      await env.DB.batch(batch);
    }

    // Fetch the newly created tile IDs
    for (let i = 0; i < missingH3Indices.length; i += CHUNK_SIZE) {
      const chunk = missingH3Indices.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      const result = await env.DB.prepare(
        `SELECT id, h3_index FROM tiles WHERE h3_index IN (${placeholders})`
      )
        .bind(...chunk)
        .all<{ id: number; h3_index: string }>();

      for (const row of result.results) {
        existingTiles.set(row.h3_index, row.id);
      }
    }
  }

  // Step 3: Insert observations in batches using D1 batch API
  let synced = 0;
  let apEarned = 0;
  const tileObsCounts = new Map<string, number>();

  // Process in batches to avoid D1 limits
  const INSERT_BATCH_SIZE = 25; // D1 batch limit is conservative

  for (let i = 0; i < newObservations.length; i += INSERT_BATCH_SIZE) {
    const batch = newObservations.slice(i, i + INSERT_BATCH_SIZE);
    const statements = [];

    for (const obs of batch) {
      // Calculate points
      let qualityScore = 1.0;
      let basePoints = 1;
      let bonusPoints = obs.quality_grade === 'research' ? 1 : 0;

      if (obs.quality_grade === 'research') {
        qualityScore = 1.5;
      } else if (obs.quality_grade !== 'needs_id') {
        qualityScore = 0.5;
      }

      const totalPoints = Math.round((basePoints + bonusPoints) * qualityScore);
      const apGranted = 1;
      const tileId = existingTiles.get(obs.h3_index) || null;

      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO observations (
            inat_observation_id, player_id, latitude, longitude, h3_index, tile_id,
            taxon_id, taxon_name, taxon_common_name, taxon_iconic_group, taxon_family,
            quality_grade, quality_score, is_first_for_tile,
            base_points, bonus_points, total_points, ap_granted,
            observed_at, photo_url, processed, processed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`
        ).bind(
          obs.inat_observation_id,
          playerId,
          obs.latitude,
          obs.longitude,
          obs.h3_index,
          tileId,
          obs.taxon_id || null,
          obs.taxon_name || null,
          obs.taxon_common_name || null,
          obs.taxon_iconic_group || null,
          obs.taxon_family || null,
          obs.quality_grade,
          qualityScore,
          basePoints,
          bonusPoints,
          totalPoints,
          apGranted,
          obs.observed_at,
          obs.photo_url || null
        )
      );

      synced++;
      apEarned += apGranted;
      tileObsCounts.set(obs.h3_index, (tileObsCounts.get(obs.h3_index) || 0) + 1);
    }

    try {
      await env.DB.batch(statements);
    } catch (batchErr) {
      console.error('Batch insert error:', batchErr);
      // Continue with next batch even if one fails
    }
  }

  // Step 4: Update tile observation counts in batch
  const tileUpdateStmts = Array.from(tileObsCounts.entries()).map(([h3, count]) =>
    env.DB.prepare(
      `UPDATE tiles SET
        total_observations = total_observations + ?,
        last_activity_at = datetime('now'),
        updated_at = datetime('now')
       WHERE h3_index = ?`
    ).bind(count, h3)
  );

  for (let i = 0; i < tileUpdateStmts.length; i += 50) {
    const batch = tileUpdateStmts.slice(i, i + 50);
    try {
      await env.DB.batch(batch);
    } catch (e) {
      console.error('Tile update batch error:', e);
    }
  }

  // Step 5: Update player stats
  await env.DB.prepare(
    `UPDATE players SET
      total_observations = total_observations + ?,
      action_points = action_points + ?,
      ap_earned_today = ap_earned_today + ?,
      updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(synced, apEarned, apEarned, playerId)
    .run();

  return json({
    synced,
    skipped,
    ap_earned: apEarned,
  });
});

// Get player observations
router.get('/players/:id/observations', async (request, env, params) => {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  const observations = await env.DB.prepare(
    `SELECT * FROM observations
     WHERE player_id = ?
     ORDER BY observed_at DESC
     LIMIT ? OFFSET ?`
  )
    .bind(params.id, limit, offset)
    .all();

  return json(observations.results);
});

// ============================================
// ACTIONS (AP Spending)
// ============================================

router.post('/actions', async (request, env) => {
  const body = await request.json() as {
    player_id: number;
    tile_h3_index: string;
    action_type: 'claim' | 'fortify' | 'scout' | 'contest';
  };

  const { player_id, tile_h3_index, action_type } = body;
  const validActions = ['claim', 'fortify', 'scout', 'contest'];

  if (!player_id || !tile_h3_index || !validActions.includes(action_type)) {
    return error('player_id, tile_h3_index, and valid action_type required');
  }

  // Get player
  const player = await env.DB.prepare(`SELECT * FROM players WHERE id = ?`)
    .bind(player_id)
    .first<{
      id: number;
      inat_username: string;
      action_points: number;
      faction_id: number | null;
      class: string;
    }>();

  if (!player) {
    return error('Player not found', 404);
  }

  if (player.action_points < 1) {
    return error('Not enough AP. Submit observations to earn more!');
  }

  // Get or create tile
  let tile = await env.DB.prepare(`SELECT * FROM tiles WHERE h3_index = ?`)
    .bind(tile_h3_index)
    .first<{
      id: number;
      h3_index: string;
      state: string;
      owner_id: number | null;
      capture_progress: number;
      defense_strength: number;
      contester_id: number | null;
      contest_progress: number;
      tile_type: string;
      is_locked: number;
    }>();

  if (!tile) {
    // Create tile
    const newTile = await env.DB.prepare(
      `INSERT INTO tiles (h3_index, resolution) VALUES (?, ?) RETURNING *`
    )
      .bind(tile_h3_index, 8)
      .first();
    tile = newTile as typeof tile;
  }

  if (!tile) {
    return error('Failed to get/create tile');
  }

  if (tile.is_locked) {
    return error('This tile is locked. Complete the unlock quest first.');
  }

  // Check daily limits
  const today = new Date().toISOString().split('T')[0];
  const dailyLimit = await env.DB.prepare(
    `SELECT * FROM player_daily_limits
     WHERE player_id = ? AND tile_id = ? AND date = ?`
  )
    .bind(player_id, tile.id, today)
    .first<{ actions_count: number; contest_count: number }>();

  const maxActionsPerTile = 10;
  const maxContestsPerTile = 3;

  if (dailyLimit && dailyLimit.actions_count >= maxActionsPerTile) {
    return error('Daily action limit reached for this tile. Try another tile!');
  }

  if (
    action_type === 'contest' &&
    dailyLimit &&
    dailyLimit.contest_count >= maxContestsPerTile
  ) {
    return error('Daily contest limit reached for this tile.');
  }

  // Process action
  let progressAdded = 0;
  let result: Record<string, unknown> = {};
  const apSpent = 1;

  // Calculate class bonus
  let classBonus = 1.0;
  // Class bonuses could be expanded based on tile biome

  switch (action_type) {
    case 'claim': {
      if (tile.owner_id === player_id) {
        return error('You already own this tile. Try fortify instead.');
      }

      if (tile.state === 'contested' && tile.contester_id !== player_id) {
        return error('Another player is contesting this tile.');
      }

      progressAdded = Math.round(10 * classBonus);

      if (tile.state === 'neutral' || tile.owner_id === null) {
        // Claiming neutral tile
        const newProgress = tile.capture_progress + progressAdded;

        if (newProgress >= 100) {
          // Tile captured!
          await env.DB.prepare(
            `UPDATE tiles SET
              state = 'claimed', owner_id = ?, owner_faction_id = ?,
              capture_progress = 100, last_activity_at = datetime('now'),
              updated_at = datetime('now')
             WHERE id = ?`
          )
            .bind(player_id, player.faction_id, tile.id)
            .run();

          // Update player tile count
          await env.DB.prepare(
            `UPDATE players SET tiles_owned = tiles_owned + 1 WHERE id = ?`
          )
            .bind(player_id)
            .run();

          // Log history
          await env.DB.prepare(
            `INSERT INTO tile_history (tile_id, event_type, new_owner_id, new_faction_id)
             VALUES (?, 'claimed', ?, ?)`
          )
            .bind(tile.id, player_id, player.faction_id)
            .run();

          // Activity log
          await env.DB.prepare(
            `INSERT INTO activity_log (event_type, player_id, tile_id, headline, is_global)
             VALUES ('tile_captured', ?, ?, ?, 1)`
          )
            .bind(player_id, tile.id, `${player.inat_username} captured a tile!`)
            .run();

          result = { captured: true, new_progress: 100 };
        } else {
          await env.DB.prepare(
            `UPDATE tiles SET capture_progress = ?, last_activity_at = datetime('now'),
             updated_at = datetime('now') WHERE id = ?`
          )
            .bind(newProgress, tile.id)
            .run();

          result = { captured: false, new_progress: newProgress };
        }
      } else {
        // Need to contest first
        return error('This tile is owned. Use contest action first.');
      }
      break;
    }

    case 'fortify': {
      if (tile.owner_id !== player_id) {
        return error('You can only fortify tiles you own.');
      }

      progressAdded = Math.round(5 * classBonus);
      const newDefense = Math.min(tile.defense_strength + progressAdded, 100);

      await env.DB.prepare(
        `UPDATE tiles SET
          state = 'fortified', defense_strength = ?,
          last_activity_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      )
        .bind(newDefense, tile.id)
        .run();

      if (tile.state !== 'fortified') {
        await env.DB.prepare(
          `INSERT INTO tile_history (tile_id, event_type, new_owner_id)
           VALUES (?, 'fortified', ?)`
        )
          .bind(tile.id, player_id)
          .run();
      }

      result = { fortified: true, new_defense: newDefense };
      break;
    }

    case 'scout': {
      // Scout reveals info about tile - useful for finding high-value targets
      // Returns tile stats and nearby opportunities
      const nearbyTiles = await env.DB.prepare(
        `SELECT h3_index, state, owner_id, total_observations, unique_species
         FROM tiles
         WHERE state = 'neutral' OR owner_id IS NULL
         ORDER BY RANDOM() LIMIT 5`
      ).all();

      result = {
        scouted: true,
        tile_info: {
          total_observations: tile.total_observations || 0,
          state: tile.state,
          owner_id: tile.owner_id,
        },
        nearby_opportunities: nearbyTiles.results,
      };
      break;
    }

    case 'contest': {
      if (tile.owner_id === null || tile.state === 'neutral') {
        return error('Cannot contest neutral tile. Use claim instead.');
      }

      if (tile.owner_id === player_id) {
        return error('Cannot contest your own tile.');
      }

      progressAdded = Math.round(8 * classBonus);

      // Account for defense
      const effectiveProgress = Math.max(
        1,
        progressAdded - Math.floor(tile.defense_strength / 10)
      );
      const newContestProgress = (tile.contest_progress || 0) + effectiveProgress;

      if (tile.contester_id && tile.contester_id !== player_id) {
        // Someone else is contesting - they get priority
        return error('Another player is already contesting this tile.');
      }

      if (newContestProgress >= 100) {
        // Tile becomes contested - flip begins
        await env.DB.prepare(
          `UPDATE tiles SET
            state = 'contested', contester_id = ?, contest_progress = 100,
            last_contested_at = datetime('now'), last_activity_at = datetime('now'),
            updated_at = datetime('now')
           WHERE id = ?`
        )
          .bind(player_id, tile.id)
          .run();

        // Start capture progress for contester
        await env.DB.prepare(
          `UPDATE tiles SET capture_progress = 0 WHERE id = ?`
        )
          .bind(tile.id)
          .run();

        await env.DB.prepare(
          `INSERT INTO tile_history (tile_id, event_type, old_owner_id, new_owner_id)
           VALUES (?, 'contested', ?, ?)`
        )
          .bind(tile.id, tile.owner_id, player_id)
          .run();

        await env.DB.prepare(
          `INSERT INTO activity_log (event_type, player_id, tile_id, headline, is_global)
           VALUES ('tile_contested', ?, ?, ?, 1)`
        )
          .bind(player_id, tile.id, `${player.inat_username} is contesting a tile!`)
          .run();

        result = { contested: true, flipping: true, contest_progress: 100 };
      } else {
        await env.DB.prepare(
          `UPDATE tiles SET
            contester_id = ?, contest_progress = ?,
            last_activity_at = datetime('now'), updated_at = datetime('now')
           WHERE id = ?`
        )
          .bind(player_id, newContestProgress, tile.id)
          .run();

        result = { contested: false, contest_progress: newContestProgress };
      }
      break;
    }
  }

  // Deduct AP
  await env.DB.prepare(
    `UPDATE players SET action_points = action_points - ? WHERE id = ?`
  )
    .bind(apSpent, player_id)
    .run();

  // Record action
  await env.DB.prepare(
    `INSERT INTO actions (player_id, tile_id, action_type, ap_spent, progress_added, result)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(player_id, tile.id, action_type, apSpent, progressAdded, JSON.stringify(result))
    .run();

  // Update daily limits
  await env.DB.prepare(
    `INSERT INTO player_daily_limits (player_id, tile_id, date, actions_count, contest_count)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(player_id, tile_id, date) DO UPDATE SET
       actions_count = actions_count + 1,
       contest_count = contest_count + ?`
  )
    .bind(
      player_id,
      tile.id,
      today,
      action_type === 'contest' ? 1 : 0,
      action_type === 'contest' ? 1 : 0
    )
    .run();

  return json({
    success: true,
    action_type,
    ap_spent: apSpent,
    ap_remaining: player.action_points - apSpent,
    progress_added: progressAdded,
    result,
  });
});

// ============================================
// QUESTS
// ============================================

// Get available quests for player
router.get('/players/:id/quests', async (request, env, params) => {
  const today = new Date().toISOString().split('T')[0];
  const weekStart = getWeekStart();

  // Get all active quests with player progress
  const quests = await env.DB.prepare(
    `SELECT q.*, pq.progress, pq.target, pq.is_complete, pq.reset_period
     FROM quests q
     LEFT JOIN player_quests pq ON q.id = pq.quest_id AND pq.player_id = ?
       AND (
         (q.quest_type = 'daily' AND pq.reset_period = ?) OR
         (q.quest_type = 'weekly' AND pq.reset_period = ?) OR
         (q.quest_type NOT IN ('daily', 'weekly'))
       )
     WHERE q.is_active = 1
     ORDER BY q.quest_type, q.id`
  )
    .bind(params.id, today, weekStart)
    .all();

  return json(quests.results);
});

// Update quest progress
router.post('/players/:id/quests/:questId/progress', async (request, env, params) => {
  const body = await request.json() as { progress: number };
  const playerId = parseInt(params.id);
  const questId = parseInt(params.questId);

  const quest = await env.DB.prepare(`SELECT * FROM quests WHERE id = ?`)
    .bind(questId)
    .first<{
      id: number;
      quest_type: string;
      requirements: string;
      rewards: string;
    }>();

  if (!quest) {
    return error('Quest not found', 404);
  }

  const requirements = JSON.parse(quest.requirements) as { count: number };
  const target = requirements.count || 1;
  const newProgress = body.progress;
  const isComplete = newProgress >= target;

  const resetPeriod =
    quest.quest_type === 'daily'
      ? new Date().toISOString().split('T')[0]
      : quest.quest_type === 'weekly'
      ? getWeekStart()
      : null;

  // Upsert progress
  await env.DB.prepare(
    `INSERT INTO player_quests (player_id, quest_id, progress, target, is_complete, completed_at, reset_period)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(player_id, quest_id, reset_period) DO UPDATE SET
       progress = ?,
       is_complete = ?,
       completed_at = CASE WHEN ? = 1 AND is_complete = 0 THEN datetime('now') ELSE completed_at END`
  )
    .bind(
      playerId,
      questId,
      newProgress,
      target,
      isComplete ? 1 : 0,
      isComplete ? new Date().toISOString() : null,
      resetPeriod,
      newProgress,
      isComplete ? 1 : 0,
      isComplete ? 1 : 0
    )
    .run();

  // Grant rewards if just completed
  if (isComplete) {
    const rewards = JSON.parse(quest.rewards) as {
      ap?: number;
      points?: number;
      cosmetic?: string;
      title?: string;
    };

    if (rewards.ap) {
      await env.DB.prepare(
        `UPDATE players SET action_points = action_points + ? WHERE id = ?`
      )
        .bind(rewards.ap, playerId)
        .run();
    }

    if (rewards.points) {
      await env.DB.prepare(
        `UPDATE players SET total_points = total_points + ?, season_points = season_points + ? WHERE id = ?`
      )
        .bind(rewards.points, rewards.points, playerId)
        .run();
    }

    // Cosmetic rewards handled separately
  }

  return json({ progress: newProgress, target, is_complete: isComplete });
});

// ============================================
// ACHIEVEMENTS
// ============================================

// Get player achievements
router.get('/players/:id/achievements', async (request, env, params) => {
  const achievements = await env.DB.prepare(
    `SELECT a.*, pa.unlocked_at
     FROM achievements a
     LEFT JOIN player_achievements pa ON a.id = pa.achievement_id AND pa.player_id = ?
     WHERE a.is_hidden = 0 OR pa.unlocked_at IS NOT NULL
     ORDER BY a.category, a.tier`
  )
    .bind(params.id)
    .all();

  return json(achievements.results);
});

// Check and grant achievement
router.post('/players/:id/achievements/check', async (request, env, params) => {
  const playerId = parseInt(params.id);

  // Get player stats
  const player = await env.DB.prepare(`SELECT * FROM players WHERE id = ?`)
    .bind(playerId)
    .first<{
      total_observations: number;
      tiles_owned: number;
      longest_streak: number;
    }>();

  if (!player) {
    return error('Player not found', 404);
  }

  // Get unique species count
  const speciesCount = await env.DB.prepare(
    `SELECT COUNT(DISTINCT taxon_id) as count FROM observations WHERE player_id = ? AND taxon_id IS NOT NULL`
  )
    .bind(playerId)
    .first<{ count: number }>();

  // Get unearned achievements
  const unearned = await env.DB.prepare(
    `SELECT a.* FROM achievements a
     WHERE a.id NOT IN (SELECT achievement_id FROM player_achievements WHERE player_id = ?)`
  )
    .bind(playerId)
    .all<{
      id: number;
      name: string;
      requirements: string;
      rewards: string;
    }>();

  const newlyUnlocked: string[] = [];

  for (const achievement of unearned.results) {
    const req = JSON.parse(achievement.requirements) as {
      type: string;
      count: number;
    };
    let qualified = false;

    switch (req.type) {
      case 'observations':
        qualified = player.total_observations >= req.count;
        break;
      case 'tiles_claimed':
      case 'tiles_owned':
        qualified = player.tiles_owned >= req.count;
        break;
      case 'unique_species':
        qualified = (speciesCount?.count || 0) >= req.count;
        break;
      case 'streak':
        qualified = player.longest_streak >= req.count;
        break;
    }

    if (qualified) {
      await env.DB.prepare(
        `INSERT INTO player_achievements (player_id, achievement_id) VALUES (?, ?)`
      )
        .bind(playerId, achievement.id)
        .run();

      newlyUnlocked.push(achievement.name);

      // Grant rewards
      const rewards = JSON.parse(achievement.rewards || '{}') as {
        title?: string;
        ap?: number;
      };
      if (rewards.title) {
        // Could auto-equip or just unlock
      }
      if (rewards.ap) {
        await env.DB.prepare(
          `UPDATE players SET action_points = action_points + ? WHERE id = ?`
        )
          .bind(rewards.ap, playerId)
          .run();
      }

      // Activity log
      await env.DB.prepare(
        `INSERT INTO activity_log (event_type, player_id, headline, is_global)
         VALUES ('achievement_unlocked', ?, ?, 0)`
      )
        .bind(playerId, `Unlocked: ${achievement.name}`)
        .run();
    }
  }

  return json({ newly_unlocked: newlyUnlocked });
});

// ============================================
// FACTIONS
// ============================================

router.get('/factions', async (request, env) => {
  const factions = await env.DB.prepare(
    `SELECT f.*,
       (SELECT COUNT(*) FROM players WHERE faction_id = f.id) as member_count,
       (SELECT COUNT(*) FROM tiles WHERE owner_faction_id = f.id) as tiles_owned
     FROM factions f
     ORDER BY tiles_owned DESC`
  ).all();

  return json(factions.results);
});

router.get('/factions/:id', async (request, env, params) => {
  const faction = await env.DB.prepare(
    `SELECT f.*,
       (SELECT COUNT(*) FROM players WHERE faction_id = f.id) as member_count,
       (SELECT COUNT(*) FROM tiles WHERE owner_faction_id = f.id) as tiles_owned
     FROM factions f WHERE f.id = ?`
  )
    .bind(params.id)
    .first();

  if (!faction) {
    return error('Faction not found', 404);
  }

  // Get top members
  const topMembers = await env.DB.prepare(
    `SELECT id, inat_username, inat_display_name, total_points, tiles_owned
     FROM players WHERE faction_id = ?
     ORDER BY season_points DESC LIMIT 10`
  )
    .bind(params.id)
    .all();

  return json({ ...faction, top_members: topMembers.results });
});

// ============================================
// LEADERBOARDS
// ============================================

router.get('/leaderboards/:type', async (request, env, params) => {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const period = url.searchParams.get('period') || null;

  let query: string;
  let bindings: unknown[];

  switch (params.type) {
    case 'global':
      query = `SELECT id, inat_username, inat_display_name, inat_icon_url,
                      total_points, tiles_owned, faction_id, class
               FROM players ORDER BY total_points DESC LIMIT ?`;
      bindings = [limit];
      break;

    case 'season':
      query = `SELECT id, inat_username, inat_display_name, inat_icon_url,
                      season_points, tiles_owned, faction_id, class
               FROM players ORDER BY season_points DESC LIMIT ?`;
      bindings = [limit];
      break;

    case 'tiles':
      query = `SELECT id, inat_username, inat_display_name, inat_icon_url,
                      tiles_owned, faction_id, class
               FROM players ORDER BY tiles_owned DESC LIMIT ?`;
      bindings = [limit];
      break;

    case 'observations':
      query = `SELECT id, inat_username, inat_display_name, inat_icon_url,
                      total_observations, faction_id, class
               FROM players ORDER BY total_observations DESC LIMIT ?`;
      bindings = [limit];
      break;

    case 'factions':
      return json(
        (
          await env.DB.prepare(
            `SELECT f.id, f.name, f.color,
                    COUNT(DISTINCT p.id) as members,
                    SUM(p.season_points) as total_points,
                    COUNT(DISTINCT t.id) as tiles_owned
             FROM factions f
             LEFT JOIN players p ON p.faction_id = f.id
             LEFT JOIN tiles t ON t.owner_faction_id = f.id
             GROUP BY f.id
             ORDER BY tiles_owned DESC`
          ).all()
        ).results
      );

    default:
      return error('Unknown leaderboard type');
  }

  const results = await env.DB.prepare(query).bind(...bindings).all();
  return json(results.results);
});

// ============================================
// ACTIVITY LOG
// ============================================

router.get('/activity', async (request, env) => {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const global_only = url.searchParams.get('global') === 'true';

  let query = `SELECT * FROM activity_log`;
  if (global_only) {
    query += ` WHERE is_global = 1`;
  }
  query += ` ORDER BY created_at DESC LIMIT ?`;

  const results = await env.DB.prepare(query).bind(limit).all();
  return json(results.results);
});

// ============================================
// SEASONS
// ============================================

router.get('/seasons/current', async (request, env) => {
  const season = await env.DB.prepare(
    `SELECT * FROM seasons WHERE is_active = 1 ORDER BY start_date DESC LIMIT 1`
  ).first();

  return json(season || { error: 'No active season' });
});

// ============================================
// STATS
// ============================================

router.get('/stats', async (request, env) => {
  const [players, tiles, observations, factions] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) as count FROM players`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) as count FROM tiles WHERE owner_id IS NOT NULL`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) as count FROM observations`).first<{ count: number }>(),
    env.DB.prepare(
      `SELECT f.name, f.color, COUNT(t.id) as tiles
       FROM factions f
       LEFT JOIN tiles t ON t.owner_faction_id = f.id
       GROUP BY f.id`
    ).all(),
  ]);

  return json({
    total_players: players?.count || 0,
    claimed_tiles: tiles?.count || 0,
    total_observations: observations?.count || 0,
    faction_territories: factions.results,
  });
});

// ============================================
// TILE BIOMES (Land Cover Data)
// ============================================

// Get all land cover classes with colors
router.get('/biomes/classes', async (request, env) => {
  const classes = await env.DB.prepare(
    `SELECT code, name, biome_type, color, description FROM landcover_classes ORDER BY code`
  ).all();

  return json(classes.results);
});

// Get biome data for specific tiles (batch lookup)
// Uses D1 for res3-5, R2 for res7+
router.post('/biomes/lookup', async (request, env) => {
  const body = await request.json() as { h3_indices: string[] };
  const { h3_indices } = body;

  if (!h3_indices || !Array.isArray(h3_indices) || h3_indices.length === 0) {
    return error('h3_indices array required');
  }

  // Limit to prevent abuse
  const indices = h3_indices.slice(0, 1000);

  // Separate indices by resolution (H3 index length indicates resolution)
  // res3 = 9 chars, res5 = 10 chars, res7 = 11 chars
  const lowResIndices: string[] = []; // res 3-5 -> D1
  const highResIndices: string[] = []; // res 7+ -> R2

  for (const idx of indices) {
    if (idx.length <= 10) {
      lowResIndices.push(idx);
    } else {
      highResIndices.push(idx);
    }
  }

  const biomeMap: Record<string, { biome: string; code: number }> = {};

  // Query D1 for res3-5 tiles
  if (lowResIndices.length > 0) {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < lowResIndices.length; i += CHUNK_SIZE) {
      const chunk = lowResIndices.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');

      const biomes = await env.DB.prepare(
        `SELECT h3_index, biome_type, landcover_code FROM tile_biomes WHERE h3_index IN (${placeholders})`
      )
        .bind(...chunk)
        .all<{ h3_index: string; biome_type: string; landcover_code: number }>();

      for (const row of biomes.results) {
        biomeMap[row.h3_index] = {
          biome: row.biome_type,
          code: row.landcover_code,
        };
      }
    }
  }

  // Query R2 for res7+ tiles
  if (highResIndices.length > 0 && env.BIOME_TILES) {
    // Group by prefix (first 4 chars)
    const PREFIX_LENGTH = 4;
    const byPrefix = new Map<string, string[]>();

    for (const idx of highResIndices) {
      const prefix = idx.substring(0, PREFIX_LENGTH);
      if (!byPrefix.has(prefix)) {
        byPrefix.set(prefix, []);
      }
      byPrefix.get(prefix)!.push(idx);
    }

    // Fetch each required chunk from R2
    for (const [prefix, prefixIndices] of byPrefix) {
      try {
        // Check in-memory cache first
        const cached = r2ChunkCache.get(prefix);
        if (cached && Date.now() - cached.timestamp < R2_CACHE_TTL) {
          // Use cached data
          for (const idx of prefixIndices) {
            const data = cached.data[idx];
            if (data) {
              biomeMap[idx] = data;
            }
          }
          continue;
        }

        // Fetch from R2
        const object = await env.BIOME_TILES.get(`res7/${prefix}.json.gz`);
        if (!object) {
          continue; // Chunk doesn't exist
        }

        // Decompress and parse
        const compressed = await object.arrayBuffer();
        const decompressed = await decompressGzip(compressed);
        const chunkData = JSON.parse(decompressed) as Record<string, { code: number; biome: string }>;

        // Cache it
        r2ChunkCache.set(prefix, { data: chunkData, timestamp: Date.now() });

        // Extract requested indices
        for (const idx of prefixIndices) {
          const data = chunkData[idx];
          if (data) {
            biomeMap[idx] = data;
          }
        }
      } catch (e) {
        console.error(`Error fetching R2 chunk ${prefix}:`, e);
      }
    }
  }

  return json(biomeMap);
});

// Helper to decompress gzip data
async function decompressGzip(data: ArrayBuffer): Promise<string> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(data));
  writer.close();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(result);
}

// Get biomes for a bounding box (for map rendering)
router.get('/biomes/bounds', async (request, env) => {
  const url = new URL(request.url);
  const resolution = parseInt(url.searchParams.get('resolution') || '5');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '5000'), 10000);

  // For now, just return all biomes at a resolution (can optimize with spatial query later)
  const biomes = await env.DB.prepare(
    `SELECT h3_index, biome_type, landcover_code
     FROM tile_biomes
     WHERE resolution = ?
     LIMIT ?`
  )
    .bind(resolution, limit)
    .all<{ h3_index: string; biome_type: string; landcover_code: number }>();

  return json(biomes.results);
});

// Batch import biome data (admin endpoint)
router.post('/biomes/import', async (request, env) => {
  const body = await request.json() as {
    biomes: Array<{
      h3: string;
      code: number;
      biome: string;
    }>;
    resolution: number;
  };

  const { biomes, resolution } = body;

  if (!biomes || !Array.isArray(biomes)) {
    return error('biomes array required');
  }

  if (!resolution || resolution < 0 || resolution > 15) {
    return error('valid resolution (0-15) required');
  }

  // Process in batches
  const BATCH_SIZE = 50;
  let imported = 0;
  let errors = 0;

  for (let i = 0; i < biomes.length; i += BATCH_SIZE) {
    const batch = biomes.slice(i, i + BATCH_SIZE);

    const statements = batch.map(b =>
      env.DB.prepare(
        `INSERT OR REPLACE INTO tile_biomes (h3_index, resolution, landcover_code, biome_type)
         VALUES (?, ?, ?, ?)`
      ).bind(b.h3, resolution, b.code, b.biome)
    );

    try {
      await env.DB.batch(statements);
      imported += batch.length;
    } catch (e) {
      console.error('Batch import error:', e);
      errors += batch.length;
    }
  }

  return json({
    imported,
    errors,
    total: biomes.length,
  });
});

// Get biome stats
router.get('/biomes/stats', async (request, env) => {
  const stats = await env.DB.prepare(
    `SELECT
       resolution,
       biome_type,
       COUNT(*) as count
     FROM tile_biomes
     GROUP BY resolution, biome_type
     ORDER BY resolution, count DESC`
  ).all();

  // Also get totals by resolution
  const totals = await env.DB.prepare(
    `SELECT resolution, COUNT(*) as count FROM tile_biomes GROUP BY resolution`
  ).all();

  return json({
    by_biome: stats.results,
    totals: totals.results,
  });
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function getWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0];
}

// ============================================
// MAIN HANDLER
// ============================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return router.handle(request, env);
  },
};
