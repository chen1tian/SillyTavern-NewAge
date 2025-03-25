// server/dist/chat.js

import { NAMESPACES, MSG_TYPE } from '../lib/constants.js'; // 导入常数
import * as Rooms from './Rooms.js'; //导入Rooms.js
import { v4 as uuidv4 } from 'uuid';
import { logger, error, warn, info } from './logger.js';
import { MemberManagement } from './memberManagement.js';
import { RelationsManage } from './relationsManage.js';

class ChatModule {
  constructor(io) {
    this.io = io; // Socket.IO 服务器实例

    // 1. 房间信息
    this.rooms = {}; // { [roomName]: Room }
    // Room 对象示例:
    // {
    //   name: string;           // 房间名 (与 roomName 相同，但为了方便访问)
    //   members: Set<string>;   // 房间内的成员 (clientId 集合)
    //   master: string;        // 房主 (clientId)
    //   managers: Set<string>;  // 管理员 (clientId 集合)
    //   guests: Set<string>;    // 访客 (clientId 集合)
    //   messageQueue: [];      // 消息队列 (用于存储 guest 消息, 可选)
    //   createdAt: Date;       // 房间创建时间
    //   // ... 其他房间相关信息 ...
    // }

    // 2. 成员信息 (可选, 如果需要更详细的成员信息)
    this.members = {}; // { [clientId]: Member }
    // Member 对象示例:
    // {
    //   clientId: string;     // 客户端 ID
    //   clientType: string;   // 客户端类型
    //   nickname: string;    // 昵称 (可选)
    //   avatar: string;      // 头像 URL (可选)
    //   // ... 其他成员相关信息 ...
    // }

    // 3. LLM 请求映射 (用于消息路由)
    this.llmRequests = {}; // { [requestId]: { originalClient: string, room: string, target: string | string[], responses: string[], completed: boolean, responseCount: number} }

    // 4. 已连接的 SillyTavern 扩展端列表
    // string[]  // SillyTavern 扩展端的 clientId 数组
    this.connectedExtensions = [];

    // 5. 已连接的客户端房间列表
    //string[]
    this.connectedClientRooms = [];

    // 6. 消息请求模式（默认、立即、仅master、独立）
    this.messageRequestMode = 'Default';

    // 7. guest请求队列
    this.guestRequestQueues = {}; // { [roomName]: LLMRequest[] }

    // 8. LLM响应队列
    this.llmResponseQueues = {}; // { [roomName]: LLMResponse[] }

    // 9. 创建 MemberManagement 实例
    this.memberManagement = new MemberManagement(io, this);

    // 10. 创建 RelationsManage 实例
    this.relationsManage = new RelationsManage(io);
  }

  /**
   * 创建房间。
   * @param {string} roomName - 房间名。
   * @param {string} creatorClientId - 创建者客户端 ID。
   * @returns {boolean} - 是否成功创建。
   */
  createRoom(roomName, creatorClientId) {
    // 使用 creatorClientId 作为 roomName
    roomName = creatorClientId; // 修改这里，使用 creatorClientId 作为房间名
    if (this.rooms[roomName]) {
      // 房间已存在
      return false;
    }

    // 使用 Rooms.js 创建房间 (如果房间不存在，Socket.IO 会自动创建)
    try {
      Rooms.createRoom(roomName, creatorClientId); // 修改后的 Rooms.createRoom
    } catch (error) {
      // Rooms.js 抛出错误
      console.error('Error creating room using Rooms.js:', error);
      return false;
    }

    // 创建 Room 对象并添加到 this.rooms
    this.rooms[roomName] = {
      name: roomName,
      members: new Set([creatorClientId]), // 初始成员：创建者
      master: creatorClientId, // 房主是创建者
      managers: new Set(),
      guests: new Set([creatorClientId]), //一开始都是访客
      messageQueue: [],
      createdAt: new Date(),
    };
    //将创建者转变为master
    this.changeClientRole(creatorClientId, roomName, 'master');
    return true;
  }

  /**
   * 删除房间。
   * @param {string} roomName - 房间名。
   * @returns {boolean} - 是否成功删除。
   */
  deleteRoom(roomName) {
    if (!this.rooms[roomName]) {
      // 房间不存在
      return false;
    }

    // 使用 Rooms.js 删除房间 (将所有客户端移出房间)
    try {
      Rooms.deleteRoom(roomName);
    } catch (error) {
      // Rooms.js 抛出错误
      console.error('Error deleting room using Rooms.js:', error);
      return false;
    }

    // 从 this.rooms 中移除房间
    delete this.rooms[roomName];

    // TODO: 触发 ROOM_DELETED 事件
    // this.emitEvent('ROOM_DELETED', roomName, { roomName });

    return true;
  }

