// server/dist/non_stream.js

import { MSG_TYPE } from '../lib/constants.js';
import { uuidv4 } from '../lib/uuid/uuid.js';
import { logger, error, warn, info } from './logger.js';

/**
 * 发送非流式消息 / Sends a non-stream message.
 * @param {import('socket.io').Socket | import('socket.io-client').Socket} socket - Socket.IO 的客户端或服务器端 Socket 实例 / Socket.IO client or server socket instance.
 * @param {string} message - 要发送的消息 / The message to send.
 * @param {string} [requestId] - 可选的请求 ID / Optional request ID.
 * @param {string} [outputId] - 可选的输出 ID / Optional output ID.
 * @returns {void}
 */
function sendNonStreamMessage(socket, message, requestId) {
  const reqId = requestId || uuidv4(); // 如果未提供 requestId，则生成一个新的
  const outId = uuidv4(); // 如果未提供 outputId，则生成一个新的

  const extensionName = $('#socketio-extensionName').val();

  socket.emit('message', {
    type: MSG_TYPE.NON_STREAM,
    data: message,
    source: 'client', // 标记消息来源为客户端
    requestId: reqId,
    outputId: outId,
    clientId: extensionName,
  });
}

/**
 * 设置服务器端非流式消息处理器 / Sets up server-side non-stream message handlers.
 * @param {import('socket.io').Server} io - Socket.IO Server 实例 / Socket.IO Server instance.
 * @param {object} chatModule - ChatModule 实例 / ChatModule instance.
 * @returns {void}
 */
function setupServerNonStreamHandlers(io, namespace, chatModule) { // 修改：传入 chatModule
  io.of(namespace).on('connection', (socket) => {
    const clientId = socket.handshake.auth.clientId;
    info('Client connecting to non_stream', { clientId });
    socket.on('message', (data) => {
      if (data.type === MSG_TYPE.NON_STREAM) {
        // ... (消息处理逻辑基本不变) ...
        info(`Received non-stream message from ${clientId}: ${data.data}`, { data }, 'NON_STREAM_MESSAGE');

        let responseMessage;
        if (data.data === 'Connection active?') {
          responseMessage = 'Yes,connection is fine.';
          socket.emit('message', {
            type: MSG_TYPE.NON_STREAM,
            data: responseMessage,
            source: 'server',
            requestId: data.requestId, // 使用客户端发送的 requestId
            outputId: uuidv4(),
          });
        } else {
          responseMessage = `${data.data}`; // (根据实际需求修改)
        }
        // 从 llmRequests 中查找匹配的请求 (现在由 ChatModule 管理)
        const originalRequest = chatModule.llmRequests[data.requestId];

        if (originalRequest) {
          // 使用 originalRequest.room 作为目标房间
          io.of(namespace).to(originalRequest.room).emit('message', {
            type: MSG_TYPE.NON_STREAM,
            data: responseMessage,
            source: 'server',
            requestId: data.requestId,
            outputId: data.outputId,
          });
          // 在这里调用 chatModule.handleLlmResponse
          if (data.requestId) {
            const roomName = originalRequest.room;
            // 构造一个与 LLM_RESPONSE 类似的 data 对象
            const responseData = {
              requestId: data.requestId,
              data: responseMessage, // 使用完整的消息内容
              // ... 其他需要的字段 ...
            };
            chatModule.handleLlmResponse(roomName, responseData);
          }
        } else {
          warn(`No matching requests found for requestId: ${data.requestId}`, {}, 'NON_STREAM_WARNING');
        }
      }
    });
  });
}

export { sendNonStreamMessage, setupServerNonStreamHandlers };
