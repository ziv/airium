import source from './sensors.json';
import { validateSection } from '../sim/validate';

export interface SensorConfig {
  azimuth: number;
  elevation: number;
  maxRange: number;
  referenceRadius: number;
  updateHz: number;
  terrainLOS: boolean;
  sampleSpacing: number;
}
export function validateSensors(input: unknown): SensorConfig {
  return validateSection<SensorConfig>('sensors', input, {
    azimuth: { min: 1, max: 89 },
    elevation: { min: 1, max: 89 },
    maxRange: { min: 1000, max: 200000 },
    referenceRadius: { min: 1, max: 100 },
    updateHz: { min: 0.1, max: 60 },
    terrainLOS: { type: 'boolean' },
    sampleSpacing: { min: 50, max: 5000 },
  });
}
export const SENSORS = validateSensors(source);
