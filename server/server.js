import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { setupServerNonStreamHandlers } from './lib/non_stream.js';
import { setupServerStreamHandlers, forwardStreamData } from './lib/stream.js';
import { NAMESPACES, MSG_TYPE } from './lib/constants.js';
import { uuidv4 } from './lib/uuid/uuid.js';
import { fileURLToPath } from 'url';
import path, { dirname, join } from 'path';
import fs from 'fs';
import * as fss from 'fs/promises';
import bcrypt from 'bcryptjs';
import pkg from 'lodash';
const { merge, isString, startsWith, has, forEach } = pkg;
//import * as functionCall from './dist/function_call.js';

import { readJsonFromFile, saveJsonToFile, addStaticResources } from './dist/function_call.js';

// 导入模块
import * as Rooms from './dist/Rooms.js';
import * as Keys from './dist/Keys.js';
import { logger } from './dist/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

app.use(express.json());

app.use('/lib', express.static(path.join(__dirname, './lib')));
app.use('/dist', express.static(path.join(__dirname, './dist')));
app.use('/exampleClient', express.static(path.join(__dirname, './exampleClient')));
app.use('/public', express.static(path.join(__dirname, './public')));

const httpServer = createServer(app);
const saltRounds = 10;

let io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  serveClient: true,
});

export { io };

let serverSettings = {
  serverPort: 4000,
  serverAddress: 'http://localhost',
  staticResouce: {},
  reconnectAttempts: 5,
  reconnectDelay: 1000,
  timeout: 5000,
  autoConnect: true,
  socketIOPath: '/socket.io',
  queryParameters: {},
  transport: 'websocket',
  Rooms: [],
  clientKeys: {},// 存储形式：{clientId: key}
  sillyTavernPassword: new Map(),// 存储形式：{clientId: hash}
  networkSafe: true,
  restrictedFiles: [],
};

export { serverSettings };

let trustedSillyTaverns = new Set();

let trustedClients = new Set();

let sillyTavernkey = new Map();

/**
 * @description 从文件加载服务器设置，自动设置可信客户端/SillyTavern，并确保密码已哈希 / Loads server settings, auto-sets trusted clients/SillyTaverns, and ensures passwords are hashed.
 * @function loadServerSettings
 * @returns {void}
 */
async function loadServerSettings() {
  const settingsDir = join(__dirname, './settings');
  try {
    // 1. 加载 server_settings.json
    try {
      const settingsData = await fss.readFile(join(settingsDir, 'server_settings.json'), 'utf-8');
      const fileSettings = JSON.parse(settingsData);

      // 使用 lodash 的 merge 方法深度合并配置
      serverSettings = merge({}, serverSettings, fileSettings);

      logger.info('Server settings loaded from file.');
    } catch (error) {
      logger.warn('No settings file found or error loading settings. Using default settings.', error);
      // 写入默认配置
      await fss.writeFile(join(settingsDir, 'server_settings.json'), JSON.stringify(serverSettings, null, 2), 'utf-8');
    }

    // 2. 遍历 settings 目录下的其他 JSON 文件
    const files = await fss.readdir(settingsDir);

    for (const file of files) {
      if (file === 'server_settings.json' || !file.endsWith('.json')) {
        continue;
      }

      const filePath = join(settingsDir, file);
      try {
        const fileData = await fss.readFile(filePath, 'utf-8');
        const jsonData = JSON.parse(fileData);
        // 移除 sillyTavernMasterKey（如果存在）
        if (has(jsonData, 'sillyTavernMasterKey')) {
          delete jsonData.sillyTavernMasterKey;
          // 异步写入文件（不等待）
          fss.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf-8');
        }

        // 检查并处理可信客户端/SillyTavern
        if (has(jsonData, 'clientId') && has(jsonData, 'isTrust') && jsonData.isTrust) {
          const { clientId } = jsonData;
          if (clientId.startsWith('SillyTavern')) {
            trustedSillyTaverns.add(clientId);
            serverSettings.Rooms.push(clientId); // 确保 Rooms 数组存在
            // 密码哈希
            if (has(jsonData, 'sillyTavernPassWord') && isString(jsonData.sillyTavernPassWord) && !startsWith(jsonData.sillyTavernPassWord, '$')) {
              const hashedPassword = await bcrypt.hash(jsonData.sillyTavernPassWord, saltRounds);
              serverSettings.sillyTavernPassword.set(clientId, hashedPassword);
              // 更新文件，移除 sillyTavernPassWord，不再需要单独存储
              delete jsonData.sillyTavernPassWord;
              await fss.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf-8');
            }
            logger.info(`Added trusted SillyTavern: ${clientId}`);
            const stkey = await Keys.generateAndStoreClientKey(clientId);
            // 存储 SillyTavern key
            serverSettings.clientKeys[clientId] = stkey;
          } else {
            trustedClients.add(clientId);
            serverSettings.Rooms.push(clientId);
            const key = await Keys.generateAndStoreClientKey(clientId);
            serverSettings.clientKeys[clientId] = key; // 存储客户端 key
            logger.info(`Added trusted client: ${clientId}`);
          }
        }
      } catch (error) {
        logger.error(`Error processing file ${file}:`, error);
      }
    }
  } catch (error) {
    logger.error('Error loading settings:', error);
  }
}

/**
 * @description 将服务器设置保存到文件 / Saves server settings to a file.
 * @function saveServerSettings
 * @param {object} newSettings - 要保存的新设置 / New settings to save.
 * @returns {void}
 */
function saveServerSettings(newSettings) {
  try {
    fs.writeFileSync(join(__dirname, './settings/server_settings.json'), JSON.stringify(newSettings, null, 2), 'utf-8');
    console.log('Server settings saved successfully.');
  } catch (error) {
    console.error('Failed to save server settings:', error);
  }
}

