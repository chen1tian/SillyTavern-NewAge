// server/dist/stream.js
import { MSG_TYPE, STREAM_EVENTS } from '../lib/constants.js';
import { uuidv4 } from '../lib/uuid/uuid.js';
import ss from '../node_modules/@sap_oss/node-socketio-stream/index.js';
import { logger, error, warn, info } from './logger.js'; // 导入 logger

/**
 * 设置服务器端流式处理程序，SillyTavern -> 服务器 / Sets up server-side stream handlers,SillyTavern -> server.
 * @param {import('socket.io').Server} io - Socket.IO Server 实例 / Socket.IO Server instance.
 * @param {string} namespace - 命名空间 / Namespace.
 * @param {object} chatModule - ChatModule 实例 / ChatModule instance.
 * @returns {void}
 */
function setupServerStreamHandlers(io, namespace, chatModule) { // 修改：传入 chatModule
  const streamBuffers = {};
  const outputBuffers = {};
  const requestStatus = {};
  const clientStreams = {};

  io.of(namespace).on('connection', (socket) => {
    const clientId = socket.handshake.auth.clientId;
    info('Client connecting to llm', { clientId }, 'STREAM_START');
    socket.on(STREAM_EVENTS.START, (data) => {
      // ... (START 事件处理逻辑不变) ...
      if (data.type === MSG_TYPE.STREAM_START) {
        info(`Stream started from ${clientId} with stream ID ${data.streamId}`, { data }, 'STREAM_START');

        const target = data.target; // 获取 target, SillyTavern
        const requestId = data.requestId;

        streamBuffers[data.streamId] = {};
        if (!outputBuffers[data.outputId]) {
          outputBuffers[data.outputId] = '';
        }

        if (requestId) {
          requestStatus[requestId] = 'started';
        }

        // 为每个 streamId 创建一个客户端流
        const clientStream = forwardStreamData(io, namespace, chatModule.llmRequests, data); // 调用 forwardingHandler, 获取流
        if (clientStream) {
          clientStreams[data.streamId] = clientStream; // 存储流
        }
      }
    });

    socket.on(STREAM_EVENTS.DATA_FIRST, (data) => handleStreamData(socket, data, chatModule, clientStreams)); // 修改
    socket.on(STREAM_EVENTS.DATA_MIDDLE, (data) => handleStreamData(socket, data, chatModule, clientStreams)); // 修改
    socket.on(STREAM_EVENTS.DATA_LAST, (data) => handleStreamData(socket, data, chatModule, clientStreams));   // 修改
    socket.on(STREAM_EVENTS.DATA_RETRY, (data) => handleStreamData(socket, data, chatModule, clientStreams)); // 修改
    socket.on(STREAM_EVENTS.DATA_FAILED, (data) => handleStreamData(socket, data, chatModule, clientStreams)); // 修改

    function handleStreamData(socket, data, chatModule, clientStreams) { // 修改：传入 chatModule
      // ... (handleStreamData 逻辑不变) ...
      info(`Received stream chunk from ${clientId} for stream ${data.streamId}`, { data }, `STREAM_${data.type}`);

      if (!streamBuffers[data.streamId]) {
        warn(`Received data for unknown stream ${data.streamId}. Ignoring.`, {}, 'STREAM_WARNING');
        return;
      }

      streamBuffers[data.streamId][data.chunkIndex] = data.data;
      outputBuffers[data.outputId] += data.data;

      if (data.requestId && requestStatus[data.requestId]) {
        requestStatus[data.requestId] = 'processing';
      }

      // 立即将数据块写入客户端流
      if (clientStreams[data.streamId]) {
        clientStreams[data.streamId].write(data.data);
      }
    }

    socket.on(STREAM_EVENTS.END, (data) => {
      if (data.type === MSG_TYPE.STREAM_END) {
        // ... (END 事件处理逻辑基本不变) ...
        info(`Stream ended from ${clientId} for stream ${data.streamId}`, { data }, 'STREAM_END');

        if (streamBuffers[data.streamId]) {
          const sortedChunks = [];
          const chunks = streamBuffers[data.streamId];
          for (let i = 0; i < Object.keys(chunks).length; i++) {
            sortedChunks.push(chunks[i]);
          }
          const fullStreamMessage = sortedChunks.join('');
          info(`Full message for stream ${data.streamId}: ${fullStreamMessage}`, {}, 'STREAM_INFO');
          const fullOutputMessage = outputBuffers[data.outputId];
          info(`Full message for output ${data.outputId}: ${fullOutputMessage}`, {}, 'STREAM_INFO');
          delete streamBuffers[data.streamId];
          // 在这里调用 chatModule.handleLlmResponse (处理完整的流式消息)
          if (data.requestId) {
            const originalRequest = chatModule.llmRequests[data.requestId];
            if (originalRequest) {
              const roomName = originalRequest.room;
              // 构造一个与 LLM_RESPONSE 类似的 data 对象
              const responseData = {
                requestId: data.requestId,
                data: fullOutputMessage, // 使用完整的消息内容
                // ... 其他需要的字段 ...
              };
              chatModule.handleLlmResponse(roomName, responseData);
            }
          }
        }

        if (data.requestId && requestStatus[data.requestId]) {
          requestStatus[data.requestId] = 'completed';
          info(`Request ${data.requestId} completed.`, {}, 'STREAM_INFO');
        }

        // 关闭客户端流
        if (clientStreams[data.streamId]) {
          clientStreams[data.streamId].end();
          delete clientStreams[data.streamId];
        }
      }
    });
  });
}

/**
 * 流式转发数据，服务器 -> 客户端  / Forwards stream data,server -> client.
 * @param {import('socket.io').Server} io - Socket.IO Server 实例 / Socket.IO Server instance.
 * @param {string} namespace - 命名空间 / Namespace.
 * @param {object} llmRequests - LLM 请求映射 (从 ChatModule 获取) / LLM request map (from ChatModule).
 * @param {object} originalData - 原始数据 (来自 SillyTavern 扩展端) / Original data (from SillyTavern extension).
 * @returns {object} - Socket.IO 流对象 / Socket.IO stream object.
 */
function forwardStreamData(io, namespace, llmRequests, originalData) {
  const forwardingHandler = (socket, data) => {
    const stream = ss.createStream();
    const eventName = STREAM_EVENTS.streamed_data;

    // 从 llmRequests 中查找匹配的请求 (现在由 ChatModule 管理)
    const originalRequest = llmRequests[originalData.requestId]; // 使用原始数据中的 requestId

    if (originalRequest) {
      // 使用 originalRequest.room 作为目标房间
      ss(io.of(namespace).to(originalRequest.room)).emit(eventName, stream, {
        streamId: originalData.streamId, // 使用原始 data 中的 streamId
        outputId: originalData.outputId, // 使用原始 data 中的 outputId
        requestId: originalData.requestId, // 使用原始 data 中的 requestId
        source: 'server',
      });
    } else {
      warn(`No matching requests found for requestId: ${originalData.requestId}`, {}, 'STREAM_WARNING');
    }

    return stream;
  };
  return forwardingHandler;
}

export { setupServerStreamHandlers, forwardStreamData };
