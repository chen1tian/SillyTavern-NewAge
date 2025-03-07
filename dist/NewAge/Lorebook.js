import { assignPartialLorebookSettings } from '../iframe_server/lorebook.js';
import {
  characters,
  getOneCharacter,
  getRequestHeaders,
  saveCharacterDebounced,
  saveSettings,
  saveSettingsDebounced,
  this_chid,
} from '../../../../../../script.js';
import { selected_group } from '../../../../../group-chats.js';
import { ensureImageFormatSupported, getCharaFilename } from '../../../../../utils.js';
import {
  createNewWorldInfo,
  deleteWorldInfo,
  getWorldInfoSettings,
  selected_world_info,
  setWorldInfoButtonClass,
  world_info,
  world_names,
} from '../../../../../world-info.js';

/**
 * 启用或禁用指定的 Lorebooks。
 *
 * @param {string[]} lorebooksToModify - 要启用或禁用的 Lorebook 名称数组。
 * @param {boolean} enable - true 表示启用，false 表示禁用。
 * @param {string[]} [currentSelectedLorebooks] - 当前已选择的 Lorebooks 数组。如果未提供，将使用 world_names 作为默认值。
 */
function modifyLorebookStatus(lorebooksToModify, enable, currentSelectedLorebooks) {
  try {
    if (!currentSelectedLorebooks) {
      currentSelectedLorebooks = world_names;
    }

    const updatedLorebooks = enable
      ? [...new Set([...currentSelectedLorebooks, ...lorebooksToModify])]
      : currentSelectedLorebooks.filter(book => !lorebooksToModify.includes(book));

    assignPartialLorebookSettings({ selected_global_lorebooks: updatedLorebooks });

    return {
      success: true,
      message: `Lorebooks ${enable ? 'enabled' : 'disabled'} successfully.`,
      updatedLorebooks: updatedLorebooks,
    };
  } catch (error) {
    console.error('Error modifying Lorebook status:', error);
    return {
      success: false,
      message: `Error modifying Lorebooks: ${error.message}`,
    };
  }
}

/**
 * 获取所有 Lorebook 的名称列表。
 *
 * @async
 * @returns {Promise<string[]>} - 包含所有 Lorebook 名称的数组。
 * @throws {Error} - 如果在获取 Lorebook 列表时发生错误。
 */
async function getLorebooks() {
  try {
    return {
      success: true,
      message: 'Lorebook list retrieved successfully.',
      lorebooks: world_names,
    };
  } catch (error) {
    console.error('Error getting Lorebook list:', error);
    return {
      success: false,
      message: `Error getting Lorebook list: ${error.message}`,
    };
  }
}

/**
 * 将世界信息设置对象转换为 Lorebook 设置对象。
 *
 * @param {object} world_info_settings - 世界信息设置对象。
 * @returns {object} - 包含 Lorebook 设置和状态信息的对象。
 *   - success: {boolean} - 操作是否成功。
 *   - message: {string} - 描述操作结果的消息。
 *   - lorebookSettings: {object} - 转换后的 Lorebook 设置对象（仅在成功时提供）。
 */