loadServerSettings();

/**
 * @description 重新初始化 Socket.IO 服务器 / Reinitializes the Socket.IO server.
 * @function reinitializeSocketIO
 * @param {object} newSettings - 新的服务器设置 / New server settings.
 * @returns {void}
 */
function reinitializeSocketIO(newSettings) {
  serverSettings = { ...serverSettings, ...newSettings };
  io.of(NAMESPACES.GENERAL).removeAllListeners();
  setupServerNonStreamHandlers(io, NAMESPACES.GENERAL);
  const forwardHandler = forwardStreamData(io, NAMESPACES.GENERAL, 'monitor-room'); //必须要有monitor-room
  setupServerStreamHandlers(io, NAMESPACES.GENERAL, forwardHandler);
}

let requestQueue = [];

/**
 * @description 处理 LLM 请求 / Processes the LLM request.
 * @function processLLMRequest
 * @param {string} target - 目标 SillyTavern 实例的 clientId / Target SillyTavern client ID.
 * @param {object} request - 请求对象 / Request object.
 * @returns {void}
 */
function processLLMRequest(target, request) {
  if (trustedSillyTaverns.has(target)) {
    io.of(NAMESPACES.SILLY_TAVERN).to(target).emit(MSG_TYPE.LLM_REQUEST, request);
    console.log(`Forwarding LLM request to SillyTavern: ${target}`);
  } else {
    console.warn(`Target SillyTavern not found: ${target}`);
    // 可以选择向请求的发起者发送错误消息
    if (request.clientId) {
      // 确保请求包含 clientId
      io.of(NAMESPACES.AUTH)
        .to(request.clientId)
        .emit(MSG_TYPE.ERROR, {
          // 假设错误消息发送回 /auth
          type: MSG_TYPE.ERROR,
          message: `Target SillyTavern not found: ${target}`,
          requestId: request.requestId, // 包含请求 ID
        });
    }
  }
}

const functionRegistry = {};

/**
 * @description 注册一个函数以供 function_call 调用 / Registers a function for function_call.
 * @function registerFunction
 * @param {string} name - 函数名称 / The name of the function.
 * @param {Function} func - 要注册的函数 / The function to register.
 * @returns {void}
 */
function registerFunction(name, func) {
  if (functionRegistry[name]) {
    console.warn(`Function "${name}" is already registered. Overwriting.`);
  }
  functionRegistry[name] = func;
  console.log(`Function "${name}" registered for function_call.`);
}

// 在服务器启动时注册函数
import * as functionCall from './dist/function_call.js'; // 导入所有函数
import { error } from 'console';
for (const functionName in functionCall) {
  if (typeof functionCall[functionName] === 'function') {
    registerFunction(functionName, functionCall[functionName]);
  }
}

/**
 * @description 处理 function_call 请求 / Handles a function_call request.
 * @function handleFunctionCallRequest
 * @async
 * @param {import('socket.io').Socket} socket - Socket.IO Socket 实例 / Socket.IO Socket instance.
 * @param {object} data - 请求数据 / Request data.
 * @param {string} data.requestId - 请求 ID / Request ID.
 * @param {string} data.functionName - 要调用的函数名称 / Name of the function to call.
 * @param {any[]} data.args - 函数参数 / Function arguments.
 * @param {Function} callback - 回调函数 / Callback function.
 * @returns {Promise<void>}
 */
async function handleFunctionCallRequest(socket, data, callback) {
  const { requestId, functionName, args, target } = data; // 添加 target

  if (target === 'server') {
    // 服务器端函数调用
    const func = functionRegistry[functionName];
    if (!func) {
      console.warn(`Function "${functionName}" not found.`);
      callback({
        requestId,
        success: false,
        error: { message: `Function "${functionName}" not found.` },
      });
      return;
    }

    try {
      const result = await func(...args);
      callback({ requestId, success: true, result });
    } catch (error) {
      console.error(`Error calling function "${functionName}":`, error);
      callback({
        requestId,
        success: false,
        error: { message: error.message || 'An unknown error occurred.' },
      });
    }
  } else {
    // 转发给 SillyTavern 扩展
    io.to(target).emit(MSG_TYPE.FUNCTION_CALL, data, callback);
  }
}

/**
 * @description 验证客户端密钥 / Validates a client's key.
 * @function isValidKey
 * @async
 * @param {string} clientId - 客户端 ID / The client ID.
 * @param {string} key - 客户端提供的密钥 / The key provided by the client.
 * @returns {Promise<boolean>} - 如果密钥有效，则返回 true；否则返回 false / True if the key is valid, false otherwise.
 */
async function isValidKey(clientId, key) {
  if (trustedSillyTaverns.has(clientId)) {
    // 如果是 SillyTavern，从 Keys 中获取并验证
    const storedKey = Keys.getClientKey(clientId);
    if (!storedKey) {
      return false; // 没有找到密钥
    }
    return await bcrypt.compare(String(key), storedKey);
  } else {
    return await Keys.isValidClientKey(clientId, key);
  }
}

/**
 * @description 检查发送者是否有权限向目标房间发送消息 / Checks if a sender is allowed to send a message to a target room.
 * @function canSendMessage
 * @param {string} senderClientId - 发送者客户端 ID / The sender's client ID.
 * @param {string} targetRoom - 目标房间名称 / The target room name.
 * @returns {boolean} - 如果允许发送，则返回 true；否则返回 false / True if sending is allowed, false otherwise.
 */
