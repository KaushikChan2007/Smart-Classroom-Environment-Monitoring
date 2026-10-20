import { getApp, getApps, initializeApp } from 'firebase/app';
import { getDatabase, onValue, ref } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const metricFields = {
  temperature: ['temperature', 'temp'],
  humidity: ['humidity'],
  airQuality: ['airQuality', 'air_quality', 'co2', 'co2ppm'],
  occupancy: ['occupancy', 'events', 'motionCount', 'motion_count'],
  light: ['light', 'lightLevel', 'light_level', 'lux'],
  noise: ['noise', 'noiseLevel', 'noise_level', 'soundLevel', 'sound_level'],
};
const statusFields = {
  occupancy: 'motion_status',
  light: 'light_status',
  noise: 'sound_status',
};

export function isFirebaseConfigured() {
  return Object.values(firebaseConfig).every((value) => typeof value === 'string' && value.trim());
}

function parseTimestamp(value) {
  if (value === undefined || value === null) return Date.now();
  const timestamp = typeof value === 'number' || /^\d+$/.test(value)
    ? Number(value)
    : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('Firebase timestamp must be a valid date or Unix timestamp.');
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
}

function parseReadings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The configured Firebase path must contain a sensor readings object.');
  }

  const source = value.readings ?? value.sensors ?? value.current ?? value.data ?? value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('Firebase readings must be a sensor readings object.');
  }
  const sample = {};

  for (const [metric, aliases] of Object.entries(metricFields)) {
    const field = aliases.find((alias) => source[alias] !== undefined);
    const statusField = statusFields[metric];
    if (field === undefined && statusField && typeof source[statusField] === 'boolean') {
      sample[metric] = source[statusField];
      continue;
    }

    const reading = field === undefined ? Number.NaN : Number(source[field]);
    if (!Number.isFinite(reading)) {
      throw new Error(`Firebase reading "${metric}" is missing or is not a number.`);
    }
    sample[metric] = reading;
  }

  sample.motion = Boolean(source.motion ?? source.moving ?? source.motionDetected ?? source.motion_status ?? false);
  sample.ts = parseTimestamp(source.ts ?? source.timestamp ?? source.updatedAt ?? source.updated_at);
  sample.source = 'firebase';
  return sample;
}

export function startFirebaseListener({ onSample, onError }) {
  const firebaseApp = getApps().some((app) => app.name === 'smart-classroom')
    ? getApp('smart-classroom')
    : initializeApp(firebaseConfig, 'smart-classroom');
  const database = getDatabase(firebaseApp);
  const path = import.meta.env.VITE_FIREBASE_DATABASE_PATH?.trim();

  if (!path) throw new Error('Set VITE_FIREBASE_DATABASE_PATH to the node containing the current sensor readings.');

  return onValue(
    ref(database, path),
    (snapshot) => {
      if (!snapshot.exists()) {
        onError(new Error(`No readings found at Firebase path "${path}". Check the configured database path.`));
        return;
      }

      try {
        onSample(parseReadings(snapshot.val()));
      } catch (error) {
        onError(error);
      }
    },
    onError,
  );
}
