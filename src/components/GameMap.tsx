import { useEffect, useMemo, useState, useCallback, memo } from 'react';
import { MapContainer, TileLayer, useMapEvents, Polygon, CircleMarker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import type { Observation, Tile, IconicTaxon } from '../types';
import { TAXA_COLORS, BIOME_COLORS } from '../types';
import type { MapViewState } from '../hooks';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icon issue with bundlers
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// Extended tile type with pre-computed boundary
interface TileWithBoundary extends Tile {
  boundary?: [number, number][];
}

interface GameMapProps {
  observations: Observation[];
  tiles: TileWithBoundary[];
  selectedTile: string | null;
  onTileSelect: (h3Index: string | null) => void;
  onViewStateChange: (viewState: MapViewState) => void;
  initialCenter?: [number, number];
  initialZoom?: number;
  flyToPosition?: [number, number] | null;
}

// Map event handler component
function MapEventHandler({
  onViewStateChange
}: {
  onViewStateChange: (viewState: MapViewState) => void;
}) {
  const map = useMapEvents({
    moveend: () => {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      onViewStateChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
        zoom
      });
    },
    zoomend: () => {
      const bounds = map.getBounds();
      const zoom = map.getZoom();
      onViewStateChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
        zoom
      });
    }
  });

  useEffect(() => {
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    onViewStateChange({
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
      zoom
    });
  }, [map, onViewStateChange]);

  return null;
}

// Component to fly to a location
function MapController({ center, zoom }: { center?: [number, number]; zoom?: number }) {
  const map = useMap();

  useEffect(() => {
    if (center) {
      map.flyTo(center, zoom || map.getZoom(), { duration: 1 });
    }
  }, [map, center, zoom]);

  return null;
}

// Memoized Hexagon tile component - uses pre-computed boundary
const HexTile = memo(function HexTile({
  tile,
  isSelected,
  onClick
}: {
  tile: TileWithBoundary;
  isSelected: boolean;
  onClick: () => void;
}) {
  // Use pre-computed boundary from tile, avoid H3 calculation on render
  const boundary = tile.boundary;

  if (!boundary || boundary.length === 0) {
    return null;
  }

  // Always use biome color for fill
  const fillColor = BIOME_COLORS[tile.biome_type] || BIOME_COLORS.unknown;

  // Ownership indicated by border color and opacity
  const hasOwner = !!tile.owner_id;
  const fillOpacity = tile.total_observations > 0 ? (hasOwner ? 0.5 : 0.3) : 0.15;
  const borderColor = isSelected ? '#FFFFFF' : hasOwner ? '#73AC13' : 'rgba(255,255,255,0.3)';
  const borderWeight = isSelected ? 3 : hasOwner ? 2 : 1;

  return (
    <Polygon
      positions={boundary}
      pathOptions={{
        fillColor,
        fillOpacity: isSelected ? 0.7 : fillOpacity,
        color: borderColor,
        weight: borderWeight
      }}
      eventHandlers={{
        click: (e) => {
          e.originalEvent.stopPropagation();
          onClick();
        }
      }}
    />
  );
});

// Memoized Observation marker component
const ObservationMarker = memo(function ObservationMarker({ observation }: { observation: Observation }) {
  const taxaColor = TAXA_COLORS[observation.iconic_taxon as IconicTaxon] || TAXA_COLORS.unknown;

  return (
    <CircleMarker
      center={[observation.latitude, observation.longitude]}
      radius={8}
      pathOptions={{
        fillColor: taxaColor,
        fillOpacity: 0.9,
        color: 'white',
        weight: 2
      }}
    >
      <Popup>
        <div className="popup-content">
          {observation.photo_url && (
            <img
              src={observation.photo_url}
              alt={observation.species_name || 'Observation'}
              className="popup-image"
              loading="lazy"
            />
          )}

          <div className="popup-details">
            <h3 className="popup-title">
              {observation.common_name || observation.species_name || 'Unknown Species'}
            </h3>

            {observation.species_name && observation.common_name && (
              <p className="popup-species">
                {observation.species_name}
              </p>
            )}

            <span
              className="taxa-pill"
              style={{
                backgroundColor: `${taxaColor}22`,
                color: taxaColor,
                border: `1px solid ${taxaColor}44`
              }}
            >
              {observation.iconic_taxon}
            </span>

            <div className="popup-meta">
              <span className="popup-date">
                {new Date(observation.observed_at).toLocaleDateString()}
              </span>
              <span className="popup-points">
                +{observation.total_points} pts
              </span>
            </div>

            {observation.is_research_grade && (
              <div className="popup-badge">
                <span>✓</span> Research Grade
              </div>
            )}

            <div className="popup-user">
              {observation.pfp_url && (
                <img
                  src={observation.pfp_url}
                  alt={observation.username}
                  className="popup-avatar"
                  loading="lazy"
                />
              )}
              <span>@{observation.username}</span>
            </div>

            <a
              href={observation.inat_url}
              target="_blank"
              rel="noopener noreferrer"
              className="popup-link"
            >
              View on iNaturalist →
            </a>
          </div>
        </div>
      </Popup>
    </CircleMarker>
  );
});

