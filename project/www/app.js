// app.js — RunForm Analyser Dashboard
'use strict';

// =========================================================================
// CONSTANTS
// =========================================================================
const POLL_INTERVAL     = 100;   // ms
const STALE_THRESHOLD   = 2000;  // ms
const STEP_SCORE_THRESH = 10;    // show score panel after N steps

const CLR = {
  good:    '#22C55E',
  warning: '#F59E0B',
  alert:   '#EF4444',
  info:    '#3B82F6',
  neutral: '#6B7280',
  border:  '#E5E7EB',
};

const FEEDBACK_ICONS = { OK: '✓', INFO: 'ℹ', WARNING: '⚠', ALERT: '✕' };

// =========================================================================
// RECORDING STATE
// =========================================================================
let isRecording = false;

function toggleRecording() {
  if (isRecording) {
    stopSession();
  } else {
    startSession();
  }
}

function startSession() {
  // Reset all session data
  lastStepCount        = -1;
  sessionBaseStepCount = null;  // set on first poll — ignores old JSON data
  sessionSteps         = 0;
  prevCadence          = null;
  prevImpact           = null;
  prevAngle            = null;
  sessionStartTime     = new Date();  // timer starts immediately on Start
  totalSteps           = 0;
  lastKnownScores      = null;
  animDotX             = null;
  animDotY             = null;

  // Clear feedback store
  Object.keys(feedbackStore).forEach(k => delete feedbackStore[k]);

  // Reset UI
  const fc = document.getElementById('feedbackCurrent');
  if (fc) fc.innerHTML = '<div class="feedback-empty">Waiting for first step...</div>';
  const fl = document.getElementById('feedbackLog');
  if (fl) fl.innerHTML = '<li class="log-empty">No events yet.</li>';
  const lc = document.getElementById('logCount');
  if (lc) lc.textContent = '';
  document.getElementById('scorePanel').classList.remove('visible');
  document.getElementById('stat-steps').textContent    = '0';
  document.getElementById('stat-lateral').textContent  = '—';
  document.getElementById('stat-sidestep').textContent = 'Normal';
  document.getElementById('stat-sidestep-chip').className = 'stat-chip';
  document.getElementById('stat-time').textContent = '0:00';
  ['cadence','strike','impact','angle'].forEach(id => {
    document.getElementById(`val-${id}`).textContent   = '—';
    document.getElementById(`badge-${id}`).textContent = '—';
    document.getElementById(`badge-${id}`).className   = 'status-badge';
    document.getElementById(`card-${id}`).className    = 'metric-card';
  });
  footpathCtx.clearRect(0, 0, footpathCanvas.width, footpathCanvas.height);
  footpathCtx.fillStyle = '#F0F4FF';
  footpathCtx.fillRect(0, 0, footpathCanvas.width, footpathCanvas.height);
  initGauges();

  isRecording = true;
  updateRecordButton();
}

function stopSession() {
  isRecording = false;
  updateRecordButton();
}

function updateRecordButton() {
  const btn   = document.getElementById('recordBtn');
  const label = document.getElementById('recordLabel');
  if (!btn) return;
  if (isRecording) {
    btn.className   = 'record-btn recording';
    label.textContent = 'Stop Recording';
  } else {
    btn.className   = 'record-btn';
    label.textContent = 'Start Recording';
  }
}

// =========================================================================
// SESSION STATE
// =========================================================================
let lastStepCount         = -1;   // last data.stepCount processed
let sessionBaseStepCount  = null; // data.stepCount when recording started — ignore anything at/below this
let sessionSteps          = 0;    // steps recorded in THIS session
let prevCadence      = null;
let prevImpact       = null;
let prevAngle        = null;
let gaugesReady      = false;
let sessionStartTime = null;
let totalSteps       = 0;
let lastKnownScores  = null;

// Unique feedback store.
// Key: message text.  Value: { level, message, firstSeen: Date, count, lastSeen: Date }
// Each distinct message is stored exactly once; count increments on repeat.
const feedbackStore = {};

