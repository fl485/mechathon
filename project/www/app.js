// app.js — RunForm Analyser Dashboard
// Pure Vanilla JS, no frameworks.
// Polls data.json every 100 ms and updates all UI elements.

'use strict';

// =========================================================================
// CONSTANTS
// =========================================================================
const POLL_INTERVAL    = 100;   // ms between JSON polls
const STALE_THRESHOLD  = 2000;  // ms — data older than this = disconnected
const MAX_FEEDBACK     = 5;     // maximum feedback items shown at once
const STEP_SCORE_THRESH = 10;   // show score panel after this many steps

// Colour tokens (match CSS variables)
const CLR = {
  good:    '#22C55E',
  warning: '#F59E0B',
  alert:   '#EF4444',
  info:    '#3B82F6',
  neutral: '#6B7280',
  border:  '#E5E7EB',
};

// =========================================================================
// STATE
// =========================================================================
let lastTimestamp     = 0;
let prevCadence       = null;
let prevImpact        = null;
let prevAngle         = null;
let feedbackQueue     = [];   // [{level, message}, ...]
let gaugesInitialised = false;

// =========================================================================
// CLOCK
// =========================================================================
function updateClock() {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2, '0');
  const mm  = String(now.getMinutes()).padStart(2, '0');
  const ss  = String(now.getSeconds()).padStart(2, '0');
  document.getElementById('headerClock').textContent = `${hh}:${mm}:${ss}`;
}
setInterval(updateClock, 1000);
updateClock();

// =========================================================================
// CONNECTION STATUS
// =========================================================================
function updateConnectionStatus(dataTimestamp) {
  const dot   = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  const age   = Date.now() - dataTimestamp * 1000;  // dataTimestamp is POSIX seconds

  if (dataTimestamp === 0) {
    dot.className = 'conn-dot';  // yellow / neutral
    label.textContent = 'Connecting...';
  } else if (age < STALE_THRESHOLD) {
    dot.className = 'conn-dot connected';
    label.textContent = 'Live';
  } else {
    dot.className = 'conn-dot disconnected';
    label.textContent = 'No signal';
  }
}

// =========================================================================
// METRIC CARDS
// =========================================================================

/** Return 'good'|'warning'|'alert' based on value and thresholds */
function cadenceStatus(spm) {
  if (spm >= 160 && spm <= 180) return 'good';
  if ((spm >= 150 && spm < 160) || (spm > 180 && spm <= 190)) return 'warning';
  return 'alert';
}

function strikeStatus(strike) {
  if (strike === 'forefoot') return 'good';
  if (strike === 'midfoot')  return 'good';
  if (strike === 'heel')     return 'alert';
  return 'warning';
}

function impactStatus(g) {
  if (g < 2.5)  return 'good';
  if (g <= 3.5) return 'warning';
  return 'alert';
}

function angleStatus(deg) {
  if (deg >= 0 && deg <= 10)                         return 'good';
  if ((deg >= -5 && deg < 0) || (deg > 10 && deg <= 20)) return 'warning';
  return 'alert';
}

/** Trend arrow given current and previous value */
function trendArrow(current, previous, higherIsBetter) {
  if (previous === null) return '→';
  const delta = current - previous;
  if (Math.abs(delta) < 0.5) return '→';
  if (delta > 0) return higherIsBetter ? '↑' : '↓';
  return higherIsBetter ? '↓' : '↑';
}

