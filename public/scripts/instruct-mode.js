'use strict';

import { name1, name2, saveSettingsDebounced, substituteParams } from '../script.js';
import { selected_group } from './group-chats.js';
import { parseExampleIntoIndividual } from './openai.js';
import {
    power_user,
    context_presets,
} from './power-user.js';
import { regexFromString, resetScrollHeight } from './utils.js';

/**
 * @type {any[]} Instruct mode presets.
 */
export let instruct_presets = [];

const controls = [
    { id: 'instruct_enabled', property: 'enabled', isCheckbox: true },
    { id: 'instruct_wrap', property: 'wrap', isCheckbox: true },
    { id: 'instruct_system_prompt', property: 'system_prompt', isCheckbox: false },
    { id: 'instruct_system_sequence_prefix', property: 'system_sequence_prefix', isCheckbox: false },
    { id: 'instruct_system_sequence_suffix', property: 'system_sequence_suffix', isCheckbox: false },
    { id: 'instruct_input_sequence', property: 'input_sequence', isCheckbox: false },
    { id: 'instruct_input_suffix', property: 'input_suffix', isCheckbox: false },
    { id: 'instruct_output_sequence', property: 'output_sequence', isCheckbox: false },
    { id: 'instruct_output_suffix', property: 'output_suffix', isCheckbox: false },
    { id: 'instruct_system_sequence', property: 'system_sequence', isCheckbox: false },
    { id: 'instruct_system_suffix', property: 'system_suffix', isCheckbox: false },
    { id: 'instruct_last_system_sequence', property: 'last_system_sequence', isCheckbox: false },
    { id: 'instruct_user_alignment_message', property: 'user_alignment_message', isCheckbox: false },
    { id: 'instruct_stop_sequence', property: 'stop_sequence', isCheckbox: false },
    { id: 'instruct_names', property: 'names', isCheckbox: true },
    { id: 'instruct_macro', property: 'macro', isCheckbox: true },
    { id: 'instruct_names_force_groups', property: 'names_force_groups', isCheckbox: true },
    { id: 'instruct_first_output_sequence', property: 'first_output_sequence', isCheckbox: false },
    { id: 'instruct_last_output_sequence', property: 'last_output_sequence', isCheckbox: false },
    { id: 'instruct_activation_regex', property: 'activation_regex', isCheckbox: false },
    { id: 'instruct_bind_to_context', property: 'bind_to_context', isCheckbox: true },
    { id: 'instruct_skip_examples', property: 'skip_examples', isCheckbox: true },
    { id: 'instruct_system_same_as_user', property: 'system_same_as_user', isCheckbox: true, trigger: true },
];

/**
 * Migrates instruct mode settings into the evergreen format.
 * @param {object} settings Instruct mode settings.
 * @returns {void}
 */
function migrateInstructModeSettings(settings) {
    // Separator sequence => Output suffix
    if (settings.separator_sequence !== undefined) {
        settings.output_suffix = settings.separator_sequence || '';
        delete settings.separator_sequence;
    }

    const defaults = {
        input_suffix: '',
        system_sequence: '',
        system_suffix: '',
        user_alignment_message: '',
        last_system_sequence: '',
        names_force_groups: true,
        skip_examples: false,
        system_same_as_user: false,
    };

    for (let key in defaults) {
        if (settings[key] === undefined) {
            settings[key] = defaults[key];
        }
    }
}

/**
 * Loads instruct mode settings from the given data object.
 * @param {object} data Settings data object.
 */