// =========================================================================
// ACTIONABLE ADVICE MAP
// Keyed by message substring. Used by the report generator.
// =========================================================================
const ADVICE = {
  'heel striking': {
    priority: 1,
    title: 'Eliminate Heel Strike',
    drill: 'Short-Step Drill',
    tips: [
      'Shorten your stride by ~10% so your foot lands under your hip, not in front.',
      'Think about "pulling" your foot back towards you rather than reaching forward.',
      'Introduce the change gradually: apply for 5 minutes per run, extend each week.',
      'Slightly increasing cadence naturally moves your landing point back.',
    ],
  },
  'cadence is too low': {
    priority: 1,
    title: 'Increase Cadence',
    drill: 'Metronome Run',
    tips: [
      'Use a free metronome app set to 170 bpm — take one step per beat.',
      'Apply for 60-second bursts, then run freely. Repeat 3–4 times per session.',
      'Target range is 160–180 steps/min. Small jumps of 5 spm per week are safest.',
    ],
  },
  'cadence is slightly slow': {
    priority: 2,
    title: 'Nudge Cadence Up',
    drill: 'Count Steps',
    tips: [
      'Count your steps for 30 seconds and aim for 80+ (= 160 spm both feet).',
      'A slight lean forward from the ankles often naturally increases turnover.',
    ],
  },
  'rolling inward': {
    priority: 1,
    title: 'Reduce Overpronation',
    drill: 'Single-Leg Ankle Stability',
    tips: [
      'Balance on one leg for 30 s with eyes closed — 3 sets each side daily.',
      'Progress to single-leg calf raises (3 × 15 each side).',
      'Check shoe wear — consider a stability or motion-control shoe.',
      'Strengthen your glutes (clamshells, bridges) to improve overall alignment.',
    ],
  },
  'supination': {
    priority: 2,
    title: 'Address Supination',
    drill: 'Hip Strengthening',
    tips: [
      'Lateral band walks: 2 × 20 steps each direction daily.',
      'Consider a neutral, cushioned shoe for better shock absorption.',
      'Supination is often mild — monitor for ankle instability and adjust if needed.',
    ],
  },
  'crossing your body': {
    priority: 1,
    title: 'Fix Crossover Gait',
    drill: 'Wide-Lane Drill',
    tips: [
      'Imagine two parallel train tracks — keep each foot on its own track.',
      'On a treadmill: place tape 10 cm apart and aim to land outside the lines.',
      'Think "hip-width" for each landing — not narrow, not wide.',
      'Reduces knee and IT-band stress significantly over time.',
    ],
  },
  'crossover gait': {
    priority: 2,
    title: 'Widen Your Step Landing',
    drill: 'Hip-Width Cue',
    tips: [
      'Consciously land slightly wider — a few centimetres is enough.',
      'Visualise two parallel lanes and keep feet separated.',
    ],
  },
  'landing very hard': {
    priority: 1,
    title: 'Soften Your Landing',
    drill: 'Quiet Feet Drill',
    tips: [
      'Run on a quiet floor and aim for silence — if you can hear yourself, land softer.',
      'Increase knee bend on contact to absorb impact through your legs, not the ground.',
      'Shorten stride length if impact remains high.',
      'This gradually builds calf, Achilles, and tibial resilience.',
    ],
  },
  'cadence is very high': {
    priority: 3,
    title: 'Monitor High Cadence',
    drill: null,
    tips: [
      'Very high cadence is only a concern if it feels forced or your form is suffering.',
      'If comfortable, no action needed — elite runners often exceed 180 spm.',
    ],
  },
  'cadence is slightly high': {
    priority: 3,
    title: 'High Cadence Note',
    drill: null,
    tips: [
      'Slightly elevated cadence is generally fine and may even be beneficial.',
      'Only adjust if you feel fatigued or if form breaks down.',
    ],
  },
};

function getAdvice(message) {
  const m = (message || '').toLowerCase();
  for (const [key, val] of Object.entries(ADVICE)) {
    if (m.includes(key)) return val;
  }
  return null;
}

// =========================================================================
// CLOCK
// =========================================================================
function updateClock() {
  const n = new Date();
  document.getElementById('headerClock').textContent =
    [n.getHours(), n.getMinutes(), n.getSeconds()]
      .map(v => String(v).padStart(2, '0')).join(':');
}
setInterval(updateClock, 1000);
updateClock();