function toLorebookSettings(world_info_settings) {
    try {
        const lorebookSettings = {
            selected_global_lorebooks: world_info_settings.world_info.globalSelect,
            scan_depth: world_info_settings.world_info_depth,
            context_percentage: world_info_settings.world_info_budget,
            budget_cap: world_info_settings.world_info_budget_cap,
            min_activations: world_info_settings.world_info_min_activations,
            max_depth: world_info_settings.world_info_min_activations_depth_max,
            max_recursion_steps: world_info_settings.world_info_max_recursion_steps,
            insertion_strategy: ({ 0: 'evenly', 1: 'character_first', 2: 'global_first' }[world_info_settings.world_info_character_strategy]),
            include_names: world_info_settings.world_info_include_names,
            recursive: world_info_settings.world_info_recursive,
            case_sensitive: world_info_settings.world_info_case_sensitive,
            match_whole_words: world_info_settings.world_info_match_whole_words,
            use_group_scoring: world_info_settings.world_info_use_group_scoring,
            overflow_alert: world_info_settings.world_info_overflow_alert,
        };
        return {
            success: true,
            message: "World info settings converted to Lorebook settings successfully.",
            lorebookSettings: lorebookSettings,
        };
    }
    catch (error) {
        console.error("Error converting to Lorebook settings:", error);
        return {
            success: false,
            message: `Error converting to Lorebook settings: ${error.message}`,
        };
    }
}
/**
 * 应用部分 Lorebook 设置。
 *
 * @param {object} settings - 要应用的 Lorebook 设置对象。
 * @returns {object} - 包含操作结果的对象。
 *   - success: {boolean} - 操作是否成功。
 *   - message: {string} - 描述操作结果的消息。
 */
function AssignPartialLorebookSettings(settings) {
  try {
    const for_eachs = {
      selected_global_lorebooks: (value) => {
        $('#world_info').find('option[value!=""]').remove();
        world_names.forEach((item, i) => $('#world_info').append(`<option value='${i}'${value.includes(item) ? ' selected' : ''}>${item}</option>`));
        selected_world_info.length = 0;
        selected_world_info.push(...value);
        saveSettings();
      },
      scan_depth: (value) => {
        $('#world_info_depth').val(value).trigger('input');
      },
      context_percentage: (value) => {
        $('#world_info_budget').val(value).trigger('input');
      },
      budget_cap: (value) => {
        $('#world_info_budget_cap').val(value).trigger('input');
      },
      min_activations: (value) => {
        $('#world_info_min_activations').val(value).trigger('input');
      },
      max_depth: (value) => {
        $('#world_info_min_activations_depth_max').val(value).trigger('input');
      },
      max_recursion_steps: (value) => {
        $('#world_info_max_recursion_steps').val(value).trigger('input');
      },
      insertion_strategy: (value) => {
        const converted_value = { 'evenly': 0, 'character_first': 1, 'global_first': 2 }[value];
        $(`#world_info_character_strategy option[value='${converted_value}']`).prop('selected', true);
        $('#world_info_character_strategy').val(converted_value).trigger('change');
      },
      include_names: (value) => {
        $('#world_info_include_names').prop('checked', value).trigger('input');
      },
      recursive: (value) => {
        $('#world_info_recursive').prop('checked', value).trigger('input');
      },
      case_sensitive: (value) => {
        $('#world_info_case_sensitive').prop('checked', value).trigger('input');
      },
      match_whole_words: (value) => {
        $('#world_info_match_whole_words').prop('checked', value).trigger('input');
      },
      use_group_scoring: (value) => {
        $('#world_info_use_group_scoring').prop('checked', value).trigger('change');
      },
      overflow_alert: (value) => {
        $('#world_info_overflow_alert').prop('checked', value).trigger('change');
      },
    };

     // 检查 selected_global_lorebooks 中的 Lorebooks 是否存在
     if (settings.selected_global_lorebooks) {
        const inexisting_lorebooks = settings.selected_global_lorebooks.filter(lorebook => !world_names.includes(lorebook));
        if (inexisting_lorebooks.length > 0) {
            throw new Error(`Attempted to modify globally enabled Lorebooks, but the following Lorebooks were not found: ${inexisting_lorebooks}`);
        }
    }

    Object.entries(settings)
      .filter(([_, value]) => value !== undefined)
      .forEach(([field, value]) => {
        for_eachs[field]?.(value);
      });

    return {
      success: true,
      message: "Lorebook settings applied successfully.",
    };
  } catch (error) {
    console.error("Error applying Lorebook settings:", error);
    return {
      success: false,
      message: `Error applying Lorebook settings: ${error.message}`,
    };
  }
}

export { modifyLorebookStatus, getLorebooks, toLorebookSettings, AssignPartialLorebookSettings };
