# PRD — IoT-Based Smart Classroom Environment Monitoring System

Engineering Clinics · B.Tech 3rd Sem · Chandigarh Engineering College (CGC University, Mohali)
Team: Chandan Kaushik, Devansh Walia · Guide: Dr. Rubaljeet

> UI source of truth: `docs/reference-ui.png` (dashboard mockup from the synopsis). Match it closely.

---

## 1. Summary

ESP32 + 5 sensors measure temperature, humidity, air quality, occupancy, light, and noise in one classroom. Data goes to Firebase Realtime Database over WiFi. A web dashboard shows live readings, historical trends, and threshold alerts.

**Flow:** Sensors → ESP32 → Firebase RTDB → Dashboard (+ Cloud Functions for alerts)

## 2. Users

| User | Needs |
|---|---|
| Faculty | Is the room comfortable right now? |
| Facility staff | Alerts when to ventilate/act |
| Administration | Trends, recurring problem hours |
| Evaluators (demo) | Works live and without hardware (simulator) |

## 3. Scope

**In:** one classroom node, live dashboard, history, threshold alerts, mobile + desktop, simulator mode.
**Out (future):** HVAC/fan/light control, multi-campus rollout. Keep schema multi-room ready (`classrooms/{roomId}`).

## 4. Tech stack

- Frontend: Vite + vanilla JS (ES modules), HTML, CSS. Chart.js for charts. Firebase Web SDK (modular).
- Backend: Firebase Cloud Functions (Node.js 20) — optional, needs Blaze plan. App must work without it (client-side alert evaluation fallback).
- DB: Firebase Realtime Database
- Hosting: Firebase Hosting
- Firmware: Arduino IDE, `Firebase_ESP_Client` (mobizt), `DHT sensor library`

## 5. Hardware & pin map (suggested — adjust to your wiring)

| Sensor | ESP32 pin | Notes |
|---|---|---|
| DHT22 | GPIO 4 | 10k pull-up on data |
| MQ135 (AO) | GPIO 34 | ADC1. MQ135 outputs up to 5V → use voltage divider to 3.3V. 24h+ warm-up |
| LDR (divider) | GPIO 35 | ADC1 |
| Sound module (AO) | GPIO 32 | ADC1 |
| PIR (OUT) | GPIO 27 | digital |

Use **ADC1 pins only (32–39)**. ADC2 does not work while WiFi is on.
MQ135 is **not a calibrated CO₂ sensor** (per your own slide) → label values "est." in UI.
PIR cannot count people → "Occupancy" = motion events in last 5 min, shown as Low / Medium / High + Occupied / Vacant.

## 5a. Firebase setup (do once)

1. console.firebase.google.com → Add project (`smart-classroom-cec`).
2. Build → **Realtime Database** → Create → region **asia-southeast1** → start in locked mode.
3. Build → **Authentication** → Sign-in method → enable **Email/Password**. Add two users:
   - `esp32-node@yourproject.local` (device account; ESP32 uses this)
   - `admin@yourproject.local` (dashboard login; optional)
4. Project settings → Your apps → **Web app (</>)** → copy `firebaseConfig` → goes in `.env` (see §13).
5. Copy the RTDB URL (`https://<project>-default-rtdb.asia-southeast1.firebasedatabase.app`) → used in ESP32 firmware and `.env`.
6. Paste rules from §7 into RTDB → Rules → Publish.
7. Install CLI: `npm i -g firebase-tools` → `firebase login` → `firebase init` (Hosting, Database, Functions) in the project root.
8. Cloud Functions require upgrading to the **Blaze** plan (pay-as-you-go; free quota is plenty for this). If you skip it, use the client-side alert fallback.

## 6. Data schema (Realtime Database)

```
/classrooms/{roomId}/
  meta:    { name, building, createdAt }
  live:    { temperature, humidity, airQuality, occupancy, motion, light, noise,
             comfort, ts }                     ← ESP32 overwrites every 5–10 s
  history/{pushId}: same fields as live       ← ESP32 pushes every 60 s
  hourly/{YYYYMMDDHH}: { avg*, max*, min* }   ← Cloud Function rollup (optional)
  alerts/{pushId}: { type, severity, message, value, threshold, ts, acknowledged }
/config/thresholds: see §8
```

Field units: temperature °C, humidity %, airQuality ppm (est.), occupancy = motion count/5 min, motion = bool, light lux (est.), noise dB (est.), ts = epoch **milliseconds** (ESP32 gets time via NTP).
`comfort`: "good" | "moderate" | "poor" (computed on ESP32 from temp+humidity+air).
Default `roomId`: `room-101`.

## 7. Security rules (`database.rules.json`)

```json
{
  "rules": {
    "classrooms": {
      ".read": true,
      "$room": {
        ".write": "auth != null",
        "history": { ".indexOn": ["ts"] },
        "alerts":  { ".indexOn": ["ts"] }
      }
    },
    "config": { ".read": true, ".write": "auth != null" }
  }
}
```

Prototype-level: public read, authenticated write. Tighten reads (`auth != null`) before any real deployment.