// =========================================================================
// CONNECTION STATUS
// =========================================================================
function updateConnectionStatus(ts) {
  const dot   = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  const age   = Date.now() - ts * 1000;
  if (!ts) {
    dot.className = 'conn-dot'; label.textContent = 'Connecting...';
  } else if (age < STALE_THRESHOLD) {
    dot.className = 'conn-dot connected'; label.textContent = 'Live';
  } else {
    dot.className = 'conn-dot disconnected'; label.textContent = 'No signal';
  }
}

// =========================================================================
// METRIC CARDS
// =========================================================================
function cadenceStatus(s) {
  if (s >= 160 && s <= 180) return 'good';
  if ((s >= 150 && s < 160) || (s > 180 && s <= 190)) return 'warning';
  return 'alert';
}
function strikeStatus(s) {
  return (s === 'forefoot' || s === 'midfoot') ? 'good' : (s === 'heel' ? 'alert' : 'warning');
}
function impactStatus(g) { return g < 2.5 ? 'good' : g <= 3.5 ? 'warning' : 'alert'; }
function angleStatus(d) {
  if (d >= 0 && d <= 10) return 'good';
  if ((d >= -5 && d < 0) || (d > 10 && d <= 20)) return 'warning';
  return 'alert';
}
function trendArrow(cur, prev, higherBetter) {
  if (prev === null || Math.abs(cur - prev) < 0.5) return '→';
  return (cur > prev) === higherBetter ? '↑' : '↓';
}

function updateMetricCards(data) {
  if (data.cadence && data.cadence > 0) {
    const v = Math.round(data.cadence), s = cadenceStatus(v);
    document.getElementById('val-cadence').textContent = v;
    setCard('card-cadence','badge-cadence','trend-cadence', s, s.toUpperCase(), trendArrow(v, prevCadence, true));
    prevCadence = v;
  }
  if (data.footStrike) {
    const label = data.footStrike.charAt(0).toUpperCase() + data.footStrike.slice(1);
    const s = strikeStatus(data.footStrike);
    document.getElementById('val-strike').textContent = label;
    setCard('card-strike','badge-strike','trend-strike', s, s.toUpperCase(), '→');
  }
  const impV = +Math.abs(data.az || 0).toFixed(2);
  const impS = impactStatus(impV);
  document.getElementById('val-impact').textContent = impV.toFixed(2);
  setCard('card-impact','badge-impact','trend-impact', impS, impS.toUpperCase(), trendArrow(impV, prevImpact, false));
  prevImpact = impV;

  if (data.impactAngle !== undefined) {
    const ang = +data.impactAngle.toFixed(1), angS = angleStatus(ang);
    document.getElementById('val-angle').textContent = ang;
    setCard('card-angle','badge-angle','trend-angle', angS, angS.toUpperCase(), trendArrow(ang, prevAngle, false));
    prevAngle = ang;
  }
}

function setCard(cardId, badgeId, trendId, status, badgeText, trendChar) {
  document.getElementById(cardId).className = `metric-card ${status}`;
  const b = document.getElementById(badgeId);
  b.className = `status-badge ${status}`; b.textContent = badgeText;
  const t = document.getElementById(trendId);
  t.textContent = trendChar;
  t.className = 'trend-arrow' + (trendChar === '↑' ? ' up' : trendChar === '↓' ? ' down' : '');
}

// =========================================================================
// FOOT PATH CANVAS
// =========================================================================
const footpathCanvas = document.getElementById('footpath');
const footpathCtx    = footpathCanvas.getContext('2d');
let animDotX = null, animDotY = null;

