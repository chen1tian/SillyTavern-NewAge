import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import path, { dirname, join } from 'path';
import fs from 'fs';
import * as fss from 'fs/promises';
import bcrypt from 'bcryptjs';
import pkg from 'lodash';
const { merge, isString, startsWith, has, forEach } = pkg;
import dayjs from 'dayjs';
//import * as functionCall from './dist/function_call.js';

import { readJsonFromFile, saveJsonToFile, addStaticResources } from './dist/function_call.js';

// 导入模块
import * as Rooms from './dist/Rooms.js';
import * as Keys from './dist/Keys.js';
import { logger, log, error, warn, info, debug } from './dist/logger.js';
import { addDebugClients, removeDebugClients } from './dist/debug.js';
import { setupServerNonStreamHandlers } from './dist/non_stream.js';
import { setupServerStreamHandlers, forwardStreamData } from './dist/stream.js';
import { EVENTS, NAMESPACES, MSG_TYPE } from './lib/constants.js';
import { ChatModule } from './dist/chat.js';
import { uuidv4 } from './lib/uuid/uuid.js';

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

const chatModule = new ChatModule(io);

let serverSettings = {
  serverPort: 4000,
  serverAddress: 'http://localhost',
  staticResouce: {},
  timeout: 5000,
  socketIOPath: '/socket.io',
  queryParameters: {},
  transport: 'websocket',
  Rooms: [],
  clientKeys: {}, // 存储形式：{clientId: key}
  sillyTavernPassword: new Map(), // 存储形式：{clientId: hash}
  networkSafe: true,
  debugMode: false,
};

export { serverSettings };

let trustedSillyTaverns = new Set();

let trustedClients = new Set();

let sillyTavernkey = new Map();

/**
 * 从文件加载服务器设置，自动设置可信客户端/SillyTavern，并确保密码已哈希 / Loads server settings, auto-sets trusted clients/SillyTaverns, and ensures passwords are hashed.
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

      info('Server settings loaded from file.', {}, 'CONFIG_LOADED');
    } catch (error) {
      warn('No settings file found or error loading settings. Using default settings.', { error: error }, 'CONFIG_LOADED');
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
              // delete jsonData.sillyTavernPassWord;
              await fss.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf-8');
            }
            info(`Added trusted SillyTavern: ${clientId}`, {}, 'CONFIG_LOADED');
            const stkey = await Keys.generateAndStoreClientKey(clientId);
            // 存储 SillyTavern key
            serverSettings.clientKeys[clientId] = stkey;
          } else {
            trustedClients.add(clientId);
            serverSettings.Rooms.push(clientId);
            const key = await Keys.generateAndStoreClientKey(clientId);
            serverSettings.clientKeys[clientId] = key; // 存储客户端 key
            info(`Added trusted client: ${clientId}`, {}, 'CONFIG_LOADED');
          }
        }
      } catch (error) {
        error(`Error processing file ${file}:`, { error: error }, 'CONFIG_LOADED');
      }
    }
  } catch (error) {
    error('Error loading settings:', { error: error }, 'CONFIG_LOADED');
  }
}

/**
 * 将服务器设置保存到文件 / Saves server settings to a file.
 * @function saveServerSettings
 * @param {object} newSettings - 要保存的新设置 / New settings to save.
 * @returns {void}
 */
