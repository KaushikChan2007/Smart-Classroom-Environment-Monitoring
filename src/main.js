import Chart from 'chart.js/auto';
import { isFirebaseConfigured, startFirebaseListener } from './firebase.js';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';
import { createHistory, startSimulator } from './simulator.js';
import { getMetricStatus } from './thresholds.js';

const METRICS = {
  temperature: { label: 'Temperature', unit: '°C', color: '#e4745a', min: 10, max: 35, digits: 1 },
  humidity: { label: 'Humidity', unit: '%', color: '#5b9bd5', min: 0, max: 100, digits: 1 },
  airQuality: { label: 'Air quality', unit: 'ppm est.', color: '#4f9a62', min: 400, max: 1600, digits: 0 },
  occupancy: { label: 'Motion activity', unit: 'events', color: '#79acc5', min: 0, max: 8, digits: 0 },
  light: { label: 'Light level', unit: 'lux est.', color: '#e3b341', min: 0, max: 1500, digits: 0 },
  noise: { label: 'Noise level', unit: 'dB est.', color: '#8e7cc3', min: 30, max: 90, digits: 0 },
};
const STORAGE_KEYS = {
  theme: 'smart-classroom-theme',
  settings: 'smart-classroom-settings',
  alerts: 'smart-classroom-alerts',
};
const navItems = [...document.querySelectorAll('.nav-item[data-page]')];
const panels = [...document.querySelectorAll('[data-panel]')];
const pageTitle = document.querySelector('#page-title');
const pageSubtitle = document.querySelector('#page-subtitle');
const pageNames = new Map(navItems.map((item) => [item.dataset.page, item.textContent.trim()]));
const pageDescriptions = {
  overview: 'A healthier space for better learning.',
  live: 'Current readings, at a glance.',
  trends: 'Patterns that help you plan ahead.',
  alerts: 'A short list of things to check.',
  settings: 'Make this dashboard work for your room.',
};
const themeToggle = document.querySelector('.theme-toggle');
const themeToggleLabel = document.querySelector('.theme-toggle-label');
const sourceStatus = document.querySelector('#source-status');
const sourceStatusLabel = document.querySelector('#source-status-label');
const metricCards = [...document.querySelectorAll('[data-metric]')];
const alertBanner = document.querySelector('#overview-alert');
const overviewChartContext = document.querySelector('#trends-chart').getContext('2d');
const detailChartContext = document.querySelector('#detail-trends-chart').getContext('2d');
const liveGrid = document.querySelector('#live-grid');
const alertList = document.querySelector('#alert-list');
const settingsForm = document.querySelector('#settings-form');
const rangeButtons = [...document.querySelectorAll('[data-range]')];
const trendMetricLabels = {
  temperature: 'Temperature',
  humidity: 'Humidity',
  airQuality: 'Air quality (estimate)',
  occupancy: 'Motion activity',
  light: 'Light (estimate)',
  noise: 'Noise (estimate)',
};
const soundCheckbox = document.querySelector('#sound-alerts');
const soundMessage = document.querySelector('#sound-message');
const testSoundButton = document.querySelector('#test-sound');

const defaultSettings = {
  roomName: 'Room 101',
  temperatureMax: 26,
  humidityMax: 60,
  airQualityMax: 800,
  noiseMax: 55,
  soundAlerts: false,
};
const settings = readStorage(STORAGE_KEYS.settings, defaultSettings);
const alerts = readStorage(STORAGE_KEYS.alerts, []);
let currentReadings;
let selectedRangeHours = 24;
let selectedMetric = 'temperature';
let overviewChart;
let detailChart;
let audioContext;

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    const parsed = JSON.parse(value);
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : fallback;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function setSourceStatus(state, label) {
  sourceStatus.dataset.state = state;
  sourceStatusLabel.textContent = label;
  const liveTitle = document.querySelector('#live-source-title');
  const liveDescription = document.querySelector('#live-source-description');
  const dataNote = document.querySelector('#live-data-note');
  const copy = {
    connecting: ['Connecting to Firebase', 'Waiting for the first database update.'],
    connected: ['Firebase readings are live', 'Listening for updates from Realtime Database.'],
    simulator: ['Demo readings are updating', 'Simulated locally · refreshes every 5 seconds.'],
  }[state] ?? ['Sensor source unavailable', 'Check the connection status above.'];
  liveTitle.textContent = copy[0];
  liveDescription.textContent = copy[1];
  document.querySelector('#overview-trend-caption').textContent = state === 'connected'
    ? 'Firebase readings collected since this dashboard opened · relative sensor ranges'
    : 'Last 24 hours · relative sensor ranges';
  dataNote.textContent = state === 'connected'
    ? 'Temperature, humidity and air quality are numeric readings. Motion, light and sound are sensor states; no people count, lux or dB values are available. Trend history starts when this dashboard opens.'
    : 'Air quality, light and noise are estimates. Occupancy is based on motion activity, not a people count.';
}

