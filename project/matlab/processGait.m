function state = processGait(ax_raw, ay_raw, az_raw, state)
% processGait  Real-time gait signal processing pipeline (one sample per call)
%
% Inputs:
%   ax_raw, ay_raw, az_raw  - raw 12-bit signed counts from MMA8452Q
%   state                   - persistent state struct (initialised by initProcessGait)
%
% Outputs:
%   state                   - updated state struct
%
% All filter coefficients must be pre-computed once and stored in state.
% This function is designed to be called at 100 Hz.

FS = 100;  % sampling frequency (Hz)

% -----------------------------------------------------------------------
% 1. Unit conversion: 12-bit signed, ±2g range
%    Full-scale = 2047 counts = 2g  =>  scale = 2/2048
% -----------------------------------------------------------------------
SCALE = 2.0 / 2048.0;
ax_g = ax_raw * SCALE;
ay_g = ay_raw * SCALE;
az_g = az_raw * SCALE;

% -----------------------------------------------------------------------
% 2. Low-pass filter: 4th-order Butterworth, cutoff 20 Hz
%    Applied to all three axes for smoothing
% -----------------------------------------------------------------------
[ax_lp, state.zi_lp_x] = filter(state.lp_b, state.lp_a, ax_g, state.zi_lp_x);
[ay_lp, state.zi_lp_y] = filter(state.lp_b, state.lp_a, ay_g, state.zi_lp_y);
[az_lp, state.zi_lp_z] = filter(state.lp_b, state.lp_a, az_g, state.zi_lp_z);

% -----------------------------------------------------------------------
% 3. High-pass filter (Z only): 2nd-order Butterworth, cutoff 0.5 Hz
%    Extracts impact transients by removing quasi-DC gravity component
% -----------------------------------------------------------------------
[az_hp, state.zi_hp_z] = filter(state.hp_b, state.hp_a, az_g, state.zi_hp_z);

% Store current filtered values in state for external access
state.ax_filt = ax_lp;
state.ay_filt = ay_lp;
state.az_filt = az_lp;
state.az_impact = az_hp;  % high-pass Z for impact detection

% -----------------------------------------------------------------------
% 4. Gravity removal: subtract running mean of raw Z over last 1 s (100 samples)
% -----------------------------------------------------------------------
state.gravity_buf(state.gravity_idx) = az_g;
state.gravity_idx = mod(state.gravity_idx, 100) + 1;
if state.gravity_buf_full || state.gravity_idx == 1
    state.gravity_buf_full = true;
    gravity_mean = mean(state.gravity_buf);
else
    gravity_mean = mean(state.gravity_buf(1:state.gravity_idx - 1));
end
az_gravity_removed = az_lp - gravity_mean;
state.az_gravity_removed = az_gravity_removed;

% -----------------------------------------------------------------------
% 5. Tilt estimation (pitch / roll) from filtered acceleration
% -----------------------------------------------------------------------
pitch_deg_raw = atan2d(ay_lp, az_lp);
roll_deg_raw  = atan2d(-ax_lp, az_lp);

% Smooth with 50-sample moving average using circular buffer
state.pitch_buf(state.tilt_idx) = pitch_deg_raw;
state.roll_buf(state.tilt_idx)  = roll_deg_raw;
state.tilt_idx = mod(state.tilt_idx, 50) + 1;

if state.tilt_buf_full || state.tilt_idx == 1
    state.tilt_buf_full = true;
    state.pitch_deg = mean(state.pitch_buf);
    state.roll_deg  = mean(state.roll_buf);
else
    n = state.tilt_idx - 1;
    state.pitch_deg = mean(state.pitch_buf(1:n));
    state.roll_deg  = mean(state.roll_buf(1:n));
end

