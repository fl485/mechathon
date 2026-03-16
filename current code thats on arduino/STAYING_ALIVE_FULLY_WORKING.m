clear; clc;

% --- CONFIGURATION ---
PORT = 'COM4';
BOARD = 'Nano3';
I2C_ADDR = '0x1C';
TRIGGER_PIN = 'D2'; % Change this to the pin your component is connected to
RECORD_DURATION = 0.5; % 500 milliseconds
% ---------------------

% 1. Connect to Arduino, Sensor, and Digital Pin
a = arduino(PORT, BOARD, 'Libraries', 'I2C');
dev = device(a, 'I2CAddress', I2C_ADDR);
configurePin(a, TRIGGER_PIN, 'DigitalInput'); % Configure pin to read 1 or 0

% 2. Put device in STANDBY mode
writeRegister(dev, hex2dec('2A'), 0);

% 3. Enable the High-Pass Filter (HPF_OUT = 1)
writeRegister(dev, hex2dec('0E'), hex2dec('10'));
writeRegister(dev, hex2dec('0F'), hex2dec('00'));

% 4. Set ODR to 50Hz and ACTIVATE
writeRegister(dev, hex2dec('2A'), hex2dec('21'));

% ==========================================
% 5. CALIBRATION PHASE (Do this BEFORE trigger)
% ==========================================
CALIB_SAMPLES = 50; 
calib_data = zeros(CALIB_SAMPLES, 6, 'uint8');

fprintf('=== CALIBRATION PHASE ===\n');
fprintf('Keep sensor STRICTLY STATIONARY for 2 seconds...\n');
pause(2); 

for i = 1:CALIB_SAMPLES
    calib_data(i,:) = readRegister(dev, hex2dec('01'), 6, 'uint8');
end

% Process calibration data to find bias
accel_calib_g = zeros(CALIB_SAMPLES, 3);
for i = 1:CALIB_SAMPLES
    for axis = 1:3
        idx = (axis-1)*2 + 1;
        raw_val = double(calib_data(i, idx)) * 256 + double(calib_data(i, idx+1));
        if raw_val > 32767, raw_val = raw_val - 65536; end
        accel_calib_g(i, axis) = (raw_val / 16) / 1024;
    end
end
bias = mean(accel_calib_g * 9.80665);
fprintf('Calibration complete! Bias (X, Y, Z): %.3f, %.3f, %.3f m/s^2\n\n', bias(1), bias(2), bias(3));

% ==========================================
% 6. WAITING FOR TRIGGER
% ==========================================
fprintf('Waiting for trigger... (Pin %s must output 0 to start)\n', TRIGGER_PIN);

% Loop indefinitely until the pin reads 0
while readDigitalPin(a, TRIGGER_PIN) == 1
    % Do nothing, just wait
end

% ==========================================
% 7. RECORDING PHASE (500ms Window)
% ==========================================
fprintf('TRIGGERED! Recording for 500ms...\n');

% Pre-allocate arrays (100 samples is plenty for 500ms at ~34Hz)
MAX_SAMPLES = 100; 
raw_data = zeros(MAX_SAMPLES, 6, 'uint8');
timestamps = zeros(MAX_SAMPLES, 1);
sample_count = 0;

tic; % Start the 500ms stopwatch
while toc < RECORD_DURATION
    sample_count = sample_count + 1;
    raw_data(sample_count,:) = readRegister(dev, hex2dec('01'), 6, 'uint8');
    timestamps(sample_count) = toc; 
end

fprintf('Recording finished. Captured %d samples.\n', sample_count);
clear a dev; % Release COM port safely

% Trim arrays to remove unused pre-allocated empty slots
raw_data = raw_data(1:sample_count, :);
timestamps = timestamps(1:sample_count);

% ==========================================
% 8. DATA PROCESSING & INTEGRATION
% ==========================================
accel_g = zeros(sample_count, 3);
for i = 1:sample_count
    for axis = 1:3
        idx = (axis-1)*2 + 1;
        raw_val = double(raw_data(i, idx)) * 256 + double(raw_data(i, idx+1));
        if raw_val > 32767, raw_val = raw_val - 65536; end
        accel_g(i, axis) = (raw_val / 16) / 1024; 
    end
end

% Convert to m/s^2 and subtract the pre-calculated bias
accel_calibrated = (accel_g * 9.80665) - bias;

% Double Integration
vel = cumtrapz(timestamps, accel_calibrated);
pos = cumtrapz(timestamps, vel);

% ==========================================
% 9. PLOT 3D ANIMATION
% ==========================================
fig = figure('Name', '3D Footpath Animation (500ms Window)', 'Color', 'w');

% Plot static background path
plot3(pos(:,1), pos(:,2), pos(:,3), 'Color', [0.8 0.8 0.8], 'LineWidth', 1.5);
hold on; grid on;
xlabel('X Position (m)'); ylabel('Y Position (m)'); zlabel('Z Position (m)');
title(sprintf('3D Footpath (%.2f seconds)', RECORD_DURATION));
view(3); 

% Set dynamic axis limits with a small buffer
buffer = 0.05;
xlim([min(pos(:,1))-buffer, max(pos(:,1))+buffer]);
ylim([min(pos(:,2))-buffer, max(pos(:,2))+buffer]);
zlim([min(pos(:,3))-buffer, max(pos(:,3))+buffer]);

plot3(pos(1,1), pos(1,2), pos(1,3), 'go', 'MarkerSize', 8, 'MarkerFaceColor', 'g');
plot3(pos(end,1), pos(end,2), pos(end,3), 'ro', 'MarkerSize', 8, 'MarkerFaceColor', 'r');

traceLine = animatedline('Color', 'b', 'LineWidth', 2.5);
headMarker = plot3(pos(1,1), pos(1,2), pos(1,3), 'bo', 'MarkerSize', 6, 'MarkerFaceColor', 'b');

fprintf('\nAnimating... Close the figure window to stop.\n');
while isgraphics(fig)
    clearpoints(traceLine); 
    for i = 1:length(pos)
        if ~isgraphics(fig), break; end
        addpoints(traceLine, pos(i,1), pos(i,2), pos(i,3));
        set(headMarker, 'XData', pos(i,1), 'YData', pos(i,2), 'ZData', pos(i,3));
        drawnow; 
        pause(0.02); 
    end
    if isgraphics(fig), pause(1); end
end
