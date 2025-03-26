// server/dist/memberManagement.js
import { NAMESPACES, MSG_TYPE } from '../lib/constants.js';
import { logger, error, warn, info } from '../dist/logger.js'; // 导入 logger

class MemberManagement {
  constructor(io, chatModule) {
    this.io = io;
    this.chatModule = chatModule; // 传入 ChatModule 实例, 以便访问 rooms 等信息
    /**
     * @property {object} members - 存储成员信息。
     * @example
     * {
     *   [identity]: {
     *     clientId: string; // identity
     *     clientType: string;
     *     desc: string;
     *     html: string;
     *     key: string;
     *     mutedUntil: Date | null; // **新增：禁言截止时间，null 表示未禁言**
     *   }
     * }
     */
    this.members = {};
  }

  /**
   * 添加成员 (在客户端连接时调用)。
   * @param {string} identity - 客户端 ID (现在应该是 identity)。
   * @param {string} clientType - 客户端类型。
   * @param {object} [memberData={}] - 成员数据 (可选, 例如昵称、头像等)。
   */
  addMember(identity, clientType, memberData = {}) { // 修改参数名为 identity
    if (this.members[identity]) { // 使用 identity
      warn(`Member with identity ${identity} already exists. Overwriting.`, {}, 'MEMBER_WARNING');
    }

    this.members[identity] = { // 使用 identity
      clientId: identity,
      clientType: clientType,
      desc: memberData.desc,
      html: memberData.html,
      key: memberData.key,
      ...memberData, // 合并成员数据
      mutedUntil: null, // **初始化为 null**
    };
    info(`Add member ${identity} successfully.`);
  }

  /**
   * 移除成员 (在客户端断开连接时调用)。
   * @param {string} identity - 客户端 ID (现在应该是 identity)。
   */
  removeMember(identity) { // 修改参数名为 identity
    if (!this.members[identity]) {  // 使用 identity
      warn(`Member with identity ${identity} not found.`, {}, 'MEMBER_WARNING');
      return;
    }
    const rooms = this.chatModule.roomManagement.findRoomsForMember(identity);
    rooms.forEach(roomName => {
      // RoomManagement 的 leaveRoom 会处理成员列表和角色
      // 这里无需重复操作 room.members.delete
      this.notifyRoomMasterAndManagers(roomName, MSG_TYPE.MEMBER_LEFT, { identity });
      // 清除可能残留的状态
      this.chatModule.broadcastMemberStatus(roomName, identity, MEMBER_STATUS.IDLE);
    });
    delete this.members[identity];
    info(`Remove member ${identity} successfully.`);
  }

  /**
* 获取成员信息。
* @param {string} identity - 客户端 ID。
* @returns {object | null} - 成员信息对象，如果未找到则返回 null。
*/
  getMember(identity) {  // 修改参数名为 identity
    return this.members[identity] || null;  // 使用 identity
  }

  // 获取所有成员
  getAllMembers() {
    return this.members;
  }

  /**
   * 设置成员角色。
   * @param {string} identity - 客户端 ID。
   * @param {string} roomName - 房间名。
   * @param {string} role - 新角色 ('master', 'manager', 'guest')。
   *  @returns {boolean} - 是否设置成功
   */
  setMemberRole(identity, roomName, role) {
    return this.chatModule.changeClientRole(identity, roomName, role);
  }

  /**
   * 将成员踢出房间。
   * @param {string} identity - 要踢出的客户端 ID。
   * @param {string} roomName - 房间名。
   *  @returns {boolean} - 是否踢出成功
   */
  kickMember(identity, roomName) {
    if (!this.chatModule.rooms[roomName] || !this.chatModule.rooms[roomName].members.has(identity)) {
      warn(`Either room ${roomName} or client ${identity} in the room not found.`, {}, 'MEMBER_WARNING');
      return false; // 房间或成员不存在
    }

    // 从房间中移除成员
    return this.chatModule.leaveRoom(identity, roomName);
  }

  /**
   * 检查成员当前是否被禁言。
   * @param {string} identity - 成员 identity。
   * @returns {boolean} 是否被禁言。
   */
  isMuted(identity) {
    const member = this.members[identity];
    if (!member || !member.mutedUntil) {
      return false; // 成员不存在或 mutedUntil 为 null/undefined
    }
    // 检查 mutedUntil 是否为未来的时间
    return member.mutedUntil > new Date();
  }