export function loadInstructMode(data) {
    if (data.instruct !== undefined) {
        instruct_presets = data.instruct;
    }

    migrateInstructModeSettings(power_user.instruct);

    controls.forEach(control => {
        const $element = $(`#${control.id}`);

        if (control.isCheckbox) {
            $element.prop('checked', power_user.instruct[control.property]);
        } else {
            $element.val(power_user.instruct[control.property]);
        }

        $element.on('input', function () {
            power_user.instruct[control.property] = control.isCheckbox ? !!$(this).prop('checked') : $(this).val();
            saveSettingsDebounced();
            if (!control.isCheckbox) {
                resetScrollHeight($element);
            }
        });

        if (control.trigger) {
            $element.trigger('input');
        }
    });

    instruct_presets.forEach((preset) => {
        const name = preset.name;
        const option = document.createElement('option');
        option.value = name;
        option.innerText = name;
        option.selected = name === power_user.instruct.preset;
        $('#instruct_presets').append(option);
    });

    highlightDefaultPreset();
}

function highlightDefaultPreset() {
    $('#instruct_set_default').toggleClass('default', power_user.default_instruct === power_user.instruct.preset);
}

/**
 * Select context template if not already selected.
 * @param {string} preset Preset name.
 */
export function selectContextPreset(preset) {
    // If context template is not already selected, select it
    if (preset !== power_user.context.preset) {
        $('#context_presets').val(preset).trigger('change');
        toastr.info(`Context Template: preset "${preset}" auto-selected`);
    }

    // If instruct mode is disabled, enable it, except for default context template
    if (!power_user.instruct.enabled && preset !== power_user.default_context) {
        power_user.instruct.enabled = true;
        $('#instruct_enabled').prop('checked', true).trigger('change');
        toastr.info('Instruct Mode enabled');
    }

    saveSettingsDebounced();
}

/**
 * Select instruct preset if not already selected.
 * @param {string} preset Preset name.
 */
export function selectInstructPreset(preset) {
    // If instruct preset is not already selected, select it
    if (preset !== power_user.instruct.preset) {
        $('#instruct_presets').val(preset).trigger('change');
        toastr.info(`Instruct Mode: preset "${preset}" auto-selected`);
    }

    // If instruct mode is disabled, enable it
    if (!power_user.instruct.enabled) {
        power_user.instruct.enabled = true;
        $('#instruct_enabled').prop('checked', true).trigger('change');
        toastr.info('Instruct Mode enabled');
    }

    saveSettingsDebounced();
}

/**
 * Automatically select instruct preset based on model id.
 * Otherwise, if default instruct preset is set, selects it.
 * @param {string} modelId Model name reported by the API.
 * @returns {boolean} True if instruct preset was activated by model id, false otherwise.
 */
export function autoSelectInstructPreset(modelId) {
    // If instruct mode is disabled, don't do anything
    if (!power_user.instruct.enabled) {
        return false;
    }

    // Select matching instruct preset
    let foundMatch = false;
    for (const instruct_preset of instruct_presets) {
        // If instruct preset matches the context template
        if (power_user.instruct.bind_to_context && instruct_preset.name === power_user.context.preset) {
            foundMatch = true;
            selectInstructPreset(instruct_preset.name);
            break;
        }
    }
    // If no match was found, auto-select instruct preset
    if (!foundMatch) {
        for (const preset of instruct_presets) {
            // If activation regex is set, check if it matches the model id
            if (preset.activation_regex) {
                try {
                    const regex = regexFromString(preset.activation_regex);

                    // Stop on first match so it won't cycle back and forth between presets if multiple regexes match
                    if (regex instanceof RegExp && regex.test(modelId)) {
                        selectInstructPreset(preset.name);

                        return true;
                    }
                } catch {
                    // If regex is invalid, ignore it
                    console.warn(`Invalid instruct activation regex in preset "${preset.name}"`);
                }
            }
        }

        if (power_user.instruct.bind_to_context && power_user.default_instruct && power_user.instruct.preset !== power_user.default_instruct) {
            if (instruct_presets.some(p => p.name === power_user.default_instruct)) {
                console.log(`Instruct mode: default preset "${power_user.default_instruct}" selected`);
                $('#instruct_presets').val(power_user.default_instruct).trigger('change');
            }
        }
    }

    return false;
}

