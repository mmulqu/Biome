// Iconic taxa from iNaturalist
export type IconicTaxon =
  | 'Plantae'
  | 'Aves'
  | 'Fungi'
  | 'Insecta'
  | 'Mammalia'
  | 'Amphibia'
  | 'Reptilia'
  | 'Mollusca'
  | 'Arachnida'
  | 'Actinopterygii'
  | 'Animalia'
  | 'unknown';

// Biome types
export type BiomeType =
  | 'forest'
  | 'grassland'
  | 'wetland'
  | 'coastal'
  | 'urban'
  | 'agricultural'
  | 'alpine'
  | 'desert'
  | 'riparian'
  | 'marine'
  | 'unknown';

// Player data
export interface Player {
  id: string;
  username: string;
  display_name: string;
  pfp_url: string;
  total_points: number;
  tiles_owned: number;
  observation_count: number;
  unique_species: number;
  data_deserts_pioneered: number;
}

// Observation from iNaturalist
export interface Observation {
  id: string;
  player_id: string;
  username: string;
  pfp_url?: string;
  h3_index: string;
  taxon_id: number | null;
  iconic_taxon: IconicTaxon;
  species_name: string | null;
  common_name: string | null;
  observed_at: string;
  latitude: number;
  longitude: number;
  is_research_grade: boolean;
  photo_url: string | null;
  inat_url: string;
  base_points: number;
  taxa_multiplier: number;
  data_gap_multiplier: number;
  research_grade_bonus: number;
  total_points: number;
}

// H3 Tile data
export interface Tile {
  h3_index: string;
  biome_type: BiomeType;
  center_lat: number;
  center_lng: number;
  total_observations: number;
  unique_observers: number;
  owner_id: string | null;
  owner_username?: string;
  owner_pfp?: string;
  owner_points: number;
  is_rare: boolean;
}

// Tile score entry
export interface TileScore {
  h3_index: string;
  player_id: string;
  username: string;
  pfp_url?: string;
  total_points: number;
  observation_count: number;
}

// Leaderboard entry
export interface LeaderboardEntry {
  rank: number;
  id: string;
  username: string;
  display_name: string;
  pfp_url?: string;
  total_points: number;
  tiles_owned?: number;
  observation_count?: number;
}

// Map bounds for viewport queries
export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

// iNaturalist API response types
export interface INatObservation {
  id: number;
  observed_on_string: string;
  quality_grade: 'research' | 'needs_id' | 'casual';
  location: string | null;
  uri: string;
  taxon?: {
    id: number;
    iconic_taxon_name: string;
    name: string;
    preferred_common_name?: string;
  };
  photos?: Array<{
    url: string;
  }>;
  user: {
    id: number;
    login: string;
    name?: string;
    icon_url?: string;
  };
}

export interface INatObservationsResponse {
  total_results: number;
  page: number;
  per_page: number;
  results: INatObservation[];
}

// Scoring constants
export const SCORING = {
  BASE_POINTS: 10,
  RESEARCH_GRADE_BONUS: 1.25,
  TAXA_MATCH_MULTIPLIER: 1.5,
  DATA_GAP_THRESHOLDS: [
    { max: 0, multiplier: 3.0 },
    { max: 10, multiplier: 2.0 },
    { max: 50, multiplier: 1.5 },
    { max: 200, multiplier: 1.2 },
    { max: 500, multiplier: 1.0 },
    { max: Infinity, multiplier: 0.8 }
  ]
} as const;

// Taxa colors for UI
export const TAXA_COLORS: Record<IconicTaxon, string> = {
  Plantae: '#73AC13',
  Aves: '#1E90FF',
  Fungi: '#9932CC',
  Insecta: '#FF8C00',
  Mammalia: '#DC143C',
  Amphibia: '#20B2AA',
  Reptilia: '#228B22',
  Mollusca: '#4169E1',
  Arachnida: '#8B4513',
  Actinopterygii: '#00CED1',
  Animalia: '#1E90FF',
  unknown: '#808080'
};

// Biome colors for map
export const BIOME_COLORS: Record<BiomeType, string> = {
  forest: '#228B22',
  grassland: '#9ACD32',
  wetland: '#20B2AA',
  coastal: '#4682B4',
  urban: '#808080',
  agricultural: '#DAA520',
  alpine: '#E6E6FA',
  desert: '#DEB887',
  riparian: '#5F9EA0',
  marine: '#000080',
  unknown: '#404040'
};

// Biome bonus taxa
export const BIOME_BONUS_TAXA: Record<BiomeType, IconicTaxon[]> = {
  forest: ['Plantae', 'Fungi', 'Aves', 'Insecta', 'Mammalia'],
  grassland: ['Plantae', 'Insecta', 'Aves', 'Mammalia'],
  wetland: ['Amphibia', 'Aves', 'Plantae', 'Insecta'],
  coastal: ['Aves', 'Mollusca', 'Plantae', 'Actinopterygii'],
  urban: ['Aves', 'Insecta', 'Plantae', 'Mammalia'],
  agricultural: ['Aves', 'Insecta', 'Plantae'],
  alpine: ['Plantae', 'Aves', 'Mammalia'],
  desert: ['Reptilia', 'Arachnida', 'Plantae', 'Insecta'],
  riparian: ['Amphibia', 'Actinopterygii', 'Aves', 'Plantae', 'Insecta'],
  marine: ['Actinopterygii', 'Mollusca'],
  unknown: []
};

// H3 resolution for game tiles
export const H3_RESOLUTION = 9; // ~0.1 km² hexagons