  /**
   * 加入房间。
   * @param {string} clientId - 客户端 ID。
   * @param {string} roomName - 房间名。
   * @param {string} [role='guest'] - 角色 ('guest', 'manager', 'master')。
   * @returns {boolean} - 是否成功加入。
   */
  joinRoom(clientId, roomName, role = 'guest') {
    if (!this.rooms[roomName]) {
      // 房间不存在
      return false;
    }
    //是否已经在房间
    if (this.rooms[roomName].members.has(clientId)) {
      return false;
    }

    // 使用 Rooms.js 将客户端添加到房间
    try {
      Rooms.addClientToRoom(clientId, roomName);
    } catch (error) {
      // Rooms.js 抛出错误
      console.error('Error adding client to room using Rooms.js:', error);
      return false;
    }

    // 将客户端添加到房间成员列表
    this.rooms[roomName].members.add(clientId);
    this.changeClientRole(clientId, roomName, role);
    // 通知房间内的 master 和 managers
    this.memberManagement.notifyRoomMasterAndManagers(roomName, MSG_TYPE.MEMBER_JOINED, { clientId, role });

    // 通知新加入的成员
    this.io.to(clientId).emit(MSG_TYPE.MEMBER_ROLE_CHANGED, {
      clientId: clientId,
      roomName: roomName,
      role: role // 或者直接使用  role: this.rooms[roomName].guests.has(clientId) ? 'guest' : (this.rooms[roomName].managers.has(clientId) ? 'manager' : 'master')
    });

    return true;
  }

  /**
   * 离开房间。
   * @param {string} clientId - 客户端 ID。
   * @param {string} roomName - 房间名。
   * @returns {boolean} - 是否成功离开。
   */
  leaveRoom(clientId, roomName) {
    if (!this.rooms[roomName]) {
      // 房间不存在
      return false;
    }

    // 使用 Rooms.js 将客户端从房间移除
    try {
      Rooms.removeClientFromRoom(clientId, roomName);
    } catch (error) {
      // Rooms.js 抛出错误
      console.error('Error removing client from room using Rooms.js:', error);
      return false;
    }

    // 将客户端从房间成员列表中移除
    this.rooms[roomName].members.delete(clientId);

    // 通知房间内的 master 和 managers
    this.memberManagement.notifyRoomMasterAndManagers(roomName, MSG_TYPE.MEMBER_LEFT, { clientId });

    // 如果房间为空，则删除房间 (可选)
    if (this.rooms[roomName].members.size === 0) {
      this.deleteRoom(roomName);
    }

    return true;
  }

  /**
   * 获取房间内的成员列表。
   * @param {string} roomName - 房间名。
   * @returns {string[] | null} - 成员列表 (clientId 数组)，如果房间不存在则返回 null。
   */
  getRoomMembers(roomName) {
    if (!this.rooms[roomName]) {
      return null; // 房间不存在
    }
    return Array.from(this.rooms[roomName].members);
  }

  /**
   * 更改用户角色
   * @param {*} clientId
   * @param {*} roomName
   * @param {*} role
   * @returns
   */
  changeClientRole(clientId, roomName, role) {
    if (!this.rooms[roomName]) {
      return false;
    }
    const room = this.rooms[roomName];
    room.guests.delete(clientId);
    room.managers.delete(clientId);
    if (role === 'master') {
      room.master = clientId;
    } else if (role === 'manager') {
      room.managers.add(clientId);
    } else {
      room.guests.add(clientId);
    }

    return true;
  }