/**
 * Converts instruct mode sequences to an array of stopping strings.
 * @returns {string[]} Array of instruct mode stopping strings.
 */
export function getInstructStoppingSequences() {
    /**
     * Adds instruct mode sequence to the result array.
     * @param {string} sequence Sequence string.
     * @returns {void}
     */
    function addInstructSequence(sequence) {
        // Cohee: oobabooga's textgen always appends newline before the sequence as a stopping string
        // But it's a problem for Metharme which doesn't use newlines to separate them.
        const wrap = (s) => power_user.instruct.wrap ? '\n' + s : s;
        // Sequence must be a non-empty string
        if (typeof sequence === 'string' && sequence.length > 0) {
            // If sequence is just a whitespace or newline - we don't want to make it a stopping string
            // User can always add it as a custom stop string if really needed
            if (sequence.trim().length > 0) {
                const wrappedSequence = wrap(sequence);
                // Need to respect "insert macro" setting
                const stopString = power_user.instruct.macro ? substituteParams(wrappedSequence) : wrappedSequence;
                result.push(stopString);
            }
        }
    }

    const result = [];

    if (power_user.instruct.enabled) {
        const stop_sequence = power_user.instruct.stop_sequence || '';
        const input_sequence = power_user.instruct.input_sequence?.replace(/{{name}}/gi, name1) || '';
        const output_sequence = power_user.instruct.output_sequence?.replace(/{{name}}/gi, name2) || '';
        const first_output_sequence = power_user.instruct.first_output_sequence?.replace(/{{name}}/gi, name2) || '';
        const last_output_sequence = power_user.instruct.last_output_sequence?.replace(/{{name}}/gi, name2) || '';
        const system_sequence = power_user.instruct.system_sequence?.replace(/{{name}}/gi, 'System') || '';
        const last_system_sequence = power_user.instruct.last_system_sequence?.replace(/{{name}}/gi, 'System') || '';

        const combined_sequence = `${stop_sequence}\n${input_sequence}\n${output_sequence}\n${first_output_sequence}\n${last_output_sequence}\n${system_sequence}\n${last_system_sequence}`;

        combined_sequence.split('\n').filter((line, index, self) => self.indexOf(line) === index).forEach(addInstructSequence);
    }

    if (power_user.context.use_stop_strings) {
        if (power_user.context.chat_start) {
            result.push(`\n${substituteParams(power_user.context.chat_start)}`);
        }

        if (power_user.context.example_separator) {
            result.push(`\n${substituteParams(power_user.context.example_separator)}`);
        }
    }

    return result;
}

export const force_output_sequence = {
    FIRST: 1,
    LAST: 2,
};

/**
 * Formats instruct mode chat message.
 * @param {string} name Character name.
 * @param {string} mes Message text.
 * @param {boolean} isUser Is the message from the user.
 * @param {boolean} isNarrator Is the message from the narrator.
 * @param {string} forceAvatar Force avatar string.
 * @param {string} name1 User name.
 * @param {string} name2 Character name.
 * @param {boolean|number} forceOutputSequence Force to use first/last output sequence (if configured).
 * @returns {string} Formatted instruct mode chat message.
 */
