import {
  chat,
  messageFormatting,
  reloadCurrentChat,
  saveChatConditional,
  substituteParamsExtended,
  system_message_types
} from '../../../../../../script.js';
import { handlePartialRender } from '../index.js';
import { stringToRange } from '../../../../../utils.js';

/**
 * 设置指定消息楼层的消息内容和/或数据。
 *
 * @param {object} field_values - 要设置的字段值。
 * @param {string} [field_values.message] - 要设置的消息文本（可选）。
 * @param {object} [field_values.data] - 要设置的与消息关联的数据（可选）。
 * @param {number} message_id - 要设置的消息的楼层 ID。
 * @param {object} [option] - 设置选项（可选）。
 * @param {"current" | number} [option.swipe_id="current"] - 要设置的消息页 ID。
 *   - "current": 设置当前显示的消息页。
 *   - number: 设置指定索引的消息页（从 0 开始）。如果消息页不存在，将创建它。
 * @param {"none" | "display_current" | "display_and_render_current" | "all"} [option.refresh="display_and_render_current"] - 刷新选项。
 *   - "none": 不更新 UI。
 *   - "display_current": 更新当前消息的显示。
 *   - "display_and_render_current": 更新当前消息的显示并重新渲染。
 *   - "all": 重新加载整个聊天。
 * @returns {Promise<object>} - 包含操作结果的对象。
 *   - success: {boolean} - 操作是否成功。
 *   - message: {string} - 描述操作结果的消息。
 * @throws {Error} 如果 message_id 无效或选项无效。
 */
async function setChatMessage(field_values, message_id, option = {}) {
  try {
    // 设置默认选项值
    const { swipe_id = 'current', refresh = 'display_and_render_current' } = option;

    // 验证参数
    if (typeof swipe_id !== 'number' && swipe_id !== 'current') {
      throw new Error(`提供的 swipe_id 无效, 请提供 'current' 或序号, 你提供的是: ${swipe_id}`);
    }
    if (!['none', 'display_current', 'display_and_render_current', 'all'].includes(refresh)) {
      throw new Error(
        `提供的 refresh 无效, 请提供 'none', 'display_current', 'display_and_render_current' 或 'all', 你提供的是: ${refresh}`,
      );
    }

    // 获取消息
    const chat_message = chat[message_id];
    if (!chat_message) {
      throw new Error(`未找到第 ${message_id} 楼的消息`);
    }

    // 添加消息页（如果需要）
    const addSwipesIfRequired = () => {
      if (swipe_id === 'current') {
        return false; // 当前页不需要添加
      }
      // swipe_id 对应的消息页存在
      if (swipe_id == 0 || (chat_message.swipes && swipe_id < chat_message.swipes.length)) {
        return false;
      }

      if (!chat_message.swipes) {
        chat_message.swipe_id = 0;
        chat_message.swipes = [chat_message.mes];
        chat_message.swipe_info = [{}]; // 应该用swipe_info而不是variables
      }
      // 补全缺失的 swipes
      for (let i = chat_message.swipes.length; i <= swipe_id; i++) {
        chat_message.swipes.push('');
        chat_message.swipe_info.push({}); // 补全缺失的 swipe_info
      }
      return true;
    };

    const swipeIdPreviousIndex = chat_message.swipe_id ?? 0; // 旧的 swipe ID
    const swipeIdToSetIndex = swipe_id == 'current' ? swipeIdPreviousIndex : swipe_id; //要设置哪个
    const swipeIdToUseIndex = refresh != 'none' ? swipeIdToSetIndex : swipeIdPreviousIndex; //设置完后用哪个

    // 获取消息文本（如果提供了 field_values.message，则优先使用）
    const message =
      field_values.message ??
      (chat_message.swipes ? chat_message.swipes[swipeIdToSetIndex] : undefined) ??
      chat_message.mes;

    // 更新消息内容和数据
    const updateChatMessage = () => {
      const message_demacroed = substituteParamsExtended(message); // 处理消息中的宏

      if (field_values.data) {
        if (!chat_message.swipe_info) {
          chat_message.swipe_info = [];
        }
        chat_message.swipe_info[swipeIdToSetIndex] = field_values.data; // 更新数据
      }
      //更新swipes
      if (chat_message.swipes) {
        chat_message.swipes[swipeIdToSetIndex] = message_demacroed;
        chat_message.swipe_id = swipeIdToUseIndex;
      }

      if (swipeIdToUseIndex === swipeIdToSetIndex) {
        chat_message.mes = message_demacroed; // 如果设置和使用的swipe id相同，则更新主消息
      }
    };

    // 更新部分 HTML
    const updatePartialHtml = shouldUpdateSwipe => {
      const mes_html = $(`div.mes[mesid = "${message_id}"]`);
      if (!mes_html) {
        return;
      }

      if (shouldUpdateSwipe) {
        mes_html.find('.swipes-counter').text(`${swipeIdToUseIndex + 1}\u200b/\u200b${chat_message.swipes.length}`);
      }

      if (refresh !== 'none') {
        mes_html
          .find('.mes_text')
          .empty()
          .append(
            messageFormatting(message, chat_message.name, chat_message.is_system, chat_message.is_user, message_id),
          ); //更新消息

        if (refresh === 'display_and_render_current') {
          handlePartialRender(message_id); // 重新渲染
        }
      }
    };

    const shouldUpdateSwipe = addSwipesIfRequired();
    updateChatMessage();

    if (refresh === 'all') {
      await reloadCurrentChat(); // 重新加载整个聊天
    } else {
      updatePartialHtml(shouldUpdateSwipe); //更新html
      await saveChatConditional(); // 保存聊天
    }
    console.info(
      `设置第 ${message_id} 楼消息, 选项: ${JSON.stringify(
        option,
      )}, 设置前使用的消息页: ${swipeIdPreviousIndex}, 设置的消息页: ${swipeIdToSetIndex}, 现在使用的消息页: ${swipeIdToUseIndex} `,
    );

    return {
      success: true,
      message: `Message ${message_id} updated successfully.`,
    };
  } catch (error) {
    console.error('Error setting chat message:', error);
    return {
      success: false,
      message: `Error setting chat message: ${error.message}`,
    };
  }
}