function saveServerSettings(newSettings) {
  try {
    fs.writeFileSync(join(__dirname, './settings/server_settings.json'), JSON.stringify(newSettings, null, 2), 'utf-8');
    info('Server settings saved successfully.', {}, 'CONFIG_SAVED');
  } catch (error) {
    error('Failed to save server settings:', { error: error }, 'CONFIG_SAVED');
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

const functionRegistry = {};

/**
 * 注册一个函数以供 function_call 调用 / Registers a function for function_call.
 * @function registerFunction
 * @param {string} name - 函数名称 / The name of the function.
 * @param {Function} func - 要注册的函数 / The function to register.
 * @returns {void}
 */
function registerFunction(name, func) {
  if (functionRegistry[name]) {
    warn(`Function "${name}" is already registered. Overwriting.`, {}, 'FUNCTION_REGISTER');
  }
  functionRegistry[name] = func;
  info(`Function "${name}" registered for function_call.`, {}, 'FUNCTION_REGISTER');
}

// 在服务器启动时注册函数
import * as functionCall from './dist/function_call.js'; // 导入所有函数
for (const functionName in functionCall) {
  if (typeof functionCall[functionName] === 'function') {
    registerFunction(functionName, functionCall[functionName]);
  }
}

/**
 * 处理 function_call 请求 / Handles a function_call request.
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
      warn(`Function "${functionName}" not found.`, { data }, EVENTS.FUNCTION_CALL_WARN);
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
      error(`Error calling function "${functionName}":`, { error: error, data }, EVENTS.FUNCTION_CALL_ERROR);
      callback({
        requestId,
        success: false,
        error: { message: error.message || 'An unknown error occurred.' },
      });
    }
  } else {
    // 转发给 SillyTavern 扩展 (或其他客户端)
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
 * 通用身份验证函数
 * @param {Socket} socket - Socket.IO 的 socket 对象
 * @param {boolean} [skipNetworkSafeCheck=false] - 是否跳过 networkSafe 检查 (用于 getKey)
 * @returns {boolean | object} - 验证通过返回 true; 未通过返回 false 或带有错误信息的对象 (用于回调)
 */
async function checkAuth(socket, skipNetworkSafeCheck = serverSettings.networkSafe) {
  const clientId = socket.handshake.auth.clientId;
  const clientKey = socket.handshake.auth.key;

  if (
    skipNetworkSafeCheck && serverSettings.networkSafe) {// 1. networkSafe 模式检查
    console.warn(`Network safe mode is enabled. Skipping authentication for client: ${clientId}`);
    return true; // 网络安全模式下直接通过
  } else if (!trustedClients.has(clientId) || !trustedSillyTaverns.has(clientId)) {// 2. 客户端信任检查
    console.warn(`Client ${clientId} is not trusted.`);
    console.log('trustedSillyTaverns:', trustedClients);
    return { status: 'error', message: 'Client is not trusted.' }; // 返回错误对象
  } else {
    if (clientKey !== 'getKey' && !(await isValidKey(clientId, clientKey))) {// 3. 密钥验证 (getKey 除外)
      console.warn(`Client ${clientId} provided invalid key.`);
      return { status: 'error', message: 'Invalid key.' }; // 返回错误对象
    } else {
      return true;// 所有检查通过
    }
  }
}

function broadcastClientListUpdate() {
  try {
    const members = chatModule.memberManagement.getAllMembers();
    const clientList = Object.values(members).map(member => ({
      clientId: member.clientId,
      clientType: member.clientType,
      desc: member.desc,
      html: member.html,
      key: member.key,
    }));

    io.of(NAMESPACES.CLIENTS).emit(MSG_TYPE.UPDATE_CONNECTED_CLIENTS, { clients: clientList });
  } catch (error) {
    error('Error broadcasting client list update:', error); // 使用 error 级别
  }
}

// 默认命名空间 (/)
io.on('connection', async (socket) => {
  const clientType = socket.handshake.auth.clientType;
  const clientId = socket.handshake.auth.clientId;

  // 提取的通用函数，用于处理客户端连接和断开连接的日志和断开操作
  function handleClientConnection(message, shouldDisconnect = false) {
    info(message, { clientId, clientType }); // 使用 info 级别
    if (shouldDisconnect) {
      socket.disconnect(true);
    }
  }

  if (!clientId) {
    handleClientConnection('Client connected without clientId. Disconnecting.', true);
    return;
  }
  // 添加成员 (无论哪种类型的客户端)
  chatModule.memberManagement.addMember(clientId, clientType, {
    /* 可以在这里添加其他成员信息，例如昵称、头像等 */
  });

  // (可选) 自动将客户端加入以其 clientId 命名的房间
  chatModule.joinRoom(clientId, clientId);

  if (clientType === 'monitor') {
    handleClientConnection('Monitor client connected');
    // 监控客户端现在也加入房间
    chatModule.joinRoom(clientId, 'monitor-room', 'manager');
    info('Client connected to /clients namespace', { clientId, clientType });
  } else if (clientType === 'SillyTavern') {
    handleClientConnection(`Extension client connected: ${clientId}`);
    // 添加已连接的扩展端
    chatModule.relationsManage.addConnectedExtension(clientId);
    info('Client connected to /clients namespace', { clientId, clientType });
  } else {
    // 普通客户端
    handleClientConnection(`Client connected: ${clientId}`);
    // 添加已连接的客户端房间
    chatModule.relationsManage.addClientRooms(clientId);
    info('Client connected to /clients namespace', { clientId, clientType });
  }

  socket.on('disconnect', (reason) => {
    handleClientConnection(`Client ${clientId} disconnected: ${reason}`);

    // 移除成员
    chatModule.memberManagement.removeMember(clientId);

    // 根据客户端类型移除已连接的客户端房间或扩展端
    if (clientType === 'SillyTavern') {
      chatModule.relationsManage.removeConnectedExtension(clientId);
    } else if (clientType !== 'monitor') {
      chatModule.relationsManage.removeClientRooms(clientId);
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

// /auth 命名空间
const authNsp = io.of(NAMESPACES.AUTH);

authNsp.on('connection', async (socket) => {
  const clientType = socket.handshake.auth.clientType;
  const clientId = socket.handshake.auth.clientId;
  const clientKey = socket.handshake.auth.key;

  info('Client connecting to /auth', { clientId, clientType });

  const authResult = await checkAuth(socket);

  if (authResult !== true) {
    // 认证失败
    warn('Authentication failed', { clientId, clientType, reason: authResult.message });
    if (typeof authResult === 'object' && authResult.status === 'error') {
      // 统一所有 callback 的调用形式
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    // 清理客户端信息 (重要)
    cleanUpClient(clientId, clientType);
    socket.disconnect(true);
    return;
  }

  // 认证成功
  info('Client authenticated', { clientId, clientType });

  // 身份验证成功后，广播客户端列表更新
  broadcastClientListUpdate();

  setupSocketListenersOnAuthNsp(socket); // 设置监听器 (仅对已认证的客户端)
});

function setupSocketListenersOnAuthNsp(socket) {
  const clientType = socket.handshake.auth.clientType;
  const clientId = socket.handshake.auth.clientId;

  // 监听 GET_CLIENT_KEY (仅限 SillyTavern 或管理前端)
  socket.on(MSG_TYPE.GET_CLIENT_KEY, async (data, callback) => {
    if (typeof callback !== 'function') return;
    if (clientType !== 'SillyTavern' && clientType !== 'monitor') {
      callback({ status: 'error', message: 'Unauthorized' });
      return;
    }

    // 管理员可以获取任意key
    if (clientType === 'monitor') {
      const targetClientId = data.clientId;
      const key = Keys.getClientKey(targetClientId);
      if (key) {
        callback({ status: 'ok', key: key });
      } else {
        callback({ status: 'error', message: 'Client key not found.' });
      }
      return;
    }

    //SillyTavern只能获取自己的
    if (clientType === 'SillyTavern' && clientId == data.clientId) {
      const key = Keys.getClientKey(clientId);
      if (key) {
        callback({ status: 'ok', key: key });
      }
    } else {
      callback({ status: 'error', message: 'Client key not found.' });
    }
  });

  // 监听 GET_SILLYTAVERN_EXTENSION (获取已连接的 SillyTavern 扩展端列表)
  socket.on(MSG_TYPE.GET_SILLYTAVERN_EXTENSION, (callback) => {
    if (typeof callback !== 'function') return;
    if (clientType !== 'SillyTavern' && clientType !== 'monitor') {
      callback({ status: 'error', message: 'Unauthorized' });
      return;
    }
    const extensions = chatModule.relationsManage.connectedExtensions;
    if (extensions.length > 0) {
      callback({ status: 'ok', extensions: extensions });
    } else {
      callback({ status: 'error', message: 'No connected SillyTavern extensions.' });
    }
  });

  // 客户端主动断开连接 (CLIENT_DISCONNECTED)
  socket.on(MSG_TYPE.CLIENT_DISCONNECTED, (reason) => {
    info(`Client ${clientId} disconnected (client-side) from ${NAMESPACES.AUTH}`, { clientType });
    cleanUpClient(clientId, clientType); // 清理客户端信息
    socket.disconnect(true);
  });

  socket.on('disconnect', (reason) => {
    info(`Client ${clientId} disconnected from ${NAMESPACES.AUTH}: ${reason}`, { clientType });
    cleanUpClient(clientId, clientType); // 清理客户端信息
  });
}

const clientsNsp = io.of(NAMESPACES.CLIENTS);

// /clients 命名空间
clientsNsp.on('connection', async (socket) => {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;

  info('Client connecting to /clients', { clientId, clientType });

  const authResult = await checkAuth(socket);

  if (authResult !== true) {
    // 验证失败
    warn('Authentication failed', { clientId, clientType, reason: authResult.message });
    if (typeof authResult === 'object' && authResult.status === 'error') {
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  info('Client connected to /clients namespace', { clientId });
  setupSocketListenersOnClientsNsp(socket);
});

function setupSocketListenersOnClientsNsp(socket) {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;

  // 辅助函数：检查权限
  function checkPermission(requiredClientType) {
    if (requiredClientType === 'SillyTavern' && clientType != 'SillyTavern') {
      return { status: 'error', message: 'Unauthorized' };
    } else if (requiredClientType === 'monitor' && clientType != 'monitor') {
      return { status: 'error', message: 'Unauthorized' };
    }
    return true;
  }

  // 获取所有客户端密钥
  socket.on(MSG_TYPE.GET_ALL_CLIENT_KEYS, (callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.GET_ALL_CLIENT_KEYS });
      return;
    }

    const permissionResult = checkPermission('monitor');
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }

    try {
      const keys = Keys.getAllClientKeys();
      callback({ status: 'ok', keys });
    } catch (error) {
      error('Error getting all client keys:', { error: error }, 'GET_ALL_CLIENT_KEYS'); // 使用 error 级别
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 获取单个客户端密钥 (SillyTavern 和管理员都可以)
  socket.on(MSG_TYPE.GET_CLIENT_KEY, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.GET_CLIENT_KEY });
      return;
    }

    const targetClientId = data.clientId;

    // SillyTavern 和管理员都可以获取单个密钥, 不需要 checkPermission

    try {
      const key = Keys.getClientKey(targetClientId);
      callback({ status: 'ok', key: key ?? null }); // 使用空值合并运算符
    } catch (error) {
      error('Error getting client key:', { error: error }, 'GET_CLIENT_KEY');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 生成客户端密钥
  socket.on(MSG_TYPE.GENERATE_CLIENT_KEY, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.GENERATE_CLIENT_KEY });
      return;
    }

    const permissionResult = checkPermission('monitor');
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }

    const targetClientId = data.targetClientId;
    try {
      const key = Keys.generateAndStoreClientKey(targetClientId);
      callback({ status: 'ok', key });
    } catch (error) {
      error('Error generating client key:', { error: error }, 'GENERATE_CLIENT_KEY');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 移除客户端密钥
  socket.on(MSG_TYPE.REMOVE_CLIENT_KEY, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.REMOVE_CLIENT_KEY });
      return;
    }

    const permissionResult = checkPermission('monitor');
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }

    const targetClientId = data.targetClientId;
    try {
      Keys.removeClientKey(targetClientId);
      callback({ status: 'ok' });
    } catch (error) {
      error('Error removing client key:', { error: error }, 'REMOVE_CLIENT_KEY');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 获取客户端列表
  socket.on(MSG_TYPE.GET_CLIENT_LIST, (callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.GET_CLIENT_LIST });
      return;
    }
    // 不需要检查特定权限，SillyTavern 和管理员都可以获取客户端列表

    try {
      // 使用 chatModule.memberManagement.getAllMembers() 获取所有成员信息
      const members = chatModule.memberManagement.getAllMembers();
      const clientList = Object.values(members).map(member => ({
        clientId: member.clientId,
        clientType: member.clientType,
        // ... 其他你想要包含的成员信息 ...
      }));

      callback({ status: 'ok', clients: clientList });
    } catch (error) {
      error('Error getting client list:', { error: error }, 'GET_CLIENT_LIST');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 客户端断开连接
  socket.on('disconnect', (reason) => {
    info(`Client disconnected from ${NAMESPACES.CLIENTS} namespace`, { clientId, reason });
    cleanUpClient(clientId, clientType); // 清理客户端信息
  });

  // 客户端主动断开连接 (CLIENT_DISCONNECTED)
  socket.on(MSG_TYPE.CLIENT_DISCONNECTED, () => {
    info(`Client ${clientId} disconnected (client-side) from /clients`);
    cleanUpClient(clientId, clientType); // 清理客户端信息
  });
}

// /rooms 命名空间
const roomsNsp = io.of(NAMESPACES.ROOMS);

roomsNsp.on('connection', async (socket) => {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;

  info('Client connecting to /rooms', { clientId, clientType });

  const authResult = await checkAuth(socket);

  if (authResult !== true) {
    // 验证失败
    warn('Authentication failed', { clientId, clientType, reason: authResult.message });
    if (typeof authResult === 'object' && authResult.status === 'error') {
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  info('Client connected to /rooms namespace', { clientId });
  setupSocketListenersOnRoomsNsp(socket)
});

function setupSocketListenersOnRoomsNsp(socket) {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;
  // 辅助函数：检查权限
  function checkPermission(requiredClientType) {
    if (requiredClientType === 'monitor' && clientType !== 'monitor') {
      return { status: 'error', message: 'Unauthorized' };
    }
    return true;
  }

  // 获取房间列表 (SillyTavern 和管理前端都可以访问)
  socket.on(MSG_TYPE.GET_ROOMS, (callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.GET_ROOMS });
      return;
    }
    try {
      const rooms = chatModule.getRoomList(); // 从 ChatModule 获取所有房间
      callback({ status: 'ok', rooms });
    } catch (error) {
      error('Error getting rooms:', { error: error }, 'GET_ROOMS');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 获取房间内的客户端 (SillyTavern 和管理前端都可以访问)
  socket.on(MSG_TYPE.GET_CLIENTS_IN_ROOM, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.GET_CLIENTS_IN_ROOM });
      return;
    }

    const { roomName } = data;

    // 验证 roomName 是否有效 (防止安全问题)
    if (typeof roomName !== 'string' || roomName.trim() === '') {
      callback({ status: 'error', message: 'Invalid room name' });
      return;
    }

    try {
      const clientsInRoom = chatModule.getRoomMembers(roomName); // 从 ChatModule 获取房间成员
      if (clientsInRoom) {
        // 获取客户端的详细信息 (例如，从 memberManagement 获取)
        const clientInfo = clientsInRoom.map((id) => {
          const member = chatModule.memberManagement.getMember(id);
          return {
            clientId: id,
            clientType: member ? member.clientType : 'unknown', // 获取 clientType
            // ... 其他你想要包含的信息 ...
          };
        });
        callback({ status: 'ok', clients: clientInfo });
      } else {
        callback({ status: 'error', message: 'Room not found' });
      }
    } catch (error) {
      error('Error getting clients in room:', { error: error }, 'GET_CLIENTS_IN_ROOM');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 创建房间 (仅限管理前端)
  socket.on(MSG_TYPE.CREATE_ROOM, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.CREATE_ROOM });
      return;
    }

    const permissionResult = checkPermission('monitor');
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }
    const { roomName } = data;
    try {
      if (chatModule.createRoom(roomName, clientId)) {
        callback({ status: 'ok' });
      } else {
        callback({ status: 'error', message: 'Room already exists' });
      }

    } catch (error) {
      error('Error creating room:', { error: error }, 'CREATE_ROOM');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 删除房间 (仅限管理前端)
  socket.on(MSG_TYPE.DELETE_ROOM, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.DELETE_ROOM });
      return;
    }
    const permissionResult = checkPermission('monitor');
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }
    const { roomName } = data;
    try {
      if (chatModule.deleteRoom(roomName)) {
        callback({ status: 'ok' });
      } else {
        callback({ status: 'error', message: 'Room not found' });
      }
    } catch (error) {
      error('Error deleting room:', { error: error }, 'DELETE_ROOM');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 将客户端添加到房间 (仅限管理前端)
  socket.on(MSG_TYPE.ADD_CLIENT_TO_ROOM, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.ADD_CLIENT_TO_ROOM });
      return;
    }

    const permissionResult = checkPermission('monitor');
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }
    const { clientId, roomName, role } = data;
    try {
      if (chatModule.joinRoom(clientId, roomName, role)) {
        callback({ status: 'ok' });
      } else {
        callback({ status: 'error', message: 'Failed to add client to room' });
      }
    } catch (error) {
      error('Error adding client to room:', { error: error }, 'ADD_CLIENT_TO_ROOM');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 将客户端从房间移除 (仅限管理前端)
  socket.on(MSG_TYPE.REMOVE_CLIENT_FROM_ROOM, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.REMOVE_CLIENT_FROM_ROOM });
      return;
    }
    const permissionResult = checkPermission('monitor');
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }
    const { clientId, roomName } = data;
    try {
      if (chatModule.leaveRoom(clientId, roomName)) {
        callback({ status: 'ok' });
      } else {
        callback({ status: 'error', message: 'Failed to remove client from room' });
      }

    } catch (error) {
      error('Error removing client from room:', { error: error }, 'REMOVE_CLIENT_FROM_ROOM');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 设置成员角色 (仅限管理前端)
  socket.on(MSG_TYPE.SET_MEMBER_ROLE, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.SET_MEMBER_ROLE });
      return;
    }
    const permissionResult = checkPermission('monitor'); // 或者可以根据角色进行更细致的权限控制
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }
    const { targetClientId, roomName, role } = data;
    if (!['master', 'manager', 'guest'].includes(role)) {
      callback({ status: 'error', message: 'Invalid role' });
      return;
    }
    try {
      if (chatModule.memberManagement.setMemberRole(targetClientId, roomName, role)) {
        callback({ status: 'ok' });
        // 可选：通知房间内其他成员角色变更
        chatModule.memberManagement.notifyRoomMasterAndManagers(roomName, MSG_TYPE.SET_MEMBER_ROLE, { clientId: targetClientId, role }); 
      } else {
        callback({ status: 'error', message: 'Failed to set member role' });
      }
    } catch (error) {
      error('Error setting member role:', { error: error }, 'SET_MEMBER_ROLE');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 踢出成员 (仅限管理前端)
  socket.on(MSG_TYPE.KICK_MEMBER, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.KICK_MEMBER });
      return;
    }
    const permissionResult = checkPermission('monitor'); // 或者可以根据角色进行更细致的权限控制
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }
    const { targetClientId, roomName } = data;
    try {
      if (chatModule.memberManagement.kickMember(targetClientId, roomName)) {
        callback({ status: 'ok' });
        // 可选：通知房间内其他成员有成员被踢出
        chatModule.memberManagement.notifyRoomMasterAndManagers(roomName, MSG_TYPE.MEMBER_LEFT, { clientId: targetClientId }); // 再次使用 MEMBER_LEFT 通知，可以考虑定义新的事件类型
        // 通知被踢出的客户端
        io.to(targetClientId).emit(MSG_TYPE.WARNING, { message: `You have been kicked from room ${roomName}.` }); // 可以考虑定义新的消息类型
      } else {
        callback({ status: 'error', message: 'Failed to kick member' });
      }
    } catch (error) {
      error('Error kicking member:', { error: error }, 'KICK_MEMBER');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 设置连接策略 (仅限管理前端)
  socket.on(MSG_TYPE.SET_CONNECTION_POLICY, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.SET_CONNECTION_POLICY });
      return;
    }

    const permissionResult = checkPermission('monitor');
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }

    const { policy } = data;
    const result = chatModule.relationsManage.setConnectionPolicy(policy);
    if (result.success) {
      callback({ status: 'ok' });
    } else {
      callback({ status: 'error', message: result.error ?? 'Failed to set connection policy' });
    }
  });

  // 获取当前连接策略 (SillyTavern 和管理前端都可以访问)
  socket.on(MSG_TYPE.GET_CONNECTION_POLICY, (callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.GET_CONNECTION_POLICY });
      return;
    }

    try {
      const policy = chatModule.relationsManage.getConnectionPolicy();
      callback({ status: 'ok', policy });
    } catch (error) {
      error('Error getting connection policy:', { error: error }, 'GET_CONNECTION_POLICY');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 手动分配扩展给客户端 (仅限管理前端)
  socket.on(MSG_TYPE.ASSIGN_EXTENSION_TO_CLIENT, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.ASSIGN_EXTENSION_TO_CLIENT });
      return;
    }

    const permissionResult = checkPermission('monitor');
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }

    const { clientRoom, extensions } = data;
    const result = chatModule.relationsManage.assignExtensionToClient(clientRoom, extensions); // 返回 { success, error? }
    if (result.success) {
      callback({ status: 'ok' });
    } else {
      callback({ status: 'error', message: result.error ?? 'Failed to assign extension' });
    }
  });

  // 获取所有分配 (SillyTavern 和管理前端都可以访问)
  socket.on(MSG_TYPE.GET_ASSIGNMENTS, (callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.GET_ASSIGNMENTS });
      return;
    }

    try {
      const assignments = chatModule.relationsManage.getAssignments();
      callback({ status: 'ok', assignments });
    } catch (error) {
      error('Error getting assignments:', { error: error }, 'GET_ASSIGNMENTS');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 获取指定房间的分配
  socket.on(MSG_TYPE.GET_ASSIGNMENTS_FOR_ROOM, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.GET_ASSIGNMENTS_FOR_ROOM });
      return;
    }
    const { roomName } = data
    try {
      const assignments = chatModule.relationsManage.getAssignmentsForRoom(roomName);
      callback({ status: 'ok', assignments });
    } catch (error) {
      error('Error getting assignments for room:', { error: error }, 'GET_ASSIGNMENTS_FOR_ROOM');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 客户端断开连接
  socket.on('disconnect', (reason) => {
    info(`Client disconnected from ${NAMESPACES.ROOMS} namespace`, { clientId, reason });
    cleanUpClient(clientId, clientType); // 清理客户端信息
  });

  // 客户端主动断开连接 (CLIENT_DISCONNECTED)
  socket.on(MSG_TYPE.CLIENT_DISCONNECTED, () => {
    info(`Client ${clientId} disconnected (client-side) from /rooms`);
    cleanUpClient(clientId, clientType); // 清理客户端信息
  });
}

