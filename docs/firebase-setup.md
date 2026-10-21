# Firebase Realtime Database setup

The dashboard subscribes to one Realtime Database node and updates its readings whenever that node changes.
The configured node is the database root (`/`) for the current project. The trend chart begins collecting samples when the dashboard is opened; the current root payload does not contain historical readings.

1. Copy `.env.example` to `.env.local`.
2. Add the Firebase Web app API key to `.env.local`.
3. Set `VITE_FIREBASE_DATABASE_PATH` to the node containing all current readings (`/` means the database root).
4. Restart the Vite development server after changing environment variables.

The selected node must contain numeric temperature and humidity readings. Air quality, occupancy, light, and sound are optional and display as unavailable when missing. Occupancy, light, and sound can be numeric readings or boolean sensor states. They can be at the node root or nested under `readings`, `sensors`, `current`, or `data`.

```json
{
  "temperature": 23.8,
  "humidity": 48,
  "air_quality": 612,
  "motion_status": true,
  "light_status": false,
  "sound_status": true,
  "timestamp": 1792500000000
}
```

Accepted aliases include `temp`, `co2`, `occupancy` or `motion_count`, `light_level` or `lux`, and `noise_level`, `sound_level`, or `sound_db`. Boolean `motion_status`, `light_status`, and `sound_status` are displayed as sensor states. Numeric `sound_db` and other numeric sound readings are displayed as estimated dB; numeric `sound_status` values `0`/`1` are treated as Quiet/Detected. Boolean motion/light states are not converted into counts or lux. The timestamp is optional and may be milliseconds, seconds, or a date string.

When Firebase is not configured, the local simulator remains active. If a configured database path is empty, inaccessible, or has an unsupported shape, the dashboard displays an error and switches to the simulator instead. While Firebase is configured and connecting, readings remain blank until the first valid snapshot arrives.

Firebase Web configuration is client-side project configuration, not database authorization. Do not put a service-account key in the browser or open public write rules. The dashboard currently does not sign users in, so database rules that require an authenticated user will reject its read until Firebase Authentication is added. Restrict the API key to the Firebase APIs and application domains you use.