function handleSample(sample) {
  currentReadings = sample;
  history.push(sample);
  if (history.length > 2200) history.splice(0, history.length - 2200);

  for (const option of document.querySelector('#trend-metric').options) {
    option.textContent = typeof sample[option.value] === 'boolean'
      ? displayDefinition(option.value, sample).label
      : trendMetricLabels[option.value];
  }
  updateMetricCards(sample);
  updateAlertBanner(sample);
  recordThresholdAlerts(sample);
  renderLiveReadings(sample);

  for (const dataset of overviewChart.data.datasets) {
    dataset.label = displayDefinition(dataset.metricKey, sample).label;
    dataset.data.push(normalizeValue(sample[dataset.metricKey], METRICS[dataset.metricKey]));
  }
  overviewChart.data.labels.push(new Date(sample.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  while (overviewChart.data.labels.length > 24) {
    overviewChart.data.labels.shift();
    for (const dataset of overviewChart.data.datasets) dataset.data.shift();
  }
  overviewChart.update('none');

  if (!document.querySelector('[data-panel="trends"]').hidden) renderTrends();
}

function normalizeValue(value, definition) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 100 : 0;
  const ratio = ((value - definition.min) / (definition.max - definition.min)) * 100;
  return Math.max(0, Math.min(100, ratio));
}

function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error(`Could not save ${key.replace('smart-classroom-', '')} in this browser.`);
  }
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  themeToggle.setAttribute('aria-pressed', String(isDark));
  themeToggle.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} mode`);
  themeToggleLabel.textContent = isDark ? 'Light mode' : 'Dark mode';
  if (overviewChart) {
    updateChartTheme(overviewChart);
    updateChartTheme(detailChart);
  }
}

function showNotice(message) {
  const notice = document.querySelector('#app-notice');
  notice.textContent = message;
  notice.hidden = false;
}

async function prepareAudio() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('This browser does not support alert sounds.');
  }
  if (!audioContext) audioContext = new AudioContextConstructor();
  if (audioContext.state === 'suspended') await audioContext.resume();
  if (audioContext.state !== 'running') {
    throw new Error('Browser audio is unavailable. Check your sound settings and try again.');
  }
}

function registerAudioUnlock() {
  if (!settings.soundAlerts) return;
  const unlock = () => {
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
    prepareAudio()
      .then(() => {
        soundMessage.textContent = 'Sound alerts are on for critical alerts';
      })
      .catch((error) => {
        soundMessage.textContent = error.message;
        showNotice(error.message);
      });
  };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
}

function playBeepSequence() {
  if (!audioContext || audioContext.state !== 'running') return false;
  const frequencies = [880, 660, 880];
  const startAt = audioContext.currentTime + 0.02;
  frequencies.forEach((frequency, index) => {
    const start = startAt + index * 0.27;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
    gain.gain.setValueAtTime(0.12, start + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.21);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.22);
  });
  return true;
}

function showPage(page) {
  if (!pageNames.has(page)) return;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  for (const item of navItems) {
    const isActive = item.dataset.page === page;
    item.classList.toggle('is-active', isActive);
    if (isActive) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  for (const panel of panels) panel.hidden = panel.dataset.panel !== page;
  pageTitle.textContent = pageNames.get(page);
  pageSubtitle.textContent = pageDescriptions[page];
  if (page === 'trends') renderTrends();
  if (page === 'alerts') renderAlerts();
  if (page === 'live' && currentReadings) renderLiveReadings(currentReadings);
}

for (const item of document.querySelectorAll('[data-page]')) {
  item.addEventListener('click', () => showPage(item.dataset.page));
}

themeToggle.addEventListener('click', () => {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(STORAGE_KEYS.theme, nextTheme);
  } catch {
    showNotice('Theme changed for now, but this browser could not save your preference.');
  }
  applyTheme(nextTheme);
});

function chartPalette() {
  const styles = getComputedStyle(document.documentElement);
  return {
    label: styles.getPropertyValue('--color-text-secondary').trim(),
    grid: styles.getPropertyValue('--color-chart-grid').trim(),
  };
}

function updateChartTheme(chart) {
  const palette = chartPalette();
  chart.options.scales.x.ticks.color = palette.label;
  chart.options.scales.x.grid.color = palette.grid;
  chart.options.scales.y.ticks.color = palette.label;
  chart.options.scales.y.grid.color = palette.grid;
  if (chart.options.plugins.legend.labels) chart.options.plugins.legend.labels.color = palette.label;
  chart.update('none');
}

function formatValue(metric, value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'N/A';
  if (typeof value === 'boolean') {
    if (metric === 'occupancy') return value ? 'Motion' : 'No motion';
    if (metric === 'light') return value ? 'On' : 'Off';
    if (metric === 'noise') return value ? 'Detected' : 'Quiet';
  }
  const definition = METRICS[metric];
  return Number(value).toFixed(definition.digits);
}

function displayDefinition(metric, sample) {
  if (typeof sample[metric] !== 'boolean') return METRICS[metric];
  const labels = {
    occupancy: 'Motion status',
    light: 'Light status',
    noise: 'Sound status',
  };
  return { ...METRICS[metric], label: labels[metric], unit: '' };
}

function setMetricLabel(element, metric, sample) {
  const definition = displayDefinition(metric, sample);
  element.textContent = definition.label;
  if (typeof sample[metric] === 'number' && ['airQuality', 'light', 'noise'].includes(metric)) {
    const estimated = document.createElement('small');
    estimated.textContent = 'est.';
    element.append(document.createTextNode(' '), estimated);
  }
}

function cardUnit(metric, sample) {
  if (sample[metric] === null || sample[metric] === undefined) return '';
  if (typeof sample[metric] === 'boolean') return '';
  return { temperature: '°C', humidity: '%', airQuality: 'ppm', occupancy: 'events', light: 'lux', noise: 'dB' }[metric];
}

function chartOptions(palette) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { usePointStyle: true, boxWidth: 7, boxHeight: 7, padding: 15, color: palette.label, font: { size: 10 } },
      },
    },
    scales: {
      x: {
        grid: { color: palette.grid, drawTicks: false },
        border: { display: false },
        ticks: { color: palette.label, maxTicksLimit: 8, maxRotation: 0, font: { size: 9 } },
      },
      y: {
        grid: { color: palette.grid, drawTicks: false },
        border: { display: false },
        ticks: { color: palette.label, maxTicksLimit: 5, font: { size: 9 } },
      },
    },
  };
}

function createOverviewChart(history) {
  const palette = chartPalette();
  const charts = Object.entries(METRICS);
  return new Chart(overviewChartContext, {
    type: 'line',
    data: {
      labels: history.map((sample) => new Date(sample.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      datasets: charts.map(([metric, definition]) => ({
        metricKey: metric,
        label: definition.label,
        data: history.map((sample) => normalizeValue(sample[metric], definition)),
        borderColor: definition.color,
        backgroundColor: definition.color,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0.36,
        yAxisID: 'y',
      })),
    },
    options: {
      ...chartOptions(palette),
      scales: {
        x: chartOptions(palette).scales.x,
        y: {
          min: 0,
          max: 100,
          grid: { color: palette.grid, drawTicks: false },
          border: { display: false },
          ticks: { color: palette.label, maxTicksLimit: 5, font: { size: 9 }, callback: (value) => `${value}%` },
        },
      },
    },
  });
}

function createDetailChart() {
  const palette = chartPalette();
  return new Chart(detailChartContext, {
    type: 'line',
    data: { labels: [], datasets: [{ data: [], borderColor: METRICS[selectedMetric].color, backgroundColor: METRICS[selectedMetric].color, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2.5, tension: 0.35, fill: true }] },
    options: {
      ...chartOptions(palette),
      plugins: { ...chartOptions(palette).plugins, legend: { display: false } },
    },
  });
}

function activeThresholds() {
  return {
    temperatureMax: Number(settings.temperatureMax),
    humidityMax: Number(settings.humidityMax),
    airQualityMax: Number(settings.airQualityMax),
    noiseMax: Number(settings.noiseMax),
  };
}

function statusFor(metric, value, readings) {
  if (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value))) {
    return { label: 'Unavailable', severity: null };
  }
  if (typeof value === 'boolean') return { label: 'Live', severity: null };
  return getMetricStatus(metric, value, readings, activeThresholds());
}

function updateMetricCards(sample) {
  for (const card of metricCards) {
    const metric = card.dataset.metric;
    const definition = displayDefinition(metric, sample);
    const { label, severity } = statusFor(metric, sample[metric], sample);
    setMetricLabel(card.querySelector('.metric-label'), metric, sample);
    card.querySelector('.metric-value').textContent = formatValue(metric, sample[metric]);
    card.querySelector('.metric-unit').textContent = cardUnit(metric, sample);
    const status = card.querySelector('.metric-status');
    status.textContent = label;
    status.className = `metric-status ${severity ? `is-${severity}` : `is-${label.toLowerCase()}`}`;
    card.setAttribute('aria-label', `${definition.label}: ${formatValue(metric, sample[metric])}${definition.unit ? ` ${definition.unit}` : ''}, ${label}`);
  }
}

function updateAlertBanner(sample) {
  const flagged = Object.keys(METRICS)
    .filter((metric) => metric !== 'occupancy' && typeof sample[metric] === 'number')
    .map((metric) => ({ metric, value: sample[metric], ...statusFor(metric, sample[metric], sample) }))
    .filter((item) => item.severity)
    .sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1));

  if (!flagged.length) {
    alertBanner.className = 'alert-placeholder is-clear';
    alertBanner.querySelector('.alert-symbol').textContent = '✓';
    alertBanner.querySelector('.alert-copy strong').textContent = 'All conditions look comfortable';
    alertBanner.querySelector('.alert-copy p').textContent = 'We’ll let you know if a reading needs attention.';
    return;
  }

  const first = flagged[0];
  alertBanner.className = `alert-placeholder is-${first.severity}`;
  alertBanner.querySelector('.alert-symbol').textContent = '!';
  alertBanner.querySelector('.alert-copy strong').textContent = `${METRICS[first.metric].label} needs attention · ${first.severity}`;
  alertBanner.querySelector('.alert-copy p').textContent = `Current reading: ${formatValue(first.metric, first.value)} ${METRICS[first.metric].unit}.`;
}

function updateLiveTimestamp(sample) {
  const lastUpdated = document.querySelector('#last-updated');
  lastUpdated.textContent = `Updated ${new Date(sample.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function renderLiveReadings(sample) {
  liveGrid.innerHTML = Object.entries(METRICS).map(([metric, definition]) => {
    const display = displayDefinition(metric, sample);
    const { label, severity } = statusFor(metric, sample[metric], sample);
    const statusClass = severity ? `is-${severity}` : `is-${label.toLowerCase()}`;
    const percentage = typeof sample[metric] === 'boolean'
      ? (sample[metric] ? 100 : 0)
      : sample[metric] === null || sample[metric] === undefined
        ? 0
        : Math.max(4, Math.min(100, ((sample[metric] - definition.min) / (definition.max - definition.min)) * 100));
    return `<article class="live-reading-card">
      <div class="live-reading-heading"><h3>${display.label}${typeof sample[metric] === 'number' && ['airQuality', 'light', 'noise'].includes(metric) ? ' <small>est.</small>' : ''}</h3><span class="metric-status ${statusClass}">${label}</span></div>
      <p class="live-reading-value">${formatValue(metric, sample[metric])}${sample[metric] === null || sample[metric] === undefined ? '' : display.unit ? `<span>${display.unit}</span>` : ''}</p>
      <div class="reading-meter" aria-hidden="true"><span style="width:${percentage}%;background:${definition.color}"></span></div>
    </article>`;
  }).join('');
  updateLiveTimestamp(sample);
}

function getRangeHistory() {
  const cutoff = Date.now() - selectedRangeHours * 60 * 60 * 1000;
  const matching = history.filter((sample) => sample.ts >= cutoff);
  return matching.length ? matching : history.slice(-1);
}

function updateSummary() {
  const samples = getRangeHistory();
  if (!samples.length) {
    document.querySelector('#trend-summary').replaceChildren();
    return;
  }
  const availableSamples = samples.filter((sample) => sample[selectedMetric] !== null && sample[selectedMetric] !== undefined);
  if (!availableSamples.length) {
    document.querySelector('#trend-summary').innerHTML = '<article class="summary-card"><span>Sensor data</span><strong>Unavailable</strong></article>';
    return;
  }
  const values = availableSamples.map((sample) => Number(sample[selectedMetric]));
  if (samples.every((sample) => typeof sample[selectedMetric] === 'boolean')) {
    const activeCount = samples.filter((sample) => sample[selectedMetric]).length;
    const inactiveCount = samples.length - activeCount;
    document.querySelector('#trend-summary').innerHTML = [
      ['Current state', formatValue(selectedMetric, samples[samples.length - 1][selectedMetric])],
      ['Active samples', `${activeCount} / ${samples.length}`],
      ['Inactive samples', `${inactiveCount} / ${samples.length}`],
    ].map(([label, value]) => `
      <article class="summary-card"><span>${label}</span><strong>${value}</strong></article>
    `).join('');
    return;
  }
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const summaries = [
    ['Minimum', minimum],
    ['Average', average],
    ['Maximum', maximum],
  ];
  document.querySelector('#trend-summary').innerHTML = summaries.map(([label, value]) => `
    <article class="summary-card"><span>${label}</span><strong>${formatValue(selectedMetric, value)} <small>${METRICS[selectedMetric].unit}</small></strong></article>
  `).join('');
}

function renderTrends() {
  const samples = getRangeHistory();
  const definition = displayDefinition(selectedMetric, samples[samples.length - 1] ?? {});
  const tickFormat = new Intl.DateTimeFormat([], selectedRangeHours <= 24
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric' });
  detailChart.data.labels = samples.map((sample) => tickFormat.format(new Date(sample.ts)));
  detailChart.data.datasets[0].data = samples.map((sample) => (
    sample[selectedMetric] === null || sample[selectedMetric] === undefined
      ? null
      : Number(sample[selectedMetric])
  ));
  detailChart.data.datasets[0].borderColor = definition.color;
  detailChart.data.datasets[0].backgroundColor = `${definition.color}24`;
  detailChart.data.datasets[0].fill = true;
  detailChart.options.scales.y.title = { display: true, text: definition.unit || 'State (0 = inactive, 1 = active)', color: chartPalette().label, font: { size: 10 } };
  detailChart.update('none');
  document.querySelector('#trend-chart-title').textContent = definition.label;
  const historyLabel = samples[samples.length - 1]?.source === 'firebase'
    ? 'Firebase readings received since this dashboard opened'
    : 'simulated readings';
  document.querySelector('#trend-range-caption').textContent = `Last ${selectedRangeHours === 168 ? '7 days' : `${selectedRangeHours} hour${selectedRangeHours === 1 ? '' : 's'}`} · ${historyLabel}`;
  updateSummary();
}

function renderAlerts() {
  const filter = document.querySelector('#alert-filter').value;
  const visible = alerts.filter((alert) => {
    if (filter === 'unacknowledged') return !alert.acknowledged;
    if (filter === 'acknowledged') return alert.acknowledged;
    return true;
  });
  if (!visible.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = alerts.length ? 'No alerts match this filter.' : 'No active alerts. If a reading stays outside its comfort range, it will be listed here.';
    alertList.replaceChildren(emptyState);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const alert of visible) {
    const item = document.createElement('article');
    item.className = `alert-list-item ${alert.acknowledged ? 'is-acknowledged' : ''}`;
    const mark = document.createElement('span');
    mark.className = `alert-list-mark ${alert.severity}`;
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = alert.severity === 'critical' ? '!' : '·';

    const copy = document.createElement('div');
    copy.className = 'alert-list-copy';
    const heading = document.createElement('div');
    const metricLabel = document.createElement('strong');
    metricLabel.textContent = alert.metricLabel;
    const severity = document.createElement('span');
    severity.className = `severity-label ${alert.severity}`;
    severity.textContent = alert.severity;
    heading.append(metricLabel, severity);
    const message = document.createElement('p');
    message.textContent = alert.message;
    const timestamp = document.createElement('time');
    timestamp.dateTime = new Date(alert.ts).toISOString();
    timestamp.textContent = new Date(alert.ts).toLocaleString();
    copy.append(heading, message, timestamp);
    item.append(mark, copy);

    if (alert.acknowledged) {
      const reviewed = document.createElement('span');
      reviewed.className = 'reviewed-label';
      reviewed.textContent = 'Reviewed';
      item.append(reviewed);
    } else {
      const acknowledge = document.createElement('button');
      acknowledge.className = 'secondary-button acknowledge-button';
      acknowledge.type = 'button';
      acknowledge.dataset.ack = alert.id;
      acknowledge.textContent = 'Mark reviewed';
      item.append(acknowledge);
    }
    fragment.append(item);
  }
  alertList.replaceChildren(fragment);
}

function recordThresholdAlerts(sample) {
  const now = sample.ts;
  let addedAlert = false;
  let criticalAlertAdded = false;
  for (const metric of Object.keys(METRICS)) {
    if (metric === 'occupancy' || typeof sample[metric] !== 'number') continue;
    const { severity } = statusFor(metric, sample[metric], sample);
    if (!severity) continue;
    const duplicate = alerts.some((alert) => alert.metric === metric && alert.severity === severity && now - alert.ts < 10 * 60 * 1000);
    if (duplicate) continue;
    alerts.unshift({
      id: `${metric}-${now}`,
      metric,
      metricLabel: METRICS[metric].label,
      severity,
      ts: now,
      value: sample[metric],
      acknowledged: false,
      message: `${formatValue(metric, sample[metric])} ${METRICS[metric].unit} is outside the set comfort range.`,
    });
    alerts.splice(100);
    addedAlert = true;
    criticalAlertAdded = criticalAlertAdded || severity === 'critical';
  }
  if (addedAlert) {
    try {
      saveStorage(STORAGE_KEYS.alerts, alerts);
    } catch (error) {
      showNotice(error.message);
      document.querySelector('#settings-message').textContent = error.message;
    }
  }
  if (criticalAlertAdded && settings.soundAlerts) {
    if (!playBeepSequence()) {
      soundMessage.textContent = 'A critical alert appeared, but browser audio is unavailable.';
      showNotice('A critical alert appeared, but the alert sound could not play. Re-enable sound alerts to unlock audio.');
    }
  }
  if (!document.querySelector('[data-panel="alerts"]').hidden) renderAlerts();
}

function fillSettingsForm() {
  for (const [key, value] of Object.entries(settings)) {
    const input = settingsForm.elements.namedItem(key);
    if (input) input.value = value;
  }
}

soundCheckbox.checked = Boolean(settings.soundAlerts);
soundMessage.textContent = settings.soundAlerts
  ? 'Sound alerts are on · click once to activate browser audio'
  : 'Sound is off';
registerAudioUnlock();

soundCheckbox.addEventListener('change', async () => {
  const enable = soundCheckbox.checked;
  try {
    if (enable) await prepareAudio();
    const updated = { ...settings, soundAlerts: enable };
    saveStorage(STORAGE_KEYS.settings, updated);
    Object.assign(settings, updated);
    soundMessage.textContent = enable ? 'Sound alerts are on for critical alerts' : 'Sound is off';
  } catch (error) {
    soundCheckbox.checked = Boolean(settings.soundAlerts);
    soundMessage.textContent = error.message;
    showNotice(error.message);
  }
});

testSoundButton.addEventListener('click', async () => {
  try {
    await prepareAudio();
    playBeepSequence();
    soundMessage.textContent = settings.soundAlerts
      ? 'Test beep played. Critical alert sounds are on.'
      : 'Test beep played. Turn on sound alerts to hear critical alerts.';
  } catch (error) {
    soundMessage.textContent = error.message;
    showNotice(error.message);
  }
});

document.querySelector('#trend-metric').addEventListener('change', (event) => {
  selectedMetric = event.target.value;
  renderTrends();
});

for (const button of rangeButtons) {
  button.addEventListener('click', () => {
    selectedRangeHours = Number(button.dataset.range);
    for (const rangeButton of rangeButtons) {
      const active = rangeButton === button;
      rangeButton.classList.toggle('is-selected', active);
      rangeButton.setAttribute('aria-pressed', String(active));
    }
    renderTrends();
  });
}

document.querySelector('#alert-filter').addEventListener('change', renderAlerts);

alertList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-ack]');
  if (!button) return;
  const alert = alerts.find((entry) => entry.id === button.dataset.ack);
  if (!alert) return;
  alert.acknowledged = true;
  try {
    saveStorage(STORAGE_KEYS.alerts, alerts);
  } catch (error) {
    showNotice(error.message);
  }
  renderAlerts();
});