function canSendMessage(senderClientId, targetRoom) {
  if (targetRoom === 'server') {
    return true;
  }

  if (targetRoom === String(senderClientId))
    if (trustedSillyTaverns.has(senderClientId)) {
      return true;
    }

  // 使用 Rooms.isClientInRoom() 检查客户端是否在房间内
  if (Rooms.isClientInRoom(senderClientId, targetRoom)) {
    return true;
  }

  return false;
}

const reconnectIntervals = new Map();

function handleReconnect(socket, clientId, clientType) {
  let attempts = 0;

  // 清除之前的重连间隔（如果存在）
  if (reconnectIntervals.has(clientId)) {
    clearInterval(reconnectIntervals.get(clientId));
    reconnectIntervals.delete(clientId);
  }

  const reconnectInterval = setInterval(() => {
    // 检查是否有相同 clientId 的其他 socket 已经连接
    let alreadyConnected = false;
    authNsp.sockets.forEach(existingSocket => {
      //这里要用.auth，而不是.handshake.auth
      if (existingSocket.auth.clientId === clientId && existingSocket.id !== socket.id) {
        alreadyConnected = true;
      }
    });

    if (alreadyConnected) {
      clearInterval(reconnectInterval);
      reconnectIntervals.delete(clientId);
      console.log(`Client ${clientId} reconnected with a different socket. Stopping retry.`);

      // 尝试将客户端重新添加到房间（如果需要）
      try {
        Rooms.addClientToRoom(socket, clientId); // 假设你的房间名与 clientId 相同
      } catch (error) {
        console.error('Error re-adding client to room:', error);
      }
      // 重新连接成功也清理旧的 socket
      cleanUpSocket(socket);
      return;
    }

    attempts++;
    if (attempts >= serverSettings.reconnectAttempts) {
      clearInterval(reconnectInterval);
      reconnectIntervals.delete(clientId);

      // 重试失败，执行清理
      cleanUpSocket(socket); // 清理 socket

      // 删除房间（如果需要）
      try {
        Rooms.deleteRoom(socket, clientId); // 假设你的房间名与 clientId 相同
        console.log(`Client ${clientId} failed to reconnect. Room ${clientId} deleted.`);
      } catch (error) {
        console.error('Error deleting room:', error);
      }

      // 通知所有 SillyTavern 实例 (可选，根据你的逻辑)
      trustedSillyTaverns.forEach(stClientId => {
        io.of(NAMESPACES.SILLY_TAVERN)
          .to(stClientId)
          .emit(MSG_TYPE.ERROR, {
            type: MSG_TYPE.ERROR,
            message: `Client ${clientId} disconnected and failed to reconnect. Room deleted.`,
          });
      });
    } else {
      console.log(
        `Client ${clientId} disconnected. Reconnect attempt ${attempts}/${serverSettings.reconnectAttempts}...`,
      );
    }
  }, serverSettings.reconnectDelay);

  reconnectIntervals.set(clientId, reconnectInterval);
}

// 清理 socket 的函数
function cleanUpSocket(socket) {
  try {
    // 从所有房间中移除 socket
    if (socket.rooms) {
      for (const room of socket.rooms) {
        if (room !== socket.handshake.auth.clientId) {
          // 不移除自身的房间
          socket.leave(room);
        }
      }
    }
    // 从 Socket.IO 的内部数据结构中移除 socket
    if (socket.nsp && socket.nsp.sockets) {
      socket.nsp.sockets.delete(socket.id);
    }

    socket.disconnect(true);

    console.log(`Socket ${socket.handshake.auth.clientType} cleaned up.`);
  } catch (error) {
    console.error('cleanUpSocket error', error);
  }
}

/**
 * 通用身份验证函数
 * @param {Socket} socket - Socket.IO 的 socket 对象
 * @param {boolean} [skipNetworkSafeCheck=false] - 是否跳过 networkSafe 检查 (用于 getKey)
 * @returns {boolean | object} - 验证通过返回 true; 未通过返回 false 或带有错误信息的对象 (用于回调)
 */
async function checkAuth(socket, skipNetworkSafeCheck = serverSettings.networkSafe) {
  const clientId = socket.handshake.auth.clientId;
  const clientKey = socket.handshake.auth.key;

  // 1. networkSafe 模式检查
  if (
    skipNetworkSafeCheck &&
    serverSettings.networkSafe &&
    (trustedClients.has(clientId) || trustedSillyTaverns.has(clientId))
  ) {
    console.warn(`Network safe mode is enabled. Skipping authentication for client: ${clientId}`);
    return true; // 网络安全模式下直接通过
  }

  // 2. 客户端信任检查
  if (!trustedClients.has(clientId) || !trustedSillyTaverns.has(clientId)) {
    console.warn(`Client ${clientId} is not trusted.`);
    console.log('trustedSillyTaverns:', trustedClients);
    return { status: 'error', message: 'Client is not trusted.' }; // 返回错误对象
  }

  // 3. 密钥验证 (getKey 除外)
  if (clientKey !== 'getKey' && !(await isValidKey(clientId, clientKey))) {
    console.warn(`Client ${clientId} provided invalid key.`);
    return { status: 'error', message: 'Invalid key.' }; // 返回错误对象
  }

  return true; // 所有检查通过
}