// /llm 命名空间
const llmNsp = io.of(NAMESPACES.LLM);

llmNsp.on('connection', async (socket) => {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;

  info('Client connecting to /llm', { clientId, clientType });

  const authResult = await checkAuth(socket);

  if (authResult !== true) {
    // 验证失败
    warn('Authentication failed', { clientId, clientType, reason: authResult.message });
    if (typeof authResult === 'object' && authResult.status === 'error') {
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  info('Client connected to /llm namespace', { clientId });
  setupSocketListenersOnLlmNsp(socket);
});

function setupSocketListenersOnLlmNsp(socket) {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;

  // 监听 LLM_REQUEST (现在由 ChatModule 处理)
  socket.on(MSG_TYPE.LLM_REQUEST, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.LLM_REQUEST });
      return;
    }
    // 调用 ChatModule 的 handleLlmRequest 方法
    chatModule.handleLlmRequest(socket, data);
    callback({ status: 'ok' }) // 统一所有callback的调用形式
  });

  // 删除消息 (仅限消息发送者或管理员)
  socket.on(MSG_TYPE.DELETE_MESSAGE, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.DELETE_MESSAGE });
      return;
    }
    // 权限检查：可以根据消息的发送者 clientId 和当前 clientId 进行判断，或者管理员权限
    // 这里简化权限检查，假设房间内成员都可以删除消息
    const { roomName, messageIds, responseIds } = data; // 现在是 messageIds 和 responseIds
    try {
      // 现在调用 deleteMessage 时，传入 roomName, messageIds (可能为 null), responseIds (可能为 null)
      if (chatModule.deleteMessage(roomName, messageIds, responseIds)) {
        callback({ status: 'ok' });
      } else {
        callback({ status: 'error', message: 'Failed to delete message' });
      }
    } catch (error) {
      error('Error deleting message:', { error: error }, 'DELETE_MESSAGE');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 清空消息 (仅限管理前端或房主)
  socket.on(MSG_TYPE.CLEAR_MESSAGES, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.CLEAR_MESSAGES });
      return;
    }
    const permissionResult = checkPermission('monitor'); // 或者可以根据角色进行更细致的权限控制，例如房主权限
    if (permissionResult !== true) {
      callback(permissionResult);
      return;
    }
    const { roomName, fromLlm } = data;
    try {
      if (chatModule.clearMessages(roomName, fromLlm)) {
        callback({ status: 'ok' });
        // 可选：广播消息已清空事件到房间内的其他客户端
        // io.to(roomName).emit(MSG_TYPE.MESSAGES_CLEARED); // 需要定义新的事件类型 MESSAGES_CLEARED
      } else {
        callback({ status: 'error', message: 'Failed to clear messages' });
      }
    } catch (error) {
      error('Error clearing messages:', { error: error }, 'CLEAR_MESSAGES');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 客户端断开连接
  socket.on('disconnect', (reason) => {
    info(`Client disconnected from ${NAMESPACES.LLM} namespace`, { clientId, reason });
    cleanUpClient(clientId, clientType); // 清理客户端信息
  });

  // 客户端主动断开连接 (CLIENT_DISCONNECTED)
  socket.on(MSG_TYPE.CLIENT_DISCONNECTED, () => {
    info(`Client ${clientId} disconnected (client-side) from /llm`);
    cleanUpClient(clientId, clientType); // 清理客户端信息
  });
}

