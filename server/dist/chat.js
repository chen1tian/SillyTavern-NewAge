// server/dist/chat.js

import { NAMESPACES, MSG_TYPE, MEMBER_STATUS } from '../lib/constants.js'; // 导入常数
import * as Rooms from './Rooms.js'; //导入Rooms.js
import { v4 as uuidv4 } from 'uuid';
import { logger, error, warn, info } from './logger.js';
import { MemberManagement } from './memberManagement.js';
import { RelationsManage } from './relationsManage.js';
import { RoomManagement } from './roomManagement.js';
import { VALID_ROOM_MODES } from './roomManagement.js'; // 导入有效模式列表

import { EventEmitter } from 'events';

var event = new EventEmitter();

/**
 * @class ChatModule
 * @description 聊天核心协调模块。负责管理 LLM 请求/响应流程、消息处理、上下文构建、
 *              分页发送，并协调 MemberManagement, RoomManagement, RelationsManage 模块。
 *              房间本身的具体管理（成员、角色、创建、删除）委托给 RoomManagement。
 *              请求消息队列由 RoomManagement 管理，响应消息队列由本模块管理。
 */
class ChatModule {
  /**
   * @constructor
   * @param {import('socket.io').Server} io - Socket.IO 服务器实例。
   * @param {object} [serverSettings={}] - 服务器设置对象。
   */
  constructor(io, serverSettings = {}) {
    /** @type {import('socket.io').Server} io - Socket.IO 服务器实例 */
    this.io = io;

    // --- 核心数据结构 ---
    /**
     * @property {object} llmRequests - 追踪 LLM 请求的映射。键是 requestId，值包含请求元数据。
     * @example { [requestId]: { originalClient: string, room: string, target: string | string[], responses: string[], completed: boolean, responseCount: number } }
     */
    this.llmRequests = {};

    /**
     * @property {object} guestRequestQueues - 在 'HostSubmit' 模式下，缓存 guest/special 请求的队列。键是 roomName。
     * @example { [roomName]: LLMRequest[] }
     */
    this.guestRequestQueues = {};

    /**
     * @property {object} llmResponseQueues - 存储 LLM 响应消息的队列。键是 roomName。
     * @example { [roomName]: LLMResponse[] }
     */
    this.llmResponseQueues = {}; // LLM 响应消息队列保留在 ChatModule

    /** @property {object} conversationalTimers - 存储 Conversational 模式下各房间后台思考的计时器信息。 */
    this.conversationalTimers = {};
    /** @property {number} thinkingProbability - Conversational 模式下每次检查时触发思考的概率。 */
    this.thinkingProbability = serverSettings.conversationalThinkProbability || 0.3;
    /** @property {number} thinkIntervalMin - Conversational 模式下最小思考间隔（毫秒）。 */
    this.thinkIntervalMin = serverSettings.conversationalThinkIntervalMin || 15000;
    /** @property {number} thinkIntervalMax - Conversational 模式下最大思考间隔（毫秒）。 */
    this.thinkIntervalMax = serverSettings.conversationalThinkIntervalMax || 60000;

    // --- 实例化依赖模块 ---
    /** @property {MemberManagement} memberManagement - 成员管理实例。 */
    this.memberManagement = new MemberManagement(io, this); // MemberManagement 需要 io 和 chatModule (间接访问 RoomManagement)
    /** @property {RoomManagement} roomManagement - 房间管理实例。 */
    this.roomManagement = new RoomManagement(io, this.memberManagement); // RoomManagement 需要 io 和 memberManagement
    /** @property {RelationsManage} relationsManage - 客户端与扩展关系管理实例。 */
    this.relationsManage = new RelationsManage(io);

    // --- 启动后台任务 ---
    // 启动 Conversational 模式的后台思考检查循环 (基础示例)
    setInterval(() => {
      this._checkConversationalRooms();
    }, serverSettings.conversationalCheckInterval || 5000); // 每隔配置的时间检查一次
    info('ChatModule initialized.', {}, 'INIT');

    event.on('clear_conversational_timer', (roomName) => this.clearConversationalTimerForRoom(roomName));

    event.on('system_message', (roomName, messageText) => {
      this.addSystemMessage(roomName, messageText);
    });
  }

  // --- 消息处理核心方法 ---

  /**
   * 广播增量消息事件给指定房间。
   * @function _broadcastIncrementalUpdate
   * @param {string} roomName - 房间名。
   * @param {string} eventType - 事件类型 (e.g., MSG_TYPE.NEW_MESSAGE)。
   * @param {object} data - 事件数据。
   * @private
   */
  _broadcastIncrementalUpdate(roomName, eventType, data) {
    const roomInfo = this.roomManagement.getRoomInfo(roomName);
    if (!roomInfo) {
      warn(`Attempting to broadcast incremental update to non-existent room ${roomName}`, { eventType }, 'INCREMENTAL_WARN');
      return;
    }
    // 广播给房间内的所有成员 + 分配给该房间的扩展端
    const targets = new Set(this.roomManagement.getRoomMembers(roomName) || []);
    const extensions = this.relationsManage.getAssignmentsForRoom(roomName) || [];
    extensions.forEach(ext => targets.add(ext));

    if (targets.size > 0) {
      const payload = { roomName, ...data }; // 附加 roomName
      let emitChain = this.io.of(NAMESPACES.LLM); // 使用 LLM 命名空间
      targets.forEach(targetId => emitChain = emitChain.to(targetId));
      emitChain.emit(eventType, payload);
      debug(`Broadcast incremental update ${eventType} to room ${roomName}`, { targets: Array.from(targets).length }, 'INCREMENTAL_BCAST');
    }
  }

