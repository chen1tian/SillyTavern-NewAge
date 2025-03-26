// server/dist/roomManagement.js

import { NAMESPACES, MSG_TYPE } from '../lib/constants.js';
import * as SocketRooms from './Rooms.js'; // 底层 Socket.IO 房间操作
import { logger, error, warn, info } from './logger.js';
import { serverSettings } from '../server.js'; // 导入服务器设置以获取默认模式
import { eventEmitter } from 'events';

// 定义有效的房间模式常量
const VALID_ROOM_MODES = ['Immediate', 'HostSubmit', 'MasterOnly', 'Conversational'];

var event = new eventEmitter();

class RoomManagement {
  /**
   * @param {import('socket.io').Server} io - Socket.IO 服务器实例。
   * @param {MemberManagement} memberManagement - MemberManagement 实例，用于通知。
   */
  constructor(io, memberManagement) {
    /** @type {import('socket.io').Server} io - Socket.IO 服务器实例 */
    this.io = io;
    /** @type {MemberManagement} memberManagement - MemberManagement 实例 */
    this.memberManagement = memberManagement;
    /**
     * @property {object} rooms - 存储房间信息的对象。键是 roomName。
     * @example
     * {
     *   [roomName]: {
     *     name: string;           // 房间名
     *     members: Set<string>;   // 成员 identity 集合
     *     master: string | null;  // 房主 identity
     *     managers: Set<string>;  // 管理员 identity 集合
     *     guests: Set<string>;    // 访客 identity 集合
     *     requestQueue: object[]; // **新增：存储客户端请求消息的队列**
     *     messageRequestMode: string;
     *     createdAt: Date;       // 创建时间
     *   }
     * }
     */
    this.rooms = {};
    /** @property {string} defaultMode - 新房间的默认模式 */
    this.defaultMode = serverSettings.defaultRoomMessageRequestMode || 'Immediate'; // 从设置加载
    if (!VALID_ROOM_MODES.includes(this.defaultMode)) {
      warn(`Invalid defaultRoomMessageRequestMode '${this.defaultMode}' in settings. Falling back to 'Immediate'.`, {}, 'INIT_WARN');
      this.defaultMode = 'Immediate';
    }
    info('RoomManagement initialized.', {}, 'INIT');
  }

  /**
   * 创建房间。房间名强制等于创建者 identity。
   * @param {string} creatorIdentity - 创建者 identity (也将作为房间名)。
   * @returns {boolean} - 是否成功创建。
   */
  createRoom(creatorIdentity) {
    const roomName = creatorIdentity; // 强制房间名等于创建者 identity
    if (this.rooms[roomName]) {
      warn(`Room ${roomName} already exists.`, {}, 'ROOM_CREATE_WARN');
      return false;
    }

    // 使用底层 SocketRooms 创建房间
    try {
      SocketRooms.createRoom(roomName, creatorIdentity);
    } catch (e) {
      error('Error creating room using SocketRooms.js:', { error: e }, 'ROOM_CREATE_ERROR');
      return false;
    }

    // 创建 RoomInfo 对象并添加到 this.rooms
    this.rooms[roomName] = {
      name: roomName,
      members: new Set([creatorIdentity]), // 初始成员：创建者
      master: creatorIdentity,             // 房主是创建者
      managers: new Set(),
      guests: new Set(), // 创建者直接是 master，不在 guests 里
      requestQueue: [],
      messageRequestMode: this.defaultMode,
      createdAt: new Date(),
    };
    info(`Room ${roomName} created successfully by ${creatorIdentity}.`, {}, 'ROOM_CREATED');
    // 不需要在这里调用 changeClientRole，因为创建时直接设为 master

    return true;
  }

