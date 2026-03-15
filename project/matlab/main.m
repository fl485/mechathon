% main.m  —  RunForm Analyser: top-level MATLAB entry point
%
% Connects to Arduino Nano over USB serial, reads MMA8452Q accelerometer data,
% processes gait metrics in real-time, writes data.json for the web dashboard,
% and optionally launches Simulink debug scopes.
%
% Usage:
%   Run this script in MATLAB with the Arduino Nano connected over USB.
%   The web dashboard opens automatically at http://localhost:8080
%
% Dependencies:
%   processGait.m, feedbackEngine.m, pathIntegration.m
%   Arduino running RunFormSensor.ino (115200 baud)

clear; clc;

% =========================================================================
% CONFIGURATION
% =========================================================================
DEBUG_MODE = false;     % Set true to enable verbose logging, CSV dump, Simulink
FS         = 100;       % Sampling frequency (Hz)
WWW_DIR    = fullfile(fileparts(mfilename('fullpath')), '..', 'www');

% =========================================================================
% INITIALISE STATE
% =========================================================================
% Initialise signal processing state (filters, buffers, counters)
state = initProcessGait(FS);
state = initPathIntegration(state);

% Debug log file handle (opened only in DEBUG_MODE)
debug_fid = -1;

% Workspace buffers for Simulink (ring buffers, 10 s = 1000 samples)
SIM_BUF_LEN = 1000;
sim_raw_ax     = zeros(SIM_BUF_LEN, 1);
sim_raw_ay     = zeros(SIM_BUF_LEN, 1);
sim_raw_az     = zeros(SIM_BUF_LEN, 1);
sim_filt_ax    = zeros(SIM_BUF_LEN, 1);
sim_filt_ay    = zeros(SIM_BUF_LEN, 1);
sim_filt_az    = zeros(SIM_BUF_LEN, 1);
sim_impact_z   = zeros(SIM_BUF_LEN, 1);
sim_step_events= zeros(SIM_BUF_LEN, 1);
sim_pitch_deg  = zeros(SIM_BUF_LEN, 1);
sim_roll_deg   = zeros(SIM_BUF_LEN, 1);
sim_lat_disp   = zeros(SIM_BUF_LEN, 1);
sim_buf_idx    = 1;
sim_t          = (0 : SIM_BUF_LEN - 1)' / FS;

% =========================================================================
% SERIAL PORT AUTO-DETECTION
% =========================================================================
fprintf('Scanning for available serial ports...\n');
available = serialportlist("available");

if isempty(available)
    error('No available serial ports found. Connect the Arduino Nano and try again.');
end

fprintf('Available ports: %s\n', strjoin(available, ', '));

% Use the last available port (most recently plugged-in device on most systems)
portName = available(end);
fprintf('Connecting to %s at 115200 baud...\n', portName);

s = serialport(portName, 115200);
configureTerminator(s, "LF");
flush(s);

% =========================================================================
% WAIT FOR SENSOR READY SIGNAL
% =========================================================================
fprintf('Waiting for sensor "READY" signal...\n');
timeout_s = 10;
t_start   = tic;
sensor_ok = false;

while toc(t_start) < timeout_s
    if s.NumBytesAvailable > 0
        line = strtrim(readline(s));
        if strcmp(line, 'READY')
            sensor_ok = true;
            break;
        elseif strcmp(line, 'ERR:SENSOR')
            error('Sensor error: WHO_AM_I check failed. Check wiring and I2C address (must be 0x1C).');
        end
    end
    pause(0.05);
end

if ~sensor_ok
    error('Timed out waiting for sensor READY. Check Arduino is running RunFormSensor.ino.');
end
fprintf('Sensor ready.\n');

% =========================================================================
% CALIBRATION SEQUENCE (2 s static)
% =========================================================================
fprintf('\nCalibration: Stand still for 2 seconds...\n');

cal_ax = zeros(200, 1);
cal_ay = zeros(200, 1);
cal_az = zeros(200, 1);
SCALE  = 2.0 / 2048.0;

for i = 1:200
    line = strtrim(readline(s));
    vals = str2double(split(line, ','));
    if numel(vals) == 3 && ~any(isnan(vals))
        cal_ax(i) = vals(1);
        cal_ay(i) = vals(2);
        cal_az(i) = vals(3);
    end
end

% Convert to g for analysis
cal_ax_g = cal_ax * SCALE;
cal_ay_g = cal_ay * SCALE;
cal_az_g = cal_az * SCALE;

gravity_offset = mean(cal_az_g);
gravity_mag    = sqrt(mean(cal_ax_g)^2 + mean(cal_ay_g)^2 + mean(cal_az_g)^2);

fprintf('Gravity offset Z: %.4f g\n', gravity_offset);
fprintf('Gravity magnitude: %.4f g (should be ~1.0)\n', gravity_mag);

