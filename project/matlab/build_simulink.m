% build_simulink.m  —  Programmatically create RunForm.slx Simulink model
%
% Run this script once to generate the Simulink debug model.
% The model reads timeseries variables from the MATLAB base workspace
% (populated by main.m in real-time) and displays them in scope blocks.
%
% Usage:
%   run build_simulink.m   (once, before first use)
%
% To use after building:
%   1. Run main.m so workspace variables are populated
%   2. Set DEBUG_MODE = 1 in main.m (or in workspace)
%   3. open_system('RunForm.slx'); sim('RunForm.slx');

sys = 'RunForm';

% Close and delete existing model if present
if bdIsLoaded(sys)
    close_system(sys, 0);
end
if exist([sys '.slx'], 'file')
    delete([sys '.slx']);
end

% Create new model
new_system(sys);
open_system(sys);

% =========================================================================
% Helper: add a From Workspace block
% =========================================================================
function blk = addFromWorkspace(sys, varname, pos)
    blk = [sys '/FW_' varname];
    add_block('simulink/Sources/From Workspace', blk, ...
        'VariableName', varname, ...
        'Position',      pos, ...
        'SampleTime',    '0.01');
end

% =========================================================================
% Helper: add an Enabled Subsystem
% =========================================================================
function ss_path = addEnabledSubsystem(sys, name, pos)
    ss_path = [sys '/' name];
    add_block('simulink/Ports & Subsystems/Enabled Subsystem', ss_path, ...
        'Position', pos);
    % Remove default Inport placeholder blocks left by template
    default_in  = find_system(ss_path, 'SearchDepth', 1, 'BlockType', 'Inport',  'Name', 'In1');
    default_out = find_system(ss_path, 'SearchDepth', 1, 'BlockType', 'Outport', 'Name', 'Out1');
    for i = 1:numel(default_in),  delete_block(default_in{i});  end
    for i = 1:numel(default_out), delete_block(default_out{i}); end
end

% =========================================================================
% Helper: add Mux → Scope inside a subsystem
% =========================================================================
function addMuxScope(ss_path, n_inputs, title, ylim_str)
    % Add Mux
    mux = [ss_path '/Mux'];
    add_block('simulink/Signal Routing/Mux', mux, ...
        'Inputs',    num2str(n_inputs), ...
        'Position',  [120 80 150 80+n_inputs*30]);

    % Add Scope
    scope = [ss_path '/Scope'];
    add_block('simulink/Sinks/Scope', scope, ...
        'NumInputPorts', '1', ...
        'Position',      [220 80 270 120]);

    % Set scope title and Y limits via ScopeConfiguration
    sc = get_param(scope, 'ScopeConfiguration');
    sc.Name = title;

    % Connect Mux → Scope
    add_line(ss_path, 'Mux/1', 'Scope/1', 'autorouting', 'on');
end

% =========================================================================
% 1. DEBUG_MODE Constant block
% =========================================================================
debug_blk = [sys '/DEBUG_MODE'];
add_block('simulink/Sources/Constant', debug_blk, ...
    'Value',    'DEBUG_MODE', ...
    'Position', [30 300 80 330]);

% =========================================================================
% 2. From Workspace source blocks (top-level)
%    Layout: column at x=30, spacing 60 px vertically
% =========================================================================
fw_vars = {'raw_ax','raw_ay','raw_az', ...
           'filt_ax','filt_ay','filt_az', ...
           'impact_z','step_events', ...
           'pitch_deg','roll_deg', ...
           'lateral_disp'};

fw_blocks = containers.Map();
for i = 1:numel(fw_vars)
    pos = [30, 30 + (i-1)*60, 130, 50 + (i-1)*60];
    fw_blocks(fw_vars{i}) = addFromWorkspace(sys, fw_vars{i}, pos);
end

% =========================================================================
% 3. Enabled Subsystem scope blocks
% =========================================================================
% Positions for subsystems (right side of diagram)
ss_x = 350;