  /**
   * 添加消息到相应的队列。请求消息委托给 RoomManagement，响应消息添加到本模块的队列。
   * @function addMessage
   * @param {string} roomName - 房间名。
   * @param {object} message - 消息对象，应包含 identity (除非是 LLM 响应)。
   * @param {boolean} fromLlm - 是否为 LLM 的响应消息。
   * @returns {string | null} - 成功则返回消息 ID (messageId 或 responseId)，失败则返回 null。
   */
  addMessage(roomName, message, fromLlm) {
    const messageId = uuidv4(); // 所有消息都有一个唯一 ID
    const timestamp = new Date();

    let successId = null;
    let messageToSend = null;

    if (fromLlm) {
      // 处理 LLM 响应消息
      const responseId = message.responseId || messageId; // 优先使用已有的 responseId
      const fullResponse = {
        ...message,
        messageId: messageId, // 通用唯一 ID
        responseId: responseId, // LLM 响应的特定 ID
        identity: message.identity || 'UnknownLLM', // 确保有发送者标识
        timestamp: timestamp,
        isResponse: true,
      };
      // 添加到本模块的响应队列
      if (!this.llmResponseQueues[roomName]) this.llmResponseQueues[roomName] = [];
      this.llmResponseQueues[roomName].push(fullResponse);
      successId = responseId;
      messageToSend = fullResponse;
      debug(`Added LLM response ${responseId} to queue for room ${roomName}.`, {}, 'ADD_MSG_LLM');
    } else {
      const messageId = uuidv4();
      // 处理客户端请求消息
      if (!message.identity) {
        warn(`Client message added without identity in room ${roomName}`, { message }, 'ADD_MSG_WARN');
        // 可以补充默认值或拒绝
        message.identity = 'UnknownClient';
      }
      const fullRequest = {
        ...message,
        messageId: messageId, // 请求消息的唯一 ID
        identity: message.identity, // 确保有发送者标识
        timestamp: timestamp,
        fromClient: true,
      };
      const added = this.roomManagement.addRequestMessage(roomName, fullRequest);
      if (added) {
        successId = messageId;
        messageToSend = fullRequest;
        debug(`Added client request ${successId} to queue for room ${roomName}.`, {}, 'ADD_MSG_CLIENT');
      } else {
        error(`Failed to add client request via RoomManagement for room ${roomName}.`, {}, 'ADD_MSG_ERROR');
        return null;
      }

      if (successId && messageToSend) {
        this._broadcastIncrementalUpdate(roomName, MSG_TYPE.NEW_MESSAGE, {
          message: messageToSend // 发送完整的消息对象
        });
      }
    }
    return successId;
  }

  /**
   * 添加系统消息到房间的请求队列。
   * @param {string} roomName
   * @param {string} messageText - 系统消息内容。
   * @returns {string | null} - messageId 或 null。
   */
  addSystemMessage(roomName, messageText) {
    const systemMessage = {
      messageId: uuidv4(),
      identity: 'System', // 特殊标识
      role: 'system',     // 特殊角色
      data: messageText,
      timestamp: new Date(),
      isSystem: true,    // 标记为系统消息
      fromClient: false, // 不是来自客户端
    };
    // 委托给 RoomManagement 添加
    const success = this.roomManagement.addRequestMessage(roomName, systemMessage);
    if (success) {
      debug(`Added system message to room ${roomName}: "${messageText}"`, {}, 'ADD_MSG_SYSTEM');
      // 广播新消息事件，让客户端也能看到系统消息
      this._broadcastIncrementalUpdate(roomName, MSG_TYPE.NEW_MESSAGE, { message: systemMessage });
      return systemMessage.messageId;
    } else {
      error(`Failed to add system message via RoomManagement for room ${roomName}.`, {}, 'ADD_MSG_ERROR');
      return null;
    }
  }

  /**
   * 编辑消息并广播 MESSAGE_UPDATED 事件。
   * @function editMessage
   * @param {string} roomName
   * @param {string} messageId - 通用唯一 ID。
   * @param {object} updatedFields
   * @param {boolean} fromLlm
   * @returns {boolean} 是否成功。
   */
  editMessage(roomName, messageId, updatedFields, fromLlm) {
    let success = false;
    let updatedMessage = null;

    if (fromLlm) {
      const queue = this.llmResponseQueues[roomName];
      const messageIndex = queue?.findIndex(msg => msg.messageId === messageId);
      if (messageIndex !== -1) {
        queue[messageIndex] = { ...queue[messageIndex], ...updatedFields, lastEdited: new Date() };
        updatedMessage = queue[messageIndex]; // 获取更新后的完整消息
        success = true;
        info(`Edited LLM response message ${messageId} in room ${roomName}.`, {}, 'EDIT_MSG');
      } else {
        warn(`LLM response message ${messageId} not found in room ${roomName} for editing.`, {}, 'EDIT_MSG_WARN');
      }
    } else {
      // 请求消息通过 RoomManagement 编辑
      updatedMessage = this.roomManagement.editRequestMessage(roomName, messageId, updatedFields); // 让 editRequestMessage 返回更新后的消息对象或 null
      if (updatedMessage) {
        success = true;
        info(`Edited client request message ${messageId} in room ${roomName}.`, {}, 'EDIT_MSG');
      } else {
        warn(`Client request message ${messageId} not found or failed to edit in room ${roomName}.`, {}, 'EDIT_MSG_WARN');
      }
    }
    if (success && updatedMessage) {
      this._broadcastIncrementalUpdate(roomName, MSG_TYPE.MESSAGE_UPDATED, {
        message: updatedMessage // 发送更新后的完整消息对象
      });
    }

    return success;
  }


