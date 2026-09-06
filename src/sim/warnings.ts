import { toRadians } from './math3d';
import type { AircraftState, FlightModel, Forces } from './physics';

/** Conditions the HUD shouts about. */
export interface Warnings {
  stall: boolean;
  overG: boolean;
  overspeed: boolean;
  gearOverspeed: boolean;
  /** Low and slow with the gear up. */
  gearUp: boolean;
  engineOut: boolean;
  lowFuel: boolean;
}

/** Height above ground below which flying gear-up and slow trips the GEAR warning, metres. */
const GEAR_WARNING_AGL = 150;
/** Fraction of the fuel capacity that counts as low ("bingo"). */
const LOW_FUEL_FRACTION = 0.1;

export function warningsFor(state: AircraftState, forces: Forces, model: FlightModel): Warnings {
  const { aerodynamics: aero, limits, gear, airframe } = model.aircraft;
  const airborne = state.status === 'airborne';
  const flying = airborne && forces.airspeed >= aero.minAeroSpeed;
  const agl = state.height - state.groundHeight;
  return {
    stall: flying && Math.abs(forces.angleOfAttack) >= toRadians(aero.stallAngle) * 0.95,
    overG:
      airborne &&
      (forces.loadFactor > limits.maxLoadFactor || forces.loadFactor < limits.minLoadFactor),
    overspeed: forces.mach > limits.maxMach || forces.airspeed > limits.maxAirspeed,
    gearOverspeed: state.gear > 0.01 && forces.airspeed > gear.maxSpeed,
    gearUp:
      airborne &&
      state.gear < 0.99 &&
      agl < GEAR_WARNING_AGL &&
      state.velocity.z < 0 &&
      forces.airspeed < gear.maxSpeed,
    engineOut: state.fuel <= 0,
    lowFuel: state.fuel > 0 && state.fuel < airframe.fuelCapacity * LOW_FUEL_FRACTION,
  };
}

export function activeWarnings(w: Warnings): string[] {
  const out: string[] = [];
  if (w.stall) out.push('STALL');
  if (w.overG) out.push('OVER-G');
  if (w.overspeed) out.push('OVERSPEED');
  if (w.gearOverspeed) out.push('GEAR SPEED');
  if (w.gearUp) out.push('GEAR');
  if (w.engineOut) out.push('ENGINE OUT');
  if (w.lowFuel) out.push('BINGO FUEL');
  return out;
}