function updateMetricCards(data) {
  // -- Cadence --
  if (data.cadence && data.cadence > 0) {
    const val    = Math.round(data.cadence);
    const status = cadenceStatus(val);
    const trend  = trendArrow(val, prevCadence, true);
    prevCadence  = val;

    document.getElementById('val-cadence').textContent   = val;
    setCardStatus('card-cadence', 'badge-cadence', 'trend-cadence', status, status.toUpperCase(), trend);
  }

  // -- Foot strike --
  if (data.footStrike) {
    const label  = data.footStrike.charAt(0).toUpperCase() + data.footStrike.slice(1);
    const status = strikeStatus(data.footStrike);
    document.getElementById('val-strike').textContent   = label;
    setCardStatus('card-strike', 'badge-strike', 'trend-strike', status, status.toUpperCase(), '→');
  }

  // -- Impact force (use peak az as proxy; clamp to reasonable display) --
  const rawImpact = Math.abs(data.az || 0);
  const impactVal = +rawImpact.toFixed(2);
  const impactSt  = impactStatus(impactVal);
  const impTrend  = trendArrow(impactVal, prevImpact, false);
  prevImpact = impactVal;
  document.getElementById('val-impact').textContent = impactVal.toFixed(2);
  setCardStatus('card-impact', 'badge-impact', 'trend-impact', impactSt, impactSt.toUpperCase(), impTrend);

  // -- Foot angle --
  if (data.impactAngle !== undefined) {
    const ang    = +data.impactAngle.toFixed(1);
    const angSt  = angleStatus(ang);
    const angTr  = trendArrow(ang, prevAngle, false);
    prevAngle    = ang;
    document.getElementById('val-angle').textContent = ang;
    setCardStatus('card-angle', 'badge-angle', 'trend-angle', angSt, angSt.toUpperCase(), angTr);
  }
}

function setCardStatus(cardId, badgeId, trendId, status, badgeText, trendChar) {
  const card  = document.getElementById(cardId);
  const badge = document.getElementById(badgeId);
  const trend = document.getElementById(trendId);

  card.className = `metric-card ${status}`;
  badge.className = `status-badge ${status}`;
  badge.textContent = badgeText;

  trend.textContent = trendChar;
  trend.className = 'trend-arrow' +
    (trendChar === '↑' ? ' up' : trendChar === '↓' ? ' down' : '');
}

// =========================================================================
// FOOT PATH CANVAS
// =========================================================================
const footpathCanvas  = document.getElementById('footpath');
const footpathCtx     = footpathCanvas.getContext('2d');
let   animDotX = null, animDotY = null;
let   animFrame = null;

function updateFootPath(footPath, optimalPath) {
  if (!footPath || !footPath.x || !footPath.y || footPath.x.length < 2) return;

  const W  = footpathCanvas.width;
  const H  = footpathCanvas.height;
  const PAD = 24;

  const allX  = [...footPath.x, ...(optimalPath ? optimalPath.x : [])];
  const allY  = [...footPath.y, ...(optimalPath ? optimalPath.y : [])];

  const minX = Math.min(...allX),  maxX = Math.max(...allX);
  const minY = Math.min(...allY),  maxY = Math.max(...allY);

  const rangeX = maxX - minX || 0.001;
  const rangeY = maxY - minY || 0.001;

  /** Map physical metres to canvas pixels.
   *  Y is flipped: running direction = upward on screen. */
  function toCanvas(x, y) {
    const cx = PAD + ((x - minX) / rangeX) * (W - 2 * PAD);
    const cy = H - PAD - ((y - minY) / rangeY) * (H - 2 * PAD);
    return [cx, cy];
  }

  footpathCtx.clearRect(0, 0, W, H);

  // Background
  footpathCtx.fillStyle = '#F0F4FF';
  footpathCtx.fillRect(0, 0, W, H);

  // Tolerance corridor: ±2 cm around the optimal path
  if (optimalPath && optimalPath.x.length >= 2) {
    footpathCtx.beginPath();
    const corridorPx = ((0.02 / rangeX) * (W - 2 * PAD));

    // Left edge
    for (let i = 0; i < optimalPath.x.length; i++) {
      const [cx, cy] = toCanvas(optimalPath.x[i] - 0.02, optimalPath.y[i]);
      i === 0 ? footpathCtx.moveTo(cx, cy) : footpathCtx.lineTo(cx, cy);
    }
    // Right edge (reversed)
    for (let i = optimalPath.x.length - 1; i >= 0; i--) {
      const [cx, cy] = toCanvas(optimalPath.x[i] + 0.02, optimalPath.y[i]);
      footpathCtx.lineTo(cx, cy);
    }
    footpathCtx.closePath();
    footpathCtx.fillStyle = 'rgba(167,139,250,0.18)';  // light purple
    footpathCtx.fill();
  }

  // Optimal path (dashed grey)
  if (optimalPath && optimalPath.x.length >= 2) {
    footpathCtx.beginPath();
    footpathCtx.setLineDash([6, 5]);
    footpathCtx.strokeStyle = '#9CA3AF';
    footpathCtx.lineWidth   = 2;
    for (let i = 0; i < optimalPath.x.length; i++) {
      const [cx, cy] = toCanvas(optimalPath.x[i], optimalPath.y[i]);
      i === 0 ? footpathCtx.moveTo(cx, cy) : footpathCtx.lineTo(cx, cy);
    }
    footpathCtx.stroke();
    footpathCtx.setLineDash([]);
  }

  // Actual path (solid blue)
  footpathCtx.beginPath();
  footpathCtx.strokeStyle = CLR.info;
  footpathCtx.lineWidth   = 2.5;
  footpathCtx.lineJoin    = 'round';
  for (let i = 0; i < footPath.x.length; i++) {
    const [cx, cy] = toCanvas(footPath.x[i], footPath.y[i]);
    i === 0 ? footpathCtx.moveTo(cx, cy) : footpathCtx.lineTo(cx, cy);
  }
  footpathCtx.stroke();

  // Animated dot at latest position
  const last = footPath.x.length - 1;
  const [dotX, dotY] = toCanvas(footPath.x[last], footPath.y[last]);
  animDotX = dotX;
  animDotY = dotY;

  drawAnimDot();
}

