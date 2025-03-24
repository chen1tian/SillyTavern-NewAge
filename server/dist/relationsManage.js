// server/dist/relationsManage.js
import { NAMESPACES, MSG_TYPE } from '../lib/constants.js';
import { logger, error, warn, info } from '../dist/logger.js'; // 导入 logger

class RelationsManage {
  constructor(io) {
    this.io = io;
    this.connectionPolicy = 'Free'; // 默认连接策略
    this.manualAssignments = {}; // 手动分配
    this.assignments = {}; // 实际分配
    this.connectedExtensions = []; //已连接的扩展
    this.connectedClientRooms = [];//已连接的客户端
  }

  /**
   * 设置连接策略。
   * @param {string} policy - 连接策略 ('Free', 'Manual', 'Balanced', 'Broadcast', 'Random')。
   * @returns {boolean} - 是否设置成功。
   */
  setConnectionPolicy(policy) {
    if (!['Free', 'Manual', 'Balanced', 'Broadcast', 'Random'].includes(policy)) {
      warn('Invalid connection policy', { policy }, 'SET_CONNECTION_POLICY');
      return false;
    }

    this.connectionPolicy = policy;
    this.updateAssignments(); // 重新计算分配
    this.broadcastAvailableExtensions(); // 广播更新
    info('Connection policy set', { policy }, 'SET_CONNECTION_POLICY');
    return true;
  }

  /**
   * 获取当前连接策略。
   * @returns {string} - 当前连接策略。
   */
  getConnectionPolicy() {
    return this.connectionPolicy;
  }

  /**
   * 手动分配扩展端给客户端房间。
   * @param {string} clientRoom - 客户端房间名。
   * @param {string[]} extensions - 要分配的扩展端 clientId 数组。
   * @returns {object} -  { success: boolean, error?: string }
   */
  assignExtensionToClient(clientRoom, extensions) {
    if (this.connectionPolicy !== 'Manual') {
      warn('Manual assignment is only allowed in Manual mode', { clientRoom, extensions }, 'ASSIGN_EXTENSION_TO_CLIENT');
      return { success: false, error: 'Manual assignment is only allowed in Manual mode' };
    }

    // 检查房间是否存在
    if (!this.connectedClientRooms.includes(clientRoom)) {
      warn('Client room not found', { clientRoom }, 'ASSIGN_EXTENSION_TO_CLIENT');
      return { success: false, error: 'Client room not found' };
    }

    // 检查所有扩展是否存在
    for (const extensionId of extensions) {
      if (!this.connectedExtensions.includes(extensionId)) {
        warn('Extension not found', { extensionId }, 'ASSIGN_EXTENSION_TO_CLIENT');
        return { success: false, error: `Extension not found: ${extensionId}` };
      }
    }

    this.manualAssignments[clientRoom] = extensions;
    this.updateAssignments();
    this.broadcastAvailableExtensions();
    info('Extension assigned to client', { clientRoom, extensions }, 'ASSIGN_EXTENSION_TO_CLIENT');
    return { success: true };
  }

  /**
   * 获取当前分配 (所有房间的)。
   * @returns {object} - 当前分配 ({ [clientRoom]: string[] })。
   */
  getAssignments() {
    return this.assignments;
  }

  /**
   * 获取指定房间的分配。
   * @param {string} clientRoom - 客户端房间名。
   * @returns {string[]} - 分配给该房间的扩展端 clientId 数组。
   */
  getAssignmentsForRoom(clientRoom) {
    return this.assignments[clientRoom] || [];
  }

