import { useEffect, useMemo, useState, useCallback } from 'react';
import { MapContainer, TileLayer, useMapEvents, Polygon, CircleMarker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import * as h3 from 'h3-js';
import type { Observation, Tile, IconicTaxon } from '../types';
import { TAXA_COLORS, BIOME_COLORS } from '../types';
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

interface GameMapProps {
  observations: Observation[];
  tiles: Tile[];
  selectedTile: string | null;
  onTileSelect: (h3Index: string | null) => void;
  onBoundsChange: (bounds: { north: number; south: number; east: number; west: number }) => void;
  initialCenter?: [number, number];
  initialZoom?: number;
}

// Get hexagon boundary coordinates for Leaflet
function getHexBoundary(h3Index: string): [number, number][] {
  const boundary = h3.cellToBoundary(h3Index);
  return boundary.map(([lat, lng]) => [lat, lng] as [number, number]);
}

// Map event handler component
function MapEventHandler({
  onBoundsChange
}: {
  onBoundsChange: (bounds: { north: number; south: number; east: number; west: number }) => void
}) {
  const map = useMapEvents({
    moveend: () => {
      const bounds = map.getBounds();
      onBoundsChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      });
    },
    zoomend: () => {
      const bounds = map.getBounds();
      onBoundsChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest()
      });
    }
  });

  useEffect(() => {
    const bounds = map.getBounds();
    onBoundsChange({
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest()
    });
  }, [map, onBoundsChange]);

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

// Hexagon tile component
function HexTile({
  tile,
  isSelected,
  onClick
}: {
  tile: Tile;
  isSelected: boolean;
  onClick: () => void;
}) {
  const boundary = useMemo(() => getHexBoundary(tile.h3_index), [tile.h3_index]);

  const fillColor = tile.owner_id
    ? '#73AC13'
    : BIOME_COLORS[tile.biome_type] || BIOME_COLORS.unknown;

  const fillOpacity = tile.total_observations > 0 ? 0.4 : 0.15;

  return (
    <Polygon
      positions={boundary}
      pathOptions={{
        fillColor,
        fillOpacity: isSelected ? 0.7 : fillOpacity,
        color: isSelected ? '#73AC13' : tile.owner_id ? '#73AC13' : 'rgba(255,255,255,0.3)',
        weight: isSelected ? 3 : 1
      }}
      eventHandlers={{
        click: (e) => {
          e.originalEvent.stopPropagation();
          onClick();
        }
      }}
    />
  );
}

// Observation marker component
function ObservationMarker({ observation }: { observation: Observation }) {
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
}

// Visible hexagons renderer - only render tiles with data
function HexagonLayer({
  bounds,
  tiles,
  selectedTile,
  onTileSelect
}: {
  bounds: { north: number; south: number; east: number; west: number } | null;
  tiles: Tile[];
  selectedTile: string | null;
  onTileSelect: (h3Index: string | null) => void;
}) {
  // Only render tiles that have observations (from tiles prop)
  const visibleTiles = useMemo(() => {
    if (!bounds) return tiles;

    // Filter to tiles in view
    return tiles.filter(tile =>
      tile.center_lat >= bounds.south &&
      tile.center_lat <= bounds.north &&
      tile.center_lng >= bounds.west &&
      tile.center_lng <= bounds.east
    );
  }, [bounds, tiles]);

  return (
    <>
      {visibleTiles.map(tile => (
        <HexTile
          key={tile.h3_index}
          tile={tile}
          isSelected={selectedTile === tile.h3_index}
          onClick={() => onTileSelect(tile.h3_index === selectedTile ? null : tile.h3_index)}
        />
      ))}
    </>
  );
}

// Custom cluster icon - using any for cluster type as react-leaflet-cluster types are incomplete
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

export default function GameMap({
  observations,
  tiles,
  selectedTile,
  onTileSelect,
  onBoundsChange,
  initialCenter,
  initialZoom
}: GameMapProps) {
  const [bounds, setBounds] = useState<{ north: number; south: number; east: number; west: number } | null>(null);
  const [mapCenter] = useState<[number, number] | undefined>(initialCenter);

  const handleBoundsChange = useCallback((newBounds: typeof bounds) => {
    setBounds(newBounds);
    if (newBounds) {
      onBoundsChange(newBounds);
    }
  }, [onBoundsChange]);

  // Default center: San Francisco (good for demo)
  const defaultCenter: [number, number] = initialCenter || [37.7749, -122.4194];
  const defaultZoom = initialZoom || 14;

  return (
    <MapContainer
      center={defaultCenter}
      zoom={defaultZoom}
      className="game-map"
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      <MapEventHandler onBoundsChange={handleBoundsChange} />

      {mapCenter && <MapController center={mapCenter} />}

      <HexagonLayer
        bounds={bounds}
        tiles={tiles}
        selectedTile={selectedTile}
        onTileSelect={onTileSelect}
      />

      {/* Use marker clustering for better performance with many observations */}
      <MarkerClusterGroup
        chunkedLoading
        iconCreateFunction={createClusterCustomIcon}
        maxClusterRadius={50}
        spiderfyOnMaxZoom={true}
        showCoverageOnHover={false}
      >
        {observations.map(obs => (
          <ObservationMarker key={obs.id} observation={obs} />
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