  /**
   * 禁言指定成员。
   * @param {string} targetIdentity - 要禁言的成员 identity。
   * @param {number} durationSeconds - 禁言时长（秒）。如果为 0 或负数，则表示永久禁言。
   * @param {string} muterIdentity - 执行禁言操作的用户 identity (用于日志和通知)。
   * @param {string} [roomName=null] - 可选，禁言发生的房间名 (用于日志和通知范围)。
   * @returns {boolean} 是否成功禁言。
   */
  muteMember(targetIdentity, durationSeconds, muterIdentity, roomName = null) {
    const targetMember = this.members[targetIdentity];
    if (!targetMember) {
      warn(`Attempted to mute non-existent member ${targetIdentity}.`, { muterIdentity, roomName }, 'MUTE_WARN');
      return false;
    }

    let mutedUntil;
    let durationText;
    if (durationSeconds <= 0) {
      // 永久禁言 (使用一个非常遥远的未来时间)
      mutedUntil = new Date('9999-12-31T23:59:59.999Z');
      durationText = 'permanently';
    } else {
      mutedUntil = new Date(Date.now() + durationSeconds * 1000);
      durationText = `for ${durationSeconds} seconds (until ${mutedUntil.toISOString()})`;
    }

    targetMember.mutedUntil = mutedUntil;
    info(`Member ${targetIdentity} muted ${durationText} by ${muterIdentity}.`, { roomName }, 'MEMBER_MUTED');

    // --- 发送 MEMBER_MUTED 事件 ---
    const muteData = {
      identity: targetIdentity,
      mutedBy: muterIdentity,
      mutedUntil: mutedUntil.toISOString(), // 发送 ISO 格式时间戳
      duration: durationSeconds <= 0 ? 'permanent' : durationSeconds,
      roomName: roomName, // 告知事件发生的上下文房间
    };
    // 1. 通知被禁言者
    this.io.of(NAMESPACES.LLM).to(targetIdentity).emit(MSG_TYPE.MEMBER_MUTED, muteData);
    // 2. (可选) 通知房间管理员或整个房间
    if (roomName) {
      // this.notifyRoomMasterAndManagers(roomName, MSG_TYPE.MEMBER_MUTED, muteData);
      // 或者广播给整个房间
      this.chatModule.broadcastMemberStatus(roomName, targetIdentity, 'muted'); // 可以用 status 或专门事件
      const eventText = durationSeconds <= 0
        ? `[System] ${targetIdentity} has been permanently muted by ${muterIdentity}.`
        : `[System] ${targetIdentity} has been muted by ${muterIdentity} for ${durationSeconds} seconds.`;
      this.chatModule.addSystemMessage(roomName, eventText); // 调用 ChatModule 添加系统消息
    }

    return true;
  }

  /**
   * 解除指定成员的禁言。
   * @param {string} targetIdentity - 要解除禁言的成员 identity。
   * @param {string} unmuterIdentity - 执行解除操作的用户 identity。
   * @param {string} [roomName=null] - 可选，解除禁言发生的房间名。
   * @returns {boolean} 是否成功解除或原本就未被禁言。
   */
  unmuteMember(targetIdentity, unmuterIdentity, roomName = null) {
    const targetMember = this.members[targetIdentity];
    if (!targetMember) {
      warn(`Attempted to unmute non-existent member ${targetIdentity}.`, { unmuterIdentity, roomName }, 'UNMUTE_WARN');
      return false;
    }

    if (!this.isMuted(targetIdentity)) {
      info(`Member ${targetIdentity} is not currently muted.`, { unmuterIdentity, roomName }, 'UNMUTE');
      return true; // 不算失败
    }

    targetMember.mutedUntil = null; // 解除禁言
    info(`Member ${targetIdentity} unmuted by ${unmuterIdentity}.`, { roomName }, 'MEMBER_UNMUTED');

    // --- 发送 MEMBER_UNMUTED 事件 ---
    const unmuteData = {
      identity: targetIdentity,
      unmutedBy: unmuterIdentity,
      roomName: roomName,
    };
    // 1. 通知被解除者
    this.io.of(NAMESPACES.LLM).to(targetIdentity).emit(MSG_TYPE.MEMBER_UNMUTED, unmuteData);
    // 2. (可选) 通知房间管理员或整个房间
    if (roomName) {
      // this.notifyRoomMasterAndManagers(roomName, MSG_TYPE.MEMBER_UNMUTED, unmuteData);
      this.chatModule.broadcastMemberStatus(roomName, targetIdentity, MEMBER_STATUS.IDLE);
      const eventText = `[System] ${targetIdentity} has been unmuted by ${unmuterIdentity}.`;
      this.chatModule.addSystemMessage(roomName, eventText); // 调用 ChatModule 添加系统消息
    }

    // --- Conversational 模式特殊处理 ---
    // 检查被解除的是否为扩展，并且是否在 Conversational 模式的房间中
    if (targetMember.clientType === 'extension' || targetMember.clientType === 'SillyTavern') {
      const rooms = this.chatModule.roomManagement.findRoomsForMember(targetIdentity);
      rooms.forEach(rName => {
        const mode = this.chatModule.roomManagement.getRoomMessageRequestMode(rName);
        if (mode === 'Conversational') {
          info(`Triggering post-unmute thinking for extension ${targetIdentity} in Conversational room ${rName}.`, {}, 'CONV_UNMUTE_THINK');
          // 延迟一小段时间再触发，避免过于即时
          setTimeout(() => {
            this.chatModule._triggerConversationalThink(rName, 'post_unmute'); // 调用 ChatModule 的后台思考方法
          }, serverSettings.postUnmuteThinkDelay || 2000); // 可配置延迟
        }
      });
    }

    return true;
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
    if (room.managers) {
      for (const managerId of room.managers) {
        this.io.to(managerId).emit(eventName, data);
      }
    }

  }

  // ... 其他成员管理相关的方法 ...
}

export { MemberManagement };