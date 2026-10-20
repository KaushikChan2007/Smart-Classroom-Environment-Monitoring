export function getMetricStatus(metric, value, readings = {}, thresholds = {}) {
  switch (metric) {
    case 'temperature':
      if (value < 16 || value > 30) return { label: 'Critical', severity: 'critical' };
      if (value < 20 || value > (thresholds.temperatureMax ?? 26)) return { label: 'Warning', severity: 'warning' };
      return { label: 'Normal', severity: null };
    case 'humidity':
      if (value < 20 || value > 75) return { label: 'Critical', severity: 'critical' };
      if (value < 30 || value > (thresholds.humidityMax ?? 60)) return { label: 'Warning', severity: 'warning' };
      return { label: 'Normal', severity: null };
    case 'airQuality':
      if (value > 1200) return { label: 'Critical', severity: 'critical' };
      if (value >= (thresholds.airQualityMax ?? 800)) return { label: 'Warning', severity: 'warning' };
      return { label: 'Good', severity: null };
    case 'noise':
      if (value > 70) return { label: 'Critical', severity: 'critical' };
      if (value >= (thresholds.noiseMax ?? 55)) return { label: 'Warning', severity: 'warning' };
      return { label: 'Normal', severity: null };
    case 'light':
      if (value < 150 || value > 1200) {
        return readings.occupancy > 0
          ? { label: 'Critical', severity: 'critical' }
          : { label: value < 150 ? 'Low' : 'High', severity: null };
      }
      if (value < 300 || value > 750) return { label: 'Warning', severity: 'warning' };
      return { label: 'Normal', severity: null };
    case 'occupancy':
      if (value <= 1) return { label: 'Low', severity: null };
      if (value <= 4) return { label: 'Medium', severity: null };
      return { label: 'High', severity: null };
    default:
      return { label: 'Unknown', severity: null };
  }
}
