// app.js — RunForm Analyser Dashboard
'use strict';

// =========================================================================
// CONSTANTS
// =========================================================================
const POLL_INTERVAL     = 100;    // ms
const STALE_THRESHOLD   = 2000;   // ms — data older than this = disconnected
const STEP_SCORE_THRESH = 10;     // show score panel after N steps
const LOG_COOLDOWN_MS   = 30000;  // 30 s before re-logging the same message

// Colour tokens
const CLR = {
  good:    '#22C55E',
  warning: '#F59E0B',
  alert:   '#EF4444',
  info:    '#3B82F6',
  neutral: '#6B7280',
  border:  '#E5E7EB',
};

// =========================================================================
// FEEDBACK PICTOGRAMS
// Inline SVG icons (44×44 viewBox) illustrating the corrective action.
// =========================================================================
const PICTOGRAMS = {

  heel_strike: `<svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- shoe sole outline -->
    <path d="M7 32 Q7 22 15 20 Q25 17 33 20 Q39 22 39 29 L39 34 Q39 36 37 36 L9 36 Q7 36 7 34Z"
          fill="#F9FAFB" stroke="#9CA3AF" stroke-width="1.5"/>
    <!-- heel zone highlighted red -->
    <ellipse cx="12" cy="34" rx="5.5" ry="2.8" fill="#FEE2E2" stroke="#EF4444" stroke-width="1.5"/>
    <!-- impact lines below heel -->
    <line x1="8"  y1="40" x2="10" y2="37" stroke="#EF4444" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="12" y1="41" x2="12" y2="38" stroke="#EF4444" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="16" y1="40" x2="14" y2="37" stroke="#EF4444" stroke-width="1.5" stroke-linecap="round"/>
    <!-- arrow showing foot should land further back / under hip -->
    <path d="M30 14 L30 20 M27 17 L30 14 L33 17" stroke="#22C55E" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="26" y="12" font-size="5.5" fill="#22C55E" font-family="sans-serif" font-weight="600">UNDER HIP</text>
  </svg>`,

  cadence_low: `<svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- clock face -->
    <circle cx="22" cy="20" r="13" fill="#FFFBEB" stroke="#F59E0B" stroke-width="1.5"/>
    <!-- hour/minute hands pointing to slow time -->
    <line x1="22" y1="20" x2="22" y2="10" stroke="#374151" stroke-width="2" stroke-linecap="round"/>
    <line x1="22" y1="20" x2="30" y2="24" stroke="#374151" stroke-width="2" stroke-linecap="round"/>
    <circle cx="22" cy="20" r="2" fill="#374151"/>
    <!-- "speed up" chevrons below -->
    <path d="M13 38 L18 35 L13 32" stroke="#F59E0B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M19 38 L24 35 L19 32" stroke="#F59E0B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M25 38 L30 35 L25 32" stroke="#F59E0B" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>`,

  cadence_high: `<svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="22" cy="20" r="13" fill="#EFF6FF" stroke="#3B82F6" stroke-width="1.5"/>
    <line x1="22" y1="20" x2="22" y2="10" stroke="#374151" stroke-width="2" stroke-linecap="round"/>
    <line x1="22" y1="20" x2="28" y2="14" stroke="#374151" stroke-width="2" stroke-linecap="round"/>
    <circle cx="22" cy="20" r="2" fill="#374151"/>
    <text x="22" y="38" text-anchor="middle" font-size="7" fill="#3B82F6" font-family="sans-serif">relax pace</text>
  </svg>`,

  overpronation: `<svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- foot cross-section as oval -->
    <ellipse cx="22" cy="26" rx="10" ry="5" fill="#FEE2E2" stroke="#EF4444" stroke-width="1.5" transform="rotate(-18 22 26)"/>
    <!-- vertical reference line -->
    <line x1="22" y1="6" x2="22" y2="38" stroke="#E5E7EB" stroke-width="1" stroke-dasharray="2 2"/>
    <!-- tilt arrow (inward = right in this orientation) -->
    <path d="M22 14 Q28 20 30 28" stroke="#EF4444" stroke-width="2" stroke-linecap="round" fill="none"/>
    <path d="M27 26 L30 28 L28 31" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- ground line -->
    <line x1="8" y1="36" x2="36" y2="36" stroke="#9CA3AF" stroke-width="1.5" stroke-linecap="round"/>
    <text x="22" y="43" text-anchor="middle" font-size="5.5" fill="#EF4444" font-family="sans-serif">INWARD ROLL</text>
  </svg>`,

  supination: `<svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="22" cy="26" rx="10" ry="5" fill="#EFF6FF" stroke="#3B82F6" stroke-width="1.5" transform="rotate(18 22 26)"/>
    <line x1="22" y1="6" x2="22" y2="38" stroke="#E5E7EB" stroke-width="1" stroke-dasharray="2 2"/>
    <!-- tilt arrow outward (left) -->
    <path d="M22 14 Q16 20 14 28" stroke="#3B82F6" stroke-width="2" stroke-linecap="round" fill="none"/>
    <path d="M17 26 L14 28 L16 31" stroke="#3B82F6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="8" y1="36" x2="36" y2="36" stroke="#9CA3AF" stroke-width="1.5" stroke-linecap="round"/>
    <text x="22" y="43" text-anchor="middle" font-size="5.5" fill="#3B82F6" font-family="sans-serif">OUTWARD ROLL</text>
  </svg>`,

  crossover: `<svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- centre line (body midline) -->
    <line x1="22" y1="2" x2="22" y2="42" stroke="#E5E7EB" stroke-width="1.5" stroke-dasharray="3 2"/>
    <!-- left footprints crossing over -->
    <ellipse cx="26" cy="36" rx="5" ry="3" fill="#BFDBFE" stroke="#3B82F6" stroke-width="1.2" transform="rotate(-12 26 36)"/>
    <ellipse cx="18" cy="25" rx="5" ry="3" fill="#BFDBFE" stroke="#3B82F6" stroke-width="1.2" transform="rotate(12 18 25)"/>
    <ellipse cx="27" cy="14" rx="5" ry="3" fill="#BFDBFE" stroke="#3B82F6" stroke-width="1.2" transform="rotate(-12 27 14)"/>
    <!-- crossing path shown in red -->
    <path d="M26 33 L18 22 L27 11" stroke="#EF4444" stroke-width="1.8" stroke-dasharray="2 1.5" stroke-linecap="round"/>
    <!-- X marker on centre line crossing -->
    <line x1="19" y1="20" x2="23" y2="24" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="23" y1="20" x2="19" y2="24" stroke="#EF4444" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`,

  hard_landing: `<svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- large downward impact arrow -->
    <path d="M22 4 L22 27" stroke="#EF4444" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M14 20 L22 30 L30 20" stroke="#EF4444" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" fill="none"/>
    <!-- ground line -->
    <line x1="6" y1="33" x2="38" y2="33" stroke="#374151" stroke-width="2.5" stroke-linecap="round"/>
    <!-- impact ripples -->
    <path d="M10 37 Q13 35 16 37" stroke="#EF4444" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    <path d="M20 38 Q22 36 24 38" stroke="#EF4444" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    <path d="M28 37 Q31 35 34 37" stroke="#EF4444" stroke-width="1.5" stroke-linecap="round" fill="none"/>
  </svg>`,

  good_form: `<svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="22" cy="22" r="18" fill="#DCFCE7" stroke="#22C55E" stroke-width="2"/>
    <path d="M11 22 L18 29 L33 14" stroke="#22C55E" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,

  default: `<svg viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="22" cy="22" r="18" fill="#EFF6FF" stroke="#3B82F6" stroke-width="1.5"/>
    <line x1="22" y1="13" x2="22" y2="24" stroke="#3B82F6" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="22" cy="30" r="2" fill="#3B82F6"/>
  </svg>`,
};

function pickPictogram(message) {
  const m = (message || '').toLowerCase();
  if (m.includes('heel striking'))               return PICTOGRAMS.heel_strike;
  if (m.includes('cadence is too low') || m.includes('cadence is slightly slow'))
                                                  return PICTOGRAMS.cadence_low;
  if (m.includes('cadence is very high') || m.includes('cadence is slightly high'))
                                                  return PICTOGRAMS.cadence_high;
  if (m.includes('rolling inward'))              return PICTOGRAMS.overpronation;
  if (m.includes('supination'))                  return PICTOGRAMS.supination;
  if (m.includes('crossing your body') || m.includes('crossover gait'))
                                                  return PICTOGRAMS.crossover;
  if (m.includes('landing very hard'))           return PICTOGRAMS.hard_landing;
  if (m.includes('great running form'))          return PICTOGRAMS.good_form;
  return PICTOGRAMS.default;
}

// =========================================================================
// STATE
// =========================================================================
let prevCadence    = null;
let prevImpact     = null;
let prevAngle      = null;
let lastDataTs     = 0;     // last data.timestamp we processed (detect new step events)
let gaugesReady    = false;

// Feedback log state
const feedbackLog     = [];        // [{level, message, time}] most-recent first
const feedbackLastSeen = {};       // message text → timestamp last added to log

// =========================================================================
// CLOCK
// =========================================================================
function updateClock() {
  const n  = new Date();
  const hh = String(n.getHours()).padStart(2, '0');
  const mm = String(n.getMinutes()).padStart(2, '0');
  const ss = String(n.getSeconds()).padStart(2, '0');
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
  const age   = Date.now() - dataTimestamp * 1000;

  if (!dataTimestamp) {
    dot.className     = 'conn-dot';
    label.textContent = 'Connecting...';
  } else if (age < STALE_THRESHOLD) {
    dot.className     = 'conn-dot connected';
    label.textContent = 'Live';
  } else {
    dot.className     = 'conn-dot disconnected';
    label.textContent = 'No signal';
  }
}

// =========================================================================
// METRIC CARDS
// =========================================================================
function cadenceStatus(spm) {
  if (spm >= 160 && spm <= 180) return 'good';
  if ((spm >= 150 && spm < 160) || (spm > 180 && spm <= 190)) return 'warning';
  return 'alert';
}
function strikeStatus(s) {
  return (s === 'forefoot' || s === 'midfoot') ? 'good' : (s === 'heel' ? 'alert' : 'warning');
}
function impactStatus(g) {
  if (g < 2.5)  return 'good';
  if (g <= 3.5) return 'warning';
  return 'alert';
}
function angleStatus(deg) {
  if (deg >= 0 && deg <= 10) return 'good';
  if ((deg >= -5 && deg < 0) || (deg > 10 && deg <= 20)) return 'warning';
  return 'alert';
}
function trendArrow(cur, prev, higherIsBetter) {
  if (prev === null || Math.abs(cur - prev) < 0.5) return '→';
  return (cur > prev) === higherIsBetter ? '↑' : '↓';
}

function updateMetricCards(data) {
  if (data.cadence && data.cadence > 0) {
    const v = Math.round(data.cadence);
    const s = cadenceStatus(v);
    const t = trendArrow(v, prevCadence, true);
    prevCadence = v;
    document.getElementById('val-cadence').textContent = v;
    setCardStatus('card-cadence', 'badge-cadence', 'trend-cadence', s, s.toUpperCase(), t);
  }
  if (data.footStrike) {
    const label = data.footStrike.charAt(0).toUpperCase() + data.footStrike.slice(1);
    const s = strikeStatus(data.footStrike);
    document.getElementById('val-strike').textContent = label;
    setCardStatus('card-strike', 'badge-strike', 'trend-strike', s, s.toUpperCase(), '→');
  }
  const rawImpact = Math.abs(data.az || 0);
  const impV = +rawImpact.toFixed(2);
  const impS = impactStatus(impV);
  const impT = trendArrow(impV, prevImpact, false);
  prevImpact = impV;
  document.getElementById('val-impact').textContent = impV.toFixed(2);
  setCardStatus('card-impact', 'badge-impact', 'trend-impact', impS, impS.toUpperCase(), impT);

  if (data.impactAngle !== undefined) {
    const ang = +data.impactAngle.toFixed(1);
    const angS = angleStatus(ang);
    const angT = trendArrow(ang, prevAngle, false);
    prevAngle = ang;
    document.getElementById('val-angle').textContent = ang;
    setCardStatus('card-angle', 'badge-angle', 'trend-angle', angS, angS.toUpperCase(), angT);
  }
}

function setCardStatus(cardId, badgeId, trendId, status, badgeText, trendChar) {
  document.getElementById(cardId).className    = `metric-card ${status}`;
  const badge = document.getElementById(badgeId);
  badge.className   = `status-badge ${status}`;
  badge.textContent = badgeText;
  const trend = document.getElementById(trendId);
  trend.textContent = trendChar;
  trend.className   = 'trend-arrow' + (trendChar === '↑' ? ' up' : trendChar === '↓' ? ' down' : '');
}

// =========================================================================
// FOOT PATH CANVAS
// =========================================================================
const footpathCanvas = document.getElementById('footpath');
const footpathCtx    = footpathCanvas.getContext('2d');
let animDotX = null, animDotY = null;

function updateFootPath(footPath, optimalPath) {
  if (!footPath || !footPath.x || !footPath.y || footPath.x.length < 2) return;

  const W = footpathCanvas.width, H = footpathCanvas.height, PAD = 24;
  const allX = [...footPath.x, ...(optimalPath ? optimalPath.x : [])];
  const allY = [...footPath.y, ...(optimalPath ? optimalPath.y : [])];
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const rangeX = maxX - minX || 0.001;
  const rangeY = maxY - minY || 0.001;

  function toCanvas(x, y) {
    return [
      PAD + ((x - minX) / rangeX) * (W - 2 * PAD),
      H - PAD - ((y - minY) / rangeY) * (H - 2 * PAD),
    ];
  }

  footpathCtx.clearRect(0, 0, W, H);
  footpathCtx.fillStyle = '#F0F4FF';
  footpathCtx.fillRect(0, 0, W, H);

  // Tolerance corridor ±2 cm
  if (optimalPath && optimalPath.x.length >= 2) {
    footpathCtx.beginPath();
    for (let i = 0; i < optimalPath.x.length; i++) {
      const [cx, cy] = toCanvas(optimalPath.x[i] - 0.02, optimalPath.y[i]);
      i === 0 ? footpathCtx.moveTo(cx, cy) : footpathCtx.lineTo(cx, cy);
    }
    for (let i = optimalPath.x.length - 1; i >= 0; i--) {
      const [cx, cy] = toCanvas(optimalPath.x[i] + 0.02, optimalPath.y[i]);
      footpathCtx.lineTo(cx, cy);
    }
    footpathCtx.closePath();
    footpathCtx.fillStyle = 'rgba(167,139,250,0.18)';
    footpathCtx.fill();
  }

  // Optimal path dashed
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

  // Actual path
  footpathCtx.beginPath();
  footpathCtx.strokeStyle = CLR.info;
  footpathCtx.lineWidth   = 2.5;
  footpathCtx.lineJoin    = 'round';
  for (let i = 0; i < footPath.x.length; i++) {
    const [cx, cy] = toCanvas(footPath.x[i], footPath.y[i]);
    i === 0 ? footpathCtx.moveTo(cx, cy) : footpathCtx.lineTo(cx, cy);
  }
  footpathCtx.stroke();

  const last = footPath.x.length - 1;
  [animDotX, animDotY] = toCanvas(footPath.x[last], footPath.y[last]);
}

let dotPhase = 0;
function drawAnimDot() {
  if (animDotX === null) return;
  dotPhase = (dotPhase + 0.07) % (2 * Math.PI);
  const pulse = 5 + 2 * Math.sin(dotPhase);
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
// SVG GAUGES  (fixed)
//
// The gauge is a semicircle sweeping through the TOP of the circle:
//   min value → 180° (left end of arc)
//   mid value →  90° (top of arc)
//   max value →   0° (right end of arc)
//
// polar(angle) = (CX + R·cos(angle), CY − R·sin(angle))
//   — the minus on sin maps standard-math Y-up angles into SVG Y-down space
//
// valueToAngleDeg: maps [totalMin…totalMax] → [180°…0°] (decreasing)
//
// SVG arc sweep-flag=0 (counter-clockwise in screen) from a higher angle
// to a lower angle travels through the top of the circle. ✓
//
// Needle: default pointing straight UP (x1=CX, y1=CY, x2=CX, y2=CY-R)
//   rotate(90 − needleAngle) around the pivot places it correctly:
//   needleAngle=180 → rotate(−90) → points left  ✓
//   needleAngle= 90 → rotate(  0) → points up     ✓
//   needleAngle=  0 → rotate( 90) → points right  ✓
// =========================================================================

/**
 * Draw one gauge.
 * zones  : [{min, max, color}] — values in real units
 * totalMin/totalMax : full scale of the gauge
 * value  : current reading to point the needle at
 */
function drawGauge(_svgId, arcsId, needleId, valTextId,
                   zones, totalMin, totalMax, value, unit) {
  const arcsG   = document.getElementById(arcsId);
  const needle  = document.getElementById(needleId);
  const valText = document.getElementById(valTextId);
  if (!arcsG || !needle || !valText) return;

  const CX = 100, CY = 110, R = 70;

  /** Map a value in [totalMin, totalMax] to an SVG angle in [180°, 0°] */
  function v2a(v) {
    const frac = (v - totalMin) / (totalMax - totalMin);
    return 180 - frac * 180;   // 180° (left) → 0° (right) through top
  }

  /** Angle in degrees → SVG coordinate (Y-down, so sin is negated) */
  function polar(deg, r) {
    const rad = deg * Math.PI / 180;
    return [CX + r * Math.cos(rad), CY - r * Math.sin(rad)];
  }

  /** SVG arc path between two angles, counter-clockwise through top */
  function arcPath(aDeg, bDeg) {
    const [sx, sy] = polar(aDeg, R);
    const [ex, ey] = polar(bDeg, R);
    // large-arc=1 only if the span is exactly 180°; otherwise 0 is correct
    const large = Math.abs(aDeg - bDeg) >= 180 ? 1 : 0;
    return `M ${sx.toFixed(2)} ${sy.toFixed(2)} ` +
           `A ${R} ${R} 0 ${large} 0 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  }

  // Draw coloured arc zones once
  if (!arcsG.dataset.ready) {
    arcsG.innerHTML = '';

    // Grey background track (full semicircle)
    const trackPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    trackPath.setAttribute('d', arcPath(180, 0));
    trackPath.setAttribute('fill', 'none');
    trackPath.setAttribute('stroke', '#E5E7EB');
    trackPath.setAttribute('stroke-width', '14');
    trackPath.setAttribute('stroke-linecap', 'butt');
    arcsG.appendChild(trackPath);

    // Coloured zone arcs
    zones.forEach(z => {
      const startA = v2a(z.min);
      const endA   = v2a(z.max);
      const path   = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d',              arcPath(startA, endA));
      path.setAttribute('fill',           'none');
      path.setAttribute('stroke',         z.color);
      path.setAttribute('stroke-width',   '14');
      path.setAttribute('stroke-linecap', 'butt');
      arcsG.appendChild(path);
    });

    arcsG.dataset.ready = '1';
  }

  // Needle rotation: rotate(90 − needleAngle) around pivot
  const clamped     = Math.max(totalMin, Math.min(totalMax, value));
  const needleAngle = v2a(clamped);
  const rotate      = 90 - needleAngle;
  needle.setAttribute('transform', `rotate(${rotate.toFixed(2)} ${CX} ${CY})`);

  valText.textContent = value.toFixed(1) + (unit || '°');
}