export function formatInstructModeChat(name, mes, isUser, isNarrator, forceAvatar, name1, name2, forceOutputSequence) {
    let includeNames = isNarrator ? false : power_user.instruct.names;

    if (!isNarrator && power_user.instruct.names_force_groups && (selected_group || forceAvatar)) {
        includeNames = true;
    }

    function getPrefix() {
        if (isNarrator) {
            return power_user.instruct.system_same_as_user ? power_user.instruct.input_sequence : power_user.instruct.system_sequence;
        }

        if (isUser) {
            return power_user.instruct.input_sequence;
        }

        if (forceOutputSequence === force_output_sequence.FIRST) {
            return power_user.instruct.first_output_sequence || power_user.instruct.output_sequence;
        }

        if (forceOutputSequence === force_output_sequence.LAST) {
            return power_user.instruct.last_output_sequence || power_user.instruct.output_sequence;
        }

        return power_user.instruct.output_sequence;
    }

    function getSuffix() {
        if (isNarrator) {
            return power_user.instruct.system_same_as_user ? power_user.instruct.input_suffix : power_user.instruct.system_suffix;
        }

        if (isUser) {
            return power_user.instruct.input_suffix;
        }

        return power_user.instruct.output_suffix;
    }

    let prefix = getPrefix() || '';
    let suffix = getSuffix() || '';

    if (power_user.instruct.macro) {
        prefix = substituteParams(prefix, name1, name2);
        prefix = prefix.replace(/{{name}}/gi, name || 'System');
    }

    if (!suffix && power_user.instruct.wrap) {
        suffix = '\n';
    }

    const separator = power_user.instruct.wrap ? '\n' : '';

    // Don't include the name if it's empty
    const textArray = includeNames && name ? [prefix, `${name}: ${mes}` + suffix] : [prefix, mes + suffix];
    const text = textArray.filter(x => x).join(separator);

    return text;
}

/**
 * Formats instruct mode system prompt.
 * @param {string} systemPrompt System prompt string.
 * @returns {string} Formatted instruct mode system prompt.
 */
export function formatInstructModeSystemPrompt(systemPrompt) {
    const separator = power_user.instruct.wrap ? '\n' : '';

    if (power_user.instruct.system_sequence_prefix) {
        // TODO: Replace with a proper 'System' prompt entity name input
        const prefix = power_user.instruct.system_sequence_prefix.replace(/{{name}}/gi, 'System');
        systemPrompt = prefix + separator + systemPrompt;
    }

    if (power_user.instruct.system_sequence_suffix) {
        systemPrompt = systemPrompt + separator + power_user.instruct.system_sequence_suffix;
    }

    return systemPrompt;
}

/**
 * Formats example messages according to instruct mode settings.
 * @param {string[]} mesExamplesArray Example messages array.
 * @param {string} name1 User name.
 * @param {string} name2 Character name.
 * @returns {string[]} Formatted example messages string.
 */
export function formatInstructModeExamples(mesExamplesArray, name1, name2) {
    const blockHeading = power_user.context.example_separator ? `${substituteParams(power_user.context.example_separator)}\n` : '';

    if (power_user.instruct.skip_examples) {
        return mesExamplesArray.map(x => x.replace(/<START>\n/i, blockHeading));
    }

    const includeNames = power_user.instruct.names || (!!selected_group && power_user.instruct.names_force_groups);

    let inputPrefix = power_user.instruct.input_sequence || '';
    let outputPrefix = power_user.instruct.output_sequence || '';
    let inputSuffix = power_user.instruct.input_suffix || '';
    let outputSuffix = power_user.instruct.output_suffix || '';

    if (power_user.instruct.macro) {
        inputPrefix = substituteParams(inputPrefix, name1, name2);
        outputPrefix = substituteParams(outputPrefix, name1, name2);
        inputSuffix = substituteParams(inputSuffix, name1, name2);
        outputSuffix = substituteParams(outputSuffix, name1, name2);

        inputPrefix = inputPrefix.replace(/{{name}}/gi, name1);
        outputPrefix = outputPrefix.replace(/{{name}}/gi, name2);

        if (!inputSuffix && power_user.instruct.wrap) {
            inputSuffix = '\n';
        }

        if (!outputSuffix && power_user.instruct.wrap) {
            outputSuffix = '\n';
        }
    }

    const separator = power_user.instruct.wrap ? '\n' : '';
    const formattedExamples = [];

    for (const item of mesExamplesArray) {
        const cleanedItem = item.replace(/<START>/i, '{Example Dialogue:}').replace(/\r/gm, '');
        const blockExamples = parseExampleIntoIndividual(cleanedItem);

        if (blockExamples.length === 0) {
            continue;
        }

        if (blockHeading) {
            formattedExamples.push(blockHeading);
        }

        for (const example of blockExamples) {
            // If force group/persona names is set, we should override the include names for the user placeholder
            const includeThisName = includeNames || (power_user.instruct.names_force_groups && example.name == 'example_user');

            const prefix = example.name == 'example_user' ? inputPrefix : outputPrefix;
            const suffix = example.name == 'example_user' ? inputSuffix : outputSuffix;
            const name = example.name == 'example_user' ? name1 : name2;
            const messageContent = includeThisName ? `${name}: ${example.content}` : example.content;
            const formattedMessage = [prefix, messageContent + suffix].filter(x => x).join(separator);
            formattedExamples.push(formattedMessage);
        }
    }

    if (formattedExamples.length === 0) {
        return mesExamplesArray.map(x => x.replace(/<START>\n/i, blockHeading));
    }

    return formattedExamples;
}