setupServerStreamHandlers(io, NAMESPACES.LLM, chatModule);
setupServerNonStreamHandlers(io, NAMESPACES.LLM, chatModule);

// /sillytavern 命名空间
const sillyTavernNsp = io.of(NAMESPACES.SILLY_TAVERN);

sillyTavernNsp.on('connection', async (socket) => {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;

  info('Client connecting to /sillytavern', { clientId, clientType });

  const authResult = await checkAuth(socket);

  if (authResult !== true) {
    // 验证失败
    warn('Authentication failed', { clientId, clientType, reason: authResult.message });
    if (typeof authResult === 'object' && authResult.status === 'error') {
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }
  info('Client connected to /sillytavern namespace', { clientId });
  setupSocketListenersOnSillyTavernNsp(socket)
});

function setupSocketListenersOnSillyTavernNsp(socket) {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;

  // 监听 IDENTIFY_SILLYTAVERN
  socket.on(MSG_TYPE.IDENTIFY_SILLYTAVERN, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.IDENTIFY_SILLYTAVERN });
      return;
    }

    // 检查 SillyTavern 扩展端是否已经连接过 (根据 clientId)
    if (chatModule.relationsManage.connectedExtensions.includes(data.clientId)) {
      warn('SillyTavern extension already connected. Ignoring new connection attempt.', { clientId: data.clientId });
      callback({ status: 'error', message: 'SillyTavern extension already connected.' }); // 拒绝连接
      return;
    }

    // 为 SillyTavern 扩展端生成密钥
    const sillyTavernKey = Keys.generateAndStoreClientKey(data.clientId);

    info(`SillyTavern extension identified`, { clientId: data.clientId });
    callback({ status: 'ok', key: sillyTavernKey });
  });

  // 客户端断开连接
  socket.on('disconnect', (reason) => {
    info(`Client disconnected from ${NAMESPACES.SILLY_TAVERN} namespace`, { clientId, reason });
    cleanUpClient(clientId, clientType); // 清理客户端信息
  });

  // 客户端主动断开连接 (CLIENT_DISCONNECTED)
  socket.on(MSG_TYPE.CLIENT_DISCONNECTED, () => {
    info(`Client ${clientId} disconnected (client-side) from /sillytavern`);
    cleanUpClient(clientId, clientType); // 清理客户端信息
  });
}