% -----------------------------------------------------------------------
% 6. Step detection
%    Threshold: Z impact signal > 1.5 g above baseline
%    Debounce:  minimum 200 ms (20 samples at 100 Hz)
% -----------------------------------------------------------------------
IMPACT_THRESHOLD = 1.5;   % g above baseline
DEBOUNCE_SAMPLES = 20;    % 200 ms at 100 Hz

state.step_detected = false;
state.sample_count = state.sample_count + 1;

if az_hp > IMPACT_THRESHOLD
    if (state.sample_count - state.last_step_sample) >= DEBOUNCE_SAMPLES
        % Valid step event
        state.step_detected    = true;
        state.last_step_sample = state.sample_count;
        state.step_count       = state.step_count + 1;

        % Record timestamp (sample index as proxy for time)
        state.step_timestamps(end+1) = state.sample_count / FS;

        % Keep only last 5 step timestamps for cadence calculation
        if numel(state.step_timestamps) > 5
            state.step_timestamps = state.step_timestamps(end-4:end);
        end

        % Save impact peak value for foot-strike classification
        state.impact_peak = az_hp;

        % Record roll angle at this step for pronation
        state.step_roll_deg = state.roll_deg;

        % Save sample index of this step for ITR window
        state.impact_sample_idx = state.sample_count;
    end
end

% -----------------------------------------------------------------------
% 7. Cadence (steps per minute, estimated for both feet)
% -----------------------------------------------------------------------
if numel(state.step_timestamps) >= 2
    intervals = diff(state.step_timestamps);  % inter-step intervals in seconds
    mean_interval = mean(intervals);
    % Multiply by 2: we only see one foot; assume symmetric gait
    state.cadence_spm = (60.0 / mean_interval) * 2;
else
    state.cadence_spm = 0;
end

% -----------------------------------------------------------------------
% 8. Foot-strike classification (computed at each step event)
%    Uses ITR = peak_z / z_at_10ms_before_peak
%    "10 ms before" = 1 sample before at 100 Hz
% -----------------------------------------------------------------------
if state.step_detected
    % Retrieve the Z-impact value 1 sample before (approx 10 ms)
    if numel(state.impact_history) >= 2
        z_before = state.impact_history(end-1);
    else
        z_before = 0.01;  % avoid division by zero on first step
    end

    if abs(z_before) < 0.01
        z_before = 0.01;  % guard against zero
    end

    ITR = state.impact_peak / z_before;
    state.ITR = ITR;

    if ITR > 3.0
        state.footStrike = 'heel';
    elseif ITR >= 1.5
        state.footStrike = 'midfoot';
    else
        state.footStrike = 'forefoot';
    end

    % Cadence score (computed here, post-step)
    c = state.cadence_spm;
    if c >= 160 && c <= 180
        state.scores.cadence = 100;
    else
        dev = max(160 - c, c - 180);
        dev = max(dev, 0);
        state.scores.cadence = max(0, 100 - dev * 5);
    end

    % Strike score
    if strcmp(state.footStrike, 'forefoot') || strcmp(state.footStrike, 'midfoot')
        state.scores.strike = 100;
    else
        state.scores.strike = max(0, 100 - (state.ITR - 3) * 20);
    end
end

% -----------------------------------------------------------------------
% 9. Pronation: track peak |roll_deg| during stance (between step events)
%    Stance ends at next step event; record roll during swing phase
% -----------------------------------------------------------------------
% Update running peak roll for this stance window
if abs(state.roll_deg) > abs(state.peak_roll_this_stance)
    state.peak_roll_this_stance = state.roll_deg;
end

if state.step_detected
    % Finalise pronation for the completed stance
    state.pronation_deg = state.peak_roll_this_stance;
    state.peak_roll_this_stance = 0;  % reset for next stance

    % Pronation score
    p = abs(state.pronation_deg);
    if state.pronation_deg >= 4 && state.pronation_deg <= 12
        state.scores.pronation = 100;
    else
        if state.pronation_deg > 12
            dev = state.pronation_deg - 12;
        elseif state.pronation_deg < 4 && state.pronation_deg > -5
            dev = 4 - state.pronation_deg;
        else
            dev = abs(state.pronation_deg) + 1;
        end
        state.scores.pronation = max(0, 100 - dev * 5);
    end