  /**
   * 添加消息到房间的消息队列。
   * @param {string} roomName - 房间名。
   * @param {object} message - 消息对象。
   * @param {boolean} fromLlm - 是否是 LLM 响应
   * @returns {string | null} - 消息 ID (如果成功) 或 null (如果失败)。
   */
  addMessage(roomName, message, fromLlm) {
    if (!this.rooms[roomName]) {
      return null; // 房间不存在
    }

    // 生成唯一的消息 ID
    const messageId = uuidv4();
    // 添加消息 ID 和时间戳
    const fullMessage = {
      ...message,
      messageId: messageId,
      timestamp: new Date(),
    };
    if (fromLlm) {
      // 将消息添加到 LLM 响应队列
      if (!this.llmResponseQueues[roomName]) {
        this.llmResponseQueues[roomName] = [];
      }
      this.llmResponseQueues[roomName].push(fullMessage);
    } else {
      // 将消息添加到房间的消息队列
      this.rooms[roomName].messageQueue.push(fullMessage);
    }
    this.sendFullContextToExtensions(roomName); // 在 addMessage 中调用，确保每次添加消息后都更新上下文
    return messageId; // 无论是请求消息还是响应消息，都返回 messageId
  }

  /**
   * 根据消息 ID 修改消息 (例如，编辑消息)。
   * @param {string} roomName - 房间名。
   * @param {string} messageId - 消息 ID。
   * @param {object} updatedMessage - 更新后的消息对象 (只包含需要更新的字段)。
   * @param {boolean} fromLlm - 是否是LLM的响应消息
   * @param {string} responseId - 如果是LLM的响应消息，则需要responseId
   * @returns {boolean} - 是否成功修改。
   */
  editMessage(roomName, messageId, updatedMessage, fromLlm, responseId) {
    if (!this.rooms[roomName]) {
      return false; // 房间不存在
    }
    if (fromLlm) {
      //如果是LLM的响应消息
      if (!responseId) {
        return false;// 缺少responseId
      }
      const responseQueue = this.llmResponseQueues[roomName];
      if (!responseQueue) {
        return false
      }
      const messageIndex = responseQueue.findIndex(msg => msg.responseId === responseId);
      if (messageIndex === -1) {
        return false; // 未找到消息
      }
      // 使用 Object.assign 进行部分更新
      responseQueue[messageIndex] = { ...responseQueue[messageIndex], ...updatedMessage };
      this.sendFullContextToExtensions(roomName);
    } else {
      //如果是客户端的请求消息
      const messageQueue = this.rooms[roomName].messageQueue;
      const messageIndex = messageQueue.findIndex(msg => msg.messageId === messageId);

      if (messageIndex === -1) {
        return false; // 未找到消息
      }

      // 使用 Object.assign 进行部分更新
      messageQueue[messageIndex] = { ...messageQueue[messageIndex], ...updatedMessage };
      this.sendFullContextToExtensions(roomName);
    }
    return true;
  }

  /**
 * 删除消息（支持批量删除）。
 * @param {string} roomName - 房间名。
 * @param {string | string[]} messageIds - 要删除的客户端请求消息 ID（或 ID 数组）。
 * @param {string | string[]} responseIds - 要删除的 LLM 响应消息 ID（或 ID 数组）。
 * @returns {boolean} - 是否成功删除（只要有任何一个消息被成功删除，就返回 true）。
 */
  deleteMessage(roomName, messageIds, responseIds) {
    if (!this.rooms[roomName]) {
      return false; // 房间不存在
    }

    let anySuccess = false; // 标记是否有任何消息被成功删除

    // 1. 处理客户端请求消息 (messageIds)
    const messageQueue = this.rooms[roomName].messageQueue;
    if (messageIds && messageQueue) {
      const idsToDelete = Array.isArray(messageIds) ? messageIds : [messageIds]; // 统一为数组
      for (const id of idsToDelete) {
        const messageIndex = messageQueue.findIndex(msg => msg.messageId === id);
        if (messageIndex !== -1) {
          messageQueue.splice(messageIndex, 1);
          anySuccess = true;
        }
      }
    }

    // 2. 处理 LLM 响应消息 (responseIds)
    const responseQueue = this.llmResponseQueues[roomName];
    if (responseIds && responseQueue) {
      const idsToDelete = Array.isArray(responseIds) ? responseIds : [responseIds]; // 统一为数组
      for (const id of idsToDelete) {
        const messageIndex = responseQueue.findIndex(msg => msg.responseId === id);
        if (messageIndex !== -1) {
          responseQueue.splice(messageIndex, 1);
          anySuccess = true;
        }
      }
    }

    if (anySuccess) {
      this.sendFullContextToRoom(roomName); // 发送更新后的完整上下文
    }

    return anySuccess;
  }

