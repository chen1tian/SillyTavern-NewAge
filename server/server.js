// server.js

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { setupServerNonStreamHandlers } from '../lib/non_stream.js';
import { setupServerStreamHandlers, forwardStreamData } from '../lib/stream.js';
import { NAMESPACES, MSG_TYPE } from '../lib/constants.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// 【新增】导入 saveJsonToFile
import { saveJsonToFile } from './dist/function_call.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);

//  初始化的 io，移到外面
let io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  serveClient: true,
});

// 设置不同命名空间的处理
//setupServerNonStreamHandlers(io, NAMESPACES.GENERAL); //  移到 reinitializeSocketIO 外部

// 创建转发处理器 (转发到 monitor-room 和 visual-novel-room)
//const forwardHandler = forwardStreamData(io, NAMESPACES.GENERAL, 'monitor-room' ); //  移到 reinitializeSocketIO 外部

//setupServerStreamHandlers(io, NAMESPACES.GENERAL, forwardHandler); //  移到 reinitializeSocketIO 外部

// 一个存储当前服务配置的变量
let serverSettings = {
  reconnectAttempts: 10,
  reconnectDelay: 1000,
  timeout: 5000,
  autoConnect: true,
  socketIOPath: '/socket.io',
  queryParameters: {},
  transport: 'websocket'
};

// 尝试从文件加载服务器设置的函数
function loadServerSettings() {
  // ... (与之前相同) ...
  try {
    const settingsData = fs.readFileSync(join(__dirname, '../settings.json'), 'utf-8');
    serverSettings = { ...serverSettings, ...JSON.parse(settingsData) }; //和默认配置合并
    console.log('Server settings loaded from file.');
  } catch (error) {
    console.log('No settings file found or error loading settings. Using default settings.');
    //如果出错, 就将默认配置保存到文件
    fs.writeFileSync(join(__dirname, '../settings.json'), JSON.stringify(serverSettings, null, 2), 'utf-8');
  }
}

//保存设置到文件
function saveServerSettings(newSettings) {
  // ... (与之前相同) ...
  try {
    fs.writeFileSync(join(__dirname, '../settings.json'), JSON.stringify(newSettings, null, 2), 'utf-8');
    console.log("保存服务器配置成功")
  } catch (e) {
    console.error("保存服务器配置失败", e)
  }
}
//在服务器启动时加载
loadServerSettings();

//  重新初始化 Socket.IO (确保服务器完全关闭)
function reinitializeSocketIO(newSettings) {
  // 更新 serverSettings
  serverSettings = { ...serverSettings, ...newSettings };
  //  移除旧的监听器
  io.of(NAMESPACES.GENERAL).removeAllListeners();

  //  在这里设置命名空间处理器
  setupServerNonStreamHandlers(io, NAMESPACES.GENERAL);
  const forwardHandler = forwardStreamData(io, NAMESPACES.GENERAL, 'monitor-room');
  setupServerStreamHandlers(io, NAMESPACES.GENERAL, forwardHandler);
}

//  请求队列
let requestQueue = [];
//  SillyTavern 的 Socket ID
let sillyTavernSocketId = null;
//  标记 SillyTavern 是否已连接
let isSillyTavernConnected = false; // 新增

//  处理 LLM 请求
function processLLMRequest() {
  // ... (与之前相同) ...
  //  只有在 SillyTavern 已连接的情况下才处理请求
  if (sillyTavernSocketId && isSillyTavernConnected && requestQueue.length > 0) {
    const request = requestQueue.shift(); // 取出队首请求
    io.to(sillyTavernSocketId).emit('llm_request', request); // 发送给 SillyTavern, 使用新的消息类型 'llm_request'
    console.log(`Forwarding LLM request to SillyTavern: ${request.requestId}`);
  }
}

// 【新增】function_call 请求队列
const functionCallQueue = [];

// 【新增】处理 function_call 请求
async function processFunctionCallRequest() {
  if (functionCallQueue.length === 0) {
    return; //  没有请求，直接返回
  }

  const { socket, data, callback } = functionCallQueue.shift(); // 取出队首请求

  try {
    const { filePath, jsonData } = data;

    // 调用 saveJsonToFile 来保存文件
    const result = await saveJsonToFile(filePath, jsonData);

    // 向客户端发送响应
    callback(result); //  将结果传递给回调函数

  } catch (error) {
    console.error('Error processing function_call request:', error);
    //  向客户端发送错误响应
    callback({ success: false, error: error.message });
  }
  // 无论如何, 保存完之后都应该处理下一个请求
  setImmediate(processFunctionCallRequest); // 立即处理下一个请求, 使用setImmediate
}

