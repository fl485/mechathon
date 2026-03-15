%% main.m  —  RunForm Analyser
%  Sensor interface based on STAYING_ALIVE_FULLY_WORKING.m (proven hardware).
%  Uses the MATLAB Arduino Support Package I2C toolbox to read MMA8452Q
%  directly — no custom Arduino sketch required.
clear; clc; close all;

% =========================================================================
% CONFIGURATION  (edit these to match your hardware)
% =========================================================================
PORT      = 'COM5';     % Arduino COM port
BOARD     = 'Nano3';    % Board type for arduino() toolbox
I2C_ADDR  = '0x1C';     % MMA8452Q with SA0 LOW

FS            = 50;     % Sensor ODR (Hz) — matches ODR code 0x21
STEP_THRESH   = 0.4;    % g above baseline to detect foot-strike
STEP_DEBOUNCE = 0.25;   % seconds minimum between two steps

SCRIPT_DIR = fileparts(mfilename('fullpath'));
WWW_DIR    = fullfile(SCRIPT_DIR, '..', 'www');
JSON_OUT   = fullfile(WWW_DIR, 'data.json');
JSON_TMP   = fullfile(WWW_DIR, 'data_tmp.json');

% =========================================================================
% CONNECT & CONFIGURE MMA8452Q
% =========================================================================
fprintf('Connecting to Arduino (%s, %s)...\n', PORT, BOARD);
a   = arduino(PORT, BOARD, 'Libraries', 'I2C');
dev = device(a, 'I2CAddress', I2C_ADDR);

writeRegister(dev, hex2dec('2A'), 0);             % Standby
writeRegister(dev, hex2dec('0E'), hex2dec('00')); % +-2 g full-scale
writeRegister(dev, hex2dec('2A'), hex2dec('21')); % 50 Hz, active
fprintf('Sensor configured at 50 Hz, +-2 g.\n');

% =========================================================================
% CALIBRATION  (keep shoe flat and still)
% =========================================================================
CALIB_N = 100;
fprintf('\nCalibration: keep the shoe FLAT and STILL for 2 seconds...\n');
pause(2);

bias_g = zeros(1, 3);
for i = 1:CALIB_N
    bias_g = bias_g + readSample(dev);
end
bias_g = bias_g / CALIB_N;

gravity_est = bias_g(3);
if abs(gravity_est - 1.0) > 0.3
    fprintf('[WARN] Z gravity is %.2f g (expected ~1.0). Check sensor orientation.\n', gravity_est);
end
fprintf('Calibration done. Bias: [%.3f, %.3f, %.3f] g\n', bias_g);

% =========================================================================
% START WEB SERVER & BROWSER
% =========================================================================
fprintf('\nStarting web server at http://localhost:8080 ...\n');
if ispc
    system(sprintf('start /B python -m http.server 8080 --directory "%s"', WWW_DIR));
else
    system(sprintf('python3 -m http.server 8080 --directory "%s" &', WWW_DIR));
end
pause(1.5);
web('http://localhost:8080', '-browser');

writeJSON(JSON_OUT, JSON_TMP, makeInitialData());
fprintf('Dashboard open. Start running! Press Ctrl+C to stop.\n\n');

% =========================================================================
% SESSION STATE
% =========================================================================
stepCount    = 0;
stepTimes    = [];
lastStepTime = -inf;
prevZ_g      = 0;

swingT  = [];
swingAx = [];
swingAy = [];

cadence    = 0;
footStrike = 'unknown';
rollAngle  = 0;
impAngle   = 0;
impForce   = 0;
latDisp    = 0;
isSidestep = false;

footPath.x = 0;
footPath.y = 0;
optPath.x  = 0;
optPath.y  = 0;

scores = struct('overall',50,'cadence',50,'strike',50,'pronation',50,'lateral',50);

dt       = 1 / FS;
tSession = tic;

