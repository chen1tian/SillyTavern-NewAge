// lib/non_stream.js

import { MSG_TYPE } from './constants.js';
import { uuidv4 } from './uuid/uuid.js'; // 导入 uuidv4

/**
 * 发送非流式消息
 * Send a non-stream message
 * @param {import('socket.io').Socket | import('socket.io-client').Socket} socket - Socket.IO 的客户端或服务器端 Socket 实例 / Socket.IO client or server socket instance
 * @param {string} message - 要发送的消息 / Message to send
 */
function sendNonStreamMessage(socket, message) {
  const outputId = uuidv4(); // 生成 outputId
  const requestId = uuidv4(); // 生成 requestId
  socket.emit('message', { type: MSG_TYPE.NON_STREAM, data: message, source: 'client', outputId: outputId, requestId: requestId }); 
}

/**
 * 设置服务器端非流式消息处理器
 * Setup server-side non-stream message handlers
 * @param {import('socket.io').Server} io - Socket.IO Server 实例 / Socket.IO Server instance
 * @param {string} namespace - 命名空间 / Namespace
 */
function setupServerNonStreamHandlers(io, namespace) {
  io.of(namespace).on('connection', (socket) => {
    console.log(`Client connected to ${namespace}:`, socket.id);

    socket.on('message', (data) => {
      if (data.type === MSG_TYPE.NON_STREAM) {
        console.log(`Received non-stream message from ${socket.id}: ${data.data}`);

        let responseMessage;
        if (data.data === "Connection active?") {
          responseMessage = "Yes,connection is fine.";
        } else {
          responseMessage = `Success: ${data.data}`;
        }
        // 保留 outputId
        io.of(namespace).emit('message', { type: MSG_TYPE.NON_STREAM, data: responseMessage, source: 'server', outputId: data.outputId, requestId: data.requestId }); // 添加 source: 'server'
      }
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected from ${namespace}:`, socket.id);
    });
  });
}

export { sendNonStreamMessage, setupServerNonStreamHandlers };