% --- Subsystem 1: Raw XYZ ---
ss1 = addEnabledSubsystem(sys, 'Raw_XYZ_Scope',     [ss_x  30  ss_x+200  160]);
addMuxScope(ss1, 3, 'Raw Accelerometer (g)', '[-3 3]');
% Add 3 Inports inside ss1
for k = 1:3
    add_block('simulink/Ports & Subsystems/In Bus Element', [ss1 '/In' num2str(k)], ...
        'Position', [30 30+k*40 60 50+k*40]);
    add_line(ss1, ['In' num2str(k) '/1'], ['Mux/1'], 'autorouting', 'on');
end

% ---- Due to complexity of wiring inside enabled subsystems programmatically,
%      use a simpler but equivalent approach: direct scope blocks with enable ----

% Delete the enabled subsystem approach and use a cleaner pattern:
close_system(sys, 0);
new_system(sys);
open_system(sys);

% =========================================================================
% REVISED APPROACH: Scope subsystems using add_block properly
% =========================================================================

% -- DEBUG_MODE Constant --
add_block('simulink/Sources/Constant', [sys '/DEBUG_MODE'], ...
    'Value',    'DEBUG_MODE', ...
    'Position', [30 500 120 530]);

% -- From Workspace blocks --
fw_info = { ...
    'raw_ax',      [30  30  160  50]; ...
    'raw_ay',      [30  70  160  90]; ...
    'raw_az',      [30 110  160 130]; ...
    'filt_ax',     [30 170  160 190]; ...
    'filt_ay',     [30 210  160 230]; ...
    'filt_az',     [30 250  160 270]; ...
    'impact_z',    [30 310  160 330]; ...
    'step_events', [30 350  160 370]; ...
    'pitch_deg',   [30 410  160 430]; ...
    'roll_deg',    [30 450  160 470]; ...
    'lateral_disp',[30 490  160 510]; ...
};

fw_blk = containers.Map();
for i = 1:size(fw_info, 1)
    vname = fw_info{i,1};
    pos   = fw_info{i,2};
    bpath = [sys '/FW_' vname];
    add_block('simulink/Sources/From Workspace', bpath, ...
        'VariableName', vname, ...
        'SampleTime',   '0.01', ...
        'Position',      pos);
    fw_blk(vname) = bpath;
end

% =========================================================================
% Helper: build one scope subsystem with N inputs, a Mux, and a Scope
%   ss_name   - subsystem name
%   top_pos   - [x1 y1 x2 y2] for subsystem in parent diagram
%   n_in      - number of input channels
%   scope_title - display name for scope
% Returns the subsystem path
% =========================================================================
function ss = buildScopeSubsystem(parent, ss_name, top_pos, n_in, scope_title)
    ss = [parent '/' ss_name];
    add_block('simulink/Ports & Subsystems/Enabled Subsystem', ss, ...
        'Position', top_pos);

    % Delete auto-generated In1/Out1 that the template adds
    auto_in  = find_system(ss, 'SearchDepth',1,'BlockType','Inport');
    auto_out = find_system(ss, 'SearchDepth',1,'BlockType','Outport');
    for k=1:numel(auto_in),  delete_block(auto_in{k});  end
    for k=1:numel(auto_out), delete_block(auto_out{k}); end

    % Add n_in Inport blocks
    for k = 1:n_in
        add_block('simulink/Ports & Subsystems/In Bus Element', ...
            [ss '/SignalIn_' num2str(k)], ...
            'Port',     num2str(k), ...
            'Position', [40, 30+k*50, 100, 50+k*50]);
    end

    % Add Mux
    mux_h = n_in * 40;
    add_block('simulink/Signal Routing/Mux', [ss '/Mux'], ...
        'Inputs',   num2str(n_in), ...
        'Position', [160, 30, 190, 30+mux_h]);

    % Add Scope
    add_block('simulink/Sinks/Scope', [ss '/Scope'], ...
        'NumInputPorts', '1', ...
        'Position',      [260, 50, 310, 90]);

    % Connect Inports → Mux
    for k = 1:n_in
        add_line(ss, ['SignalIn_' num2str(k) '/1'], ['Mux/' num2str(k)], ...
            'autorouting','on');
    end
    % Connect Mux → Scope
    add_line(ss, 'Mux/1', 'Scope/1', 'autorouting','on');