## 8. Thresholds (stored in `/config/thresholds`, editable in Settings page)

| Metric | Good | Warning | Critical |
|---|---|---|---|
| Temperature °C | 20–26 | 16–20 or 26–30 | <16 or >30 |
| Humidity % | 30–60 | 20–30 or 60–75 | <20 or >75 |
| Air quality ppm (est.) | <800 | 800–1200 | >1200 |
| Noise dB (est.) | <55 | 55–70 | >70 |
| Light lux (est.) | 300–750 | 150–300 or 750–1200 | <150 or >1200 (while occupied) |
| Occupancy | any | — | — |

Status labels shown on cards: Normal / Good / Low / High / Warning / Critical (as in mockup).

## 9. ESP32 firmware contract

- Connect WiFi → NTP sync → sign in to Firebase (email/password) → loop.
- Every **10 s**: read sensors (average 5 samples for analog), `setJSON` to `/classrooms/room-101/live`.
- Every **60 s**: `pushJSON` same payload to `/classrooms/room-101/history`.
- Auto-reconnect WiFi; if Firebase not ready, skip cycle (don't block).
- Sound: peak-to-peak over a 50 ms window → map to dB estimate.

Reference sketch:

```cpp
#include <WiFi.h>
#include <time.h>
#include <DHT.h>
#include <Firebase_ESP_Client.h>
#include <addons/TokenHelper.h>

#define WIFI_SSID "YOUR_WIFI"
#define WIFI_PASS "YOUR_PASS"
#define API_KEY   "FIREBASE_WEB_API_KEY"
#define DB_URL    "https://<project>-default-rtdb.asia-southeast1.firebasedatabase.app"
#define USER_EMAIL "esp32-node@yourproject.local"
#define USER_PASS  "DEVICE_PASSWORD"
#define ROOM "room-101"

#define DHT_PIN 4
#define MQ_PIN 34
#define LDR_PIN 35
#define SND_PIN 32
#define PIR_PIN 27

DHT dht(DHT_PIN, DHT22);
FirebaseData fbdo; FirebaseAuth auth; FirebaseConfig config;
unsigned long lastLive = 0, lastHist = 0;
int motionCount = 0; unsigned long windowStart = 0; bool lastPir = false;

int avgAnalog(int pin) { long s = 0; for (int i = 0; i < 5; i++) { s += analogRead(pin); delay(5); } return s / 5; }

float readNoiseDb() {
  int mn = 4095, mx = 0; unsigned long t = millis();
  while (millis() - t < 50) { int v = analogRead(SND_PIN); mn = min(mn, v); mx = max(mx, v); }
  return 30 + (mx - mn) * 60.0 / 4095.0;           // rough estimate, calibrate later
}

void setup() {
  Serial.begin(115200); dht.begin(); pinMode(PIR_PIN, INPUT);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(300);
  configTime(0, 0, "pool.ntp.org");
  config.api_key = API_KEY; config.database_url = DB_URL;
  auth.user.email = USER_EMAIL; auth.user.password = USER_PASS;
  config.token_status_callback = tokenStatusCallback;
  Firebase.begin(&config, &auth); Firebase.reconnectWiFi(true);
  windowStart = millis();
}

void loop() {
  bool pir = digitalRead(PIR_PIN);
  if (pir && !lastPir) motionCount++;
  lastPir = pir;
  if (millis() - windowStart > 300000) { motionCount = 0; windowStart = millis(); }

  if (Firebase.ready() && millis() - lastLive > 10000) {
    lastLive = millis();
    FirebaseJson j;
    float t = dht.readTemperature(), h = dht.readHumidity();
    int mq = avgAnalog(MQ_PIN), ldr = avgAnalog(LDR_PIN);
    if (!isnan(t)) j.set("temperature", t);
    if (!isnan(h)) j.set("humidity", h);
    j.set("airQuality", map(mq, 0, 4095, 400, 2000));   // est. ppm proxy
    j.set("light", map(ldr, 0, 4095, 0, 1000));         // est. lux (depends on LDR wiring)
    j.set("noise", readNoiseDb());
    j.set("occupancy", motionCount);
    j.set("motion", pir);
    j.set("ts", (double)time(nullptr) * 1000.0);
    String base = String("/classrooms/") + ROOM;
    Firebase.RTDB.setJSON(&fbdo, base + "/live", &j);
    if (millis() - lastHist > 60000) {
      lastHist = millis();
      Firebase.RTDB.pushJSON(&fbdo, base + "/history", &j);
    }
  }
}
```

(`comfort` can be computed in the dashboard if not sent from ESP32.)

## 10. Frontend — pages & UI

Match the reference content and layout, with the approved visual direction: warm plum navigation, cream content area, soft clay-like surfaces, and restrained maroon and sky-blue accents.

**Design tokens (from mockup):**
- Background cream `#F6F2E8`, card `#FBF8F1`, card border `#E9E3D3`
- Sidebar warm charcoal-plum, active item subtly highlighted, text cream
- Text primary warm charcoal, secondary muted brown-gray
- Accent colors: restrained maroon and a small sky-blue highlight
- Metric accent colors: temperature coral `#E4745A`, humidity blue `#5B9BD5`, air quality green `#4F9A62`, occupancy amber `#D9A441`, light gold `#E3B341`, noise purple `#8E7CC3`
- Alert banner: soft terracotta bg `#F6DDD3`, text `#B5442A`
- Radius 16–20px cards; font: Inter (UI) with a serif/display option for page titles
- Icons: Lucide or inline SVG in tinted circles (as in mockup)

**Pages (sidebar order; AI Insights is excluded):**
1. **Overview** — header ("Smart Classroom · Live Environment Monitoring", Online dot, date/time), 6 metric cards (2×3 grid; value + unit + status), "Live Trends (Last 24 Hours)" multi-line chart with legend, alert banner with "View Details →".
2. **Live Data** — per-sensor large gauge/cards, live value ticker, last-updated, sensor online/offline status, comfort score.
3. **Trends** — time range (1h / 6h / 24h / 7d), per-metric charts, min/avg/max, "problem hours" heat strip.
4. **Alerts** — list (severity, metric, value, time), filter, acknowledge, clear.
5. **Settings** — room name, thresholds editor, data source, and theme.

**Behavior:**
- Real-time via `onValue()` on `/classrooms/{room}/live`; charts load via `query(history, orderByChild('ts'), startAt(...))`.
- "Online" if `now - live.ts < 30 s`, else "Offline" (grey) with last seen.
- Responsive layout adapts from a fixed desktop sidebar to a glass-style bottom navigation on screens up to 800px; sensor cards and controls reflow for mobile.
- Loading skeletons, empty states, error banner on Firebase failure.
- Respect `prefers-reduced-motion`.

## 11. Backend — Cloud Functions (Node.js)

1. `onValueCreated('/classrooms/{room}/history/{id}')` → evaluate thresholds → write `alerts` (dedupe: skip if same type+severity alerted in last 10 min).
2. `onSchedule('every 5 minutes')` → if `live.ts` older than 2 min → write "Sensor node offline" alert.
3. `onSchedule('every 1 hours')` → hourly rollup into `hourly/`; delete history older than 30 days.
4. (Optional) FCM push / email on critical alerts.

Client-side fallback: dashboard evaluates the same thresholds on each live update and shows alerts locally if Functions aren't deployed. A user-enabled, tested browser beep plays once for a newly recorded critical alert; warning alerts stay silent. Sound requires a user gesture because browsers restrict autoplay.

## 12. Deliberately excluded features

AI Insights, Gemini integration, AI chat, and generated recommendations are not part of this dashboard.

## 13. Folder structure & env

```
smart-classroom/
├─ docs/reference-ui.png
├─ PRD.md
├─ index.html
├─ src/
│  ├─ main.js  firebase.js  config.js  thresholds.js  simulator.js
│  ├─ components/ (card, chart, sidebar, alert-banner)
│  └─ styles/ (tokens.css, layout.css, components.css)
├─ functions/ (index.js, package.json)
├─ firmware/smart_classroom.ino
├─ database.rules.json  firebase.json  .firebaserc
├─ .env  .env.example  .gitignore
```

`.env` (Vite):
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_DATABASE_URL=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_ROOM_ID=room-101
```
`.gitignore` must include `.env`, `node_modules`, `dist`, `.firebase`.

## 14. Simulator mode

`simulator.js` emits realistic demo values every 5 s (sine drift + noise + occasional spikes to trigger alerts) through the same data interface as Firebase, so the whole UI works before ESP32 is online. Simulator mode is the current default.

## 15. Milestones & acceptance

| # | Milestone | Done when |
|---|---|---|
| 1 | Scaffold + design tokens + 5 pages shell | Matches approved layout on desktop + mobile |
| 2 | Simulator + live cards + trend chart | Overview looks like mockup with moving data |
| 3 | Live Data, Trends, Alerts, and Settings | Filters, charts, thresholds, and alert actions work |
| 4 | Firebase connected (read) | Manually edited `live` node in console updates UI in <2 s |
| 5 | ESP32 writing | Real sensor values appear; history chart fills |
| 6 | Alerts (client-side, then Functions) | Heat/noise spike produces alert + banner |
| 7 | Deploy | `firebase deploy` → live URL works on phone |

## 16. Deploy

```
npm run build
firebase deploy --only hosting,database      # add ,functions if Blaze
```

## 17. Testing checklist

- Unplug ESP32 → Offline state within 30 s, offline alert in 2 min.
- Breathe on MQ135 / hold lighter-gas nearby → air quality rises and alert fires.
- Cover LDR → light drops. Clap near sound module → noise spikes.
- Wave at PIR → occupancy increments.
- Mobile Chrome + desktop Chrome both pass.

## 18. References

Firebase docs (firebase.google.com/docs) · Firebase-ESP-Client (github.com/mobizt/Firebase-ESP-Client) · ESP32 TRM (Espressif)
