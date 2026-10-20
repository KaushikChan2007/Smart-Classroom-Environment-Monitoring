const UPDATE_INTERVAL_MS = 5000;
const AIR_QUALITY_SPIKE_INTERVAL_MS = 180000;

function sampleAt(ts, elapsed) {
  const drift = elapsed / 1000;
  const spikeWindow = elapsed > 45000 && elapsed % AIR_QUALITY_SPIKE_INTERVAL_MS < 10000;
  return {
    temperature: 23.6 + Math.sin(drift / 31) * 1.6 + (Math.random() - 0.5) * 0.5,
    humidity: 49 + Math.sin(drift / 43 + 0.8) * 6 + (Math.random() - 0.5) * 2.5,
    airQuality: spikeWindow
      ? 1280 + Math.random() * 160
      : 610 + Math.sin(drift / 27 + 1.5) * 105 + (Math.random() - 0.5) * 55,
    occupancy: Math.max(0, Math.round(2 + Math.sin(drift / 55) * 1.4 + (Math.random() - 0.5) * 2)),
    light: 465 + Math.sin(drift / 36 + 2) * 105 + (Math.random() - 0.5) * 50,
    noise: 43 + Math.sin(drift / 19) * 5 + (Math.random() - 0.5) * 4,
    motion: Math.random() > 0.68,
    ts,
  };
}

export function createHistory(count = 24, now = Date.now()) {
  return Array.from({ length: count }, (_, index) => {
    const hoursAgo = count - index - 1;
    const timestamp = now - hoursAgo * 60 * 60 * 1000;
    return sampleAt(timestamp, timestamp - now);
  });
}

export function startSimulator(onSample, intervalMs = UPDATE_INTERVAL_MS) {
  const startedAt = Date.now();
  onSample(sampleAt(startedAt, 0));

  const intervalId = window.setInterval(() => {
    const now = Date.now();
    onSample(sampleAt(now, now - startedAt));
  }, intervalMs);

  return () => window.clearInterval(intervalId);
}