function updateFootPath(footPath, optimalPath) {
  if (!footPath || !footPath.x || footPath.x.length < 2) return;
  const W = footpathCanvas.width, H = footpathCanvas.height, PAD = 24;

  // x = forward displacement, y = foot height — combine both paths for axis scaling
  const allX = [...footPath.x, ...(optimalPath ? optimalPath.x : [])];
  const allY = [...footPath.y, ...(optimalPath ? optimalPath.y : [])];
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minY = 0;                                   // always start from ground
  const maxY = Math.max(...allY);
  const rangeX = maxX - minX || 0.001;
  const rangeY = maxY - minY || 0.001;

  // Add 15% vertical headroom so the arc doesn't touch the top edge
  const scaleY = (H - 2*PAD) * 0.85;

  function toCanvas(x, y) {
    return [
      PAD + ((x - minX) / rangeX) * (W - 2*PAD),
      H - PAD - ((y - minY) / rangeY) * scaleY,
    ];
  }

  footpathCtx.clearRect(0,0,W,H);
  footpathCtx.fillStyle = '#F0F4FF'; footpathCtx.fillRect(0,0,W,H);

  // Draw ground line
  const [gx0] = toCanvas(minX, 0), [gx1] = toCanvas(maxX, 0);
  const [,gy] = toCanvas(minX, 0);
  footpathCtx.beginPath();
  footpathCtx.strokeStyle = '#D1D5DB'; footpathCtx.lineWidth = 1;
  footpathCtx.setLineDash([4,4]);
  footpathCtx.moveTo(gx0, gy); footpathCtx.lineTo(gx1, gy);
  footpathCtx.stroke(); footpathCtx.setLineDash([]);

  if (optimalPath && optimalPath.x.length >= 2) {
    // Tolerance band: ±10% of rangeY around the ideal arc
    const yTol = rangeY * 0.10;
    footpathCtx.beginPath();
    for (let i=0; i<optimalPath.x.length; i++) {
      const [cx,cy] = toCanvas(optimalPath.x[i], optimalPath.y[i] - yTol);
      i===0 ? footpathCtx.moveTo(cx,cy) : footpathCtx.lineTo(cx,cy);
    }
    for (let i=optimalPath.x.length-1; i>=0; i--) {
      const [cx,cy] = toCanvas(optimalPath.x[i], optimalPath.y[i] + yTol);
      footpathCtx.lineTo(cx,cy);
    }
    footpathCtx.closePath();
    footpathCtx.fillStyle = 'rgba(167,139,250,0.22)'; footpathCtx.fill();

    // Ideal arc (dashed)
    footpathCtx.beginPath();
    footpathCtx.setLineDash([6,5]); footpathCtx.strokeStyle = '#9CA3AF'; footpathCtx.lineWidth = 2;
    for (let i=0; i<optimalPath.x.length; i++) {
      const [cx,cy] = toCanvas(optimalPath.x[i], optimalPath.y[i]);
      i===0 ? footpathCtx.moveTo(cx,cy) : footpathCtx.lineTo(cx,cy);
    }
    footpathCtx.stroke(); footpathCtx.setLineDash([]);
  }

  // Actual foot path (blue)
  footpathCtx.beginPath();
  footpathCtx.strokeStyle = CLR.info; footpathCtx.lineWidth = 2.5; footpathCtx.lineJoin = 'round';
  for (let i=0; i<footPath.x.length; i++) {
    const [cx,cy] = toCanvas(footPath.x[i], footPath.y[i]);
    i===0 ? footpathCtx.moveTo(cx,cy) : footpathCtx.lineTo(cx,cy);
  }
  footpathCtx.stroke();

  // Animated dot at current foot position
  const last = footPath.x.length - 1;
  [animDotX, animDotY] = toCanvas(footPath.x[last], footPath.y[last]);
}

let dotPhase = 0;
function drawAnimDot() {
  if (animDotX === null) return;
  dotPhase = (dotPhase + 0.07) % (2 * Math.PI);
  const pulse = 5 + 2 * Math.sin(dotPhase);
  footpathCtx.beginPath();
  footpathCtx.arc(animDotX, animDotY, pulse, 0, 2*Math.PI);
  footpathCtx.fillStyle = 'rgba(59,130,246,0.3)'; footpathCtx.fill();
  footpathCtx.beginPath();
  footpathCtx.arc(animDotX, animDotY, 4, 0, 2*Math.PI);
  footpathCtx.fillStyle = CLR.info; footpathCtx.fill();
}