// 默认命名空间 (/)
io.on('connection', async socket => {
  const clientType = socket.handshake.auth.clientType;
  const clientId = socket.handshake.auth.clientId;

  // 提取的通用函数，用于处理客户端连接和断开连接的日志和断开操作
  function handleClientConnection(message, shouldDisconnect = false) {
    logger.info(message, { clientId, clientType });
    if (shouldDisconnect) {
      socket.disconnect(true);
    }
  }

  if (!clientId) {
    handleClientConnection('Client connected without clientId. Disconnecting.', true);
    return;
  }

  if (clientType === 'monitor') {
    handleClientConnection('Monitor client connected');
    socket.join('monitor-room'); // 监控客户端仍然在默认命名空间
  } else if (clientType === 'extension') {
    handleClientConnection(`Extension client connected: ${clientId}`);
    // 如果 /rooms 命名空间负责房间管理，这里可能不需要
    // socket.join(clientId);
  }

  socket.on('disconnect', reason => {
    handleClientConnection(`Client ${clientId} disconnected: ${reason}`);

    // 只对 monitor 类型的客户端进行重试
    if (clientType === 'monitor') {
      let attempts = 0;
      const reconnectInterval = setInterval(() => {
        if (socket.connected) {
          clearInterval(reconnectInterval);
          logger.info(`Client ${clientId} reconnected.`);
        } else {
          attempts++;
          if (attempts >= serverSettings.reconnectAttempts) {
            clearInterval(reconnectInterval);
            logger.info(`Client ${clientId} failed to reconnect.`);
          } else {
            logger.info(
              `Client ${clientId} disconnected. Reconnect attempt ${attempts}/${serverSettings.reconnectAttempts}...`,
            );
          }
        }
      }, serverSettings.reconnectDelay);
    }
  });
});

// 全局 connection_error 事件处理
io.on('connection_error', (err) => {
  logger.error('Connection Error:', {
    message: err.message,
    code: err.code, // Socket.IO 错误代码
    description: err.description, // 错误描述
    context: err.context, // 错误发生的上下文信息
    timestamp: new Date().toISOString(),
  });
});

let connectedClients = new Map(); // 存储已连接的可信客户端

let clients = [];

// /auth 命名空间
const authNsp = io.of(NAMESPACES.AUTH);