/**
 * Formats instruct mode last prompt line.
 * @param {string} name Character name.
 * @param {boolean} isImpersonate Is generation in impersonation mode.
 * @param {string} promptBias Prompt bias string.
 * @param {string} name1 User name.
 * @param {string} name2 Character name.
 * @param {boolean} isQuiet Is quiet mode generation.
 * @param {boolean} isQuietToLoud Is quiet to loud generation.
 * @returns {string} Formatted instruct mode last prompt line.
 */
export function formatInstructModePrompt(name, isImpersonate, promptBias, name1, name2, isQuiet, isQuietToLoud) {
    const includeNames = name && (power_user.instruct.names || (!!selected_group && power_user.instruct.names_force_groups)) && !(isQuiet && !isQuietToLoud);

    function getSequence() {
        // User impersonation prompt
        if (isImpersonate) {
            return power_user.instruct.input_sequence;
        }

        // Neutral / system / quiet prompt
        // Use a special quiet instruct sequence if defined, or assistant's output sequence otherwise
        if (isQuiet && !isQuietToLoud) {
            return power_user.instruct.last_system_sequence || power_user.instruct.output_sequence;
        }

        // Quiet in-character prompt
        if (isQuiet && isQuietToLoud) {
            return power_user.instruct.last_output_sequence || power_user.instruct.output_sequence;
        }

        // Default AI response
        return power_user.instruct.last_output_sequence || power_user.instruct.output_sequence;
    }

    let sequence = getSequence() || '';

    if (power_user.instruct.macro) {
        sequence = substituteParams(sequence, name1, name2);
        sequence = sequence.replace(/{{name}}/gi, name || 'System');
    }

    const separator = power_user.instruct.wrap ? '\n' : '';
    let text = includeNames ? (separator + sequence + separator + `${name}:`) : (separator + sequence);

    // Quiet prompt already has a newline at the end
    if (isQuiet && separator) {
        text = text.slice(separator.length);
    }

    if (!isImpersonate && promptBias) {
        text += (includeNames ? promptBias : (separator + promptBias.trimStart()));
    }

    return (power_user.instruct.wrap ? text.trimEnd() : text) + (includeNames ? '' : separator);
}

/**
 * Select context template matching instruct preset.
 * @param {string} name Preset name.
 */
function selectMatchingContextTemplate(name) {
    let foundMatch = false;
    for (const context_preset of context_presets) {
        // If context template matches the instruct preset
        if (context_preset.name === name) {
            foundMatch = true;
            selectContextPreset(context_preset.name);
            break;
        }
    }
    if (!foundMatch) {
        // If no match was found, select default context preset
        selectContextPreset(power_user.default_context);
    }
}

/**
 * Replaces instruct mode macros in the given input string.
 * @param {string} input Input string.
 * @param {Object<string, *>} env - Map of macro names to the values they'll be substituted with. If the param
 * values are functions, those functions will be called and their return values are used.
 * @returns {string} String with macros replaced.
 */