// =========================================================================
// SVG GAUGES  (fixed — arc sweeps through TOP of semicircle)
//
// valueToAngleDeg: [totalMin…totalMax] → [180°…0°]  (decreasing)
//   min value → 180° (left),  mid → 90° (top),  max → 0° (right)
//
// polar(deg) uses  y = CY − R·sin(deg)  to flip Y-axis into SVG space.
//
// arcPath with sweep-flag=1 (positive/clockwise in SVG param space) goes
// through the top of the circle: SVG θ=270° = (cx, cy−r) = top on screen. ✓
//
// Needle: default points straight UP.  Rotation = (90 − needleAngle).
//   needleAngle=180 → rotate(−90) → points left  ✓
//   needleAngle= 90 → rotate(  0) → points up    ✓
//   needleAngle=  0 → rotate( 90) → points right ✓
// =========================================================================
function drawGauge(_svgId, arcsId, needleId, valTextId,
                   zones, totalMin, totalMax, value, unit) {
  const arcsG   = document.getElementById(arcsId);
  const needle  = document.getElementById(needleId);
  const valText = document.getElementById(valTextId);
  if (!arcsG || !needle || !valText) return;

  const CX = 100, CY = 110, R = 70;

  function v2a(v) {                          // value → SVG angle (180°→0°)
    return 180 - ((v - totalMin) / (totalMax - totalMin)) * 180;
  }
  function polar(deg, r) {
    const rad = deg * Math.PI / 180;
    return [CX + r * Math.cos(rad), CY - r * Math.sin(rad)];
  }
  function arcPath(aDeg, bDeg) {
    const [sx, sy] = polar(aDeg, R), [ex, ey] = polar(bDeg, R);
    const large = Math.abs(aDeg - bDeg) >= 180 ? 1 : 0;
    return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  }

  if (!arcsG.dataset.ready) {
    arcsG.innerHTML = '';
    // Grey background track
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    bg.setAttribute('d', arcPath(180, 0));
    bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', '#E5E7EB');
    bg.setAttribute('stroke-width', '14'); bg.setAttribute('stroke-linecap', 'butt');
    arcsG.appendChild(bg);
    // Coloured zone arcs
    zones.forEach(z => {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', arcPath(v2a(z.min), v2a(z.max)));
      p.setAttribute('fill', 'none'); p.setAttribute('stroke', z.color);
      p.setAttribute('stroke-width', '14'); p.setAttribute('stroke-linecap', 'butt');
      arcsG.appendChild(p);
    });
    arcsG.dataset.ready = '1';
  }

  const clamped = Math.max(totalMin, Math.min(totalMax, value));
  needle.setAttribute('transform', `rotate(${(90 - v2a(clamped)).toFixed(2)} ${CX} ${CY})`);
  valText.textContent = value.toFixed(1) + (unit || '°');
}

const PRONATION_ZONES = [
  { min: -30, max:  -5, color: CLR.alert   },
  { min:  -5, max:  15, color: CLR.good    },
  { min:  15, max:  30, color: CLR.alert   },
];
const IMPACT_ZONES = [
  { min: -20, max:  -5, color: CLR.alert   },
  { min:  -5, max:  10, color: CLR.good    },
  { min:  10, max:  25, color: CLR.warning },
];

function initGauges() {
  document.getElementById('pronation-arcs').removeAttribute('data-ready');
  document.getElementById('impact-arcs').removeAttribute('data-ready');
  drawGauge('pronation-gauge','pronation-arcs','pronation-needle','pronation-val', PRONATION_ZONES,-30,30,0,'°');
  drawGauge('impact-gauge','impact-arcs','impact-needle','impact-val', IMPACT_ZONES,-20,25,0,'°');
  gaugesReady = true;
}
function updateGauges(roll, impact) {
  if (!gaugesReady) initGauges();
  if (roll   !== undefined) drawGauge('pronation-gauge','pronation-arcs','pronation-needle','pronation-val',PRONATION_ZONES,-30,30,roll,'°');
  if (impact !== undefined) drawGauge('impact-gauge','impact-arcs','impact-needle','impact-val',IMPACT_ZONES,-20,25,impact,'°');
}

// =========================================================================
// FEEDBACK — CURRENT STEP
// Only re-renders when data.timestamp changes (one update per step event).
// =========================================================================
function updateCurrentFeedback(feedbackArr) {
  const container = document.getElementById('feedbackCurrent');
  if (!container) return;
  container.innerHTML = '';

  if (!feedbackArr || feedbackArr.length === 0) {
    container.innerHTML = '<div class="feedback-empty">No issues detected this step.</div>';
    return;
  }

  feedbackArr.forEach(fb => {
    const level = (fb.level || 'INFO').toUpperCase();
    const div   = document.createElement('div');
    div.className = `feedback-now-item ${level.toLowerCase()}`;

    const icon = document.createElement('span');
    icon.className = 'feedback-now-icon';
    icon.textContent = FEEDBACK_ICONS[level] || 'ℹ';

    const body  = document.createElement('div');
    body.className = 'feedback-now-body';

    const badge = document.createElement('span');
    badge.className = `feedback-level-badge ${level.toLowerCase()}`;
    badge.textContent = level;

    const msg = document.createElement('p');
    msg.className   = 'feedback-now-msg';
    msg.textContent = fb.message;

    body.appendChild(badge); body.appendChild(msg);
    div.appendChild(icon);   div.appendChild(body);
    container.appendChild(div);
  });
}

