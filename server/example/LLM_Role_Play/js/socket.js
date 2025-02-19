// example/LLM_Role_Play/js/socket.js
import * as settings from './settings.js';
import { addLogMessage } from "./log.js";
import { MSG_TYPE, STREAM_EVENTS } from "../../../lib/constants.js";
import { uuidv4 } from "../../../lib/uuid/uuid.js"; // 导入 uuid
import { io } from "../../../public/socket.io.js"
let socket = null; // 将 socket 变量提升到模块作用域

async function connectToServer() { // 【修改】改为 async 函数
  const currentSettings = settings.getSettings();

  // 【修改】如果已经有连接，先断开 (并等待)
  if (socket) {
    // 【新增】移除旧的事件监听器
    socket.off('connect');
    socket.off('message');
    socket.off(STREAM_EVENTS.START_RESPONSE);
    socket.off(STREAM_EVENTS.DATA_FIRST_RESPONSE);
    socket.off(STREAM_EVENTS.DATA_MIDDLE_RESPONSE);
    socket.off(STREAM_EVENTS.DATA_LAST_RESPONSE);
    socket.off(STREAM_EVENTS.END_RESPONSE);
    socket.off(MSG_TYPE.LLM_RESPONSE);
    socket.off('disconnect');
    socket.off('connect_error');
    // 【修改】等待 disconnect 完成
    await new Promise(resolve => {
      socket.disconnect();
      socket.on('disconnect', () => { // 监听一次 disconnect 事件
        resolve();
      });
    });
    socket = null; // 【新增】断开后将 socket 设置为 null
  }

  // 使用新的设置创建连接
  socket = io(currentSettings.serverAddress, {
    reconnectionAttempts: currentSettings.reconnectAttempts,
    reconnectionDelay: currentSettings.reconnectDelay,
    timeout: currentSettings.timeout,
    autoConnect: currentSettings.autoConnect,
    path: currentSettings.socketIOPath,
    query: currentSettings.queryParameters,
    transports: [currentSettings.transport] // 只使用 websocket
  });

  // 添加事件监听器 (这里可以处理各种 Socket.IO 事件)
  socket.on('connect', () => {
    addLogMessage('success', 'Connected to server', 'client', undefined, socket.id);

    //  连接成功后，发送设置到服务器
    socket.emit('client_settings', currentSettings);
  });
  // 监听非流式消息
  socket.on('message', (data) => {
    if (data.type === MSG_TYPE.NON_STREAM) {
      addLogMessage('info', data.data, data.source, data.requestId, data.outputId);
    }
  });
  // 监听流式消息的开始、数据和结束事件
  socket.on(STREAM_EVENTS.START_RESPONSE, (data) => {
    addLogMessage('info', `Stream started (streamId: ${data.streamId}, outputId: ${data.outputId})`, data.source, data.requestId, data.outputId);
  });

  socket.on(STREAM_EVENTS.DATA_FIRST_RESPONSE, (data) => {
    addLogMessage('info', `Stream data received (streamId: ${data.streamId}, chunkIndex: ${data.chunkIndex}, outputId: ${data.outputId}): ${data.data}`, data.source, data.requestId, data.outputId);
  });

  socket.on(STREAM_EVENTS.DATA_MIDDLE_RESPONSE, (data) => {
    addLogMessage('info', `Stream data received (streamId: ${data.streamId}, chunkIndex: ${data.chunkIndex}, outputId: ${data.outputId}): ${data.data}`, data.source, data.requestId, data.outputId);
  });

  socket.on(STREAM_EVENTS.DATA_LAST_RESPONSE, (data) => {
    addLogMessage('info', `Stream data received (streamId: ${data.streamId}, chunkIndex: ${data.chunkIndex}, outputId: ${data.outputId}): ${data.data}`, data.source, data.requestId, data.outputId);
  });

  socket.on(STREAM_EVENTS.END_RESPONSE, (data) => {
    addLogMessage('info', `Stream ended (streamId: ${data.streamId}, outputId: ${data.outputId})`, data.source, data.requestId, data.outputId);
  });

  //  监听 LLM 响应 (来自服务器)
  socket.on(MSG_TYPE.LLM_RESPONSE, (data) => {
    addLogMessage('info', `LLM response: ${data.message}`, 'server', data.requestId);
    // 在这里处理 LLM 响应 (例如, 显示在聊天界面中)
  });


  socket.on('disconnect', (reason) => {
    addLogMessage('warning', `Disconnected from server: ${reason}`, 'client');
  });

  socket.on('connect_error', (error) => {
    addLogMessage('fail', `Connection error: ${error}`, 'client');
  });

  // ... 其他事件监听器 ...
}

// 修改 sendNonStreamMessage 函数
function sendNonStreamMessage(message) {
  if (socket && socket.connected) {
    const requestId = uuidv4(); // 生成 requestId
    socket.emit(MSG_TYPE.LLM_REQUEST, {
      requestId: requestId,
      message: message,
    });
    addLogMessage('info', `Sent LLM request: ${message}`, 'client', requestId);
  } else {
    addLogMessage('fail', 'Cannot send message: Not connected to server', 'client');
  }
}
export { connectToServer, sendNonStreamMessage, socket };