export function replaceInstructMacros(input, env) {
    if (!input) {
        return '';
    }
    const instructMacros = {
        'systemPrompt': (power_user.prefer_character_prompt && env.charPrompt ? env.charPrompt : power_user.instruct.system_prompt),
        'instructSystem|instructSystemPrompt': power_user.instruct.system_prompt,
        'instructSystemPromptPrefix': power_user.instruct.system_sequence_prefix,
        'instructSystemPromptSuffix': power_user.instruct.system_sequence_suffix,
        'instructInput|instructUserPrefix': power_user.instruct.input_sequence,
        'instructUserSuffix': power_user.instruct.input_suffix,
        'instructOutput|instructAssistantPrefix': power_user.instruct.output_sequence,
        'instructSeparator|instructAssistantSuffix': power_user.instruct.output_suffix,
        'instructSystemPrefix': power_user.instruct.system_sequence,
        'instructSystemSuffix': power_user.instruct.system_suffix,
        'instructFirstOutput|instructFirstAssistantPrefix': power_user.instruct.first_output_sequence || power_user.instruct.output_sequence,
        'instructLastOutput|instructLastAssistantPrefix': power_user.instruct.last_output_sequence || power_user.instruct.output_sequence,
        'instructStop': power_user.instruct.stop_sequence,
        'instructUserFiller': power_user.instruct.user_alignment_message,
        'instructSystemInstructionPrefix': power_user.instruct.last_system_sequence,
    };

    for (const [placeholder, value] of Object.entries(instructMacros)) {
        const regex = new RegExp(`{{(${placeholder})}}`, 'gi');
        input = input.replace(regex, power_user.instruct.enabled ? value : '');
    }

    input = input.replace(/{{exampleSeparator}}/gi, power_user.context.example_separator);
    input = input.replace(/{{chatStart}}/gi, power_user.context.chat_start);

    return input;
}

jQuery(() => {
    $('#instruct_set_default').on('click', function () {
        if (power_user.instruct.preset === power_user.default_instruct) {
            power_user.default_instruct = null;
            $(this).removeClass('default');
            toastr.info('Default instruct preset cleared');
        } else {
            power_user.default_instruct = power_user.instruct.preset;
            $(this).addClass('default');
            toastr.info(`Default instruct preset set to ${power_user.default_instruct}`);
        }

        saveSettingsDebounced();
    });

    $('#instruct_system_same_as_user').on('input', function () {
        const state = !!$(this).prop('checked');
        $('#instruct_system_sequence').prop('disabled', state);
        $('#instruct_system_suffix').prop('disabled', state);
    });

    $('#instruct_enabled').on('change', function () {
        if (!power_user.instruct.bind_to_context) {
            return;
        }

        // When instruct mode gets enabled, select context template matching selected instruct preset
        if (power_user.instruct.enabled) {
            selectMatchingContextTemplate(power_user.instruct.preset);
        } else {
            // When instruct mode gets disabled, select default context preset
            selectContextPreset(power_user.default_context);
        }
    });

    $('#instruct_presets').on('change', function () {
        const name = String($(this).find(':selected').val());
        const preset = instruct_presets.find(x => x.name === name);

        if (!preset) {
            return;
        }

        migrateInstructModeSettings(preset);

        power_user.instruct.preset = String(name);
        controls.forEach(control => {
            if (preset[control.property] !== undefined) {
                power_user.instruct[control.property] = preset[control.property];
                const $element = $(`#${control.id}`);

                if (control.isCheckbox) {
                    $element.prop('checked', power_user.instruct[control.property]).trigger('input');
                } else {
                    $element.val(power_user.instruct[control.property]).trigger('input');
                }
            }
        });

        if (power_user.instruct.bind_to_context) {
            // Select matching context template
            selectMatchingContextTemplate(name);
        }

        highlightDefaultPreset();
    });
});