authNsp.on('connection', async socket => {
  const clientType = socket.handshake.auth.clientType;
  const clientId = socket.handshake.auth.clientId;
  const clientKey = socket.handshake.auth.key;
  const clientDesc = socket.handshake.auth.desc;

  logger.info('Client connecting to /auth', { clientId, clientType });

  const authResult = await checkAuth(socket);

  console.log('authResult:', authResult);

  if (authResult !== true) {
    // 验证失败
    logger.warn('Authentication failed', { clientId, clientType, reason: authResult.message });
    if (typeof authResult === 'object' && authResult.status === 'error') {
      // 统一所有callback的调用形式
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  // 认证成功
  logger.info('Client authenticated', { clientId, clientType });

  // 将客户端信息存储到 clients 对象中
  clients[clientId] = {
    clientId: clientId,
    clientType: clientType,
    desc: clientDesc,
    // ... 其他信息 ...
  };

  // 可信客户端 (包括 SillyTavern)
  if (clientKey === 'getKey' && trustedSillyTaverns.has(clientId)) {
    // 密钥验证通过，设置房间
    try {
      Rooms.createRoom(socket, clientId);
      Rooms.addClientToRoom(socket, clientId);
      //Rooms.setClientDescription(clientId, clientDesc);
      socket.join(clientId);
      logger.info(`Client ${clientId} connected and joined room ${clientId}`);
    } catch (error) {
      logger.error('Error setting up client:', error);
      // 发送错误消息 (指定目标房间)
      socket.to(clientId).emit(MSG_TYPE.ERROR, { message: 'Error setting up client.' });
      socket.disconnect(true);
    }
  }

  if (trustedClients.has(clientId)) {
    Rooms.createRoom(socket, clientId);
    Rooms.addClientToRoom(socket, clientId);
    //Rooms.setClientDescription(clientId, clientDesc);
    socket.join(clientId);
    logger.info(`Client ${clientId} connected and joined room ${clientId}`);
    Keys.generateAndStoreClientKey(clientId);

    if (clientKey === 'getKey' && serverSettings.networkSafe) {
      socket.emit(MSG_TYPE.CLIENT_KEY, { Key: Keys.getClientKey(clientId) });
    }

    connectedClients.set(clientId, { id: clientId, description: clientDesc });
  }

  setupSocketListeners(socket); //设置监听器
  sendConnectedClientsUpdate();      // 发送给监控前端 (所有客户端)
  sendConnectedClientsToSillyTavern(); // 发送给 SillyTavern (仅非 SillyTavern 客户端)
});

function setupSocketListeners(socket) {
  // 监听 GET_CLIENT_KEY
  socket.on(MSG_TYPE.GET_CLIENT_KEY, async (data, callback) => {
    if (socket.handshake.auth.clientId === 'monitor') {
      // 特殊处理：返回管理前端的密钥
      const adminKey = await Keys.generateAndStoreClientKey(socket.handshake.auth.clientId)
      if (callback) callback({ status: 'ok', key: adminKey });
      return;
    } else if (!trustedSillyTaverns.has(socket.handshake.auth.clientId)) {
      if (callback) callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const targetClientId = data.clientId;
    const key = Keys.getClientKey(targetClientId);
    if (key) {
      if (callback) callback({ status: 'ok', key: key });
    } else {
      if (callback) callback({ status: 'error', message: 'Client key not found.' });
    }
  });

  let STSocket = [];
  socket.on(MSG_TYPE.GET_SILLYTAVERN_EXTENSION, callback => {
    llmNsp.sockets.forEach(existingSocket => {
      if (existingSocket.handshake.auth.clientId.startsWith('SillyTavern')) {
        STSocket.push(existingSocket.handshake.auth.clientId);
      }
    });
    if (callback) {
      if (STSocket) {
        callback({ status: 'ok', allTheSTSocket: STSocket });
      }
      callback({ status: 'error', reason: 'No connected SillyTavern extension!' });
    }
  });

  // 监听 LOGIN(暂时放弃)
  socket.on(MSG_TYPE.LOGIN, async (data, callback) => {
    const { clientId, password } = data;
    console.log('Received login request from:', clientId, 'data:', data);

    if (!clientId || !password) {
      console.warn('Invalid login data received:', data);
      if (callback) callback({ success: false, message: 'Invalid login data.' });
      return;
    }

    if (serverSettings.sillyTavernPassword) {
      try {
        const jsonData = await readJsonFromFile(`./settings/${clientId}-settings.json`);
        console.log('jsonData.result.sillyTavernMasterKey:', jsonData.result.sillyTavernMasterKey);

        const isMatch = await bcrypt.compare(password, jsonData.result.sillyTavernMasterKey);

        if (isMatch) {
          console.log('Password matched for client:', clientId);
          if (callback) callback({ success: true });
        } else {
          console.warn('Password mismatch for client:', clientId);
          if (callback) callback({ success: false, message: 'Incorrect password.' });
        }
      } catch (error) {
        console.error('Error during login process:', error);
        if (callback) callback({ success: false, message: 'Server error during login.' });
      }
    } else {
      console.log('Password not set on server.');
      if (callback) callback({ success: false, message: 'Password not set on server.' });
    }
  });

  socket.on('disconnect', reason => {
    logger.info(`Client disconnected from ${NAMESPACES.AUTH}`, { reason });

    if (connectedClients.has(socket.handshake.auth.clientId)) {
      connectedClients.delete(socket.handshake.auth.clientId);
      sendConnectedClientsUpdate();      // 发送给监控前端 (所有客户端)
      sendConnectedClientsToSillyTavern(); // 发送给 SillyTavern (仅非 SillyTavern 客户端)
    }

    cleanUpSocket(socket);
  });

  socket.on('error', error => {
    logger.error('Socket error', { clientId: socket.handshake.auth.clientId, error: error.message });
    if (error.message === 'parse error') {
      cleanUpSocket(socket);
    }
  });

  // 客户端主动断开 (CLIENT_DISCONNECTED)
  socket.on(MSG_TYPE.CLIENT_DISCONNETED, reason => {
    const clientId = socket.handshake.auth.clientId;
    const clientType = socket.handshake.auth.clientType;
    logger.info(`Client ${clientId} disconnected (client-side)`, { clientType });
    cleanUpSocket(socket);
  });
}

// 工具函数：向监控前端发送客户端列表更新 (包含所有类型的客户端)
function sendConnectedClientsUpdate() {
  const allClients = Object.values(clients);
  io.to('monitor-room').emit(MSG_TYPE.UPDATE_CONNECTED_CLIENTS, allClients);
}

// 工具函数：向所有可信的 SillyTavern 扩展发送 connectedClients (不包含 SillyTavern 客户端)
function sendConnectedClientsToSillyTavern() {
  const nonSillyTavernClients = Object.values(clients).filter(client => client.clientType !== 'SillyTavern');

  authNsp.sockets.forEach(socket => {
    if (socket.handshake.auth.clientType === 'SillyTavern' && trustedSillyTaverns.has(socket.handshake.auth.clientId)) {
      socket.emit(MSG_TYPE.CONNECTED_CLIENTS_UPDATE, nonSillyTavernClients);
    }
  });
}

// /clients 命名空间
const clientsNsp = io.of(NAMESPACES.CLIENTS);

clientsNsp.on('connection', async (socket) => {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;

  logger.info('Client connecting to /clients', { clientId, clientType });

  const authResult = await checkAuth(socket);

  if (authResult !== true) {
    // 验证失败
    logger.warn('Authentication failed', { clientId, clientType, reason: authResult.message });
    if (typeof authResult === 'object' && authResult.status === 'error') {
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  logger.info('Client connected to /clients namespace', { clientId });

  // 辅助函数：检查权限 (修改后)
  function checkPermission(requiredClientType, clientId) {
    if (requiredClientType === 'SillyTavern' && !trustedSillyTaverns.has(clientId)) {
      return { status: 'error', message: 'Unauthorized' };
    } else if (requiredClientType === 'admin' && !trustedClients.has(clientId)) {
      return { status: 'error', message: 'Unauthorized' };
    }
    return true;
  }

  // 获取所有客户端密钥 (仅限 SillyTavern)
  socket.on(MSG_TYPE.GET_ALL_CLIENT_KEYS, async (callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.GET_ALL_CLIENT_KEYS });
      return;
    }

    const permissionResult = checkPermission('SillyTavern', clientId);
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }

    try {
      const keys = Keys.getAllClientKeys();
      callback({ status: 'ok', keys });
    } catch (error) {
      logger.error('Error getting all client keys:', error);
      callback({ status: 'error', message: error.message });
    }
  });

  // 获取单个客户端密钥
  socket.on(MSG_TYPE.GET_CLIENT_KEY, (data, callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.GET_CLIENT_KEY });
      return;
    }

    // 不需要 checkPermission，因为获取单个密钥没有特别的权限要求 (或者根据你的业务逻辑调整)
    const targetClientId = data.clientId;
    try {
      const key = Keys.getClientKey(targetClientId);
      callback({ status: 'ok', key: key ?? null }); // 使用空值合并运算符
    } catch (error) {
      logger.error('Error getting client key:', error);
      callback({ status: 'error', message: error.message });
    }
  });

  // 生成客户端密钥 (仅限 SillyTavern)
  socket.on(MSG_TYPE.GENERATE_CLIENT_KEY, (data, callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.GENERATE_CLIENT_KEY });
      return;
    }

    const permissionResult = checkPermission('SillyTavern', clientId);
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }

    const targetClientId = data.targetClientId;
    try {
      const key = Keys.generateAndStoreClientKey(targetClientId);
      callback({ status: 'ok', key });
    } catch (error) {
      logger.error('Error generating client key:', error);
      callback({ status: 'error', message: error.message });
    }
  });

  // 移除客户端密钥 (仅限 SillyTavern)
  socket.on(MSG_TYPE.REMOVE_CLIENT_KEY, async (data, callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.REMOVE_CLIENT_KEY });
      return;
    }

    const permissionResult = checkPermission('SillyTavern', clientId);
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }

    const targetClientId = data.targetClientId;
    try {
      await Keys.removeClientKey(targetClientId);
      callback({ status: 'ok' });
    } catch (error) {
      logger.error('Error removing client key:', error);
      callback({ status: 'error', message: error.message });
    }
  });

  // 获取客户端列表 (SillyTavern 和管理前端都可以访问)
  socket.on(MSG_TYPE.GET_CLIENT_LIST, async (callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.GET_CLIENT_LIST });
      return;
    }
    // 不需要检查特定权限，但可能需要根据 clientType 或其他条件过滤

    try {
      const clients = [];

      llmNsp.sockets.forEach(socket => {
        clients.push({
          clientId: socket.handshake.auth.clientId,
          clientType: socket.handshake.auth.clientType,
          clientDesc: socket.handshake.auth.Desc,
          clientHTML: socket.handshake.auth.clientHTML ?? null,
        })
      });

      callback({ success: true, clients });
    } catch (error) {
      logger.error('Error getting client list:', error);
      callback({ status: 'error', message: error.message });
    }
  });

  // 更新客户端列表
  socket.on(MSG_TYPE.UPDATE_CONNECTED_CLIENTS, (callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.UPDATE_CONNECTED_CLIENTS });
      return;
    }
    const permissionResultSilly = checkPermission('SillyTavern', clientId);
    const permissionResultAdmin = checkPermission('admin', clientId);
    if (permissionResultSilly !== true && permissionResultAdmin !== true) {
      callback({ status: 'error', message: 'Unauthorized' });
      return;
    }

    sendConnectedClientsToSillyTavern();
    callback({ status: 'ok' });
  });

  // 监听客户端断开连接
  socket.on('disconnect', (reason) => {
    logger.info(`Client disconnected from ${NAMESPACES.CLIENTS} namespace`, {
      clientId,
      reason,
    });
    cleanUpSocket(socket);
  });

  // 监听客户端主动断开连接
  socket.on(MSG_TYPE.CLIENT_DISCONNETED, () => {
    logger.info(`Client ${clientId} disconnected (client-side) from /clients`);
    cleanUpSocket(socket);
  });
});