  /**
   * 为 SillyTavern 扩展端创建房间 (通常仅包含扩展自身)。
   * @param {string} identity - SillyTavern 扩展端的 identity。
   */
  createExtensionRoom(identity) {
    const roomName = identity;
    if (this.rooms[roomName]) {
      // 通常不应该发生，但处理一下
      warn(`Extension room ${roomName} already exists.`, {}, 'ROOM_EXT_CREATE_WARN');
      return;
    }
    // 扩展房间通常只有自己，作为 master
    this.rooms[roomName] = {
      name: roomName,
      members: new Set([identity]),
      master: identity,
      managers: new Set(),
      guests: new Set(),
      requestQueue: [],
      messageRequestMode: this.defaultMode,
      createdAt: new Date(),
    };
    info(`Extension room ${roomName} created.`, {}, 'ROOM_EXT_CREATED');
    // 使用底层 SocketRooms 创建房间
    try {
      SocketRooms.createRoom(roomName, creatorIdentity);
    } catch (e) {
      error('Error creating room using SocketRooms.js:', { error: e }, 'ROOM_CREATE_ERROR');
      return false;
    }
  }


  /**
   * 删除房间。
   * @param {string} roomName - 房间名。
   * @returns {boolean} - 是否成功删除。
   */
  deleteRoom(roomName) {
    if (!this.rooms[roomName]) {
      warn(`Room ${roomName} not found for deletion.`, {}, 'ROOM_DELETE_WARN');
      return false;
    }

    const membersToNotify = Array.from(this.rooms[roomName].members);

    // 使用底层 SocketRooms 将所有客户端移出房间 (如果需要管理 Socket.IO 房间状态)
    // try {
    //   SocketRooms.deleteRoom(roomName); // 这会将所有 socket 移出
    // } catch (e) {
    //   error('Error deleting room using SocketRooms.js:', { error: e }, 'ROOM_DELETE_ERROR');
    //   // 可以选择继续执行或返回 false
    // }

    // 从 this.rooms 中移除房间信息
    delete this.rooms[roomName];
    info(`Room ${roomName} deleted successfully.`, {}, 'ROOM_DELETED');

    // 通知所有原成员房间已被删除
    if (membersToNotify.length > 0) {
      const notificationData = { roomName: roomName, message: `Room "${roomName}" has been deleted.` };
      this.io.of(NAMESPACES.ROOMS).to(membersToNotify).emit(MSG_TYPE.DELETE_ROOM, notificationData); // 需要定义 ROOM_DELETED 事件
      // 强制断开或移出可能不再有效的房间
      this.io.of(NAMESPACES.ROOMS).in(roomName).socketsLeave(roomName);
    }

    return true;
  }

  /**
   * 将客户端加入房间。
   * @param {string} identity - 客户端 identity。
   * @param {string} roomName - 房间名。
   * @param {string} [role='guest'] - 角色 ('guest', 'manager', 'master')。
   * @returns {boolean} - 是否成功加入。
   */
  joinRoom(identity, roomName, role = 'guest') {
    if (!this.rooms[roomName]) {
      warn(`Attempted to join non-existent room ${roomName}.`, { identity }, 'ROOM_JOIN_WARN');
      return false;
    }
    const room = this.rooms[roomName];
    if (room.members.has(identity)) {
      warn(`Client ${identity} is already in room ${roomName}.`, {}, 'ROOM_JOIN_WARN');
      return false; // 已经在房间里
    }

    // 使用底层 SocketRooms 将客户端加入 Socket.IO 房间
    try {
      SocketRooms.addClientToRoom(identity, roomName);
    } catch (e) {
      error('Error adding client to Socket.IO room:', { error: e, identity, roomName }, 'ROOM_JOIN_ERROR');
      return false;
    }

    // 更新房间成员列表和角色
    room.members.add(identity);
    this._updateMemberRoleInternal(room, identity, role); // 使用内部方法更新角色集合

    info(`Client ${identity} joined room ${roomName} as ${role}.`, {}, 'ROOM_JOINED');

    event.emit('system_message', roomName, `[System] ${identity} has joined the room as ${role}.`);

    // 通知房间内的 master 和 managers (使用 MemberManagement)
    this.memberManagement.notifyRoomMasterAndManagers(roomName, MSG_TYPE.MEMBER_JOINED, {
      clientId: identity, // 保持字段名兼容性
      identity: identity,
      roomName: roomName,
      role: role
    });

    // 通知新加入的成员其角色
    this.io.of(NAMESPACES.ROOMS).to(identity).emit(MSG_TYPE.MEMBER_ROLE_CHANGED, {
      clientId: identity,
      identity: identity,
      roomName: roomName,
      role: role
    });

    return true;
  }