// Zone definitions are stateless — pass them each call
const PRONATION_ZONES = [
  { min: -30, max:  -5, color: CLR.alert   },   // supination
  { min:  -5, max:  15, color: CLR.good    },   // neutral
  { min:  15, max:  30, color: CLR.alert   },   // overpronation
];
const IMPACT_ZONES = [
  { min: -20, max:  -5, color: CLR.alert   },   // heel strike
  { min:  -5, max:  10, color: CLR.good    },   // optimal
  { min:  10, max:  25, color: CLR.warning },   // forefoot
];

function initGauges() {
  drawGauge('pronation-gauge','pronation-arcs','pronation-needle','pronation-val',
            PRONATION_ZONES, -30, 30, 0, '°');
  drawGauge('impact-gauge','impact-arcs','impact-needle','impact-val',
            IMPACT_ZONES, -20, 25, 0, '°');
  gaugesReady = true;
}

function updateGauges(rollAngle, impactAngle) {
  if (!gaugesReady) initGauges();
  if (rollAngle   !== undefined)
    drawGauge('pronation-gauge','pronation-arcs','pronation-needle','pronation-val',
              PRONATION_ZONES, -30, 30, rollAngle, '°');
  if (impactAngle !== undefined)
    drawGauge('impact-gauge','impact-arcs','impact-needle','impact-val',
              IMPACT_ZONES, -20, 25, impactAngle, '°');
}