// /rooms 命名空间
const roomsNsp = io.of(NAMESPACES.ROOMS);

roomsNsp.on('connection', async (socket) => {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;

  logger.info('Client connecting to /rooms', { clientId, clientType });

  const authResult = await checkAuth(socket);

  if (authResult !== true) {
    // 验证失败
    logger.warn('Authentication failed', { clientId, clientType, reason: authResult.message });
    if (typeof authResult === 'object' && authResult.status === 'error') {
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  logger.info('Client connected to /rooms namespace', { clientId });

  // 辅助函数：检查权限 (修改后)
  function checkPermission(requiredClientType, clientType) {  // 传入 clientType
    if (requiredClientType === 'admin' && clientType !== 'monitor') {
      return { status: 'error', message: 'Unauthorized' };
    }
    return true;
  }

  // 获取房间列表 (SillyTavern 和管理前端都可以访问)
  socket.on(MSG_TYPE.GET_ROOMS, (callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.GET_ROOMS });
      return;
    }
    try {
      const rooms = Rooms.getAllRooms(); // 从 Rooms.js 获取所有房间
      callback({ status: 'ok', rooms });
    } catch (error) {
      logger.error('Error getting rooms:', error);
      callback({ status: 'error', message: error.message });
    }
  });

  // 获取房间内的客户端 (SillyTavern 和管理前端都可以访问)
  socket.on(MSG_TYPE.GET_CLIENTS_IN_ROOM, (roomName, callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.GET_CLIENTS_IN_ROOM });
      return;
    }
    // 不需要检查特定权限，但你可能需要验证 roomName

    try {
      // 验证 roomName 是否有效 (防止安全问题)
      if (typeof roomName !== 'string' || roomName.trim() === '') {
        callback({ status: 'error', message: 'Invalid room name' });
        return;
      }

      const clientsInRoom = io.of(NAMESPACES.ROOMS).adapter.rooms.get(roomName); // 使用房间命名空间
      const clientIds = clientsInRoom ? Array.from(clientsInRoom) : [];

      // 获取客户端的描述信息
      const clientInfo = clientIds.map((id) => ({
        id,
        description: Rooms.getClientDescription(id), // 从 Rooms.js 获取描述
        // ... 其他你想要包含的信息 ...
      }));

      callback({ success: true, clients: clientInfo });
    } catch (error) {
      logger.error('Error getting clients in room:', error);
      callback({ status: 'error', message: error.message });
    }
  });

  // 创建房间 (仅限管理前端)
  socket.on(MSG_TYPE.CREATE_ROOM, (roomName, callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.CREATE_ROOM });
      return;
    }

    const permissionResult = checkPermission('admin', clientType);
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }
    try {
      Rooms.createRoom(roomName);
      callback({ status: 'ok' });
    } catch (error) {
      logger.error('Error creating room:', error);
      callback({ status: 'error', message: error.message });
    }
  });

  // 删除房间 (仅限管理前端)
  socket.on(MSG_TYPE.DELETE_ROOM, (roomName, callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.DELETE_ROOM });
      return;
    }
    const permissionResult = checkPermission('admin', clientType);
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }

    try {
      Rooms.deleteRoom(roomName);
      callback({ status: 'ok' });
    } catch (error) {
      logger.error('Error deleting room:', error);
      callback({ status: 'error', message: error.message });
    }
  });

  // 将客户端添加到房间 (仅限管理前端)
  socket.on(MSG_TYPE.ADD_CLIENT_TO_ROOM, (data, callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.ADD_CLIENT_TO_ROOM });
      return;
    }

    const permissionResult = checkPermission('admin', clientType);
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }
    const { clientId, roomName } = data;
    try {
      Rooms.addClientToRoom(clientId, roomName);
      callback({ status: 'ok' });
    } catch (error) {
      logger.error('Error adding client to room:', error);
      callback({ status: 'error', message: error.message });
    }
  });

  // 将客户端从房间移除 (仅限管理前端)
  socket.on(MSG_TYPE.REMOVE_CLIENT_FROM_ROOM, (data, callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.REMOVE_CLIENT_FROM_ROOM });
      return;
    }
    const permissionResult = checkPermission('admin', clientType);
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }
    const { clientId, roomName } = data;
    try {
      Rooms.removeClientFromRoom(clientId, roomName);
      callback({ status: 'ok' });
    } catch (error) {
      logger.error('Error removing client from room:', error);
      callback({ status: 'error', message: error.message });
    }
  });

  socket.on('disconnect', (reason) => {
    logger.info(`Client disconnected from ${NAMESPACES.ROOMS} namespace`, { // 修正了这里
      clientId,
      reason,
    });
    cleanUpSocket(socket);
  });

  // 监听客户端主动断开连接
  socket.on(MSG_TYPE.CLIENT_DISCONNETED, () => {
    logger.info(`Client ${clientId} disconnected (client-side) from /rooms`); //修正了这里
    cleanUpSocket(socket);
  });
});