  /**
   * 清空房间的消息队列。
   * @param {string} roomName - 房间名。
   *  @param {boolean} fromLlm -是否是LLM响应
   * @returns {boolean} - 是否成功清空。
   */
  clearMessages(roomName, fromLlm) {
    if (!this.rooms[roomName]) {
      return false; // 房间不存在
    }
    if (fromLlm) {
      this.llmResponseQueues[roomName] = [];
    } else {
      this.rooms[roomName].messageQueue = []; // 清空消息队列
    }
    return true;
  }

  /**
   * 构建完整的聊天上下文。
   * @param {string} roomName 房间名
   * @returns {object[] | null} 完整的聊天上下文 (消息数组)，如果房间不存在则返回 null。
   */
  buildFullContext(roomName) {
    if (!this.rooms[roomName]) {
      return null; // 房间不存在
    }

    // 合并 messageQueue 和 llmResponseQueues
    const messageQueue = this.rooms[roomName].messageQueue;
    const responseQueue = this.llmResponseQueues[roomName] || []; // 确保 llmResponseQueues[roomName] 存在

    // 将两个队列合并成一个，并根据时间戳排序
    const fullContext = [...messageQueue, ...responseQueue].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    return fullContext;
  }

  /**
   * 将完整上下文发送给目标 SillyTavern 扩展端。
   * @param {string} roomName - 房间名
   */
  sendFullContextToExtensions(roomName) {

    const fullContext = this.buildFullContext(roomName);

    if (!fullContext) {
      warn('Room not found when trying to send full context', { roomName }, 'SEND_FULL_CONTEXT');
      return;
    }

    // 向房间内的所有成员发送完整上下文
    this.io.of(NAMESPACES.LLM).to(roomName).emit(MSG_TYPE.UPDATE_CONTEXT, { context: fullContext });

    // 获取目标 SillyTavern 扩展端 (根据你的连接策略)
    const targets = this.relationsManage.getAssignmentsForRoom(roomName)

    // 向目标扩展发送完整上下文
    for (const target of targets) {
      this.io.of(NAMESPACES.LLM).to(target).emit(MSG_TYPE.UPDATE_CONTEXT, { context: fullContext });
    }
  }

  /**
   * 设置消息请求模式。
   * @param {string} mode - 消息请求模式 ('Default', 'Immediate', 'MasterOnly', 'Separate')。
   * @returns {boolean} - 是否设置成功。
   */
  setMessageRequestMode(mode) {
    if (!['Default', 'Immediate', 'MasterOnly', 'Separate'].includes(mode)) {
      console.warn('Invalid message request mode:', mode);
      return false;
    }

    this.messageRequestMode = mode;
    // (可选) 在这里可以添加一些额外的逻辑，例如通知所有客户端
    return true;
  }

  /**
   * 处理 LLM 请求。
   * @param {import('socket.io').Socket} socket - Socket.IO Socket 实例。
   * @param {object} data - 消息数据。
   */
  handleLlmRequest(socket, data) {
    const clientId = socket.handshake.auth.clientId;
    const roomName = clientId; // 假设房间名与 clientId 相同
    const { target, requestId, role } = data;
    let llmRequest = { ...data };

    // 1. 验证请求
    if (!target || !requestId) {
      console.warn('Invalid LLM request:', data);
      return;
    }
    // 2. 将请求添加到消息队列, 并添加fromClient的标记
    llmRequest = {
      ...llmRequest,
      fromClient: true
    }
    this.addMessage(roomName, llmRequest, false); // 添加到消息队列

    // 3. 将请求添加到 llmRequests (用于后续路由响应)
    this.llmRequests[requestId] = {
      originalClient: clientId,
      room: roomName,
      target: target, // target 现在可以是字符串或数组
      responses: [],  // 新增：存储响应 ID
      completed: false, // 新增：请求是否完成
      responseCount: 0 // 新增：已接收的响应数量
    };
    // 4. 根据消息请求模式和角色处理请求
    switch (this.messageRequestMode) {
      case 'Default':
        if (role === 'guest') {
          // 将 guest 请求添加到队列
          if (!this.guestRequestQueues[roomName]) {
            this.guestRequestQueues[roomName] = [];
          }
          this.guestRequestQueues[roomName].push(llmRequest);

        } else if (role === 'master') {
          // 合并 guest 请求 (如果存在)
          const guestRequests = this.guestRequestQueues[roomName];
          if (guestRequests && guestRequests.length > 0) {
            llmRequest = this.mergeMessages([...guestRequests, llmRequest]);
            delete this.guestRequestQueues[roomName]; // 清空队列
          }
          // 转发给 SillyTavern 扩展端
          this.forwardLlmRequest(target, llmRequest);
        } else if (role === 'special') {
          //特殊请求拥有仅次于master的优先级，但仍然需要等待master请求
          if (!this.guestRequestQueues[roomName]) {
            this.guestRequestQueues[roomName] = [];
          }
          this.guestRequestQueues[roomName].push(llmRequest);
        }
        break;

      case 'Immediate':
        // 立即转发所有请求 (无需区分角色)
        this.forwardLlmRequest(target, llmRequest);
        break;

      // ... 其他模式 ...
      case 'MasterOnly':
        if (role === 'master') {
          this.forwardLlmRequest(target, llmRequest);
        }
        break;
      case 'Separate':
        this.forwardLlmRequest(target, llmRequest);
        break;

      default:
        console.warn('Unknown message request mode:', this.messageRequestMode);
    }
  }