  /**
   * 将客户端从房间移除。
   * @param {string} identity - 客户端 identity。
   * @param {string} roomName - 房间名。
   * @returns {boolean} - 是否成功离开。
   */
  leaveRoom(identity, roomName) {
    if (!this.rooms[roomName]) {
      warn(`Room ${roomName} not found for leaving.`, { identity }, 'ROOM_LEAVE_WARN');
      return false;
    }
    const room = this.rooms[roomName];
    if (!room.members.has(identity)) {
      warn(`Client ${identity} is not in room ${roomName} to leave.`, {}, 'ROOM_LEAVE_WARN');
      return false; // 不在房间里
    }
    // 禁止离开与 identity 同名的房间 (个人房间)
    if (roomName === identity) {
      warn(`Client ${identity} attempted to leave their own default room ${roomName}. Preventing.`, {}, 'ROOM_LEAVE_DENIED');
      return false;
    }

    // 使用底层 SocketRooms 将客户端从 Socket.IO 房间移除
    try {
      SocketRooms.removeClientFromRoom(identity, roomName);
    } catch (e) {
      error('Error removing client from Socket.IO room:', { error: e, identity, roomName }, 'ROOM_LEAVE_ERROR');
      // 可以选择继续或返回 false
    }

    // 更新房间成员列表和角色集合
    room.members.delete(identity);
    this._removeMemberRoleInternal(room, identity); // 从所有角色集合中移除

    info(`Client ${identity} left room ${roomName}.`, {}, 'ROOM_LEFT');

    event.emit('system_message', roomName, `[System] ${identity} has joined the room as ${role}.`);

    // 通知房间内的 master 和 managers (使用 MemberManagement)
    this.memberManagement.notifyRoomMasterAndManagers(roomName, MSG_TYPE.MEMBER_LEFT, {
      clientId: identity,
      identity: identity,
      roomName: roomName
    });

    // 如果房间为空，并且不是某个用户的个人房间，则删除 (可选)
    // if (room.members.size === 0 && !this.isPersonalRoom(roomName)) {
    //   this.deleteRoom(roomName);
    // }

    return true;
  }

  /**
   * 获取房间内的成员列表。
   * @param {string} roomName - 房间名。
   * @returns {string[] | null} - 成员 identity 数组，如果房间不存在则返回 null。
   */
  getRoomMembers(roomName) {
    if (!this.rooms[roomName]) {
      return null;
    }
    return Array.from(this.rooms[roomName].members);
  }

  /**
   * 获取所有房间的列表（只包含房间名）。
   * @returns {string[]}
   */
  getRoomList() {
    return Object.keys(this.rooms);
  }

  /**
 * 获取指定房间的信息。
 * @param {string} roomName - 房间名。
 * @returns {object | null} - 房间信息对象，如果不存在则返回 null。
 */
  getRoomInfo(roomName) {
    const room = this.rooms[roomName];
    if (!room) return null;
    // 返回一个不包含 requestQueue 的副本，避免外部直接修改队列
    const { requestQueue, ...roomInfo } = room;
    return roomInfo;
  }

  /**
   * 获取指定房间当前的消息请求模式。
   * @param {string} roomName - 房间名。
   * @returns {string | null} - 房间的消息请求模式，如果房间不存在则返回 null。
   */
  getRoomMessageRequestMode(roomName) {
    return this.rooms[roomName]?.messageRequestMode || null;
  }