//  只在根命名空间设置一次 'connection' 事件监听
io.on('connection', (socket) => {
  const clientType = socket.handshake.auth.clientType;

  // SillyTavern 身份认证
  socket.on(MSG_TYPE.IDENTIFY_SILLYTAVERN, () => {
    sillyTavernSocketId = socket.id;
    isSillyTavernConnected = true; //  设置 SillyTavern 连接状态
    console.log(`SillyTavern identified with socket ID: ${sillyTavernSocketId}`);
    processLLMRequest(); //  尝试处理请求, 如果有的话.
  });

  //  设置 /function_call 命名空间
  const functionCallNsp = io.of(NAMESPACES.FUNCTION_CALL);
  functionCallNsp.on('connection', (socket) => {
    console.log('Client connected to /function_call namespace');

    // 监听 'save_json' 事件 (来自客户端)
    socket.on('save_json', (data, callback) => {
      console.log('Received save_json request:', data);

      // 将请求添加到队列
      functionCallQueue.push({ socket, data, callback });

      // 如果队列中只有一个请求，则立即开始处理
      if (functionCallQueue.length === 1) {
        processFunctionCallRequest();
      }
    });
    socket.on('disconnect', (reason) => {
      console.log(`Client disconnected from /function_call namespace: ${reason}`);
    });
  });

  if (clientType === 'monitor') {
    console.log("监测到来自服务器端的连接");
    socket.join('monitor-room');
  } else if (clientType === 'visual-novel') {
    console.log("监测到来自客户端的连接");
    socket.join('visual-novel-room');
  }

  // 监听 'client_settings' 事件
  socket.on('client_settings', (clientSettings) => {
    console.log('Received client settings:', clientSettings);
    reinitializeSocketIO(clientSettings);
    saveServerSettings(serverSettings); //  确保保存设置
  });

  //  监听 LLM 对话请求 (来自客户端)
  socket.on(MSG_TYPE.LLM_REQUEST, (data) => {
    console.log(`Received LLM request from ${socket.id}:`, data);

    // 将请求添加到队列
    requestQueue.push({
      clientId: socket.id, // 客户端 ID
      requestId: data.requestId, // 请求 ID
      message: data.message,   // 消息内容
      // ... 其他需要的字段 ...
    });

    //  尝试处理请求
    processLLMRequest();
  });

  //  监听 LLM 响应 (来自 SillyTavern)
  socket.on(MSG_TYPE.LLM_RESPONSE, (data) => {
    console.log(`Received LLM response from SillyTavern:`, data);

    // 找到原始请求的客户端
    const originalRequest = requestQueue.find(req => req.requestId === data.requestId);

    if (originalRequest) {
      // 将响应转发给客户端
      io.to(originalRequest.clientId).emit(MSG_TYPE.LLM_RESPONSE, {
        requestId: data.requestId,
        message: data.message,
        // ... 其他需要的字段 ...
      });

      // 从队列中移除已处理的请求
      //requestQueue.splice(requestQueue.indexOf(originalRequest), 1); //这里不能这样移除, 因为originalRequest可能已经被shift了

      //  尝试处理下一个请求
      processLLMRequest();
    } else {
      console.warn(`Original request not found for requestId: ${data.requestId}`);
    }
  });

  socket.on('getRooms', () => {
    console.log(`Rooms for socket ${socket.id}:`, socket.rooms);
    socket.emit('roomsInfo', Array.from(socket.rooms));
  });

  socket.on('disconnect', (reason) => { //  disconnect 事件处理
    console.log(`Client ${socket.id} disconnected: ${reason}`); //  更详细的日志

    // 从请求队列中移除该客户端的请求
    //  使用 filter 方法，更简洁
    const initialQueueLength = requestQueue.length;
    requestQueue = requestQueue.filter(req => req.clientId !== socket.id);
    if (requestQueue.length < initialQueueLength) {
      console.log(`Removed ${initialQueueLength - requestQueue.length} requests from queue for client ${socket.id}`);
    }


    // 如果断开的是 SillyTavern, 重置 sillyTavernSocketId
    if (socket.id === sillyTavernSocketId) {
      sillyTavernSocketId = null;
      isSillyTavernConnected = false; //  重置 SillyTavern 连接状态
      console.log('SillyTavern disconnected.');
    }
  });
});

// ... (静态文件服务、路由、404 处理等，与之前相同) ...
// 静态文件服务
app.use('/lib', express.static(join(__dirname, '../lib')));
app.use('/dist', express.static(join(__dirname, './dist')));
app.use('/example', express.static(join(__dirname, './example'))); // 这行可能不需要，如果 example 下只有 Visual_Novel
app.use('/example/LLM_Role_Play', express.static(join(__dirname, './example/LLM_Role_Play')));
app.use('/example/html', express.static(join(__dirname, './example/LLM_Role_Play/html')));
app.use('/example/json', express.static(join(__dirname, './example/LLM_Role_Play/json')));
app.use('/example/resource', express.static(join(__dirname, './example/LLM_Role_Play/resource')));
app.use('/resource', express.static(join(__dirname, './example/LLM_Role_Play/resource')));
app.use('/public', express.static(join(__dirname, './public')));

// 根路径和 /index.html 返回 monitor.html
app.use('/', (req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') {
    res.sendFile(join(__dirname, 'example', 'monitor', 'monitor.html')); // 修正路径
  } else {
    next();
  }
});

// 404 处理
app.use((req, res) => {
  res.status(404).send('Not Found');
});

const SERVER_PORT = process.env.PORT || 4000;
//const CLIENT_PORT = 3000; // 不需要，客户端端口由 ST 自动分配
httpServer.listen(SERVER_PORT, () => {
  console.log(`Server listening on port ${SERVER_PORT}`);
  console.log(`Server monitor: http://localhost:${SERVER_PORT}`);
  //console.log(`Client should be on port ${CLIENT_PORT}`); // 不需要
});