document.querySelector('#clear-alerts').addEventListener('click', () => {
  if (!alerts.length) return;
  alerts.length = 0;
  try {
    saveStorage(STORAGE_KEYS.alerts, alerts);
  } catch (error) {
    showNotice(error.message);
  }
  renderAlerts();
});

settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(settingsForm);
  const updated = {
    roomName: String(formData.get('roomName')).trim(),
    temperatureMax: Number(formData.get('temperatureMax')),
    humidityMax: Number(formData.get('humidityMax')),
    airQualityMax: Number(formData.get('airQualityMax')),
    noiseMax: Number(formData.get('noiseMax')),
  };
  if (!settingsForm.reportValidity() || !updated.roomName) return;
  try {
    saveStorage(STORAGE_KEYS.settings, updated);
    Object.assign(settings, updated);
    document.querySelector('#room-display').textContent = settings.roomName;
    document.querySelector('#overview-room-name').textContent = settings.roomName.toUpperCase();
    document.querySelector('#settings-message').textContent = 'Settings saved for this browser.';
    if (currentReadings) {
      updateMetricCards(currentReadings);
      updateAlertBanner(currentReadings);
      recordThresholdAlerts(currentReadings);
      renderLiveReadings(currentReadings);
      renderTrends();
    }
  } catch (error) {
    document.querySelector('#settings-message').textContent = error.message;
    showNotice(error.message);
  }
});