// /function_call 命名空间
const functionCallNsp = io.of(NAMESPACES.FUNCTION_CALL);

functionCallNsp.on('connection', async (socket) => {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;

  info('Client connecting to /function_call', { clientId, clientType });

  const authResult = await checkAuth(socket);

  if (authResult !== true) {
    // 验证失败
    warn('Authentication failed', { clientId, clientType, reason: authResult.message });
    if (typeof authResult === 'object' && authResult.status === 'error') {
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  info('Client connected to /function_call namespace', { clientId });
  setupSocketListenersOnFunctionCallNsp(socket);
});

function setupSocketListenersOnFunctionCallNsp(socket) {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;

  // 监听 function_call 事件
  socket.on(MSG_TYPE.FUNCTION_CALL, (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.FUNCTION_CALL });
      return;
    }
    // data: { requestId: string, functionName: string, args: any[] }
    info(`Received function_call request`, { data });
    handleFunctionCallRequest(socket, data, callback);
  });

  // 客户端断开连接
  socket.on('disconnect', (reason) => {
    info(`Client disconnected from ${NAMESPACES.FUNCTION_CALL} namespace`, { clientId, reason });
    cleanUpClient(clientId, clientType); // 清理客户端信息
  });

  // 客户端主动断开连接 (CLIENT_DISCONNECTED)
  socket.on(MSG_TYPE.CLIENT_DISCONNECTED, () => {
    info(`Client ${clientId} disconnected (client-side) from /function_call`);
    cleanUpClient(clientId, clientType); // 清理客户端信息
  });
}