// Hexagon layer - renders tiles with pre-computed boundaries
const HexagonLayer = memo(function HexagonLayer({
  tiles,
  selectedTile,
  onTileSelect
}: {
  tiles: TileWithBoundary[];
  selectedTile: string | null;
  onTileSelect: (h3Index: string | null) => void;
}) {
  // Only render tiles that have boundaries
  const validTiles = useMemo(() =>
    tiles.filter(tile => tile.boundary && tile.boundary.length > 0),
    [tiles]
  );

  return (
    <>
      {validTiles.map(tile => (
        <HexTile
          key={tile.h3_index}
          tile={tile}
          isSelected={selectedTile === tile.h3_index}
          onClick={() => onTileSelect(tile.h3_index === selectedTile ? null : tile.h3_index)}
        />
      ))}
    </>
  );
});

// Custom cluster icon
const createClusterCustomIcon = (cluster: { getChildCount: () => number }) => {
  const count = cluster.getChildCount();
  let size = 'small';
  if (count > 50) size = 'large';
  else if (count > 10) size = 'medium';

  return L.divIcon({
    html: `<div class="cluster-icon cluster-${size}">${count}</div>`,
    className: 'custom-cluster',
    iconSize: L.point(40, 40, true),
  });
};

// Observations layer with clustering
const ObservationsLayer = memo(function ObservationsLayer({
  observations
}: {
  observations: Observation[];
}) {
  if (observations.length === 0) {
    return null;
  }

  return (
    <MarkerClusterGroup
      chunkedLoading
      iconCreateFunction={createClusterCustomIcon}
      maxClusterRadius={60}
      spiderfyOnMaxZoom={true}
      showCoverageOnHover={false}
      disableClusteringAtZoom={18}
      animate={false}
      removeOutsideVisibleBounds={true}
    >
      {observations.map(obs => (
        <ObservationMarker key={obs.id} observation={obs} />
      ))}
    </MarkerClusterGroup>
  );
});

export default function GameMap({
  observations,
  tiles,
  selectedTile,
  onTileSelect,
  onViewStateChange,
  initialCenter,
  initialZoom,
  flyToPosition
}: GameMapProps) {
  const [mapCenter, setMapCenter] = useState<[number, number] | undefined>(initialCenter);

  // Update map center when flyToPosition changes
  useEffect(() => {
    if (flyToPosition) {
      setMapCenter(flyToPosition);
    }
  }, [flyToPosition]);

  const handleViewStateChange = useCallback((viewState: MapViewState) => {
    onViewStateChange(viewState);
  }, [onViewStateChange]);

  // Default center: San Francisco (good for demo)
  const defaultCenter: [number, number] = initialCenter || [37.7749, -122.4194];
  const defaultZoom = initialZoom || 14;

  return (
    <MapContainer
      center={defaultCenter}
      zoom={defaultZoom}
      className="game-map"
      zoomControl={true}
      preferCanvas={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      <MapEventHandler onViewStateChange={handleViewStateChange} />

      {mapCenter && <MapController center={mapCenter} />}

      <HexagonLayer
        tiles={tiles}
        selectedTile={selectedTile}
        onTileSelect={onTileSelect}
      />

      <ObservationsLayer observations={observations} />
    </MapContainer>
  );
}