let dotPhase = 0;
function drawAnimDot() {
  if (animDotX === null) return;
  dotPhase = (dotPhase + 0.07) % (2 * Math.PI);
  const pulse = 5 + 2 * Math.sin(dotPhase);

  // Re-draw over existing canvas (non-destructive dot animation)
  footpathCtx.beginPath();
  footpathCtx.arc(animDotX, animDotY, pulse, 0, 2 * Math.PI);
  footpathCtx.fillStyle = 'rgba(59,130,246,0.3)';
  footpathCtx.fill();

  footpathCtx.beginPath();
  footpathCtx.arc(animDotX, animDotY, 4, 0, 2 * Math.PI);
  footpathCtx.fillStyle = CLR.info;
  footpathCtx.fill();
}

// =========================================================================
// SVG GAUGES
// =========================================================================

/**
 * Draw a semicircular gauge SVG with colour zones.
 *
 * @param {string}  svgId      - id of the <svg> element
 * @param {string}  arcsId     - id of the <g> for arcs
 * @param {string}  needleId   - id of the needle <line>
 * @param {string}  valTextId  - id of value <text>
 * @param {Array}   zones      - [{min, max, color}] in real units
 * @param {number}  totalMin   - minimum displayed value
 * @param {number}  totalMax   - maximum displayed value
 * @param {number}  value      - current value
 * @param {string}  unit       - unit string appended to label
 */
