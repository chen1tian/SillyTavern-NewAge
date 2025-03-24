// server/dist/Rooms.js
import { NAMESPACES } from '../../lib/constants.js';
import { io } from '../server.js'; // 从 server.js 导入 io 对象

import { logger, error } from './logger.js'; // 导入 logger

// 添加客户端到房间
function addClientToRoom(clientId, roomName) {
  try {
    io.of(NAMESPACES.ROOMS).socketsJoin(clientId, roomName); // 使用 socketsJoin
    logger.info(`Client ${clientId} added to room ${roomName}`);
  } catch (err) {
    error(`Error adding client ${clientId} to room ${roomName}:`, { error: err }, 'ROOM_ERROR'); // 使用新的 logger
  }
}

// 创建房间 (修改: 接受 creatorClientId 参数, 自动设置创建者, 主动创建房间)
function createRoom(roomName, creatorClientId) {
  try {
    if (io.of(NAMESPACES.ROOMS).adapter.rooms.has(roomName)) {
      // 这里可以改成警告
      logger.warn(`Room ${roomName} already exists`, {}, 'ROOM_WARNING');
      throw new Error(`Room ${roomName} already exists`);
    }
    // 主动创建房间
    io.of(NAMESPACES.ROOMS).adapter.rooms.set(roomName, new Set()); // 初始化一个空的 Set 用于存储客户端

    logger.info(`Room ${roomName} created by ${creatorClientId}`);
  } catch (err) {
    error(`Error creating room ${roomName}:`, { error: err }, 'ROOM_ERROR');
    throw new Error(`Failed to create: ${err.message}`);
  }
}

// 删除房间 (修改: 触发 ROOM_DELETED 事件, 主动删除房间)
function deleteRoom(roomName) {
  try {
    const room = io.of(NAMESPACES.ROOMS).adapter.rooms.get(roomName);
    if (!room) {
      // 这里可以改成警告
      logger.warn(`Room ${roomName} does not exist`, {}, 'ROOM_WARNING');
      throw new Error(`Room ${roomName} does not exist`);
    }

    // 将所有客户端移出房间
    for (const clientId of room) {
      removeClientFromRoom(clientId, roomName);
    }

    // 主动删除房间
    io.of(NAMESPACES.ROOMS).adapter.rooms.delete(roomName);

    logger.info(`Room ${roomName} deleted`);
    //io.of(NAMESPACES.ROOMS).emit('ROOM_DELETED', { roomName }); // 触发事件 (由 ChatModule 处理)
  } catch (err) {
    error(`Error deleting room ${roomName}:`, { error: err }, 'ROOM_ERROR');
    throw new Error(`Failed to delete room ${roomName}: ${err.message}`);
  }
}

// 获取所有房间
function getAllRooms() {
  try {
    return Array.from(io.of(NAMESPACES.ROOMS).adapter.rooms.keys());
  } catch (err) {
    error('Error getting all rooms:', { error: err }, 'ROOM_ERROR');
    throw new Error('Failed to get all rooms');
  }
}

// 获取客户端所在的房间列表 (可选, 根据需要实现)
function getClientRooms(clientId) {
  try {
    return io.of(NAMESPACES.ROOMS).adapter.sids.get(clientId); // 使用 adapter.sids 直接获取客户端房间
  } catch (err) {
    error(`Error getting rooms for client ${clientId}:`, { error: err }, 'ROOM_ERROR');
    throw new Error(`Failed to get rooms for client ${clientId}`);
  }
}

//检查客户端是否在房间内
function isClientInRoom(clientId, roomName) {
  try {
    const room = io.of(NAMESPACES.ROOMS).adapter.rooms.get(roomName);
    return room ? room.has(clientId) : false;
  } catch (err) {
    error(`Error checking if client ${clientId} is in room ${roomName}:`, { error: err }, 'ROOM_ERROR');
    throw new Error(`Failed to check if client ${clientId} is in room ${roomName}`);
  }
}

// 将客户端从房间移除
function removeClientFromRoom(clientId, roomName) {
  try {
    io.of(NAMESPACES.ROOMS).socketsLeave(clientId, roomName); // 使用 socketsLeave
    logger.info(`Client ${clientId} removed from room ${roomName}`);
  } catch (err) {
    error(`Error removing client ${clientId} from room ${roomName}:`, { error: err }, 'ROOM_ERROR');
    throw new Error(`Failed to remove client ${clientId} from room ${roomName}`);
  }
}

export {
  addClientToRoom,
  createRoom,
  deleteRoom,
  getAllRooms,
  getClientRooms, // 可选
  isClientInRoom,
  removeClientFromRoom,
};