% =========================================================================
% MAIN LOOP
% =========================================================================
while true
    tLoop = tic;

    try
        acc = readSample(dev);
    catch ME
        fprintf('[WARN] Sensor read failed: %s  Retrying...\n', ME.message);
        pause(0.1);
        continue;
    end

    acc_c  = acc - bias_g;
    az_g   = acc_c(3);
    ax_ms2 = acc_c(1) * 9.80665;
    ay_ms2 = acc_c(2) * 9.80665;
    tNow   = toc(tSession);

    % Step detection: rising edge of vertical acceleration
    isRising     = (az_g > STEP_THRESH) && (prevZ_g <= STEP_THRESH);
    notTooSoon   = (tNow - lastStepTime) > STEP_DEBOUNCE;
    stepDetected = isRising && notTooSoon;

    if stepDetected
        lastStepTime     = tNow;
        stepCount        = stepCount + 1;
        stepTimes(end+1) = tNow; %#ok<AGROW>

        impForce  = abs(acc(3));
        rollAngle = atan2d(acc_c(1), abs(acc_c(3)));
        impAngle  = atan2d(acc_c(2), abs(acc_c(3)));

        if impAngle > 8
            footStrike = 'heel';
        elseif impAngle > -3
            footStrike = 'midfoot';
        else
            footStrike = 'forefoot';
        end

        if numel(stepTimes) >= 2
            recent  = stepTimes(max(1, end-4) : end);
            cadence = 60 / mean(diff(recent));
        end

        % Double integration of swing phase for foot path
        if numel(swingT) > 4
            t0 = swingT - swingT(1);

            vel_x = cumtrapz(t0, swingAx);
            vel_y = cumtrapz(t0, swingAy);

            % Linear drift removal (assume foot starts and ends stationary)
            vel_x = vel_x - linspace(vel_x(1), vel_x(end), numel(vel_x));
            vel_y = vel_y - linspace(vel_y(1), vel_y(end), numel(vel_y));

            pos_x = cumtrapz(t0, vel_x);
            pos_y = cumtrapz(t0, vel_y);

            latDisp    = max(abs(pos_x));
            isSidestep = latDisp > 0.05;

            npts = min(20, numel(pos_x));
            idxs = round(linspace(1, numel(pos_x), npts));
            footPath.x = pos_x(idxs);
            footPath.y = pos_y(idxs);
            optPath.x  = zeros(1, npts);
            optPath.y  = pos_y(idxs);
        end

        swingT = [];  swingAx = [];  swingAy = [];

        scores = computeScores(cadence, footStrike, rollAngle, isSidestep, latDisp, impForce);
        fb     = generateFeedback(cadence, footStrike, rollAngle, isSidestep, latDisp, impForce);

        data.timestamp   = posixtime(datetime('now'));
        data.stepCount   = stepCount;
        data.cadence     = cadence;
        data.footStrike  = footStrike;
        data.az          = impForce;
        data.impactAngle = impAngle;
        data.rollAngle   = rollAngle;
        data.lateralDisp = latDisp;
        data.isSidestep  = logical(isSidestep);
        data.footPath    = footPath;
        data.optimalPath = optPath;
        data.feedback    = fb;
        data.scores      = scores;
        writeJSON(JSON_OUT, JSON_TMP, data);

        fprintf('[Step %3d]  Cad:%3.0f spm  Strike:%-9s  Roll:%+5.1f deg  Imp:%.2fg  Lat:%.1fcm\n', ...
                stepCount, cadence, footStrike, rollAngle, impForce, latDisp*100);
    end

    prevZ_g = az_g;

    if ~stepDetected
        swingT(end+1)  = tNow;   %#ok<AGROW>
        swingAx(end+1) = ax_ms2; %#ok<AGROW>
        swingAy(end+1) = ay_ms2; %#ok<AGROW>
    end

    elapsed = toc(tLoop);
    if elapsed < dt
        pause(dt - elapsed);
    end
end

% =========================================================================
% readSample — identical raw conversion to STAYING_ALIVE_FULLY_WORKING.m
% =========================================================================
function acc = readSample(dev)
    raw = readRegister(dev, hex2dec('01'), 6, 'uint8');
    acc = zeros(1, 3);
    for ax = 1:3
        idx = (ax-1)*2 + 1;
        v   = double(raw(idx)) * 256 + double(raw(idx+1));
        if v > 32767, v = v - 65536; end
        acc(ax) = (v / 16) / 1024;
    end
end

