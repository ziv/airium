/**
 * Turns an aircraft's behaviour (straight, orbit, waypoints) into an
 * autopilot target, and advances routes. Pure.
 */
import type { AutopilotTarget } from './autopilot';
import type { AircraftEntity, Route, SurfaceEntity } from './entities';
import { type LatLon, bearing, enuOffset, groundDistance, offsetLatLon } from './geo';
import { toRadians } from './math3d';

/** Degrees of arc ahead of the aircraft to aim at on the orbit circle. */
const ORBIT_LEAD = toRadians(35);

/** Heading to fly to stay on a circle around `centre`. */
export function orbitHeading(
  position: LatLon,
  centre: LatLon,
  radius: number,
  clockwise: boolean,
  earthRadius: number,
): number {
  const fromCentre = enuOffset(centre, position, earthRadius);
  const dist = Math.hypot(fromCentre.x, fromCentre.y);
  if (dist > radius * 2.5) return bearing(position, centre, earthRadius);
  const angle = Math.atan2(fromCentre.x, fromCentre.y);
  const aimAngle = angle + (clockwise ? ORBIT_LEAD : -ORBIT_LEAD);
  const aim = offsetLatLon(
    centre,
    radius * Math.sin(aimAngle),
    radius * Math.cos(aimAngle),
    earthRadius,
  );
  return bearing(position, aim, earthRadius);
}

/** Advances the route when the current waypoint is reached; returns false when the route is finished. */
export function advanceRoute(
  route: Route,
  position: LatLon,
  captureRadius: number,
  earthRadius: number,
): boolean {
  if (route.waypoints.length === 0) return false;
  const wp = route.waypoints[route.index];
  if (wp === undefined) return false;
  if (groundDistance(position, wp, earthRadius) <= captureRadius) {
    if (route.index + 1 < route.waypoints.length) route.index += 1;
    else if (route.loop) route.index = 0;
    else return false;
  }
  return true;
}

export function aircraftTarget(e: AircraftEntity, earthRadius: number): AutopilotTarget {
  const b = e.behaviour;
  switch (b.mode) {
    case 'orbit':
      return {
        heading: orbitHeading(e, b, b.radius, b.clockwise, earthRadius),
        altitude: b.altitude,
        speed: b.speed,
      };
    case 'waypoints': {
      const speed = Math.hypot(e.velocity.x, e.velocity.y, e.velocity.z);
      const active = advanceRoute(b.route, e, Math.max(400, speed * 4), earthRadius);
      const wp = b.route.waypoints[b.route.index];
      if (!active || wp === undefined) return e.cruise;
      return {
        heading: bearing(e, wp, earthRadius),
        altitude: wp.height,
        speed: wp.speed ?? e.cruise.speed,
      };
    }
    default:
      return e.cruise;
  }
}

/** Heading and speed a surface unit should move with this step, or null when it stays put. */
export function surfaceMotion(
  e: SurfaceEntity,
  earthRadius: number,
): { heading: number; speed: number } | null {
  if (!e.route || e.type.speed <= 0) return null;
  const active = advanceRoute(e.route, e, Math.max(20, e.type.speed * 3), earthRadius);
  const wp = e.route.waypoints[e.route.index];
  if (!active || wp === undefined) return null;
  return { heading: bearing(e, wp, earthRadius), speed: wp.speed ?? e.type.speed };
}