// =========================================================================
// FEEDBACK — "RIGHT NOW" (current step only, no scroll)
// =========================================================================
function updateCurrentFeedback(feedbackArr) {
  const container = document.getElementById('feedbackCurrent');
  container.innerHTML = '';

  if (!feedbackArr || feedbackArr.length === 0) {
    container.innerHTML = '<div class="feedback-empty">No issues detected this step.</div>';
    return;
  }

  feedbackArr.forEach(fb => {
    const level = (fb.level || 'INFO').toUpperCase();
    const div   = document.createElement('div');
    div.className = `feedback-now-item ${level.toLowerCase()}`;

    const picDiv = document.createElement('div');
    picDiv.className = 'feedback-now-pic';
    picDiv.innerHTML = pickPictogram(fb.message);

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'feedback-now-body';

    const badge = document.createElement('span');
    badge.className   = `feedback-level-badge ${level.toLowerCase()}`;
    badge.textContent = level;

    const msg = document.createElement('p');
    msg.className   = 'feedback-now-msg';
    msg.textContent = fb.message;

    bodyDiv.appendChild(badge);
    bodyDiv.appendChild(msg);
    div.appendChild(picDiv);
    div.appendChild(bodyDiv);
    container.appendChild(div);
  });
}

// =========================================================================
// FEEDBACK — SESSION LOG (deduplicated, timestamped history)
// =========================================================================
function formatTime(date) {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');
}

