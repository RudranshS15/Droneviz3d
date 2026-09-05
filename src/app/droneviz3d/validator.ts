/**
 * FlightDataValidator — validation seam between user input and valid flight data.
 * Discriminated union return: callers MUST check .ok before accessing .data.
 */

export type FlightField = 'gpsLat' | 'gpsLng' | 'altitude' | 'speed' | 'heading' | 'timestamp' | 'cameraFocalLength' | 'cameraWidth' | 'cameraHeight'

export interface RawFlightData {
  gpsLat: string; gpsLng: string; altitude: string; speed: string; heading: string
  timestamp: string; cameraFocalLength: string; cameraWidth: string; cameraHeight: string
  imuData: boolean; barometricAlt: boolean; rtkCorrections: boolean
}

export interface ValidatedFlightData {
  gpsLat: number; gpsLng: number; altitude: number; speed: number; heading: number
  timestamp: string; cameraFocalLength: number; cameraWidth: number; cameraHeight: number
  imuData: boolean; barometricAlt: boolean; rtkCorrections: boolean
}

export interface ValidationError { field: FlightField; message: string }

export type ValidationResult =
  | { readonly ok: true; readonly data: ValidatedFlightData }
  | { readonly ok: false; readonly errors: readonly ValidationError[] }

interface ValidationRule { validate: (raw: string) => boolean; message: string }

const rules: Record<FlightField, ValidationRule> = {
  gpsLat: { validate: (v) => { const n = parseFloat(v); return !isNaN(n) && n >= -90 && n <= 90 }, message: 'Latitude must be between -90 and 90' },
  gpsLng: { validate: (v) => { const n = parseFloat(v); return !isNaN(n) && n >= -180 && n <= 180 }, message: 'Longitude must be between -180 and 180' },
  altitude: { validate: (v) => { const n = parseFloat(v); return !isNaN(n) && n >= 10 && n <= 500 }, message: 'Altitude must be between 10m and 500m' },
  speed: { validate: (v) => { const n = parseFloat(v); return !isNaN(n) && n >= 0 && n <= 30 }, message: 'Speed must be between 0 and 30 m/s' },
  heading: { validate: (v) => { const n = parseFloat(v); return !isNaN(n) && n >= 0 && n <= 360 }, message: 'Heading must be between 0 and 360 degrees' },
  timestamp: { validate: (v) => !!v && !isNaN(Date.parse(v)), message: 'Timestamp must be a valid date' },
  cameraFocalLength: { validate: (v) => { const n = parseFloat(v); return !isNaN(n) && n >= 1 && n <= 200 }, message: 'Focal length must be between 1mm and 200mm' },
  cameraWidth: { validate: (v) => { const n = parseInt(v, 10); return !isNaN(n) && n >= 640 && n <= 7680 }, message: 'Frame width must be between 640px and 7680px' },
  cameraHeight: { validate: (v) => { const n = parseInt(v, 10); return !isNaN(n) && n >= 480 && n <= 4320 }, message: 'Frame height must be between 480px and 4320px' },
}

export function validateFlightData(raw: RawFlightData): ValidationResult {
  const errors: ValidationError[] = []
  for (const [field, rule] of Object.entries(rules) as [FlightField, ValidationRule][]) {
    const value = raw[field]
    if (typeof value === 'string' && !rule.validate(value)) {
      errors.push({ field, message: rule.message })
    }
  }
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    data: {
      gpsLat: parseFloat(raw.gpsLat), gpsLng: parseFloat(raw.gpsLng),
      altitude: parseFloat(raw.altitude), speed: parseFloat(raw.speed), heading: parseFloat(raw.heading),
      timestamp: raw.timestamp, cameraFocalLength: parseFloat(raw.cameraFocalLength),
      cameraWidth: parseInt(raw.cameraWidth, 10), cameraHeight: parseInt(raw.cameraHeight, 10),
      imuData: raw.imuData, barometricAlt: raw.barometricAlt, rtkCorrections: raw.rtkCorrections,
    },
  }
}