// /llm 命名空间
const llmNsp = io.of(NAMESPACES.LLM);

// 用于存储请求的映射关系： { [requestId]: [ { target: string, clientId: string }, ... ] }
const llmRequests = {};

llmNsp.on('connection', async (socket) => {
  const clientId = socket.handshake.auth.clientId;

  const authResult = await checkAuth(socket);

  if (authResult !== true) {
    // 验证失败
    logger.warn('Authentication failed', { clientId, reason: authResult.message }); // 使用 logger.warn
    if (typeof authResult === 'object' && authResult.status === 'error') {
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  // 监听 LLM_REQUEST
  socket.on(MSG_TYPE.LLM_REQUEST, (data, callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.LLM_REQUEST });
      return;
    }
    logger.info(`Received LLM request from ${clientId}`, { data }); // 使用 logger.info

    const target = data.target;
    const requestId = data.requestId;

    if (!canSendMessage(clientId, target)) {
      logger.warn(`Client ${clientId} is not allowed to send messages to room ${target}.`); // 使用 logger.warn
      callback({
        status: 'error',
        message: `Client ${clientId} is not allowed to send messages to room ${target}.`,
      });
      return;
    }

    if (target === 'server') {
      logger.warn(`LLM requests should not be sent to the server directly.`); // 使用 logger.warn
      callback({
        status: 'error',
        message: 'LLM requests should not be sent to the server directly.',
      });
      return;
    }

    // 查找目标客户端
    let targetSocket = null;
    llmNsp.sockets.forEach(existingSocket => {
      // 遍历当前命名空间下的所有 socket
      if (existingSocket.handshake.auth.clientId === target) {
        targetSocket = existingSocket;
      }
    });

    if (targetSocket) {
      // 找到目标SillyTavern客户端，转发请求
      targetSocket.emit(MSG_TYPE.LLM_REQUEST, data);
      logger.info(`Forwarded LLM request to target client: ${target}`); // 使用 logger.info

      // 存储请求的映射关系 (只有在找到目标客户端时才存储)
      if (!llmRequests[requestId]) {
        llmRequests[requestId] = [];
      }
      llmRequests[requestId].push({ target, clientId });
      callback({ status: 'ok', message: 'Request forwarded.' }); // 发送成功回执, 且确保callback是函数

    } else {
      // 未找到目标客户端，返回错误
      logger.warn(`Target client not found: ${target}`); // 使用 logger.warn
      callback({
        status: 'error',
        message: `Target client not found: ${target}`,
      });
    }
  });

  socket.on('disconnect', (reason) => {
    logger.info(`Client disconnected from ${NAMESPACES.LLM} namespace`, { clientId, reason }); // 使用 logger.info
    cleanUpSocket(socket);
  });

  socket.on(MSG_TYPE.CLIENT_DISCONNETED, (reason) => {
    const clientType = socket.handshake.auth.clientType;
    logger.info(`Client ${clientId}-${clientType} disconnected (llmNsp)`, { reason }); // 使用 logger.info
    cleanUpSocket(socket);
  });
});

setupServerStreamHandlers(io, NAMESPACES.LLM, llmRequests);
setupServerNonStreamHandlers(io, NAMESPACES.LLM, llmRequests);

// /sillytavern 命名空间
const sillyTavernNsp = io.of(NAMESPACES.SILLY_TAVERN);