  /**
   * 删除消息并广播 MESSAGES_DELETED 事件。
   * @function deleteMessage
   * @param {string} roomName
   * @param {string | string[]} messageIds - 通用唯一 ID 列表。
   * @returns {boolean} 是否至少删除了一个。
   */
  deleteMessage(roomName, messageIds) {
    const idsToDelete = Array.isArray(messageIds) ? messageIds : [messageIds];
    if (idsToDelete.length === 0) return false;

    let deletedIdsList = []; // 存储实际被删除的 ID

    // 从请求队列删除
    const deletedFromRequests = this.roomManagement.deleteRequestMessages(roomName, idsToDelete);
    if (deletedFromRequests > 0) {
      // RoomManagement 应该返回被删除的 ID 列表，或者我们在这里重新计算
      // 假设 deleteRequestMessages 返回数量，我们需要找出哪些 ID 属于请求
      // 为了简化，我们直接添加 idsToDelete 中的所有 ID 到广播列表，客户端需要能处理冗余
      // deletedIdsList.push(...idsToDelete); // 简单做法
      info(`Deleted ${deletedFromRequests} request message(s) for room ${roomName}.`, { ids: idsToDelete }, 'DELETE_MSG');
    }

    // 从响应队列删除
    const responseQueue = this.llmResponseQueues[roomName];
    let deletedFromResponsesCount = 0;
    if (responseQueue) {
      const initialLength = responseQueue.length;
      const idsSet = new Set(idsToDelete);
      const originalQueue = [...responseQueue]; // 备份用于查找被删除的 ID
      this.llmResponseQueues[roomName] = responseQueue.filter(msg => !idsSet.has(msg.messageId));
      deletedFromResponsesCount = initialLength - this.llmResponseQueues[roomName].length;

      if (deletedFromResponsesCount > 0) {
        // 找出实际从响应队列删除的 ID
        originalQueue.forEach(msg => {
          if (idsSet.has(msg.messageId) && !this.llmResponseQueues[roomName].some(m => m.messageId === msg.messageId)) {
            deletedIdsList.push(msg.messageId);
          }
        });
        info(`Deleted ${deletedFromResponsesCount} response message(s) for room ${roomName}.`, { ids: idsToDelete }, 'DELETE_MSG');
      }
    }

    // 去重，确保 ID 唯一
    deletedIdsList = [...new Set(deletedIdsList)];

    // *** 核心改动：广播删除事件 ***
    if (deletedIdsList.length > 0) {
      this._broadcastIncrementalUpdate(roomName, MSG_TYPE.MESSAGES_DELETED, {
        messageIds: deletedIdsList // 发送实际被删除的 ID 列表
      });
    }

    // *** 移除或注释掉这里的完整上下文发送 ***
    // if (deletedIdsList.length > 0) {
    //   this.sendFullContextToRoomMembers(roomName);
    //   this.sendFullContextToExtensions(...);
    // }

    return deletedIdsList.length > 0; // 返回是否删除了任何消息
  }

  /**
   * 清空指定房间的消息队列。
   * @function clearMessages
   * @param {string} roomName - 房间名。
   * @param {boolean} [clearRequests=true] - 是否清空请求消息队列。
   * @param {boolean} [clearResponses=true] - 是否清空响应消息队列。
   * @returns {boolean} 是否成功清空了至少一个队列。
   */
  clearMessages(roomName, clearRequests = true, clearResponses = true) {
    let success = false;
    let requestsCleared = false;
    let responsesCleared = false;

    if (clearRequests) {
      if (this.roomManagement.clearRequestMessages(roomName)) {
        requestsCleared = true; success = true;
      }
    }
    if (clearResponses) {
      if (this.llmResponseQueues[roomName]?.length > 0) {
        this.llmResponseQueues[roomName] = [];
        responsesCleared = true; success = true;
      }
    }

    if (success) {
      info(`Messages cleared for room ${roomName}. Requests: ${requestsCleared}, Responses: ${responsesCleared}.`, {}, 'CLEAR_MSG');

      this._broadcastIncrementalUpdate(roomName, MSG_TYPE.MESSAGES_CLEARED, {
        clearedRequests: requestsCleared,
        clearedResponses: responsesCleared
      });
    }
    return success;
  }

  // --- 上下文构建与发送 ---

  /**
   * 处理客户端请求完整上下文的事件。
   * @function handleGetFullContextRequest
   * @param {import('socket.io').Socket} socket - 发起请求的 Socket 实例。
   * @param {object} data - 请求数据，应包含 roomName。
   */
  async handleGetFullContextRequest(socket, data) {
    const requestingIdentity = socket.handshake.auth.clientId;
    const roomName = data?.roomName;
    const started = null;
    if (!roomName) {
      warn(`Client ${requestingIdentity} requested full context without specifying roomName.`, {}, 'GET_CONTEXT_WARN');
      socket.emit(MSG_TYPE.ERROR, { message: 'roomName is required.' });
      return;
    }

    // getOfflineMessages 内部包含权限检查和分页发送逻辑
    try {
      started = await this.getOfflineMessages(socket, roomName);
    } catch (error) {
      error(`Failed to get Offline-Messages.`, { error }, 'GET_CONTEXT_FAIL')
    }

    if (!started) {
      // 错误已在 getOfflineMessages 内部发送给 socket
      info(`Failed to start sending full context for room ${roomName} to ${requestingIdentity}.`, {}, 'GET_CONTEXT_FAIL');
    } else {
      info(`Started sending full context for room ${roomName} to ${requestingIdentity}.`, {}, 'GET_CONTEXT_START');
    }
  }

  /**
   * 构建指定房间的完整聊天上下文（合并请求和响应并排序）。
   * @function buildFullContext
   * @param {string} roomName - 房间名。
   * @returns {object[] | null} - 按时间戳排序的完整消息数组，如果无法构建则返回 null。
   */
  buildFullContext(roomName) {
    // 从 RoomManagement 获取请求消息
    const messageQueue = this.roomManagement.getRequestMessages(roomName);
    // 从本模块获取响应消息
    const responseQueue = this.llmResponseQueues[roomName] || [];

    if (messageQueue === null && responseQueue.length === 0) {
      // 房间不存在且没有响应队列
      warn(`Cannot build context for non-existent room ${roomName}.`, {}, 'BUILD_CTX_WARN');
      return null;
    }

    // 合并排序
    const fullContext = [...(messageQueue || []), ...responseQueue].sort(
      (a, b) => (a.timestamp?.getTime() || 0) - (b.timestamp?.getTime() || 0)
    );

    return fullContext;
  }