// =========================================================================
// FEEDBACK — UNIQUE STORE + SESSION LOG
// Each distinct message is stored exactly once in feedbackStore.
// count increments on every repeat occurrence.
// =========================================================================
function ingestFeedback(feedbackArr) {
  if (!feedbackArr || feedbackArr.length === 0) return false;

  const now = new Date();
  let changed = false;

  feedbackArr.forEach(fb => {
    const msg   = fb.message;
    const level = (fb.level || 'INFO').toUpperCase();
    if (!msg) return;

    if (feedbackStore[msg]) {
      // Already known — just update count and recency
      feedbackStore[msg].count++;
      feedbackStore[msg].lastSeen  = now;
      feedbackStore[msg].level     = level;  // update in case severity changed
    } else {
      // New unique message
      feedbackStore[msg] = { level, message: msg, firstSeen: now, lastSeen: now, count: 1 };
      changed = true;  // new entry — need to re-render log
    }
  });

  return changed;
}

function renderFeedbackLog() {
  const list = document.getElementById('feedbackLog');
  if (!list) return;

  const entries = Object.values(feedbackStore)
    .sort((a, b) => b.lastSeen - a.lastSeen);  // most recent first

  list.innerHTML = '';

  const countEl = document.getElementById('logCount');
  if (countEl) countEl.textContent = entries.length || '';

  if (entries.length === 0) {
    list.innerHTML = '<li class="log-empty">No events yet.</li>';
    return;
  }

  const fmt = d => [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2,'0')).join(':');

  entries.forEach(fb => {
    const li = document.createElement('li');
    li.className = `log-item ${fb.level.toLowerCase()}`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = fmt(fb.firstSeen);

    const icon = document.createElement('span');
    icon.className = 'log-icon';
    icon.textContent = FEEDBACK_ICONS[fb.level] || 'ℹ';

    const badge = document.createElement('span');
    badge.className = `log-badge ${fb.level.toLowerCase()}`;
    badge.textContent = fb.level;

    const msgSpan = document.createElement('span');
    msgSpan.className   = 'log-msg';
    msgSpan.textContent = fb.message;

    const countBadge = document.createElement('span');
    countBadge.className = 'log-count-badge';
    countBadge.textContent = fb.count > 1 ? `×${fb.count}` : '';

    li.appendChild(timeSpan); li.appendChild(icon); li.appendChild(badge);
    li.appendChild(msgSpan);  li.appendChild(countBadge);
    list.appendChild(li);
  });
}