// /debug 命名空间
const debugNsp = io.of(NAMESPACES.DEBUG);

debugNsp.on('connection', async (socket) => {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;

  info('Client connecting to /debug', { clientId, clientType });

  // 1. 身份验证
  const authResult = await checkAuth(socket);
  if (authResult !== true) {
    warn('Authentication failed for /debug', { clientId, clientType, reason: authResult.message });
    if (typeof authResult === 'object' && authResult.status === 'error') {
      socket.emit(MSG_TYPE.ERROR, { message: authResult.message }); // 错误消息
    }
    socket.disconnect(true);
    return;
  }

  // 2. 权限检查 (只允许 SillyTavern 和管理前端)
  if (clientType !== 'SillyTavern' && clientType !== 'monitor') {
    warn('Unauthorized access to /debug', { clientId, clientType });
    socket.emit(MSG_TYPE.ERROR, { message: 'Unauthorized' });
    socket.disconnect(true);
    return;
  }

  info('Client connected to /debug namespace', { clientId });
  setupSocketListenersOnDebugNsp(socket);
});

function setupSocketListenersOnDebugNsp(socket) {
  const clientId = socket.handshake.auth.clientId;
  const clientType = socket.handshake.auth.clientType;

  // 3. 监听 toggleDebugMode 事件
  socket.on(MSG_TYPE.TOGGLE_DEBUG_MODE, (callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.TOGGLE_DEBUG_MODE });
      return;
    }

    try {
      serverSettings.debugMode = !serverSettings.debugMode; // 切换 debugMode 的值
      info(`Debug mode set to ${serverSettings.debugMode}`);
      // 通知客户端（所有连接到 /debug 命名空间的客户端）
      debugNsp.emit(MSG_TYPE.DEBUG_MODE_CHANGED, { debugMode: serverSettings.debugMode }); // 使用常量

      callback({ status: 'ok', debugMode: serverSettings.debugMode });

    } catch (error) {
      error('Error toggling debug mode:', { error: error }, 'TOGGLE_DEBUG_MODE');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 监听 SERVER_STATUS 事件
  socket.on(MSG_TYPE.SERVER_STATUS, (callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.SERVER_STATUS });
      return;
    }

    try {
      // 获取服务器状态信息 (您需要根据实际情况实现)
      const serverStatus = getServerStatus(); // 假设您有一个 getServerStatus 函数

      callback({ status: 'ok', serverStatus });
    } catch (error) {
      error('Error getting server status:', { error: error }, 'SERVER_STATUS');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 监听 READ_LOG 事件
  socket.on(MSG_TYPE.READ_LOG, async (data, callback) => {
    if (typeof callback !== 'function') {
      warn('Callback is not a function', { clientId, event: MSG_TYPE.READ_LOG });
      return;
    }

    try {
      const { filename, level, page, pageSize } = data;
      // 验证参数 (更严格的检查)
      if (!filename || typeof filename !== 'string' || !['combined.log', 'error.log', 'info.log', 'warn.log'].includes(filename)) {
        throw new Error('Invalid filename');
      }

      const levelOptions = ['all', 'error', 'warn', 'info'];
      if (!level || typeof level !== 'string' || !levelOptions.includes(level)) {
        throw new Error("Invalid level Options");
      }

      const pageNumber = parseInt(page, 10) || 1;
      const pageSizeNumber = parseInt(pageSize, 10) || 10;

      if (isNaN(pageNumber) || pageNumber < 1) {
        throw new Error('Invalid page number');
      }

      if (isNaN(pageSizeNumber) || pageSizeNumber < 1 || pageSizeNumber > 100) {
        throw new Error('Invalid page size (must be between 1 and 100)');
      }

      const logData = await readLogFile(filename, level, pageNumber, pageSizeNumber); // 注意这里的参数
      callback({ status: 'ok', ...logData }); // 发送日志数据

    } catch (error) {
      error('Error reading log file:', { error: error }, 'READ_LOG');
      callback({ status: 'error', message: error.message ?? 'Unknown error' });
    }
  });

  // 客户端断开连接
  socket.on('disconnect', (reason) => {
    info(`Client disconnected from ${NAMESPACES.DEBUG} namespace`, { clientId, reason });
    cleanUpClient(clientId, clientType); // 清理客户端信息
  });

  // 客户端主动断开连接 (CLIENT_DISCONNECTED)
  socket.on(MSG_TYPE.CLIENT_DISCONNECTED, () => {
    info(`Client ${clientId} disconnected (client-side) from /debug`);
    cleanUpClient(clientId, clientType); // 清理客户端信息
  });
}

