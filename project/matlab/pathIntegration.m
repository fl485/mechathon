function state = pathIntegration(state, fs)
% pathIntegration  Lateral sidestep detection and foot-path trajectory
%
% Called every sample from main.m AFTER processGait updates state.
%
% Swing phase detection:
%   abs(az_filt) < 0.5 g AND no recent step event (after step fires)
%   Integration resets to zero on each step event (prevents drift)
%
% Outputs written to state:
%   state.lateralDisp_m  - total lateral displacement this stride (metres)
%   state.isSidestep     - logical flag
%   state.footPath_x     - lateral path array (metres, normalised to start at 0)
%   state.footPath_y     - forward path array (metres, normalised to start at 0)
%   state.optPath_x      - optimal path x (straight line)
%   state.optPath_y      - optimal path y

if nargin < 2
    fs = 100;
end

dt = 1 / fs;

% ---- Step event resets accumulator ----
if state.step_detected
    % Save completed swing-phase integrals as the foot path for this stride
    if numel(state.swing_ax_buf) >= 2
        % Double-integrate lateral (ax) and forward (ay) — already in g, convert to m/s^2
        ax_ms2 = state.swing_ax_buf * 9.81;
        ay_ms2 = state.swing_ay_buf * 9.81;

        % First integration: acceleration -> velocity
        vx = cumtrapz(ax_ms2) * dt;
        vy = cumtrapz(ay_ms2) * dt;

        % Second integration: velocity -> position
        px = cumtrapz(vx) * dt;
        py = cumtrapz(vy) * dt;

        % Normalise: shift to start at (0,0)
        px = px - px(1);
        py = py - py(1);

        % Store path
        state.footPath_x = px;
        state.footPath_y = py;

        % Lateral displacement = total excursion from start
        state.lateralDisp_m = max(abs(px));

        % Sidestep threshold: > 0.05 m lateral displacement
        state.isSidestep = state.lateralDisp_m > 0.05;

        % Compute optimal path (straight forward, zero lateral)
        stride_len = max(abs(py));  % forward distance
        n_pts = numel(px);
        state.optPath_x = zeros(n_pts, 1);
        state.optPath_y = linspace(0, stride_len, n_pts)';

        % Lateral score (used in processGait after this returns)
        if state.lateralDisp_m < 0.03
            state.scores.lateral = 100;
        else
            over_cm = (state.lateralDisp_m - 0.03) * 100;  % excess in cm
            state.scores.lateral = max(0, 100 - over_cm * 10);
        end
    end

    % Reset swing-phase buffers for next stride
    state.swing_ax_buf   = [];
    state.swing_ay_buf   = [];
    state.in_swing_phase = false;
end

% ---- Detect swing phase: az_filt magnitude below 0.5 g ----
% Swing begins after step event, when foot is in the air
if abs(state.az_filt) < 0.5 && ~state.step_detected
    % We are in swing phase — accumulate filtered accelerations
    state.in_swing_phase = true;
    state.swing_ax_buf(end+1) = state.ax_filt;
    state.swing_ay_buf(end+1) = state.ay_filt;
else
    % Stance phase or transition — stop accumulating
    state.in_swing_phase = false;
end

end  % function pathIntegration


% -----------------------------------------------------------------------
function state = initPathIntegration(state)
% initPathIntegration  Initialise path integration fields in state struct
%
% Call once after initProcessGait:
%   state = initPathIntegration(state);

state.swing_ax_buf   = [];
state.swing_ay_buf   = [];
state.in_swing_phase = false;
state.lateralDisp_m  = 0;
state.isSidestep     = false;
state.footPath_x     = [0; 0];
state.footPath_y     = [0; 0.01];
state.optPath_x      = [0; 0];
state.optPath_y      = [0; 0.01];

end  % function initPathIntegration