// =========================================================================
// GENERATE SUMMARY REPORT
// =========================================================================
function generateReport() {
  const entries = Object.values(feedbackStore);

  // Sort by severity then priority
  const LEVEL_ORDER = { ALERT: 0, WARNING: 1, INFO: 2, OK: 3 };
  const sorted = [...entries].sort((a, b) => {
    const la = LEVEL_ORDER[a.level] ?? 4;
    const lb = LEVEL_ORDER[b.level] ?? 4;
    if (la !== lb) return la - lb;
    const pa = getAdvice(a.message)?.priority ?? 9;
    const pb = getAdvice(b.message)?.priority ?? 9;
    return pa - pb;
  });

  const issues  = sorted.filter(e => e.level !== 'OK');
  const allGood = sorted.filter(e => e.level === 'OK');
  const alerts   = issues.filter(e => e.level === 'ALERT');
  const warnings = issues.filter(e => e.level === 'WARNING');
  const infos    = issues.filter(e => e.level === 'INFO');

  const now       = new Date();
  const fmtDate   = d => d.toLocaleTimeString();
  const scoreStr  = lastKnownScores
    ? `Overall ${Math.round(lastKnownScores.overall)}/100  ·  Cadence ${Math.round(lastKnownScores.cadence)}/100  ·  Strike ${Math.round(lastKnownScores.strike)}/100  ·  Pronation ${Math.round(lastKnownScores.pronation)}/100  ·  Lateral ${Math.round(lastKnownScores.lateral)}/100`
    : 'Scores not yet available (need 10+ steps)';

  // Build HTML for the report body
  let html = `
    <div class="report-meta">
      <span>Generated at <strong>${fmtDate(now)}</strong></span>
      ${sessionStartTime ? `<span>Session started <strong>${fmtDate(sessionStartTime)}</strong></span>` : ''}
      <span>Steps recorded: <strong>${totalSteps}</strong></span>
      <span>Unique issues: <strong>${issues.length}</strong></span>
    </div>

    <div class="report-scores">
      <div class="report-section-title">Performance Scores</div>
      <p class="report-score-str">${scoreStr}</p>
    </div>
  `;

  if (issues.length === 0) {
    html += `
      <div class="report-all-good">
        <span class="report-all-good-icon">✓</span>
        <div>
          <strong>No issues recorded this session.</strong>
          <p>Your running form looks great — keep up the good work!</p>
        </div>
      </div>`;
  } else {
    // Issues by severity
    const renderGroup = (title, colour, groupEntries) => {
      if (groupEntries.length === 0) return '';
      let g = `<div class="report-group">
        <div class="report-group-title" style="color:${colour}">${title}</div>`;
      groupEntries.forEach(e => {
        const adv = getAdvice(e.message);
        g += `<div class="report-issue">
          <div class="report-issue-header">
            <span class="report-issue-msg">${e.message}</span>
            <span class="report-issue-count">seen ${e.count}×</span>
          </div>`;
        if (adv && adv.tips.length > 0) {
          g += `<div class="report-issue-advice">
            <span class="report-advice-label">${adv.drill ? `Drill: ${adv.drill}` : 'Tip'}</span>
            <ul class="report-tips">`;
          adv.tips.forEach(tip => { g += `<li>${tip}</li>`; });
          g += `</ul></div>`;
        }
        g += `</div>`;
      });
      g += `</div>`;
      return g;
    };

    html += renderGroup('🔴  High Priority — Fix These First', CLR.alert,   alerts);
    html += renderGroup('🟡  Needs Attention',                  CLR.warning, warnings);
    html += renderGroup('🔵  Notes',                            CLR.info,    infos);

    // Action plan: top 3 priority items with advice
    const actionItems = issues
      .filter(e => getAdvice(e.message))
      .sort((a, b) => {
        const pa = getAdvice(a.message)?.priority ?? 9;
        const pb = getAdvice(b.message)?.priority ?? 9;
        return pa - pb;
      })
      .slice(0, 3);

    if (actionItems.length > 0) {
      html += `<div class="report-action-plan">
        <div class="report-section-title">Your Action Plan</div>
        <p class="report-action-intro">Focus on these in order — fixing higher-priority issues often resolves lower ones naturally.</p>
        <ol class="report-action-list">`;
      actionItems.forEach(e => {
        const adv = getAdvice(e.message);
        html += `<li>
          <strong>${adv.title}</strong>
          ${adv.drill ? `<span class="report-drill-tag">Drill: ${adv.drill}</span>` : ''}
          <ul class="report-tips">`;
        adv.tips.forEach(tip => { html += `<li>${tip}</li>`; });
        html += `</ul></li>`;
      });
      html += `</ol></div>`;
    }
  }

  if (allGood.length > 0) {
    html += `<div class="report-good-section">
      <div class="report-section-title">✓  What Went Well</div>
      <ul class="report-good-list">`;
    allGood.forEach(e => { html += `<li>${e.message}</li>`; });
    html += `</ul></div>`;
  }

  // Inject into modal and show
  document.getElementById('reportBody').innerHTML = html;
  document.getElementById('reportModal').classList.add('open');
}

function closeReport() {
  document.getElementById('reportModal').classList.remove('open');
}

// =========================================================================
// SCORE PANEL
// =========================================================================
function scoreColor(s) { return s >= 80 ? CLR.good : s >= 50 ? CLR.warning : CLR.alert; }