// 清理客户端信息 (重要)
function cleanUpClient(clientId, clientType) {
  // 1. 从成员列表中移除
  chatModule.memberManagement.removeMember(clientId);

  // 2. 从已连接的客户端房间或扩展端列表中移除
  if (clientType === 'SillyTavern') {
    chatModule.relationsManage.removeConnectedExtension(clientId);
  } else if (clientType !== 'monitor') {
    chatModule.relationsManage.removeClientRooms(clientId);
  }
  // 3. 客户端断开连接后，广播客户端列表更新
  broadcastClientListUpdate();
}

function readLogFile(filename, level, page, pageSize) {
  return new Promise((resolve, reject) => {
    const logFilePath = path.join(__dirname, 'logs', filename); //日志文件路径

    fs.readFile(logFilePath, 'utf8', (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      let lines = data.trim().split('\n');

      // 根据 level 过滤
      if (level && level !== 'all') {
        lines = lines.filter(line => {
          const parts = line.split(' - ');
          return parts.length > 1 && parts[1].trim() === level;
        });
      }
      const total = lines.length;

      // 分页
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const paginatedLines = lines.slice(start, end);

      resolve({
        lines: paginatedLines,
        total,
        page,
        pageSize,
        level
      });
    });
  });
}

function getServerStatus() {
  return serverStatus;
}

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

let serverStatus = {};

initializeStaticResources().then(() => {
  const SERVER_PORT = serverSettings.serverPort || 4000;
  httpServer.listen(SERVER_PORT, () => {

    // 服务器状态写入
    serverStatus.serverPort = serverSettings.serverPort;
    serverStatus.serverAddress = serverSettings.serverAddress;
    serverStatus.networkSafe = serverSettings.networkSafe;
    serverStatus.debugMode = serverSettings.debugMode;
    serverStatus.startTime = dayjs().format('YYYY-MM-DD HH:mm:ss');

    console.log(`Server listening on port ${SERVER_PORT}`);
    console.log(`Server monitor: http://localhost:${SERVER_PORT}`);
  });
});