  /**
   * 将上下文分页发送给指定的目标 (通用内部方法)。
   * @function _sendPaginatedContext
   * @param {string | string[] | import('socket.io').Socket} targets - 发送目标。
   * @param {string} roomName - 上下文所属的房间名。
   * @param {object[]} fullContext - 要发送的完整上下文。
   * @private
   * @async
   */
  async _sendPaginatedContext(targets, roomName, fullContext) {
    // ... (分页逻辑实现保持不变，如上一版本所示) ...
    if (!targets || (Array.isArray(targets) && targets.length === 0)) return;
    const CONTEXT_PAGE_SIZE = serverSettings.contextPageSize || 50;
    const CONTEXT_SEND_DELAY = serverSettings.contextSendDelay || 100;
    const totalMessages = fullContext ? fullContext.length : 0;
    const updateId = uuidv4();
    let emitTarget;
    // --- 确定发送目标 ---
    if (typeof targets === 'string') { emitTarget = this.io.of(NAMESPACES.LLM).to(targets); }
    else if (Array.isArray(targets)) { emitTarget = this.io.of(NAMESPACES.LLM); targets.forEach(t => emitTarget = emitTarget.to(t)); }
    else if (targets && typeof targets.emit === 'function') { emitTarget = targets; }
    else { warn('Invalid targets for _sendPaginatedContext.', { targets }); return; }
    // --- 处理空上下文 ---
    if (totalMessages === 0) {
      const pageData = { updateId, roomName, pageNumber: 1, totalPages: 1, isLastPage: true, contextPage: [] };
      emitTarget.emit(MSG_TYPE.UPDATE_CONTEXT_PAGE, pageData);
      info(`Sent empty context page for room ${roomName} to targets.`, { updateId, targetType: typeof targets }, 'CONTEXT_PAGING');
      return;
    }
    // --- 计算并发送分页 ---
    const totalPages = Math.ceil(totalMessages / CONTEXT_PAGE_SIZE);
    info(`Paginating context for room ${roomName} to targets. Pages: ${totalPages}`, { updateId }, 'CONTEXT_PAGING');
    for (let i = 0; i < totalPages; i++) {
      const pageNumber = i + 1;
      const startIndex = i * CONTEXT_PAGE_SIZE;
      const endIndex = startIndex + CONTEXT_PAGE_SIZE;
      const contextPage = fullContext.slice(startIndex, endIndex);
      const isLastPage = (pageNumber === totalPages);
      const pageData = { updateId, roomName, pageNumber, totalPages, isLastPage, contextPage };

      emitTarget.emit(MSG_TYPE.UPDATE_CONTEXT_PAGE, pageData);
      // info(`Sent context page ${pageNumber}/${totalPages} for room ${roomName} to targets.`, { updateId, targetType: typeof targets }, 'CONTEXT_PAGING'); // 日志可能过多

      if (!isLastPage && CONTEXT_SEND_DELAY > 0) {
        await new Promise(resolve => setTimeout(resolve, CONTEXT_SEND_DELAY));
      }
    }
    info(`Finished sending all ${totalPages} context pages for room ${roomName} to targets.`, { updateId, targetType: typeof targets }, 'CONTEXT_PAGING');
  }

  /**
   * 将完整上下文（分页）发送给指定房间的所有成员。
   * @function sendFullContextToRoomMembers
   * @param {string} roomName - 房间名。
   * @async
   */
  async sendFullContextToRoomMembers(roomName) {
    const members = this.roomManagement.getRoomMembers(roomName); // 使用 RoomManagement 获取成员
    if (!members || members.length === 0) return;
    const fullContext = this.buildFullContext(roomName);
    if (fullContext === null) return;
    try {
      await this._sendPaginatedContext(members, roomName, fullContext);
    } catch (error) {
      error(`Failed to send Paginated Context`, { error }, 'CONTEXT_PAGING')
      return;
    }
  }

  /**
   * 将完整上下文（分页）发送给指定的 SillyTavern 扩展端 (带权限检查)。
   * @function sendFullContextToExtensions
   * @param {string} requestingRoomName - 发起请求的房间名 (用于权限检查)。
   * @param {string | string[]} targetExtensions - 目标扩展的 identity (或数组)。
   * @param {string} contextRoomName - 上下文所属的房间名。
   * @async
   */
  async sendFullContextToExtensions(requestingRoomName, targetExtensions, contextRoomName) {
    if (!targetExtensions || (Array.isArray(targetExtensions) && targetExtensions.length === 0)) return;
    if (!contextRoomName) { warn(`contextRoomName required for sendFullContextToExtensions.`); return; }
    // --- 权限检查 ---
    const allowedExtensions = this.relationsManage.getAssignmentsForRoom(requestingRoomName);
    const targetsToSend = (Array.isArray(targetExtensions) ? targetExtensions : [targetExtensions])
      .filter(targetExt => {
        if (allowedExtensions && allowedExtensions.includes(targetExt)) return true;
        warn(`Room ${requestingRoomName} denied sending context to ${targetExt}.`); return false;
      });
    if (targetsToSend.length === 0) return;
    // --- 获取并发送上下文 ---
    const fullContext = this.buildFullContext(contextRoomName);
    if (fullContext === null) return;
    try {
      await this._sendPaginatedContext(targetsToSend, contextRoomName, fullContext);
    } catch (error) {
      error(`Failed to send Paginated Context`, { error }, 'CONTEXT_PAGING')
      return;
    }
  }

  /**
   * 合并多个消息对象，按照时间戳顺序将它们的 'data' 字段（假设为字符串）连接起来。
   * 使用最后一个消息（通常是触发合并的 master 请求）的其他元数据作为基础。
   * @param {object[]} messages - 要合并的消息对象数组。每个对象应至少包含 'timestamp' 和 'data' 字段。
   * @returns {object | null} - 合并后的新消息对象；如果输入数组为空或无效，则返回 null。
   */
  mergeMessages(messages) {
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      warn('Attempted to merge an empty or invalid message array.', {}, 'MERGE_MESSAGES_WARN');
      return null;
    }

    // 1. 按时间戳排序 (确保是升序，即最早的消息在前)
    const sortedMessages = [...messages].sort((a, b) => {
      // 提供更健壮的时间戳比较，处理 Date 对象或数字时间戳
      const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : (typeof a.timestamp === 'number' ? a.timestamp : 0);
      const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : (typeof b.timestamp === 'number' ? b.timestamp : 0);
      if (isNaN(timeA) || isNaN(timeB)) {
        warn('Invalid timestamp found during message merge.', { a, b }, 'MERGE_MESSAGES_WARN');
        return 0; // 如果时间戳无效，保持原始顺序（或根据需要处理）
      }
      return timeA - timeB;
    });

    // 2. 提取并连接 'data' 字段 (假设 data 是字符串)
    const combinedData = sortedMessages
      .map(msg => {
        // 从消息中提取文本内容，进行一些基本的清理
        let text = '';
        if (msg.data && typeof msg.data === 'string') {
          text = msg.data.trim();
        } else if (msg.data && typeof msg.data === 'object' && typeof msg.data.text === 'string') {
          // 尝试兼容 data 是一个包含 text 属性的对象的情况
          text = msg.data.text.trim();
        }
        // 可以选择性地添加发送者信息 (如果需要的话)
        // text = `[${msg.role || msg.clientId}]: ${text}`;
        return text;
      })
      .filter(text => text.length > 0) // 过滤掉空消息
      .join('\n\n'); // 使用双换行符分隔不同的消息，便于 LLM 理解