function updateFeedbackLog(feedbackArr) {
  if (!feedbackArr || feedbackArr.length === 0) return;

  const now = Date.now();
  let added = false;

  feedbackArr.forEach(fb => {
    const msg   = fb.message;
    const level = (fb.level || 'INFO').toUpperCase();
    const last  = feedbackLastSeen[msg];

    // Add to log only if: never seen, OR cooldown has elapsed
    if (!last || (now - last) > LOG_COOLDOWN_MS) {
      feedbackLog.unshift({ level, message: msg, time: new Date() });
      feedbackLastSeen[msg] = now;
      added = true;
      if (feedbackLog.length > 50) feedbackLog.pop();
    }
  });

  if (!added) return;  // nothing new — skip re-render

  const list = document.getElementById('feedbackLog');
  list.innerHTML = '';

  // Update count badge
  const countEl = document.getElementById('logCount');
  if (countEl) countEl.textContent = feedbackLog.length > 0 ? feedbackLog.length : '';

  feedbackLog.forEach(fb => {
    const li = document.createElement('li');
    li.className = `log-item ${fb.level.toLowerCase()}`;

    const timeSpan = document.createElement('span');
    timeSpan.className   = 'log-time';
    timeSpan.textContent = formatTime(fb.time);

    const picSpan = document.createElement('span');
    picSpan.className = 'log-pic';
    picSpan.innerHTML = pickPictogram(fb.message);

    const badge = document.createElement('span');
    badge.className   = `log-badge ${fb.level.toLowerCase()}`;
    badge.textContent = fb.level;

    const msgSpan = document.createElement('span');
    msgSpan.className   = 'log-msg';
    msgSpan.textContent = fb.message;

    li.appendChild(timeSpan);
    li.appendChild(picSpan);
    li.appendChild(badge);
    li.appendChild(msgSpan);
    list.appendChild(li);
  });
}