if abs(gravity_mag - 1.0) > 0.15
    warning('RunForm:Calibration', ...
        'Sensor may be misoriented or misconfigured (gravity magnitude = %.3f g).', gravity_mag);
end

if abs(mean(cal_ax_g)) > 0.2 || abs(mean(cal_ay_g)) > 0.2
    warning('RunForm:Calibration', ...
        'Sensor is significantly tilted. Place the shoe flat before calibration.');
end

fprintf('Calibration complete. Starting real-time processing...\n');

% =========================================================================
% START HTTP SERVER AND OPEN DASHBOARD
% =========================================================================
if ispc
    system(['start /B python -m http.server 8080 --directory "' WWW_DIR '"']);
else
    system(['python3 -m http.server 8080 --directory "' WWW_DIR '" &']);
end
pause(1.5);
web('http://localhost:8080', '-browser');
disp('RunForm Analyser dashboard opened at http://localhost:8080');

% =========================================================================
% DEBUG MODE SETUP
% =========================================================================
if DEBUG_MODE
    fprintf('\n[DEBUG] Debug mode enabled.\n');

    % Open CSV log file
    log_path = fullfile(fileparts(mfilename('fullpath')), 'debug_log.csv');
    debug_fid = fopen(log_path, 'w');
    fprintf(debug_fid, 'sample,ax_raw,ay_raw,az_raw,ax_g,ay_g,az_g,az_hp,pitch_deg,roll_deg,step,cadence,footStrike,pronation,lateralDisp\n');
    fprintf('[DEBUG] Logging to %s\n', log_path);

    % Expose DEBUG_MODE to base workspace for Simulink
    assignin('base', 'DEBUG_MODE', 1);
    fprintf('[DEBUG] Launching Simulink model...\n');
    try
        open_system('RunForm.slx');
    catch ME
        warning('RunForm:Simulink', 'Could not open RunForm.slx: %s', ME.message);
    end
else
    assignin('base', 'DEBUG_MODE', 0);
end

% =========================================================================
% MAIN LOOP
% =========================================================================
fprintf('\nRunning — press Ctrl+C to stop.\n');

step_debug_counter = 0;  % for periodic debug table print