function updateGauge(svgId, arcsId, needleId, valTextId, zones, totalMin, totalMax, value, unit) {
  const svg     = document.getElementById(svgId);
  const arcsG   = document.getElementById(arcsId);
  const needle  = document.getElementById(needleId);
  const valText = document.getElementById(valTextId);

  // Gauge geometry: semicircle centred at (100,110), radius 70
  const CX = 100, CY = 110, R = 70;
  // 180° sweep: leftmost = 180°, rightmost = 0° (angles in CSS/SVG terms)
  // Map value range [totalMin, totalMax] -> angle [-180, 0] in standard math (deg)

  function valueToAngleDeg(v) {
    const frac = (v - totalMin) / (totalMax - totalMin);
    // Map totalMin → 180° (left), totalMax → 0° (right), midpoint → 90° (top).
    // Decreasing so arcs drawn left→right all go through the upper semicircle.
    return 180 - frac * 180;
  }

  /** polar -> cartesian for SVG */
  function polar(angleDeg, r) {
    const rad = (angleDeg * Math.PI) / 180;
    return [CX + r * Math.cos(rad), CY - r * Math.sin(rad)];
  }

  /** SVG arc path for an annulus sector */
  function arcPath(startDeg, endDeg, r, strokeW) {
    const [sx, sy] = polar(startDeg, r);
    const [ex, ey] = polar(endDeg, r);
    const large = Math.abs(endDeg - startDeg) >= 180 ? 1 : 0;
    // sweep=1 (CW in SVG screen space) is required: our polar() maps standard-math
    // angles into SVG Y-down space, so a decreasing angle (180°→0°) is CW on screen.
    return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
  }

  // Draw arcs only once (or when gauge hasn't been set up yet)
  if (!arcsG.dataset.ready) {
    arcsG.innerHTML = '';
    zones.forEach(z => {
      const startA = valueToAngleDeg(z.min);
      const endA   = valueToAngleDeg(z.max);
      const path   = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d',            arcPath(startA, endA, R));
      path.setAttribute('fill',         'none');
      path.setAttribute('stroke',       z.color);
      path.setAttribute('stroke-width', '14');
      path.setAttribute('stroke-linecap', 'butt');
      arcsG.appendChild(path);
    });
    arcsG.dataset.ready = '1';
  }

  // Clamp and compute needle angle
  const clamped    = Math.max(totalMin, Math.min(totalMax, value));
  const needleAngle = valueToAngleDeg(clamped);  // SVG degrees, from right (0°)

  // Needle default SVG position is straight UP (x1=CX, y1=CY, x2=CX, y2=CY-R).
  // We need rotate(90 - needleAngle) around the pivot so that:
  //   needleAngle=180° (left)  → rotate(-90) → points left  ✓
  //   needleAngle= 90° (top)   → rotate(  0) → points up    ✓
  //   needleAngle=  0° (right) → rotate( 90) → points right ✓
  needle.setAttribute('transform', `rotate(${90 - needleAngle} ${CX} ${CY})`);

  valText.textContent = value.toFixed(1) + (unit || '°');
}

function initGauges() {
  // Pronation gauge: totalMin=-30, totalMax=+30
  // Zones: supination (-30 to -5) red, neutral (-5 to +15) green, overpronation (+15 to +30) red
  updateGauge(
    'pronation-gauge', 'pronation-arcs', 'pronation-needle', 'pronation-val',
    [
      { min: -30, max: -5,  color: CLR.alert   },
      { min:  -5, max:  15, color: CLR.good    },
      { min:  15, max:  30, color: CLR.alert   },
    ],
    -30, 30, 0, '°'
  );

  // Impact angle gauge: totalMin=-20, totalMax=+25
  // Zones: heel-strike (-20 to -5) red, optimal (-5 to +10) green, forefoot (+10 to +25) red
  updateGauge(
    'impact-gauge', 'impact-arcs', 'impact-needle', 'impact-val',
    [
      { min: -20, max:  -5, color: CLR.alert   },
      { min:  -5, max:  10, color: CLR.good    },
      { min:  10, max:  25, color: CLR.warning },
    ],
    -20, 25, 0, '°'
  );

  gaugesInitialised = true;
}

function updateGauges(rollAngle, impactAngle) {
  if (!gaugesInitialised) initGauges();

  if (rollAngle !== undefined) {
    updateGauge(
      'pronation-gauge', 'pronation-arcs', 'pronation-needle', 'pronation-val',
      [
        { min: -30, max: -5,  color: CLR.alert },
        { min:  -5, max:  15, color: CLR.good  },
        { min:  15, max:  30, color: CLR.alert },
      ],
      -30, 30, rollAngle, '°'
    );
  }

  if (impactAngle !== undefined) {
    updateGauge(
      'impact-gauge', 'impact-arcs', 'impact-needle', 'impact-val',
      [
        { min: -20, max:  -5, color: CLR.alert   },
        { min:  -5, max:  10, color: CLR.good    },
        { min:  10, max:  25, color: CLR.warning },
      ],
      -20, 25, impactAngle, '°'
    );
  }
}

// =========================================================================
// FEEDBACK PANEL
// =========================================================================