  getMemberRole(identity, roomName) {
    const room = this.rooms[roomName];
    if (!room || !room.members.has(identity)) return null; // 不在房间
    if (room.master === identity) return 'master';
    if (room.managers.has(identity)) return 'manager';
    if (room.guests.has(identity)) return 'guest';
    return null; // 理论上不应发生
  }

  /**
   * 更改客户端在指定房间的角色。
   * @param {string} identity - 客户端 identity。
   * @param {string} roomName - 房间名。
   * @param {string} newRole - 新角色 ('guest', 'manager', 'master')。
   * @returns {boolean} - 是否成功更改。
   */
  changeMemberRole(identity, roomName, newRole) {
    if (!this.rooms[roomName]) {
      warn(`Room ${roomName} not found for role change.`, { identity, newRole }, 'ROLE_CHANGE_WARN');
      return false;
    }
    const room = this.rooms[roomName];
    if (!room.members.has(identity)) {
      warn(`Client ${identity} not in room ${roomName} for role change.`, { newRole }, 'ROLE_CHANGE_WARN');
      return false; // 成员不在房间内
    }
    if (!['guest', 'manager', 'master'].includes(newRole)) {
      warn(`Invalid role specified: ${newRole}`, { identity, roomName }, 'ROLE_CHANGE_WARN');
      return false;
    }

    // 更新内部角色集合
    this._updateMemberRoleInternal(room, identity, newRole);

    info(`Changed role of ${identity} in room ${roomName} to ${newRole}.`, {}, 'ROLE_CHANGED');

    // 通知被更改角色的客户端
    this.io.of(NAMESPACES.ROOMS).to(identity).emit(MSG_TYPE.MEMBER_ROLE_CHANGED, {
      clientId: identity,
      identity: identity,
      roomName: roomName,
      role: newRole
    });

    // 通知房间管理员角色变更 (可选)
    this.memberManagement.notifyRoomMasterAndManagers(roomName, MSG_TYPE.MEMBER_ROLE_CHANGED, {
      targetIdentity: identity,
      newRole: newRole
    });

    return true;
  }

  /**
   * 设置指定房间的消息请求模式。
   * @function setRoomMessageRequestMode
   * @param {string} roomName - 要设置的房间名。
   * @param {string} mode - 新的模式。
   * @param {string} [setterIdentity=null] - 执行设置操作的用户 identity (用于日志记录)。
   * @returns {boolean} 是否设置成功。
   */
  setRoomMessageRequestMode(roomName, mode, setterIdentity = null) {
    const room = this.rooms[roomName];
    if (!room) {
      warn(`Room ${roomName} not found when trying to set mode.`, { mode, setterIdentity }, 'SET_ROOM_MODE_WARN');
      return false;
    }
    // 验证模式是否有效
    if (!VALID_ROOM_MODES.includes(mode)) {
      warn(`Invalid mode '${mode}' specified for room ${roomName}.`, { setterIdentity }, 'SET_ROOM_MODE_WARN');
      return false;
    }

    if (room.messageRequestMode === mode) {
      info(`Room ${roomName} mode is already ${mode}. No change made.`, { setterIdentity }, 'SET_ROOM_MODE');
      return true; // 模式未改变，也算成功（无操作）
    }

    const oldMode = room.messageRequestMode;
    room.messageRequestMode = mode;
    info(`Changed message request mode for room ${roomName} from ${oldMode} to ${mode}.`, { setterIdentity }, 'SET_ROOM_MODE');

    // *** 广播模式变更事件给房间内所有成员 ***
    const modeChangeData = {
      roomName: roomName,
      mode: mode,
      setter: setterIdentity, // 可以包含设置者信息
    };
    this.io.of(NAMESPACES.ROOMS).to(roomName).emit(MSG_TYPE.ROOM_MODE_CHANGED, modeChangeData); // 需要定义 ROOM_MODE_CHANGED
    debug(`Broadcast ROOM_MODE_CHANGED for room ${roomName}.`, { mode }, 'SET_ROOM_MODE_BCAST');

    // 如果从 Conversational 切换出去，可能需要清理计时器
    if (oldMode === 'Conversational' && mode !== 'Conversational') {
      this.clearConversationalTimer(roomName);
    }

    return true;
  }