function updateScores(scores, stepCount) {
  if (!scores || stepCount < STEP_SCORE_THRESH) return;
  lastKnownScores = scores;
  document.getElementById('scorePanel').classList.add('visible');

  const overall = Math.round(scores.overall || 0);
  document.getElementById('scoreOverallNum').textContent = overall;
  const circ = 2 * Math.PI * 50, fill = (overall / 100) * circ;
  const ring = document.getElementById('ringFill');
  ring.setAttribute('stroke-dasharray', `${fill.toFixed(2)} ${(circ-fill).toFixed(2)}`);
  ring.setAttribute('stroke', scoreColor(overall));

  [['bar-cadence','barval-cadence',scores.cadence],
   ['bar-strike', 'barval-strike', scores.strike],
   ['bar-pronation','barval-pronation',scores.pronation],
   ['bar-lateral','barval-lateral',scores.lateral]].forEach(([barId,valId,score]) => {
    const pct = Math.max(0, Math.min(100, Math.round(score || 0)));
    const bar = document.getElementById(barId);
    bar.style.width = pct + '%'; bar.style.background = scoreColor(pct);
    document.getElementById(valId).textContent = pct;
  });
}

// =========================================================================
// SESSION TIMER
// =========================================================================
let sessionTimerEl = null;

function updateSessionTimer() {
  if (!sessionTimerEl) sessionTimerEl = document.getElementById('stat-time');
  if (!isRecording || !sessionStartTime || !sessionTimerEl) return;
  const secs  = Math.floor((Date.now() - sessionStartTime) / 1000);
  const m     = Math.floor(secs / 60);
  const s     = secs % 60;
  sessionTimerEl.textContent = `${m}:${String(s).padStart(2,'0')}`;
}
setInterval(updateSessionTimer, 1000);

// =========================================================================
// STATS ROW
// =========================================================================
function updateStatsRow(stepCount, lateralDisp_m, isSidestep) {
  const stepsEl    = document.getElementById('stat-steps');
  const latEl      = document.getElementById('stat-lateral');
  const sideEl     = document.getElementById('stat-sidestep');
  const sideChip   = document.getElementById('stat-sidestep-chip');

  if (stepsEl) stepsEl.textContent = stepCount || 0;

  if (latEl && lateralDisp_m !== undefined) {
    latEl.textContent = (lateralDisp_m * 100).toFixed(1);
  }

  if (sideEl && sideChip) {
    if (isSidestep) {
      sideEl.textContent  = 'Crossover';
      sideChip.className  = 'stat-chip alert';
    } else {
      sideEl.textContent  = 'Normal';
      sideChip.className  = 'stat-chip good';
    }
  }
}

// =========================================================================
// MAIN POLL LOOP
// =========================================================================
async function fetchData() {
  try {
    const res = await fetch('data.json?t=' + Date.now());
    if (!res.ok) { updateConnectionStatus(0); return; }

    const data = await res.json();
    if (!data.timestamp) { updateConnectionStatus(0); return; }

    // Always update connection status so the indicator stays live
    updateConnectionStatus(data.timestamp);

    // Only process and display data when a session is active
    if (!isRecording) return;

    const currentStep = data.stepCount || 0;

    // First poll after Start: record the baseline step count so we don't
    // re-process feedback that was already in the file before recording began.
    if (sessionBaseStepCount === null) {
      sessionBaseStepCount = currentStep;
      lastStepCount        = currentStep;
    }

    // Always update visuals while recording
    updateMetricCards(data);
    updateFootPath(data.footPath, data.optimalPath);
    updateGauges(data.rollAngle, data.impactAngle);
    updateScores(data.scores, sessionSteps);
    updateStatsRow(sessionSteps, data.lateralDisp, data.isSidestep);

    // Only process feedback for steps that arrived after recording started
    if (currentStep > lastStepCount) {
      lastStepCount = currentStep;
      sessionSteps++;
      totalSteps = sessionSteps;

      updateCurrentFeedback(data.feedback);

      const newEntries = ingestFeedback(data.feedback);
      if (newEntries) renderFeedbackLog();
      else if (data.feedback && data.feedback.length > 0) renderFeedbackLog();
    }

  } catch (e) {
    updateConnectionStatus(0);
  }
}

// =========================================================================
// STARTUP
// =========================================================================
initGauges();
setInterval(fetchData, POLL_INTERVAL);
fetchData();

(function animLoop() {
  if (animDotX !== null) drawAnimDot();
  requestAnimationFrame(animLoop);
})();