% =========================================================================
% computeScores
% =========================================================================
function scores = computeScores(cadence, footStrike, rollAngle, isSidestep, latDisp, impForce)
    if cadence >= 160 && cadence <= 180
        cad_s = 100;
    elseif cadence > 0
        cad_s = max(0, 100 - abs(cadence - 170) * 2);
    else
        cad_s = 50;
    end

    switch footStrike
        case 'midfoot',  str_s = 100;
        case 'forefoot', str_s = 85;
        case 'heel',     str_s = 40;
        otherwise,       str_s = 50;
    end

    pro_s = max(0, 100 - max(0, abs(rollAngle) - 5) * 3);
    lat_s = max(0, 100 - latDisp * 1200);
    imp_s = max(0, 100 - max(0, impForce - 2.5) * 30);

    overall = 0.20*cad_s + 0.25*str_s + 0.25*pro_s + 0.15*lat_s + 0.15*imp_s;
    scores  = struct('overall', overall, 'cadence', cad_s, 'strike', str_s, ...
                     'pronation', pro_s, 'lateral', lat_s);
end

% =========================================================================
% generateFeedback
% =========================================================================
function fb = generateFeedback(cadence, footStrike, rollAngle, isSidestep, latDisp, impForce)
    fb = {};

    if cadence > 0
        if cadence < 150
            fb{end+1} = struct('level','ALERT',   'message','Cadence is too low — aim for 160–180 steps/min.');
        elseif cadence < 160
            fb{end+1} = struct('level','WARNING', 'message','Cadence is slightly slow — try to speed up your turnover.');
        elseif cadence > 190
            fb{end+1} = struct('level','WARNING', 'message','Cadence is very high — check your form.');
        elseif cadence > 180
            fb{end+1} = struct('level','INFO',    'message','Cadence is slightly high but generally fine.');
        else
            fb{end+1} = struct('level','OK',      'message','Cadence is in the ideal range. Great turnover!');
        end
    end

    switch footStrike
        case 'heel'
            fb{end+1} = struct('level','ALERT', 'message','You are heel striking — land with a midfoot or forefoot strike.');
        case 'midfoot'
            fb{end+1} = struct('level','OK',    'message','Good midfoot strike pattern.');
        case 'forefoot'
            fb{end+1} = struct('level','OK',    'message','Forefoot strike detected — efficient landing.');
    end

    if rollAngle > 15
        fb{end+1} = struct('level','ALERT',   'message','Foot is rolling inward — overpronation detected.');
    elseif rollAngle > 8
        fb{end+1} = struct('level','WARNING', 'message','Mild inward roll — watch your pronation.');
    elseif rollAngle < -15
        fb{end+1} = struct('level','ALERT',   'message','Supination detected — foot rolling outward excessively.');
    elseif rollAngle < -8
        fb{end+1} = struct('level','WARNING', 'message','Mild supination detected.');
    else
        fb{end+1} = struct('level','OK',      'message','Pronation is within normal range.');
    end

    if impForce > 3.5
        fb{end+1} = struct('level','ALERT',   'message','Landing very hard — reduce impact force to protect joints.');
    elseif impForce > 2.5
        fb{end+1} = struct('level','WARNING', 'message','Impact force is elevated — try to land softer.');
    else
        fb{end+1} = struct('level','OK',      'message','Impact force is within a safe range.');
    end

    if isSidestep
        fb{end+1} = struct('level','ALERT',   'message','Crossover gait detected — you are crossing your body centreline.');
    elseif latDisp > 0.03
        fb{end+1} = struct('level','WARNING', 'message','Slight crossover gait — keep your feet tracking straight.');
    end

    if isempty(fb)
        fb{end+1} = struct('level','OK', 'message','Great running form! Everything looks efficient.');
    end
end

% =========================================================================
% makeInitialData
% =========================================================================
function d = makeInitialData()
    d.timestamp     = posixtime(datetime('now'));
    d.stepCount     = 0;
    d.cadence       = 0;
    d.footStrike    = 'unknown';
    d.az            = 0;
    d.impactAngle   = 0;
    d.rollAngle     = 0;
    d.lateralDisp   = 0;
    d.isSidestep    = false;
    d.footPath.x    = 0;
    d.footPath.y    = 0;
    d.optimalPath.x = 0;
    d.optimalPath.y = 0;
    d.feedback      = {};
    d.scores        = struct('overall',50,'cadence',50,'strike',50,'pronation',50,'lateral',50);
end

% =========================================================================
% writeJSON — atomic write via tmp file rename
% =========================================================================
function writeJSON(outPath, tmpPath, data)
    j   = jsonencode(data);
    fid = fopen(tmpPath, 'w');
    if fid == -1
        warning('writeJSON: cannot open %s', tmpPath);
        return;
    end
    fprintf(fid, '%s', j);
    fclose(fid);
    try
        movefile(tmpPath, outPath, 'f');
    catch
        copyfile(tmpPath, outPath);
    end
end