// =========================================================================
// SCORE PANEL
// =========================================================================
function scoreColor(score) {
  if (score >= 80) return CLR.good;
  if (score >= 50) return CLR.warning;
  return CLR.alert;
}

function updateScores(scores, stepCount) {
  if (!scores || stepCount < STEP_SCORE_THRESH) return;
  document.getElementById('scorePanel').classList.add('visible');

  const overall = Math.round(scores.overall || 0);
  document.getElementById('scoreOverallNum').textContent = overall;

  const circ = 2 * Math.PI * 50;
  const fill  = (overall / 100) * circ;
  const ring  = document.getElementById('ringFill');
  ring.setAttribute('stroke-dasharray', `${fill.toFixed(2)} ${(circ - fill).toFixed(2)}`);
  ring.setAttribute('stroke', scoreColor(overall));

  setScoreBar('bar-cadence',   'barval-cadence',   scores.cadence   || 0);
  setScoreBar('bar-strike',    'barval-strike',    scores.strike    || 0);
  setScoreBar('bar-pronation', 'barval-pronation', scores.pronation || 0);
  setScoreBar('bar-lateral',   'barval-lateral',   scores.lateral   || 0);
}

function setScoreBar(barId, valId, score) {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  const bar = document.getElementById(barId);
  bar.style.width      = pct + '%';
  bar.style.background = scoreColor(pct);
  document.getElementById(valId).textContent = pct;
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

    updateConnectionStatus(data.timestamp);
    updateMetricCards(data);
    updateFootPath(data.footPath, data.optimalPath);
    updateGauges(data.rollAngle, data.impactAngle);

    // Only update current feedback and log when a new step event arrives
    // (data.timestamp changes each time MATLAB writes a new JSON)
    if (data.timestamp !== lastDataTs) {
      lastDataTs = data.timestamp;
      updateCurrentFeedback(data.feedback);
      updateFeedbackLog(data.feedback);
    }

    updateScores(data.scores, data.stepCount || 0);

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

// Continuous canvas animation loop
(function animLoop() {
  if (animDotX !== null) drawAnimDot();
  requestAnimationFrame(animLoop);
})();