const firebaseConfigured = isFirebaseConfigured();
const initialHistory = firebaseConfigured ? [] : createHistory(168);
const history = [...initialHistory];
overviewChart = createOverviewChart(initialHistory.slice(-24));
detailChart = createDetailChart();
fillSettingsForm();
document.querySelector('#room-display').textContent = settings.roomName;
document.querySelector('#overview-room-name').textContent = settings.roomName.toUpperCase();
applyTheme(readTheme());
if (initialHistory.length) {
  const initialSample = initialHistory[initialHistory.length - 1];
  updateMetricCards(initialSample);
  updateAlertBanner(initialSample);
  renderLiveReadings(initialSample);
}
renderTrends();
renderAlerts();

if (firebaseConfigured) {
  setSourceStatus('connecting', 'Connecting…');
  let unsubscribeFirebase;
  let simulatorStarted = false;
  const fallBackToSimulator = (error) => {
    if (simulatorStarted) return;
    simulatorStarted = true;
    unsubscribeFirebase?.();
    setSourceStatus('simulator', 'Simulator fallback');
    showNotice(`Firebase connection failed: ${error.message} Local simulator is active instead.`);
    startSimulator(handleSample);
  };

  try {
    unsubscribeFirebase = startFirebaseListener({
      onSample: (sample) => {
        setSourceStatus('connected', 'Firebase live');
        handleSample(sample);
      },
      onError: fallBackToSimulator,
    });
  } catch (error) {
    fallBackToSimulator(error);
  }
} else {
  setSourceStatus('simulator', 'Simulator');
  startSimulator(handleSample);
}

function readTheme() {
  try {
    return localStorage.getItem(STORAGE_KEYS.theme) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