end

% =========================================================================
% Build 5 scope subsystems
% =========================================================================

% 1. Raw XYZ Scope (3 channels)
ss1_path = buildScopeSubsystem(sys, 'Raw_XYZ_Scope',      [350  30 600 200], 3, 'Raw Accelerometer (g)');

% 2. Filtered XYZ Scope (3 channels)
ss2_path = buildScopeSubsystem(sys, 'Filt_XYZ_Scope',     [350 220 600 390], 3, 'Filtered Accelerometer (g)');

% 3. Impact and Steps Scope (2 channels)
ss3_path = buildScopeSubsystem(sys, 'Impact_Steps_Scope', [350 410 600 530], 2, 'Impact Transient + Step Events');

% 4. Tilt Angles Scope (2 channels)
ss4_path = buildScopeSubsystem(sys, 'Tilt_Angles_Scope',  [700  30 950 150], 2, 'Foot Tilt Angles (degrees)');

% 5. Lateral Displacement Scope (1 channel)
ss5_path = buildScopeSubsystem(sys, 'Lateral_Disp_Scope', [700 170 950 280], 1, 'Lateral Displacement per Step (m)');

% =========================================================================
% Route DEBUG_MODE to Enable ports of all subsystems
% =========================================================================
ss_list = {ss1_path, ss2_path, ss3_path, ss4_path, ss5_path};
% The Enable port is port index 1 by convention in Enabled Subsystems.
% We need to connect DEBUG_MODE constant to each Enable port.
for i = 1:numel(ss_list)
    ss_short = strrep(ss_list{i}, [sys '/'], '');
    add_line(sys, 'DEBUG_MODE/1', [ss_short '/Enable'], 'autorouting','on');
end

% =========================================================================
% Connect From Workspace blocks → Subsystem inputs
% =========================================================================
% Helper: get short name from full path
function sn = shortname(fp, parent)
    sn = strrep(fp, [parent '/'], '');
end

% SS1: raw_ax, raw_ay, raw_az -> ports 1,2,3
add_line(sys, 'FW_raw_ax/1',  [shortname(ss1_path,sys) '/1'], 'autorouting','on');
add_line(sys, 'FW_raw_ay/1',  [shortname(ss1_path,sys) '/2'], 'autorouting','on');
add_line(sys, 'FW_raw_az/1',  [shortname(ss1_path,sys) '/3'], 'autorouting','on');

% SS2: filt_ax, filt_ay, filt_az -> ports 1,2,3
add_line(sys, 'FW_filt_ax/1', [shortname(ss2_path,sys) '/1'], 'autorouting','on');
add_line(sys, 'FW_filt_ay/1', [shortname(ss2_path,sys) '/2'], 'autorouting','on');
add_line(sys, 'FW_filt_az/1', [shortname(ss2_path,sys) '/3'], 'autorouting','on');

% SS3: impact_z, step_events -> ports 1,2
add_line(sys, 'FW_impact_z/1',    [shortname(ss3_path,sys) '/1'], 'autorouting','on');
add_line(sys, 'FW_step_events/1', [shortname(ss3_path,sys) '/2'], 'autorouting','on');

% SS4: pitch_deg, roll_deg -> ports 1,2
add_line(sys, 'FW_pitch_deg/1', [shortname(ss4_path,sys) '/1'], 'autorouting','on');
add_line(sys, 'FW_roll_deg/1',  [shortname(ss4_path,sys) '/2'], 'autorouting','on');

% SS5: lateral_disp -> port 1
add_line(sys, 'FW_lateral_disp/1', [shortname(ss5_path,sys) '/1'], 'autorouting','on');

% =========================================================================
% Save model
% =========================================================================
save_system(sys, 'RunForm.slx');
close_system(sys);

fprintf('RunForm.slx built successfully.\n');
fprintf('To use:\n');
fprintf('  1. Run main.m (populates base workspace variables)\n');
fprintf('  2. Set DEBUG_MODE = 1 in main.m\n');
fprintf('  3. Call: open_system(''RunForm.slx''); sim(''RunForm.slx'')\n');
