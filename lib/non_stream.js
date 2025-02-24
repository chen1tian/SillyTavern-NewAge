// lib/non_stream.js

import { MSG_TYPE } from './constants.js';
import { uuidv4 } from './uuid/uuid.js';

/**
 * 发送非流式消息 / Sends a non-stream message.
 * @param {import('socket.io').Socket | import('socket.io-client').Socket} socket - Socket.IO 的客户端或服务器端 Socket 实例 / Socket.IO client or server socket instance.
 * @param {string} message - 要发送的消息 / The message to send.
 * @param {string} [requestId] - 可选的请求 ID / Optional request ID.
 * @param {string} [outputId] - 可选的输出 ID / Optional output ID.
 * @returns {void}
 */
function sendNonStreamMessage(socket, message, requestId, outputId) {
  const reqId = requestId || uuidv4(); // 如果未提供 requestId，则生成一个新的
  const outId = outputId || uuidv4(); // 如果未提供 outputId，则生成一个新的

  socket.emit('message', {
    type: MSG_TYPE.NON_STREAM,
    data: message,
    source: 'client', // 标记消息来源为客户端
    requestId: reqId,
    outputId: outId,
  });
}

/**
 * 设置服务器端非流式消息处理器 / Sets up server-side non-stream message handlers.
 * @param {import('socket.io').Server} io - Socket.IO Server 实例 / Socket.IO Server instance.
 * @param {string} namespace - 命名空间 / Namespace.
 * @returns {void}
 */
function setupServerNonStreamHandlers(io, namespace) {
  io.of(namespace).on('connection', socket => {
    console.log(`Client connected to ${namespace}:`, socket.id);

    socket.on('message', data => {
      if (data.type === MSG_TYPE.NON_STREAM) {
        console.log(`Received non-stream message from ${socket.id}: ${data.data}`);

        let responseMessage;
        if (data.data === 'Connection active?') {
          responseMessage = 'Yes,connection is fine.';
        } else {
          responseMessage = `Success: ${data.data}`;
        }

        // 保留 outputId 和 requestId
        io.of(namespace).emit('message', {
          type: MSG_TYPE.NON_STREAM,
          data: responseMessage,
          source: 'server', // 标记消息来源为服务器
          requestId: data.requestId, // 使用原始请求的 requestId
          outputId: data.outputId, // 使用原始请求的 outputId
        });
      }
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected from ${namespace}:`, socket.id);
    });
  });
}

export { sendNonStreamMessage, setupServerNonStreamHandlers };