  /**
   * 清理指定房间的 Conversational 模式计时器。
   * @param {string} roomName
   */
  clearConversationalTimer(roomName) {
    // 这个计时器状态实际存储在 ChatModule，所以 RoomManagement 需要通知 ChatModule
    // 或者将计时器状态也移到 RoomManagement
    // 简单的做法是 RoomManagement 发出一个内部事件，ChatModule 监听并处理
    eventEmitter.emit('clear_conversational_timer', roomName);
    // 或者直接调用 ChatModule 的方法 (如果存在循环依赖问题，则事件更好)
    // this.chatModule.clearConversationalTimerForRoom(roomName); // 假设 ChatModule 有此方法
    info(`Conversational timer clear requested for room ${roomName} due to mode change.`, {}, 'CONV_TIMER_CLEAR');
  }

  /**
   * 查找指定成员所在的所有房间。
   * @function findRoomsForMember
   * @param {string} identity - 要查找的成员的 identity。
   * @returns {string[]} - 包含该成员的所有房间名的数组。
   */
  findRoomsForMember(identity) {
    const memberRooms = [];
    if (!identity) {
      warn('findRoomsForMember called with empty identity.', {}, 'ROOM_FIND_WARN');
      return memberRooms; // 返回空数组
    }
    // 遍历所有房间
    for (const roomName in this.rooms) {
      // 检查房间是否存在以及成员集合是否存在
      if (this.rooms.hasOwnProperty(roomName) && this.rooms[roomName]?.members) {
        // 检查成员是否在该房间的 members 集合中
        if (this.rooms[roomName].members.has(identity)) {
          memberRooms.push(roomName);
        }
      }
    }
    debug(`Found ${memberRooms.length} rooms for member ${identity}.`, { rooms: memberRooms }, 'ROOM_FIND');
    return memberRooms;
  }

  /**
   * 内部方法：更新成员在指定房间对象中的角色集合。
   * @param {object} room - 房间信息对象 (this.rooms[roomName])。
   * @param {string} identity - 成员 identity。
   * @param {string} newRole - 新角色。
   * @private
   */
  _updateMemberRoleInternal(room, identity, newRole) {
    // 先从所有角色集合中移除
    this._removeMemberRoleInternal(room, identity);

    // 再添加到新的角色集合
    if (newRole === 'master') {
      room.master = identity; // 更新房主
    } else if (newRole === 'manager') {
      room.managers.add(identity);
    } else { // guest
      room.guests.add(identity);
    }
  }

  /**
   * 内部方法：移除成员的角色，并返回其旧角色（可选）。
   * @param {object} room
   * @param {string} identity
   * @returns {string | null} 返回被移除前的角色，如果未找到则返回 null。
   * @private
   */
  _removeMemberRoleInternal(room, identity) {
    let oldRole = null;
    if (room.master === identity) {
      oldRole = 'master';
      room.master = null;
      warn(`Master ${identity} left room ${room.name}. Room currently has no master.`, {}, 'ROOM_MASTER_LEFT');
      // TODO: 可以在这里添加选举新 Master 的逻辑
    } else if (room.managers.has(identity)) {
      oldRole = 'manager';
      room.managers.delete(identity);
    } else if (room.guests.has(identity)) {
      oldRole = 'guest';
      room.guests.delete(identity);
    }
    return oldRole;
  }

