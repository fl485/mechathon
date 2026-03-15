function feedback = feedbackEngine(cadence_spm, footStrike, pronation_deg, ...
                                   isSidestep, lateralDisp_m, impact_g, scores)
% feedbackEngine  Generate plain-English feedback messages for the runner
%
% Inputs:
%   cadence_spm     - steps per minute (both feet estimated)
%   footStrike      - string: 'heel' | 'midfoot' | 'forefoot'
%   pronation_deg   - peak roll angle at stance (positive = inward = pronation)
%   isSidestep      - logical: true if lateral crossover detected
%   lateralDisp_m   - lateral displacement this stride in metres
%   impact_g        - peak impact acceleration in g at last step
%   scores          - struct with fields: overall, cadence, strike, pronation, lateral
%
% Output:
%   feedback        - cell array of structs, each with fields:
%                       .level   - 'OK' | 'INFO' | 'WARNING' | 'ALERT'
%                       .message - plain-English guidance string

feedback = {};

% -----------------------------------------------------------------------
% Cadence rules
% -----------------------------------------------------------------------
if cadence_spm > 0  % only evaluate once we have cadence data
    if cadence_spm < 150
        feedback{end+1} = struct( ...
            'level',   'WARNING', ...
            'message', 'Your cadence is too low. Try taking quicker, shorter steps — aim for about 3 steps per second.');

    elseif cadence_spm >= 150 && cadence_spm <= 159
        feedback{end+1} = struct( ...
            'level',   'INFO', ...
            'message', 'Your cadence is slightly slow. Try to increase your step rate gradually.');

    elseif cadence_spm >= 181 && cadence_spm <= 190
        feedback{end+1} = struct( ...
            'level',   'INFO', ...
            'message', 'Cadence is slightly high — this is fine if it feels comfortable.');

    elseif cadence_spm > 190
        feedback{end+1} = struct( ...
            'level',   'INFO', ...
            'message', 'Your cadence is very high. Only adjust if it feels forced or uncomfortable.');
    end
end

% -----------------------------------------------------------------------
% Foot strike rules
% -----------------------------------------------------------------------
if strcmp(footStrike, 'heel')
    feedback{end+1} = struct( ...
        'level',   'WARNING', ...
        'message', 'You are heel striking. Try landing with your foot under your hip, not in front. Shorter steps help.');
end

% -----------------------------------------------------------------------
% Pronation rules
% -----------------------------------------------------------------------
if pronation_deg > 15
    feedback{end+1} = struct( ...
        'level',   'ALERT', ...
        'message', 'Your foot is rolling inward too much on landing. Focus on landing with a firm, stable ankle.');

elseif pronation_deg < -5
    feedback{end+1} = struct( ...
        'level',   'INFO', ...
        'message', 'Your foot shows some supination (outward roll). This is usually fine but watch for ankle instability.');
end

% -----------------------------------------------------------------------
% Lateral sidestep / crossover rules
% -----------------------------------------------------------------------
if isSidestep
    if lateralDisp_m > 0.08
        feedback{end+1} = struct( ...
            'level',   'ALERT', ...
            'message', 'Your foot is crossing your body centreline as you run — this wastes energy. Imagine running along a straight line.');

    elseif lateralDisp_m >= 0.05
        feedback{end+1} = struct( ...
            'level',   'WARNING', ...
            'message', 'Slight crossover gait detected. Try to land your foot a little wider on each step.');
    end
end

% -----------------------------------------------------------------------
% Impact force rule
% -----------------------------------------------------------------------
if impact_g > 3.5
    feedback{end+1} = struct( ...
        'level',   'ALERT', ...
        'message', 'You are landing very hard. Try to land softer and quieter — reduce stride length if needed.');
end

% -----------------------------------------------------------------------
% All-clear: only show if no negative feedback AND all scores above 80
% -----------------------------------------------------------------------
if isempty(feedback)
    if scores.overall > 80
        feedback{end+1} = struct( ...
            'level',   'OK', ...
            'message', 'Great running form! Everything looks efficient — keep it up.');
    end
end

end  % function feedbackEngine