const FEEDBACK_ICONS = {
  OK:      '✓',
  INFO:    'ℹ',
  WARNING: '⚠',
  ALERT:   '✕',
};

function updateFeedback(feedbackArr) {
  if (!feedbackArr || !Array.isArray(feedbackArr) || feedbackArr.length === 0) return;

  const list = document.getElementById('feedbackList');

  // Clear "waiting" placeholder on first real data
  const empty = list.querySelector('.feedback-empty');
  if (empty) empty.remove();

  // Add new messages to the front of the queue
  feedbackArr.forEach(fb => {
    const level = (fb.level || 'INFO').toUpperCase();
    feedbackQueue.unshift({ level, message: fb.message });
  });

  // Keep only latest MAX_FEEDBACK items
  feedbackQueue = feedbackQueue.slice(0, MAX_FEEDBACK);

  // Re-render list
  list.innerHTML = '';
  feedbackQueue.forEach(fb => {
    const li   = document.createElement('li');
    li.className = `feedback-item ${fb.level.toLowerCase()}`;

    const icon = document.createElement('span');
    icon.className = 'feedback-icon';
    icon.textContent = FEEDBACK_ICONS[fb.level] || 'ℹ';

    const txt = document.createElement('span');
    txt.className = 'feedback-text';
    txt.textContent = fb.message;

    li.appendChild(icon);
    li.appendChild(txt);
    list.appendChild(li);
  });
}

// =========================================================================
// SCORE PANEL
// =========================================================================

function updateScores(scores, stepCount) {
  if (!scores || stepCount < STEP_SCORE_THRESH) return;

  // Show panel
  document.getElementById('scorePanel').classList.add('visible');

  const overall = Math.round(scores.overall || 0);
  document.getElementById('scoreOverallNum').textContent = overall;

  // Ring chart: circumference of r=50 circle = 2π×50 ≈ 314
  const circ = 2 * Math.PI * 50;
  const fill  = (overall / 100) * circ;
  const ring  = document.getElementById('ringFill');
  ring.setAttribute('stroke-dasharray', `${fill} ${circ - fill}`);
  ring.setAttribute('stroke', scoreColor(overall));

  setScoreBar('bar-cadence',   'barval-cadence',   scores.cadence   || 0);
  setScoreBar('bar-strike',    'barval-strike',    scores.strike    || 0);
  setScoreBar('bar-pronation', 'barval-pronation', scores.pronation || 0);
  setScoreBar('bar-lateral',   'barval-lateral',   scores.lateral   || 0);
}

function scoreColor(score) {
  if (score >= 80) return CLR.good;
  if (score >= 50) return CLR.warning;
  return CLR.alert;
}

function setScoreBar(barId, valId, score) {
  const bar = document.getElementById(barId);
  const val = document.getElementById(valId);
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  bar.style.width = pct + '%';
  bar.style.background = scoreColor(pct);
  val.textContent = pct;
}

// =========================================================================
// MAIN POLL LOOP
// =========================================================================

async function fetchData() {
  try {
    const res = await fetch('data.json?t=' + Date.now());  // cache-bust
    if (!res.ok) {
      updateConnectionStatus(0);
      return;
    }

    const data = await res.json();

    // Guard against empty placeholder {}
    if (!data.timestamp) {
      updateConnectionStatus(0);
      return;
    }

    updateConnectionStatus(data.timestamp);
    updateMetricCards(data);
    updateFootPath(data.footPath, data.optimalPath);
    updateGauges(data.rollAngle, data.impactAngle);
    updateFeedback(data.feedback);
    updateScores(data.scores, data.stepCount || 0);

  } catch (e) {
    updateConnectionStatus(0);
  }
}

// =========================================================================
// STARTUP
// =========================================================================

// Initialise gauges with default 0° position
initGauges();

// Start polling
setInterval(fetchData, POLL_INTERVAL);
fetchData();  // immediate first call

// Draw animated dot on canvas continuously
(function animLoop() {
  if (animDotX !== null) drawAnimDot();
  requestAnimationFrame(animLoop);
})();