  /**
   * 更新分配 (根据连接策略)。
   */
  updateAssignments() {
    this.assignments = {}; // 清空旧的分配
    info('Updating assignments based on policy:', this.connectionPolicy);
    if (this.connectionPolicy === 'Free') {
      // 所有客户端都可以访问所有已连接的 SillyTavern 扩展端
      for (const clientRoom of this.connectedClientRooms) {
        this.assignments[clientRoom] = this.connectedExtensions;
      }
    } else if (this.connectionPolicy === 'Manual') {
      // 使用管理员的手动分配
      this.assignments = { ...this.manualAssignments };
    } else if (this.connectionPolicy === 'Balanced') {
      // 均衡分配 (简化版示例)
      let extensionIndex = 0;
      if (this.connectedExtensions.length > 0) { // 检查是否为空
        for (const clientRoom of this.connectedClientRooms) {
          this.assignments[clientRoom] = [];
          if (this.connectedExtensions.length > 0) {
            this.assignments[clientRoom].push(this.connectedExtensions[extensionIndex]);
            extensionIndex = (extensionIndex + 1) % this.connectedExtensions.length;
          }
        }
      }
    } else if (this.connectionPolicy === 'Broadcast') {
      // 所有客户端共享所有 SillyTavern 扩展端 (与 Free 相同)
      for (const clientRoom of this.connectedClientRooms) {
        this.assignments[clientRoom] = this.connectedExtensions;
      }
    } else if (this.connectionPolicy === 'Random') {
      // 随机分配 (简化版示例)

      if (this.connectedExtensions.length > 0) { // 检查是否为空
        for (const clientRoom of this.connectedClientRooms) {
          this.assignments[clientRoom] = [];
          if (this.connectedExtensions.length > 0) {
            const randomIndex = Math.floor(Math.random() * this.connectedExtensions.length);
            this.assignments[clientRoom].push(this.connectedExtensions[randomIndex]);
          }
        }
      }
    }
    info('Assignments updated:', this.assignments); // 记录详细的分配结果
  }

  /**
   * 广播可用扩展端列表给所有房间。
   */
  broadcastAvailableExtensions() {
    for (const clientRoom in this.assignments) {
      this.io.to(clientRoom).emit(MSG_TYPE.AVAILABLE_EXTENSIONS, { extensions: this.assignments[clientRoom] });
    }
  }

  /**
   * 添加已连接的扩展端。
   * @param {string} extensionId - 扩展端 clientId。
   */
  addConnectedExtension(extensionId) {
    if (!this.connectedExtensions.includes(extensionId)) {
      this.connectedExtensions.push(extensionId);
      this.updateAssignments(); // 重新计算
      this.broadcastAvailableExtensions();
      info('Extension connected', { extensionId }, 'EXTENSION_CONNECTED');
    }
  }

  /**
    * 移除已断开连接的扩展端。
    * @param {string} extensionId - 扩展端 clientId。
    */
  removeConnectedExtension(extensionId) {
    const index = this.connectedExtensions.indexOf(extensionId);
    if (index > -1) { // 更明确的检查
      this.connectedExtensions.splice(index, 1);
      this.updateAssignments(); // 重新计算
      this.broadcastAvailableExtensions();
      info('Extension disconnected', { extensionId }, 'EXTENSION_DISCONNECTED');
    }
  }

  /**
   * 添加客户端房间。
   *  @param {string} clientRoom - 客户端房间ID
   */
  addClientRooms(clientRoom) {
    if (!this.connectedClientRooms.includes(clientRoom)) {
      this.connectedClientRooms.push(clientRoom);
      this.updateAssignments(); // 重新计算
      this.broadcastAvailableExtensions();
      info('Client rooms connected', { clientRoom }, 'CLIENT_CONNECTED');
    }
  }

  /**
   * 移除客户端房间。
   *  @param {string} clientRoom - 客户端房间ID
   */
  removeClientRooms(clientRoom) {
    const index = this.connectedClientRooms.indexOf(clientRoom);
    if (index > -1) { //更明确的检查
      this.connectedClientRooms.splice(index, 1);
      this.updateAssignments(); // 重新计算
      this.broadcastAvailableExtensions();
      info('Client rooms disconnected', { clientRoom }, 'CLIENT_DISCONNECTED');
    }
  }
}

export { RelationsManage };