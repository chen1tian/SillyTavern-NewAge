// lib/memberManagement.js
import { NAMESPACES, MSG_TYPE } from './constants.js';
import { logger, error, warn, info } from '../dist/logger.js'; // 导入 logger

class MemberManagement {
  constructor(io, chatModule) {
    this.io = io;
    this.chatModule = chatModule; // 传入 ChatModule 实例, 以便访问 rooms 等信息
    this.members = {}; // { [clientId]: Member }
  }

  /**
   * 添加成员 (在客户端连接时调用)。
   * @param {string} clientId - 客户端 ID。
   * @param {string} clientType - 客户端类型。
   * @param {object} [memberData={}] - 成员数据 (可选, 例如昵称、头像等)。
   */
  addMember(clientId, clientType, memberData = {}) {
    if (this.members[clientId]) {
      warn(`Member with clientId ${clientId} already exists. Overwriting.`, {}, 'MEMBER_WARNING');
    }

    this.members[clientId] = {
      clientId: clientId,
      clientType: clientType,
      ...memberData, // 合并成员数据
    };
    info(`Add member ${clientId} successfully.`);
  }

  /**
   * 移除成员 (在客户端断开连接时调用)。
   * @param {string} clientId - 客户端 ID。
   */
  removeMember(clientId) {
    if (!this.members[clientId]) {
      warn(`Member with clientId ${clientId} not found.`, {}, 'MEMBER_WARNING');
      return;
    }

    // 从所有房间中移除该成员
    const rooms = this.chatModule.rooms
    for (let roomName in rooms) {
      if (rooms[roomName].members.has(clientId)) {
        rooms[roomName].members.delete(clientId)
        this.notifyRoomMasterAndManagers(roomName, MSG_TYPE.MEMBER_LEFT, { clientId });
      }
    }

    delete this.members[clientId];
    info(`Remove member ${clientId} successfully.`);
  }

  /**
   * 获取成员信息。
   * @param {string} clientId - 客户端 ID。
   * @returns {object | null} - 成员信息对象，如果未找到则返回 null。
   */
  getMember(clientId) {
    return this.members[clientId] || null;
  }

  // 获取所有成员
  getAllMembers() {
    return this.members;
  }

  /**
   * 设置成员角色。
   * @param {string} clientId - 客户端 ID。
   * @param {string} roomName - 房间名。
   * @param {string} role - 新角色 ('master', 'manager', 'guest')。
   *  @returns {boolean} - 是否设置成功
   */
  setMemberRole(clientId, roomName, role) {
    return this.chatModule.changeClientRole(clientId, roomName, role);
  }

  /**
   * 将成员踢出房间。
   * @param {string} clientId - 要踢出的客户端 ID。
   * @param {string} roomName - 房间名。
   *  @returns {boolean} - 是否踢出成功
   */
  kickMember(clientId, roomName) {
    if (!this.chatModule.rooms[roomName] || !this.chatModule.rooms[roomName].members.has(clientId)) {
      warn(`Either room ${roomName} or client ${clientId} in the room not found.`, {}, 'MEMBER_WARNING');
      return false; // 房间或成员不存在
    }

    // 从房间中移除成员
    return this.chatModule.leaveRoom(clientId, roomName);
  }

  /**
   * 禁言成员 (TODO: 实现此功能)。
   * @param {string} clientId - 要禁言的客户端 ID。
   * @param {string} roomName - 房间名。
   * @param {number} duration - 禁言时长 (秒)。
   */
  muteMember(clientId, roomName, duration) {
    // TODO: 实现禁言逻辑 (例如，添加一个 mutedUntil 时间戳到 member 对象)
  }

  /**
   * 向房间的 master 和 manager 发送通知 (内部方法)。
   * @param {string} roomName - 房间名。
   * @param {string} eventName - 事件名称。
   * @param {object} data - 事件数据。
   */
  notifyRoomMasterAndManagers(roomName, eventName, data) {
    const room = this.chatModule.rooms[roomName];
    if (!room) {
      return;
    }

    // 发送给 master
    if (room.master) {
      this.io.to(room.master).emit(eventName, data);
    }

    // 发送给 managers
    for (const managerId of room.managers) {
      this.io.to(managerId).emit(eventName, data);
    }
  }

  // ... 其他成员管理相关的方法 ...
}

export { MemberManagement };