  /**
   * 向指定房间的请求队列添加一条消息。
   * @function addRequestMessage
   * @param {string} roomName - 房间名。
   * @param {object} message - 要添加的消息对象 (应已包含 messageId, identity, timestamp)。
   * @returns {boolean} - 是否添加成功。
   */
  addRequestMessage(roomName, message) {
    const room = this.rooms[roomName];
    if (!room) {
      warn(`Room ${roomName} not found when trying to add request message.`, { messageId: message?.messageId }, 'ROOM_MSG_WARN');
      return false;
    }
    if (!room.requestQueue) {
      // 以防万一队列未初始化
      room.requestQueue = [];
      warn(`Request queue for room ${roomName} was not initialized. Initializing now.`, {}, 'ROOM_MSG_WARN');
    }
    room.requestQueue.push(message);
    debug(`Added request message ${message.messageId} to room ${roomName}. Queue size: ${room.requestQueue.length}`, {}, 'ROOM_MSG_ADD');
    return true;
  }

  /**
   * 获取指定房间的请求消息队列。
   * 返回的是队列的浅拷贝，以防止外部直接修改。
   * @function getRequestMessages
   * @param {string} roomName - 房间名。
   * @returns {object[] | null} - 请求消息数组的浅拷贝，如果房间不存在则返回 null。
   */
  getRequestMessages(roomName) {
    const room = this.rooms[roomName];
    // 返回浅拷贝以防止外部修改原始队列
    return room?.requestQueue ? [...room.requestQueue] : null;
  }

  /**
     * 编辑请求消息。
     * @param {string} roomName
     * @param {string} messageId
     * @param {object} updatedFields
     * @returns {object | null} 返回更新后的完整消息对象，如果失败则返回 null。
     */
  editRequestMessage(roomName, messageId, updatedFields) {
    const room = this.rooms[roomName];
    if (!room?.requestQueue) return null;
    const messageIndex = room.requestQueue.findIndex(msg => msg.messageId === messageId);
    if (messageIndex === -1) return null;
    room.requestQueue[messageIndex] = { ...room.requestQueue[messageIndex], ...updatedFields, lastEdited: new Date() };
    info(`Edited request message ${messageId} in room ${roomName} (RoomManagement).`, {}, 'ROOM_MSG_EDIT');
    return room.requestQueue[messageIndex]; // 返回更新后的对象
  }

  /**
     * 删除请求消息。
     * @param {string} roomName
     * @param {string[]} messageIds
     * @returns {string[]} 返回实际被删除的消息 ID 列表。
     */
  deleteRequestMessages(roomName, messageIds) {
    const room = this.rooms[roomName];
    if (!room?.requestQueue) return [];
    const idsToDelete = new Set(messageIds);
    if (idsToDelete.size === 0) return [];
    const deletedIds = [];
    const originalLength = room.requestQueue.length;
    room.requestQueue = room.requestQueue.filter(msg => {
      if (idsToDelete.has(msg.messageId)) {
        deletedIds.push(msg.messageId);
        return false; // 不保留
      }
      return true; // 保留
    });
    const deletedCount = originalLength - room.requestQueue.length;
    if (deletedCount > 0) {
      info(`Deleted ${deletedCount} request message(s) from room ${roomName} (RoomManagement).`, { ids: deletedIds }, 'ROOM_MSG_DELETE');
    }
    return deletedIds; // 返回实际删除的 ID 列表
  }

  /**
   * 清空指定房间的请求消息队列。
   * @function clearRequestMessages
   * @param {string} roomName - 房间名。
   * @returns {boolean} - 是否成功清空（如果队列存在且被清空）。
   */
  clearRequestMessages(roomName) {
    const room = this.rooms[roomName];
    if (room?.requestQueue) {
      if (room.requestQueue.length > 0) {
        room.requestQueue = [];
        info(`Cleared request messages for room ${roomName}.`, {}, 'ROOM_MSG_CLEAR');
        return true;
      }
      return false; // 队列已空，不算成功清空新内容
    }
    warn(`Room ${roomName} or its request queue not found for clearing.`, {}, 'ROOM_MSG_CLEAR_WARN');
    return false;
  }
}

export { RoomManagement };