    // 3. 获取最后一个消息作为元数据的基础 (通常是 master 请求)
    // 如果排序后最后一个消息不存在（理论上不会发生，因为我们检查了数组长度），则取第一个
    const baseMessage = sortedMessages[sortedMessages.length - 1] || sortedMessages[0];

    // 4. 创建新的合并消息对象
    const mergedMessage = {
      // 复制基础消息的所有元数据 (requestId, target, role 等)
      ...baseMessage,
      // 使用合并后的数据替换原始 data 字段
      data: combinedData,
      // 使用最后一个消息的时间戳，代表合并完成的时间点
      timestamp: baseMessage.timestamp,
      // (可选) 添加标记表明这是一个合并后的消息及其来源
      isMerged: true,
      mergedFromCount: sortedMessages.length,
      originalRequestIds: sortedMessages.map(msg => msg.requestId), // 保留原始请求ID列表
    };

    info(`Messages merged successfully for requestId ${mergedMessage.requestId}. Merged ${sortedMessages.length} messages.`, { mergedRequestId: mergedMessage.requestId }, 'MERGE_MESSAGES');

    return mergedMessage;
  }

  /**
   * 检查所有处于 Conversational 模式的房间，决定是否触发思考。
   * @private
   */
  _checkConversationalRooms() {
    // 不再检查全局模式
    for (const roomName in this.roomManagement.rooms) {
      const roomInfo = this.roomManagement.getRoomInfo(roomName);
      // **检查房间自身的模式**
      if (roomInfo && roomInfo.messageRequestMode === 'Conversational') {
        if (!this.conversationalTimers[roomName] || Date.now() > this.conversationalTimers[roomName]) {
          if (Math.random() < this.thinkingProbability) {
            try {
              this._triggerConversationalThink(roomName); // 触发思考
            } catch (error) {
              error(`Failed to trigger Conversational Think.`,{error},'RANDOM_RESPONSE')
            }
          }
          // 设置下次检查时间
          const nextThinkDelay = Math.random() * (this.thinkIntervalMax - this.thinkIntervalMin) + this.thinkIntervalMin;
          this.conversationalTimers[roomName] = Date.now() + nextThinkDelay;
        }
      }
    }
  }

  /**
   * 触发指定房间的 Conversational 思考流程。
   * @param {string} roomName
   * @param {string} [triggerType='random'] - 触发类型 ('random', 'post_unmute')
   * @private
   * @async
   */
  async _triggerConversationalThink(roomName, triggerType = 'random') { // 添加 triggerType
    if (!this.roomManagement.getRoomInfo(roomName)) return;

    const assignedExtensions = this.relationsManage.getAssignmentsForRoom(roomName);
    if (!assignedExtensions || assignedExtensions.length === 0) return;

    const targetExtension = assignedExtensions[Math.floor(Math.random() * assignedExtensions.length)];

    // *** 新增：检查扩展是否被禁言 ***
    if (this.memberManagement.isMuted(targetExtension)) {
      // debug(`Skipping conversational thinking for muted extension ${targetExtension} in room ${roomName}.`, {}, 'CONV_THINK_SKIP_MUTED');
      return; // 如果被禁言，则不触发
    }

    const context = this.buildFullContext(roomName);
    if (!context || context.length === 0) return;

    const thinkRequestId = `think_${uuidv4()}`;

    // 根据触发类型调整指令
    let instruction = serverSettings.conversationalInstruction || "Review the conversation and recent system events ,then respond naturally if you have something relevant to add.";
    if (triggerType === 'post_unmute') {
      instruction = serverSettings.postUnmuteInstruction || `You were just unmuted. Review the recent conversation, considering this event, and respond naturally if appropriate. ${instruction}`;
    }


    const thinkRequestData = {
      mode: 'Conversational',
      type: 'THINK_REQUEST',
      requestId: thinkRequestId,
      targetRoom: roomName,
      context: context,
      instruction: instruction // 使用调整后的指令
    };

    info(`Triggering conversational thinking (${triggerType}) for room ${roomName} targeting ${targetExtension}`, { requestId: thinkRequestId }, 'CONV_THINK_TRIGGER');
    this.forwardLlmRequest(targetExtension, thinkRequestData);
  }

  /**
   * 清理指定房间的 Conversational 计时器。
   * @param {string} roomName
   */
  clearConversationalTimerForRoom(roomName) {
    if (this.conversationalTimers[roomName]) {
      // 如果计时器是 setTimeout ID，需要 clearTimeout
      // clearTimeout(this.conversationalTimers[roomName].timerId);
      delete this.conversationalTimers[roomName];
      info(`Cleared conversational timer for room ${roomName}.`, {}, 'CONV_TIMER_CLEAR');
    }
  }

  /**
   * 处理 LLM 请求 (入口点)。
   * @param {import('socket.io').Socket} socket - Socket.IO Socket 实例。
   * @param {object} data - 消息数据，应包含 targetRoom。
   */
  handleLlmRequest(socket, data) {
    const requestingIdentity = socket.handshake.auth.clientId;
    const targetRoom = data.targetRoom;

    if (this.memberManagement.isMuted(requestingIdentity)) {
      warn(`Muted user ${requestingIdentity} attempted to send LLM request in room ${targetRoom}.`, {}, 'MUTE_BLOCKED');
      // 向用户发送错误提示
      socket.emit(MSG_TYPE.ERROR, { message: 'You are currently muted and cannot send messages.' });
      // 如果有回调，也告知失败
      // if (callback) callback({ status: 'error', message: 'You are muted.' });
      return; // 阻止后续处理
    }

    // --- 获取当前房间的模式 ---
    const currentRoomMode = this.roomManagement.getRoomMessageRequestMode(targetRoom);

    // --- 基础验证 (放在入口处) ---
    const roomInfo = this.roomManagement.getRoomInfo(targetRoom);
    if (!roomInfo || !roomInfo.members.has(requestingIdentity)) {
      warn('Invalid or unauthorized targetRoom in LLM request', { requestingIdentity, targetRoom });
      socket.emit(MSG_TYPE.ERROR, { message: 'Invalid or unauthorized target room.' });
      return;
    }
    if (!data.requestId) { // target 在特定模式下才需要
      warn('Invalid LLM request (missing requestId)', { data });
      socket.emit(MSG_TYPE.ERROR, { message: 'Invalid LLM request data.' });
      return;
    }

    // --- 准备请求消息 ---
    const currentRequestMessage = {
      ...data,
      identity: requestingIdentity,
      fromClient: true
    };

    // --- 添加到消息队列并更新成员上下文 ---
    const messageId = this.addMessage(targetRoom, currentRequestMessage, false);
    if (!messageId) {
      error('Failed to add LLM request message to queue.', { targetRoom, currentRequestMessage }, 'LLM_REQUEST_ERROR');
      socket.emit(MSG_TYPE.ERROR, { message: 'Failed to record request message.' });
      return;
    }
    try {
      this.sendFullContextToRoomMembers(targetRoom); // 仅通知成员
    } catch (error) {
      error(`Failed to send fullContext to roomMembers.`, { error }, 'GET_CONTEXT_FAIL')
    }

    // --- 记录追踪信息 (所有模式都需要) ---
    this.llmRequests[data.requestId] = {
      originalClient: requestingIdentity,
      room: targetRoom,
      target: data.target, // 可能为 undefined
      responses: [],
      completed: false,
      responseCount: 0
    };

    info(`Received LLM request for room ${targetRoom} from ${requestingIdentity}`, { requestId: data.requestId, mode: this.messageRequestMode }, 'LLM_REQUEST_RECEIVED');

    // --- 根据模式调用对应的处理方法 ---
    switch (currentRoomMode) { // **使用 currentRoomMode**
      case 'Immediate':
        this._handleImmediateRequest(targetRoom, currentRequestMessage, data.target, data.requestId, currentRoomMode); // 传递模式
        break;
      case 'HostSubmit':
        this._handleHostSubmitRequest(targetRoom, currentRequestMessage, data.target, data.requestId, data.role, currentRoomMode); // 传递模式
        break;
      case 'MasterOnly':
        this._handleMasterOnlyRequest(targetRoom, currentRequestMessage, data.target, data.requestId, data.role, currentRoomMode); // 传递模式
        break;
      case 'Conversational':
        this._handleConversationalRequest(targetRoom, currentRequestMessage, data.target, data.requestId, currentRoomMode); // 传递模式
        break;
      default:
        warn(`Unknown message request mode '${currentRoomMode}' for room ${targetRoom}`, {}, 'LLM_REQUEST_WARN');
        socket.emit(MSG_TYPE.ERROR, { message: `Invalid server mode configuration for this room.` });
        delete this.llmRequests[data.requestId];
    }
  }

  /** @private */
  _handleImmediateRequest(targetRoom, currentRequestMessage, target, requestId, currentRoomMode) {
    if (!target) {
      warn('Immediate mode requires a target extension.', { requestId, targetRoom });
      // 不需要再次发送错误给 socket，因为入口处已处理
      // 但需要确保不继续执行
      // 可以考虑清理已添加的 llmRequests 条目
      delete this.llmRequests[requestId];
      return;
    }
    const context = this.buildFullContext(targetRoom);
    if (context === null) {
      error(`Failed to build context for Immediate request ${requestId}.`, {}, 'LLM_REQUEST_ERROR');
      delete this.llmRequests[requestId];
      return;
    }
    const requestDataForExtension = {
      mode: currentRoomMode,
      requestId, targetRoom,
      requestingIdentity: currentRequestMessage.identity,
      currentRequest: currentRequestMessage,
      context
    };
    info(`Forwarding Immediate request ${requestId} for room ${targetRoom}.`, { contextLength: context.length }, 'LLM_REQUEST_SEND');
    this.forwardLlmRequest(target, requestDataForExtension);
  }

  /** @private */
  _handleHostSubmitRequest(targetRoom, currentRequestMessage, target, requestId, role, currentRoomMode) {
    if (role === 'guest' || role === 'special') {
      if (!this.guestRequestQueues[targetRoom]) this.guestRequestQueues[targetRoom] = [];
      this.guestRequestQueues[targetRoom].push(currentRequestMessage);
      info(`Queued ${role} request ${requestId} for room ${targetRoom} in HostSubmit mode`, {}, 'LLM_REQUEST_QUEUED');
      // Guest 请求在此处结束，等待主持人触发
      // 不需要记录 llmRequests，因为没有请求发出
      delete this.llmRequests[requestId]; // 清理入口处添加的追踪信息
    } else if (role === 'master' || role === 'moderator') {
      if (!target) { // 主持人提交时必须有目标
        warn(`HostSubmit mode requires a target extension for submission.`, { requestId, targetRoom });
        delete this.llmRequests[requestId];
        return;
      }
      const guestRequests = this.guestRequestQueues[targetRoom];
      let messagesToMerge = [currentRequestMessage];
      let finalRequestId = requestId; // 默认使用主持人的请求 ID

      if (guestRequests && guestRequests.length > 0) {
        messagesToMerge = [...guestRequests, currentRequestMessage];
        info(`Found ${guestRequests.length} guest requests to merge for room ${targetRoom}`, { requestId }, 'LLM_REQUEST_MERGE');
        delete this.guestRequestQueues[targetRoom]; // 清空队列
        // 合并请求时，可能需要生成一个新的 requestId 或选择主持人的 requestId
        // 这里我们选择保留主持人的 requestId (已在 llmRequests 中)
      }

      let finalRequestObject = currentRequestMessage;
      if (messagesToMerge.length > 1) {
        const mergedResult = this.mergeMessages(messagesToMerge);
        if (mergedResult) {
          finalRequestObject = mergedResult;
          // 如果 mergeMessages 生成了新的 requestId, 需要更新 llmRequests
          // 如果沿用主持人的 requestId，则无需更新
          finalRequestId = mergedResult.requestId || requestId; // 确保 ID 正确
          // 更新追踪信息中的 target (如果之前未提供)
          this.llmRequests[finalRequestId].target = target;
          info(`Merged ${messagesToMerge.length} requests for room ${targetRoom}.`, { finalRequestId }, 'LLM_REQUEST_SEND');
        } else {
          warn(`Merging messages failed for room ${targetRoom}, sending only host request.`, { requestId }, 'LLM_REQUEST_MERGE_FAIL');
        }
      } else {
        info(`Forwarding HostSubmit request (no guests) ${requestId} for room ${targetRoom}.`, {}, 'LLM_REQUEST_SEND');
      }

      const context = this.buildFullContext(targetRoom);
      const requestDataForExtension = {
        mode: currentRoomMode,
        requestId: finalRequestId, // 使用最终的请求 ID
        targetRoom,
        requestingIdentity: currentRequestMessage.identity, // 主持人的 identity
        currentRequest: finalRequestObject, // 原始或合并后的消息
        context
      };
      this.forwardLlmRequest(target, requestDataForExtension);
    } else {
      // 非 guest/special/host 的角色请求在 HostSubmit 模式下被忽略
      info(`Ignoring request from role '${role}' in HostSubmit mode.`, { requestId, targetRoom }, 'LLM_REQUEST_IGNORE');
      delete this.llmRequests[requestId]; // 清理追踪信息
    }
  }

  /** @private */
  _handleMasterOnlyRequest(targetRoom, currentRequestMessage, target, requestId, role, currentRoomMode) {
    if (role === 'master' || role === 'moderator') {
      if (!target) {
        warn(`MasterOnly mode requires a target extension.`, { requestId, targetRoom });
        delete this.llmRequests[requestId];
        return;
      }
      const context = this.buildFullContext(targetRoom);
      const requestDataForExtension = {
        mode: currentRoomMode,
        requestId, targetRoom,
        requestingIdentity: currentRequestMessage.identity,
        currentRequest: currentRequestMessage,
        context
      };
      info(`Forwarding MasterOnly request ${requestId} for room ${targetRoom}.`, { contextLength: context?.length || 0 }, 'LLM_REQUEST_SEND');
      this.forwardLlmRequest(target, requestDataForExtension);
    } else {
      info(`Ignoring non-master/moderator request ${requestId} in MasterOnly mode.`, { targetRoom, role }, 'LLM_REQUEST_IGNORE');
      delete this.llmRequests[requestId]; // 清理追踪信息
    }
  }

  /** @private */
  _handleConversationalRequest(targetRoom, currentRequestMessage, target, requestId, currentRoomMode) {
    if (target) {
      // 用户明确指定了目标 (@LLM) - 行为类似 Immediate
      info(`Handling direct conversational request ${requestId} to target ${target}.`, { targetRoom }, 'CONV_REQUEST_DIRECT');
      const context = this.buildFullContext(targetRoom);
      if (context === null) {
        error(`Failed to build context for Conversational direct request ${requestId}.`, {}, 'LLM_REQUEST_ERROR');
        delete this.llmRequests[requestId];
        return;
      }
      const requestDataForExtension = {
        mode: currentRoomMode,
        type: 'DIRECT_REQUEST', // 区分是用户直接请求
        requestId, targetRoom,
        requestingIdentity: currentRequestMessage.identity,
        currentRequest: currentRequestMessage,
        context
      };
      this.forwardLlmRequest(target, requestDataForExtension);
      // 可选：重置该 target 扩展在该房间的后台思考计时器
      // this._resetConversationalTimer(targetRoom, target);
    } else {
      // 用户没有指定目标 - 消息仅用于丰富上下文，由后台思考触发器处理
      info(`Received ambient conversational message ${requestId} for context in room ${targetRoom}.`, {}, 'CONV_REQUEST_AMBIENT');
      // 不需要向任何扩展发送请求，后台触发器会处理
      // 但入口处已经添加了消息到队列并记录了 llmRequests，这里需要清理
      delete this.llmRequests[requestId]; // 清理追踪信息，因为没有请求发出
    }
  }

  /**
   * 转发 LLM 请求给 SillyTavern 扩展端。
   * @param {string | string[]} target - 目标扩展的 identity (或数组)。
   * @param {object} requestData - 包含模式、上下文、当前请求等的结构化数据。
   */
  forwardLlmRequest(target, requestData) {
    // 不再直接发送原始请求 'data'，而是发送结构化的 'requestData'
    const eventType = MSG_TYPE.LLM_REQUEST; // 使用标准请求事件类型

    if (Array.isArray(target)) {
      for (const t of target) {
        this.io.of(NAMESPACES.LLM).to(t).emit(eventType, requestData);
      }
    } else {
      this.io.of(NAMESPACES.LLM).to(target).emit(eventType, requestData);
    }
  }

  /**
   * 处理 LLM 响应的核心逻辑：记录响应、更新上下文、更新状态。
   * 注意：响应内容的实时转发由 stream.js 和 non_stream.js 处理。
   * @param {string} roomName - 响应对应的房间名 (由 stream/non_stream 模块根据 requestId 确定并传入)。
   * @param {object} data - 响应数据 (由 stream/non_stream 组装或直接获取)。
   *                        应包含 requestId, data/response (内容), responderIdentity (可选) 等。
   */
  handleLlmResponse(roomName, data) {
    const { requestId } = data;

    const currentRoomMode = this.roomManagement.getRoomMessageRequestMode(targetRoomForResponse);

    // 检查 roomName 是否有效
    if (!this.roomManagement.rooms[roomName]) {
      warn(`Invalid roomName '${roomName}' provided to handleLlmResponse for requestId ${requestId}.`, {}, 'LLM_RESPONSE_WARN');
      // 尝试从 llmRequests 恢复 roomName (如果可能)
      const requestInfo = this.llmRequests[requestId];
      if (requestInfo && this.roomManagement.rooms[requestInfo.room]) {
        roomName = requestInfo.room;
        info(`Recovered roomName '${roomName}' from llmRequests for requestId ${requestId}.`, {}, 'LLM_RESPONSE_INFO');
      } else {
        error(`Cannot determine valid room for response ${requestId}. Aborting processing.`, { data }, 'LLM_RESPONSE_ERROR');
        return; // 无法确定房间，无法继续
      }
    }

    const originalRequest = this.llmRequests[requestId]; // 用于状态更新和获取原始客户端
    const isBackgroundThinkResponse = !originalRequest && (data.type === 'THINK_RESPONSE' || requestId?.startsWith('think_'));

    // --- 1. 准备响应消息对象 ---
    const responseId = uuidv4();
    const responseContent = data.data || data.response || '';
    // 尝试确定响应者 identity
    const responderIdentity = data.responderIdentity || (originalRequest ? originalRequest.target : data.source); // 尝试多种来源

    if (!responderIdentity) {
      warn(`LLM response for ${requestId} lacks responder identity.`, { data }, 'LLM_RESPONSE_WARN');
      // 可能需要进一步处理或记录
    }

    const fullResponse = {
      ...data,
      identity: responderIdentity,
      responseId: responseId,
      data: responseContent,
      isResponse: true,
      timestamp: new Date()
    };

    // --- 2. 记录响应到队列 ---
    const messageId = this.addMessage(roomName, fullResponse, true); // true 表示是 LLM 响应
    if (!messageId) {
      error(`Failed to add LLM response message ${responseId} to queue for room ${roomName}.`, { requestId }, 'LLM_RESPONSE_ERROR');
      // 即使添加失败，也继续尝试更新上下文和状态
    } else {
      info(`Recorded LLM response ${responseId} (from req ${requestId}) to room ${roomName} queue.`, {}, 'LLM_RESPONSE_RECORDED');
    }

    // --- 3. 更新并广播上下文给房间成员 ---
    // 注意： stream.js/non_stream.js 已经将响应内容实时/完整地发给了房间
    // sendFullContextToRoomMembers 会再次发送完整历史，确保成员端上下文一致
    try {
      this.sendFullContextToRoomMembers(roomName);
    } catch (error) {
      error(`Failed to send fullContext to roomMembers.`, { error }, 'GET_CONTEXT_FAIL')
    }

    // --- 4. 更新请求状态 (仅对用户直接请求) ---
    if (originalRequest) {
      originalRequest.responses.push(responseId);
      originalRequest.responseCount++;
      const expectedResponses = Array.isArray(originalRequest.target) ? originalRequest.target.length : 1;
      if (originalRequest.responseCount >= expectedResponses) {
        originalRequest.completed = true;
        info(`User request ${requestId} for room ${roomName} completed.`, {}, 'LLM_REQUEST_COMPLETE');
        // 可选清理: delete this.llmRequests[requestId];
      }

      // --- 5. (可选) 通知原始请求者请求已完成 ---
      //   这里不发送响应内容，只发送确认信息
      const completionData = {
        mode: currentRoomMode,
        roomName: roomName,
        requestId: requestId,
        responseId: responseId, // 可以包含最后一个收到的 responseId
        status: originalRequest.completed ? 'completed' : 'processing', // 告知当前状态
      };
      this.io.of(NAMESPACES.LLM).to(originalRequest.originalClient).emit(MSG_TYPE.REQUEST_STATUS_UPDATE, completionData); // 使用新事件类型
      info(`Sent request status update for ${requestId} to client ${originalRequest.originalClient}. Status: ${completionData.status}`, {}, 'LLM_RESPONSE_NOTIFY');

    } else if (isBackgroundThinkResponse) {
      // 后台思考请求没有原始客户端需要通知完成状态
      info(`Processed background thinking response ${responseId} for room ${roomName}.`, {}, 'CONV_THINK_PROCESSED');
    }

  }

  /**
   * 获取指定房间的完整上下文，并通过传入的 Socket 分页发送。
   * @param {import('socket.io').Socket} socket - 用于接收分页上下文的客户端 Socket 实例。
   * @param {string} roomName - 需要获取上下文的房间名。
   * @returns {Promise<boolean>} - 返回一个 Promise，表示发送操作是否开始（不保证完成）。
   *                             如果房间不存在或无法构建上下文，则 resolve 为 false。
   */
  async getOfflineMessages(socket, roomName) {
    // 验证权限：该 socket (identity) 是否是 roomName 的成员？
    const identity = socket.handshake.auth.clientId; // 获取请求者的 identity
    const roomInfo = this.roomManagement.getRoomInfo(roomName);
    if (!this.roomManagement.rooms[roomName] || !roomInfo.members.has(identity)) {
      warn(`Unauthorized attempt to get offline messages for room ${roomName} by ${identity}.`, {}, 'GET_OFFLINE_UNAUTHORIZED');
      socket.emit(MSG_TYPE.ERROR, { message: `You are not a member of room ${roomName}.` });
      return false; // 权限不足
    }

    info(`Requesting offline messages for room ${roomName} by ${identity}.`, {}, 'GET_OFFLINE_REQUEST');
    const fullContext = this.buildFullContext(roomName);

    if (fullContext === null) {
      warn('Room not found or context is null when getting offline messages', { identity, roomName }, 'GET_OFFLINE_ERROR');
      socket.emit(MSG_TYPE.ERROR, { message: `Could not retrieve context for room ${roomName}.` });
      return false; // 房间不存在或无法构建上下文
    }

    // 调用通用分页函数，目标是单个 socket
    try {
      await this._sendPaginatedContext(socket, roomName, fullContext);
    } catch (error) {
      error(`Failed to send Paginated Context`, { error }, 'CONTEXT_PAGING')
      return;
    }
    return true; // 表示发送已开始
  }

  /**
   * 广播成员状态更新给指定房间的所有成员。
   * @function broadcastMemberStatus
   * @param {string} roomName - 状态更新发生的房间名。
   * @param {string} identity - 状态发生变化的成员的 identity。
   * @param {string} status - 新的状态 ('idle', 'typing', 'processing')。
   */
  broadcastMemberStatus(roomName, identity, status) {
    // 验证状态是否有效
    if (!Object.values(MEMBER_STATUS).includes(status)) {
      warn(`Attempted to broadcast invalid status '${status}' for ${identity} in ${roomName}.`, {}, 'STATUS_UPDATE_WARN');
      return;
    }

    const roomInfo = this.roomManagement.getRoomInfo(roomName);
    if (!roomInfo) {
      // 房间不存在，无法广播
      return;
    }

    const statusData = {
      identity: identity,
      roomName: roomName,
      status: status,
      timestamp: new Date(),
    };

    // 向房间内的所有成员广播状态更新
    // 注意：不应该只发给其他人，自己也需要收到状态更新来同步 UI（如果需要）
    this.io.of(NAMESPACES.LLM).to(roomName).emit(MSG_TYPE.MEMBER_STATUS_UPDATE, statusData);
    debug(`Broadcast status update for ${identity} in ${roomName}: ${status}`, {}, 'STATUS_UPDATE_BCAST');
  }

  // ... 方法 ...
}

export { ChatModule };