sillyTavernNsp.on('connection', async (socket) => {
  const clientId = socket.handshake.auth.clientId;

  const authResult = await checkAuth(socket);

  if (authResult !== true) {
    // 验证失败
    logger.warn('Authentication failed', { clientId, reason: authResult.message }); // 使用 logger.warn
    if (typeof authResult === 'object' && authResult.status === 'error') {
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  let toSendKey = null;

  // 监听 IDENTIFY_SILLYTAVERN
  socket.on(MSG_TYPE.IDENTIFY_SILLYTAVERN, async (data, callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId, event: MSG_TYPE.IDENTIFY_SILLYTAVERN });
      return;
    }
    // data: { clientId: string }'

    if (trustedSillyTaverns.has(data.clientId)) {
      logger.warn('SillyTavern master key already set. Ignoring new key and send old key.', { clientId: data.clientId }); // 使用 logger.warn
      if (serverSettings.clientKeys[data.clientId]) {
        toSendKey = serverSettings.clientKeys[data.clientId];
      }
      callback({ status: 'warning', message: 'SillyTavern already connected.', key: toSendKey }); //更严谨些
      return;
    } else {
      // 添加到可信 SillyTavern 集合
      trustedSillyTaverns.add(data.clientId);

      let SILLYTAVERN_key; // 为每个 SillyTavern 实例单独生成密钥
      if (Keys.clientKeys[socket.id]) {
        // 检查是否已存在密钥（不太可能，但以防万一）
        SILLYTAVERN_key = Keys.clientKeys[socket.id];
      } else {
        SILLYTAVERN_key = Keys.generateAndStoreClientKey(data.clientId);
      }
      //serverSettings.sillyTavernMasterKey = SILLYTAVERN_key; // 存储密钥（可选，取决于你如何使用）

      logger.info(`SillyTavern identified`, { socketId: socket.id, clientId: data.clientId }); // 使用 logger.info
      saveServerSettings(serverSettings);
      //processLLMRequest();
      callback({ status: 'ok', key: SILLYTAVERN_key });
    }
  });

  socket.on('disconnect', (reason) => {
    logger.info(`Client disconnected from ${NAMESPACES.SILLY_TAVERN} namespace`, { clientId, reason }); // 使用 logger.info
    cleanUpSocket(socket);
  });

  socket.on(MSG_TYPE.CLIENT_DISCONNETED, (reason) => {
    const clientType = socket.handshake.auth.clientType;
    logger.info(`Client ${clientId}-${clientType} disconnected (sillyTavernNsp)`, { reason });// 使用 logger.info
    cleanUpSocket(socket);
  });
});

// /function_call 命名空间
const functionCallNsp = io.of(NAMESPACES.FUNCTION_CALL);

functionCallNsp.on('connection', async (socket) => {
  logger.info(`Client connected to ${NAMESPACES.FUNCTION_CALL} namespace`, { clientId: socket.handshake.auth.clientId });  // 使用 logger.info

  const authResult = await checkAuth(socket);
  if (authResult !== true) {
    // 验证失败
    logger.warn('Authentication failed', { clientId: socket.handshake.auth.clientId, reason: authResult.message }); // 使用 logger.warn
    if (typeof authResult === 'object' && authResult.status === 'error') {
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  // 监听 function_call 事件
  socket.on(MSG_TYPE.FUNCTION_CALL, (data, callback) => {
    if (typeof callback !== 'function') {
      logger.warn('Callback is not a function', { clientId: socket.handshake.auth.clientId, event: MSG_TYPE.FUNCTION_CALL });
      return;
    }
    // data: { requestId: string, functionName: string, args: any[] }
    logger.info(`Received function_call request`, { data }); // 使用 logger.info
    handleFunctionCallRequest(socket, data, callback);
  });

  socket.on('disconnect', (reason) => {
    logger.info(`Client disconnected from ${NAMESPACES.FUNCTION_CALL} namespace`, { clientId: socket.handshake.auth.clientId, reason }); // 使用 logger.info
    cleanUpSocket(socket);
  });

  socket.on(MSG_TYPE.CLIENT_DISCONNETED, (reason) => {
    const clientId = socket.handshake.auth.clientId;
    const clientType = socket.handshake.auth.clientType;
    logger.info(`Client ${clientId}-${clientType} disconnected (functionCallNsp)`, { reason });// 使用 logger.info
    cleanUpSocket(socket);
  });
});

// 初始静态资源映射 (URL 路径 -> 相对于 server.js 的文件系统路径)
const initialResources = {
  '/lib': './lib',
  '/dist': './dist',
  '/exampleClient': './exampleClient',
  '/public': './public',
};

// 在应用启动时，加载初始静态资源到内存
async function initializeStaticResources() {
  try {
    for (const urlPath in initialResources) {
      if (initialResources.hasOwnProperty(urlPath)) {
        const basePath = path.join(__dirname, initialResources[urlPath]);

        // 递归遍历目录的函数
        async function addResourcesRecursively(currentPath, currentUrlPath) {
          const entries = await fss.readdir(currentPath, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            const relativeUrl = path.join(currentUrlPath, entry.name);

            if (entry.isDirectory()) {
              // 如果是目录，递归调用
              await addResourcesRecursively(fullPath, relativeUrl);
            } else {
              // 如果是文件, 调用addStaticResources, 注意这里是单个文件，所以可以直接构造字典
              await addStaticResources(app, {
                [relativeUrl]: path.relative(path.join(__dirname, 'dist', '..'), fullPath),
              }); //path.relative得到相对于项目根目录的路径
            }
          }
        }

        await addResourcesRecursively(basePath, urlPath);
      }
    }
    console.log('Initial static resources added successfully.');
  } catch (error) {
    console.error('Error initializing static resources:', error);
    process.exit(1);
  }
}

// 根路径和 /index.html 返回 monitor.html
app.use('/', (req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') {
    res.sendFile(join(__dirname, 'exampleClient', 'monitor', 'monitor.html'));
  } else {
    next();
  }
});

// 404 处理
app.use((req, res) => {
  res.status(404).send('Not Found');
});

initializeStaticResources().then(() => {
  const SERVER_PORT = serverSettings.serverPort || 4000;
  httpServer.listen(SERVER_PORT, () => {
    console.log(`Server listening on port ${SERVER_PORT}`);
    console.log(`Server monitor: http://localhost:${SERVER_PORT}`);
  });
});
