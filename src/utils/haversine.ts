/**
 * Computes road distance using the 1.3x circuity factor Haversine formula:
 * d = 1.3 * 2 * R * arcsin(sqrt(sin^2(Δφ/2) + cos(φ1)*cos(φ2)*sin^2(Δλ/2)))
 * where R = 6371 km.
 */

const EARTH_RADIUS_KM = 6371;
const ROAD_CIRCUITY_FACTOR = 1.3;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function computeHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  applyCircuityFactor = true
): number {
  if (lat1 === lat2 && lon1 === lon2) {
    return 0;
  }

  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  // Clamp 'a' to [0, 1] to avoid Math.asin domain errors due to floating-point imprecision
  const clampedA = Math.min(1, Math.max(0, a));
  const c = 2 * Math.asin(Math.sqrt(clampedA));

  const aerialDistance = EARTH_RADIUS_KM * c;
  const finalDistance = applyCircuityFactor
    ? aerialDistance * ROAD_CIRCUITY_FACTOR
    : aerialDistance;

  return Math.round(finalDistance * 100) / 100;
}

/**
 * Estimates driving duration in minutes assuming an average commercial heavy vehicle speed of 45 km/h
 */
export function estimateDrivingDurationMin(distanceKm: number): number {
  const avgSpeedKmh = 45;
  const durationHours = distanceKm / avgSpeedKmh;
  return Math.max(0, Math.round(durationHours * 60));
}