  /**
   * 转发 LLM 请求给 SillyTavern 扩展端。
   * @param {string | string[]} target - 目标 SillyTavern 扩展端的 clientId (或 clientId 数组)。
   * @param {object} request - 请求数据。
   */
  forwardLlmRequest(target, request) {
    if (Array.isArray(target)) {
      // 如果 target 是数组，则向每个目标发送请求
      for (const t of target) {
        this.io.of(NAMESPACES.LLM).to(t).emit(MSG_TYPE.LLM_REQUEST, request);
      }
    } else {
      // 如果 target 是字符串，则直接发送请求
      this.io.of(NAMESPACES.LLM).to(target).emit(MSG_TYPE.LLM_REQUEST, request);
    }
  }

  /**
   * 处理 LLM 响应。
   * @param {string} roomName - 房间名
   * @param {object} data - 响应数据。
   */
  handleLlmResponse(roomName, data) {
    const { requestId } = data;

    // 1. 查找原始请求
    const originalRequest = this.llmRequests[requestId];

    if (!originalRequest) {
      console.warn(`No matching request found for requestId: ${requestId}`);
      return;
    }

    // 2. 为每个响应生成唯一的 responseId
    const responseId = uuidv4();
    const fullResponse = {
      ...data,
      responseId: responseId // 将 responseId 添加到响应数据中
    }
    // 3. 将响应添加到对应房间的llmResponseQueues中
    const messageId = this.addMessage(roomName, fullResponse, true);

    // 4. 将 responseId 添加到 llmRequests.responses 数组
    originalRequest.responses.push(responseId);
    originalRequest.responseCount++;
    // 5. 检查是否所有响应都已收到 (简化版，假设 target 数量已知)
    if (Array.isArray(originalRequest.target) && originalRequest.responseCount >= originalRequest.target.length) {
      originalRequest.completed = true;
      // (可选) 从 llmRequests 中移除已完成的请求
      // delete this.llmRequests[requestId];
      // 或者添加到 completedRequests 集合，稍后统一清理
    }
  }

  /**
   * 获取离线消息。
   * @param {string} clientId - 客户端 ID。
   * @param {string | null} lastMessageId - 最后接收到的消息 ID (如果为空，则获取所有消息)。
   * @returns {object[] | null} - 离线消息数组 (如果未找到房间或消息，则返回 null)。
   */
  getOfflineMessages(clientId, lastMessageId) {
    const roomName = clientId; // 假设房间名与 clientId 相同
    if (!this.rooms[roomName]) {
      warn('Room not found', { clientId, roomName }, 'GET_OFFLINE_MESSAGES');
      return null; // 房间不存在
    }

    const messageQueue = this.rooms[roomName].messageQueue;

    if (!lastMessageId) {
      // 返回所有消息
      info('Returning all messages', { clientId, roomName });
      return messageQueue;
    }

    const lastMessageIndex = messageQueue.findIndex(msg => msg.messageId === lastMessageId);

    if (lastMessageIndex === -1) {
      warn('Last message not found', { clientId, roomName, lastMessageId }, 'GET_OFFLINE_MESSAGES');
      return null; // 未找到最后接收的消息
    }

    // 返回 lastMessageIndex 之后的所有消息
    return messageQueue.slice(lastMessageIndex + 1);
  }

  // ... 方法 ...
}

export { ChatModule };