try
    while true
        % ---- Read one CSV line from serial ----
        if s.NumBytesAvailable == 0
            pause(0.002);
            continue;
        end

        line = strtrim(readline(s));

        % Skip empty or error lines
        if isempty(line) || startsWith(line, 'ERR') || startsWith(line, 'READY')
            continue;
        end

        vals = str2double(split(line, ','));
        if numel(vals) ~= 3 || any(isnan(vals))
            if DEBUG_MODE
                fprintf('[DEBUG] Bad line: "%s"\n', line);
            end
            continue;
        end

        ax_raw = vals(1);
        ay_raw = vals(2);
        az_raw = vals(3);

        if DEBUG_MODE
            fprintf('[DEBUG] Raw: %d, %d, %d\n', ax_raw, ay_raw, az_raw);
        end

        % ---- Signal processing ----
        state = processGait(ax_raw, ay_raw, az_raw, state);

        % ---- Path integration ----
        state = pathIntegration(state, FS);

        % ---- Update Simulink workspace buffers (ring buffer) ----
        sim_raw_ax(sim_buf_idx)      = ax_raw * SCALE;
        sim_raw_ay(sim_buf_idx)      = ay_raw * SCALE;
        sim_raw_az(sim_buf_idx)      = az_raw * SCALE;
        sim_filt_ax(sim_buf_idx)     = state.ax_filt;
        sim_filt_ay(sim_buf_idx)     = state.ay_filt;
        sim_filt_az(sim_buf_idx)     = state.az_filt;
        sim_impact_z(sim_buf_idx)    = state.az_impact;
        sim_step_events(sim_buf_idx) = double(state.step_detected);
        sim_pitch_deg(sim_buf_idx)   = state.pitch_deg;
        sim_roll_deg(sim_buf_idx)    = state.roll_deg;
        sim_lat_disp(sim_buf_idx)    = state.lateralDisp_m;

        sim_buf_idx = mod(sim_buf_idx, SIM_BUF_LEN) + 1;

        % Push rolled buffers to base workspace as timeseries for Simulink
        % Reconstruct time vector aligned to current buffer position
        t_rolled = circshift(sim_t, -(sim_buf_idx - 1));
        assignin('base', 'raw_ax',      timeseries(circshift(sim_raw_ax,    -(sim_buf_idx-1)), t_rolled));
        assignin('base', 'raw_ay',      timeseries(circshift(sim_raw_ay,    -(sim_buf_idx-1)), t_rolled));
        assignin('base', 'raw_az',      timeseries(circshift(sim_raw_az,    -(sim_buf_idx-1)), t_rolled));
        assignin('base', 'filt_ax',     timeseries(circshift(sim_filt_ax,   -(sim_buf_idx-1)), t_rolled));
        assignin('base', 'filt_ay',     timeseries(circshift(sim_filt_ay,   -(sim_buf_idx-1)), t_rolled));
        assignin('base', 'filt_az',     timeseries(circshift(sim_filt_az,   -(sim_buf_idx-1)), t_rolled));
        assignin('base', 'impact_z',    timeseries(circshift(sim_impact_z,  -(sim_buf_idx-1)), t_rolled));
        assignin('base', 'step_events', timeseries(circshift(sim_step_events,-(sim_buf_idx-1)),t_rolled));
        assignin('base', 'pitch_deg',   timeseries(circshift(sim_pitch_deg, -(sim_buf_idx-1)), t_rolled));
        assignin('base', 'roll_deg',    timeseries(circshift(sim_roll_deg,  -(sim_buf_idx-1)), t_rolled));
        assignin('base', 'lateral_disp',timeseries(circshift(sim_lat_disp,  -(sim_buf_idx-1)), t_rolled));

        % ---- On step event: compute feedback and write JSON ----
        if state.step_detected

            step_debug_counter = step_debug_counter + 1;

            % Generate feedback messages
            feedbackMessages = feedbackEngine( ...
                state.cadence_spm, ...
                state.footStrike, ...
                state.pronation_deg, ...
                state.isSidestep, ...
                state.lateralDisp_m, ...
                state.impact_peak, ...
                state.scores);

            if DEBUG_MODE
                fprintf('[DEBUG] Step #%d at t=%.2f s  cadence=%.1f spm  strike=%s  pronation=%.1f deg  lateral=%.3f m\n', ...
                    state.step_count, state.sample_count / FS, ...
                    state.cadence_spm, state.footStrike, ...
                    state.pronation_deg, state.lateralDisp_m);

                if mod(step_debug_counter, 10) == 0
                    fprintf('\n[DEBUG] === Metrics after %d steps ===\n', state.step_count);
                    fprintf('  Cadence:   %.1f spm  (score: %d)\n', state.cadence_spm,   state.scores.cadence);
                    fprintf('  Strike:    %s        (score: %d)\n', state.footStrike,     state.scores.strike);
                    fprintf('  Pronation: %.1f deg  (score: %d)\n', state.pronation_deg,  state.scores.pronation);
                    fprintf('  Lateral:   %.3f m    (score: %d)\n', state.lateralDisp_m,  state.scores.lateral);
                    fprintf('  Overall:   %d\n', state.scores.overall);
                    fprintf('=====================================\n\n');
                end

                % Write debug CSV row
                fprintf(debug_fid, '%d,%d,%d,%d,%.4f,%.4f,%.4f,%.4f,%.2f,%.2f,%d,%.1f,%s,%.2f,%.4f\n', ...
                    state.sample_count, ax_raw, ay_raw, az_raw, ...
                    ax_raw*SCALE, ay_raw*SCALE, az_raw*SCALE, state.az_impact, ...
                    state.pitch_deg, state.roll_deg, ...
                    1, state.cadence_spm, state.footStrike, ...
                    state.pronation_deg, state.lateralDisp_m);
            end

            % Build data struct for JSON export
            data.timestamp     = posixtime(datetime('now'));
            data.ax            = state.ax_filt;
            data.ay            = state.ay_filt;
            data.az            = state.az_filt;
            data.cadence       = state.cadence_spm;
            data.footStrike    = state.footStrike;
            data.impactAngle   = state.pitch_deg;
            data.rollAngle     = state.roll_deg;
            data.lateralDisp   = state.lateralDisp_m;
            data.isSidestep    = state.isSidestep;
            data.footPath.x    = state.footPath_x(:)';
            data.footPath.y    = state.footPath_y(:)';
            data.optimalPath.x = state.optPath_x(:)';
            data.optimalPath.y = state.optPath_y(:)';
            data.feedback      = feedbackMessages;
            data.scores.overall   = state.scores.overall;
            data.scores.cadence   = state.scores.cadence;
            data.scores.strike    = state.scores.strike;
            data.scores.pronation = state.scores.pronation;
            data.scores.lateral   = state.scores.lateral;
            data.stepCount        = state.step_count;

            % Atomic JSON write: write to temp file then rename
            jsonStr  = jsonencode(data);
            tmpFile  = fullfile(WWW_DIR, 'data_tmp.json');
            destFile = fullfile(WWW_DIR, 'data.json');

            fid = fopen(tmpFile, 'w');
            if fid ~= -1
                fprintf(fid, '%s', jsonStr);
                fclose(fid);
                movefile(tmpFile, destFile, 'f');
            else
                warning('RunForm:JSON', 'Could not write data_tmp.json');
            end

        end  % step_detected

    end  % while true

catch ME
    fprintf('\nMain loop interrupted: %s\n', ME.message);
end

% =========================================================================
% CLEANUP
% =========================================================================
fprintf('Shutting down...\n');
if debug_fid ~= -1
    fclose(debug_fid);
end
clear s;
fprintf('Done.\n');