/**
 * 获取指定范围和条件的消息。
 *
 * @param {string | number} range - 要获取的消息范围。
 *   - number: 单个消息 ID。
 *   - string: 范围，例如 "5-10" 或 "5-" 或 "-10"。
 * @param {object} [option] - 筛选选项。
 * @param {"all" | "system" | "assistant" | "user"} [option.role="all"] - 消息角色。
 * @param {"all" | "hidden" | "unhidden"} [option.hide_state="all"] - 隐藏状态。
 * @returns {Promise<object>} - 包含消息数组和状态信息的对象。
 *   - success: {boolean} - 操作是否成功。
 *   - message: {string} - 描述操作结果的消息。
 *   - chatMessages: {ChatMessage[]} - 消息数组（仅在成功时提供）。
 * @throws {Error} 如果 range 或 option 无效。
 */
async function getChatMessages(range, option = {}) {
  try {
    const { role = 'all', hide_state = 'all' } = option;

    // 验证参数
    if (!['all', 'system', 'assistant', 'user'].includes(role)) {
      throw new Error(`提供的 role 无效, 请提供 'all', 'system', 'assistant' 或 'user', 你提供的是: ${role}`);
    }
    if (!['all', 'hidden', 'unhidden'].includes(hide_state)) {
      throw new Error(`提供的 hide_state 无效, 请提供 'all', 'hidden' 或 'unhidden', 你提供的是: ${hide_state}`);
    }

    const range_demacroed = substituteParamsExtended(String(range)); // 处理可能的宏
    const parsedRange = stringToRange(range_demacroed, 0, chat.length - 1);

    if (!parsedRange) {
      throw new Error(`提供的消息范围 range 无效: ${range_demacroed}`);
    }

    const { start, end } = parsedRange;

    // 获取消息的角色
    const getRole = chat_message => {
      const is_narrator = chat_message.extra?.type === system_message_types.NARRATOR;
      if (is_narrator) {
        if (chat_message.is_user) {
          return 'unknown'; // 如果是叙述者且 is_user 为 true，则返回 'unknown'
        }
        return 'system';
      }
      return chat_message.is_user ? 'user' : 'assistant';
    };

    // 处理单个消息
    const processMessage = async message_id => {
      const chat_message = chat[message_id];
      if (!chat_message) {
        console.warn(`没找到第 ${message_id} 楼的消息`);
        return null; // 如果找不到消息，返回 null
      }

      const messageRole = getRole(chat_message);
      if (role !== 'all' && messageRole !== role) {
        return null; // 按角色筛选
      }

      if (hide_state !== 'all' && (hide_state === 'hidden') !== chat_message.is_system) {
        return null; // 按隐藏状态筛选
      }

      const swipe_id = chat_message?.swipe_id ?? 0;
      const swipes = chat_message?.swipes ?? [chat_message.mes];
      //const swipes_data = chat_message?.variables ?? []; //原始的
      const swipes_data = chat_message?.swipe_info ?? []; //修改为swipe_info
      const data = swipes_data[swipe_id] ?? {};

      return {
        message_id: message_id,
        name: chat_message.name,
        role: messageRole,
        is_hidden: chat_message.is_system,
        message: chat_message.mes,
        data: data,
        swipe_id: swipe_id,
        swipes: swipes,
        swipes_data: swipes_data,
        is_user: chat_message.is_user, // 增加这个字段
        is_system_or_hidden: chat_message.is_system, //增加这个字段
      };
    };

    const promises = [];
    for (let i = start; i <= end; i++) {
      promises.push(processMessage(i));
    }

    const chatMessages = (await Promise.all(promises)).filter(message => message !== null);

    return {
      success: true,
      message: `Retrieved messages from ${start} to ${end} successfully.`,
      chatMessages: chatMessages,
    };
  } catch (error) {
    console.error('Error getting chat messages:', error);
    return {
      success: false,
      message: `Error getting chat messages: ${error.message}`,
    };
  }
}

export { getChatMessages, setChatMessage };
