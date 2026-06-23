import { type Location } from '@/model';

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/** Haversine distance in kilometers between two coordinates. */
export function getDistanceKm(from: Coordinate, to: Coordinate): number {
  const R = 6371; // Earth's radius in kilometers
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const deltaLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const deltaLon = ((to.longitude - from.longitude) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Distance to a vendor = distance to its NEAREST store. Shared by the Treats
 * sort and the Locations list so both rank/show the same value (a vendor with
 * multiple stores would otherwise differ if one screen used only stores[0]).
 */
export function distanceToLocationKm(from: Coordinate, location: Location): number {
  if (!location.stores.length) return Number.POSITIVE_INFINITY;
  return Math.min(
    ...location.stores.map((store) =>
      getDistanceKm(from, { latitude: store.point[0], longitude: store.point[1] })
    )
  );
}

export function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