end

% -----------------------------------------------------------------------
% Append current impact Z to rolling history (for ITR look-back)
% -----------------------------------------------------------------------
state.impact_history(end+1) = az_hp;
if numel(state.impact_history) > 200
    state.impact_history = state.impact_history(end-199:end);
end

% -----------------------------------------------------------------------
% Compute overall score (weighted average; only valid after first step)
% -----------------------------------------------------------------------
if state.step_count >= 1
    state.scores.overall = ...
        0.25 * state.scores.cadence   + ...
        0.30 * state.scores.strike    + ...
        0.25 * state.scores.pronation + ...
        0.20 * state.scores.lateral;
end

end  % function processGait


% -----------------------------------------------------------------------
function state = initProcessGait(fs)
% initProcessGait  Initialise the state struct for processGait
%
% Call once before the main loop:
%   state = initProcessGait(100);
%
% fs - sampling frequency in Hz (should be 100)

if nargin < 1
    fs = 100;
end

% ---- Design low-pass filter: 4th-order Butterworth, 20 Hz ----
[lp_b, lp_a] = butter(4, 20 / (fs / 2), 'low');
state.lp_b = lp_b;
state.lp_a = lp_a;

% Initial filter states (4th order -> 4 states per axis)
state.zi_lp_x = zeros(length(lp_a) - 1, 1);
state.zi_lp_y = zeros(length(lp_a) - 1, 1);
state.zi_lp_z = zeros(length(lp_a) - 1, 1);

% ---- Design high-pass filter: 2nd-order Butterworth, 0.5 Hz ----
[hp_b, hp_a] = butter(2, 0.5 / (fs / 2), 'high');
state.hp_b = hp_b;
state.hp_a = hp_a;
state.zi_hp_z = zeros(length(hp_a) - 1, 1);

% ---- Gravity removal: circular buffer (100 samples = 1 s) ----
state.gravity_buf      = zeros(100, 1);
state.gravity_idx      = 1;
state.gravity_buf_full = false;

% ---- Tilt smoothing: 50-sample circular buffers ----
state.pitch_buf     = zeros(50, 1);
state.roll_buf      = zeros(50, 1);
state.tilt_idx      = 1;
state.tilt_buf_full = false;
state.pitch_deg     = 0;
state.roll_deg      = 0;

% ---- Step detection ----
state.sample_count      = 0;
state.last_step_sample  = -100;  % initialise far back to allow first detection
state.step_detected     = false;
state.step_count        = 0;
state.step_timestamps   = [];
state.impact_peak       = 0;
state.impact_sample_idx = 0;
state.impact_history    = [];

% ---- Foot strike ----
state.footStrike = 'unknown';
state.ITR        = 0;

% ---- Cadence ----
state.cadence_spm = 0;

% ---- Pronation ----
state.pronation_deg         = 0;
state.peak_roll_this_stance = 0;
state.step_roll_deg         = 0;

% ---- Lateral displacement (set by pathIntegration) ----
state.lateralDisp_m = 0;
state.isSidestep    = false;

% ---- Foot path (set by pathIntegration) ----
state.footPath_x  = [];
state.footPath_y  = [];
state.optPath_x   = [];
state.optPath_y   = [];

% ---- Current filtered values ----
state.ax_filt          = 0;
state.ay_filt          = 0;
state.az_filt          = 0;
state.az_impact        = 0;
state.az_gravity_removed = 0;

% ---- Scores ----
state.scores.overall   = 0;
state.scores.cadence   = 0;
state.scores.strike    = 0;
state.scores.pronation = 0;
state.scores.lateral   = 0;

end  % function initProcessGait
