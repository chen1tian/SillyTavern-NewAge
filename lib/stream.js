// lib/stream.js
import { MSG_TYPE, STREAM_EVENTS } from './constants.js';
import { uuidv4 } from './uuid/uuid.js';
import ss from '../server/node_modules/@sap_oss/node-socketio-stream/index.js';

// (Deprecated) 客户端流式发送函数 (已移至 llm_message_handler.js)
/*
function startClientStream(socket, message, numStreams) {
  const streamId = uuidv4();
  const chunkSize = Math.ceil(message.length / numStreams);

  socket.emit(STREAM_EVENTS.START, {
    type: MSG_TYPE.STREAM_START,
    streamId: streamId,
    numStreams: numStreams,
  });

  for (let i = 0; i < numStreams; i++) {
    const start = i * chunkSize;
    const end = Math.min((i + 1) * chunkSize, message.length);
    const chunk = message.substring(start, end);

    let dataType;
    let eventName;
    if (i === 0) {
      dataType = MSG_TYPE.STREAM_DATA_FIRST;
      eventName = STREAM_EVENTS.DATA_FIRST;
    } else if (i === numStreams - 1) {
      dataType = MSG_TYPE.STREAM_DATA_LAST;
      eventName = STREAM_EVENTS.DATA_LAST;
    } else {
      dataType = MSG_TYPE.STREAM_DATA_MIDDLE;
      eventName = STREAM_EVENTS.DATA_MIDDLE;
    }

    socket.emit(eventName, {
      type: dataType,
      streamId: streamId,
      chunkIndex: i,
      data: chunk,
    });
  }

  socket.emit(STREAM_EVENTS.END, {
    type: MSG_TYPE.STREAM_END,
    streamId: streamId,
  });
  return streamId;
}
*/

/**
 * 设置服务器端流式处理程序，SillyTavern -> 服务器 / Sets up server-side stream handlers,SillyTavern -> server.
 * @param {import('socket.io').Server} io - Socket.IO Server 实例 / Socket.IO Server instance.
 * @param {string} namespace - 命名空间 / Namespace.
 * @param {function} [forwardingHandler] - 自定义转发处理函数 (可选) / Custom forwarding handler function (optional).
 * @returns {void}
 */
function setupServerStreamHandlers(io, namespace, llmRequests) {
  // 传入 llmRequests
  const streamBuffers = {};
  const outputBuffers = {};
  const requestStatus = {};
  const clientStreams = {};

  io.of(namespace).on('connection', socket => {
    // 现在在 /llm 命名空间中
    console.log(`Client connected to ${namespace}:`, socket.id);

    socket.on(STREAM_EVENTS.START, data => {
      if (data.type === MSG_TYPE.STREAM_START) {
        console.log(`Stream started from ${socket.id} with stream ID ${data.streamId} and output ID ${data.outputId}`);
        const clientId = socket.handshake.auth.clientId; // 获取 clientId
        const target = data.target; // 获取 target, SillyTavern
        const requestId = data.requestId;

        streamBuffers[data.streamId] = {};
        if (!outputBuffers[data.outputId]) {
          outputBuffers[data.outputId] = '';
        }

        if (requestId) {
          requestStatus[requestId] = 'started';

          // 更新 llmRequests (与 LLM_REQUEST 事件处理程序中的逻辑相同)
          if (!llmRequests[requestId]) {
            llmRequests[requestId] = [];
          }
          llmRequests[requestId].push({ target, clientId });
        }

        // 为每个 streamId 创建一个客户端流
        const clientStream = forwardStreamData(io, NAMESPACES.LLM, llmRequests, data); // 调用 forwardingHandler, 获取流
        if (clientStream) {
          clientStreams[data.streamId] = clientStream; // 存储流
        }
      }
    });

    socket.on(STREAM_EVENTS.DATA_FIRST, data => handleStreamData(socket, data, llmRequests, clientStreams));
    socket.on(STREAM_EVENTS.DATA_MIDDLE, data => handleStreamData(socket, data, llmRequests, clientStreams));
    socket.on(STREAM_EVENTS.DATA_LAST, data => handleStreamData(socket, data, llmRequests, clientStreams));
    socket.on(STREAM_EVENTS.DATA_RETRY, data => handleStreamData(socket, data, llmRequests, clientStreams));
    socket.on(STREAM_EVENTS.DATA_FAILED, data => handleStreamData(socket, data, llmRequests, clientStreams));

    function handleStreamData(socket, data, llmRequests, clientStreams) {
      console.log(
        `Received stream chunk from ${socket.id} for stream ${data.streamId}, output ${data.outputId}, chunk ${data.chunkIndex}, type: ${data.type}`,
      );

      if (!streamBuffers[data.streamId]) {
        console.warn(`Received data for unknown stream ${data.streamId}. Ignoring.`);
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

    socket.on(STREAM_EVENTS.END, data => {
      if (data.type === MSG_TYPE.STREAM_END) {
        console.log(`Stream ended from ${socket.id} for stream ${data.streamId}, output ${data.outputId}`);

        if (streamBuffers[data.streamId]) {
          const sortedChunks = [];
          const chunks = streamBuffers[data.streamId];
          for (let i = 0; i < Object.keys(chunks).length; i++) {
            sortedChunks.push(chunks[i]);
          }
          const fullStreamMessage = sortedChunks.join('');
          console.log(`Full message for stream ${data.streamId}: ${fullStreamMessage}`);
          const fullOutputMessage = outputBuffers[data.outputId];
          console.log(`Full message for output ${data.outputId}: ${fullOutputMessage}`);
          delete streamBuffers[data.streamId];
        }

        if (data.requestId && requestStatus[data.requestId]) {
          requestStatus[data.requestId] = 'completed';
          console.log(`Request ${data.requestId} completed.`);

          // 清理映射关系 (可选，根据需要选择是否立即清理)
          delete llmRequests[data.requestId];
        }

        // 关闭客户端流
        if (clientStreams[data.streamId]) {
          clientStreams[data.streamId].end();
          delete clientStreams[data.streamId];
        }
      }
    });

    socket.on('disconnect', reason => {
      console.log(`Client disconnected from ${namespace}:`, socket.id, 'Reason:', reason);
    });

    socket.on('connect_error', error => {
      console.log(`Client:${socket.id} connect_error, error:`, error);
    });

    socket.on('reconnect_attempt', attemptNumber => {
      console.log(`Client:${socket.id} reconnect_attempt, attemptNumber:`, attemptNumber);
    });

    socket.on('reconnect', attemptNumber => {
      console.log(`Client:${socket.id} reconnected, attemptNumber:`, attemptNumber);
    });

    socket.on('reconnect_failed', () => {
      console.log(`Client:${socket.id} reconnected fail`);
    });
  });
}

/**
 * 流式转发数据，服务器 -> 客户端  / Forwards stream data,server -> client.
 * @param {import('socket.io').Server} io - Socket.IO Server 实例 / Socket.IO Server instance.
 * @param {string} namespace - 命名空间 / Namespace.
 * @param {string | string[]} [targetRoom] - 目标房间名 (可选, 如果提供则只转发给该房间) / Target room name (optional, if provided, only forwards to that room).
 * @returns {function} - 转发处理函数 / Forwarding handler function.
 */
function forwardStreamData(io, namespace, llmRequests, originalData) {
  const forwardingHandler = (socket, data) => {
    // data:  { type: MSG_TYPE.STREAM_START, streamId: streamId, ... }
    const stream = ss.createStream();
    const eventName = 'streamed_data';
    // 从 llmRequests 中查找匹配的请求
    const originalRequests = llmRequests[originalData.requestId]; // 使用原始数据中的 requestId

    if (originalRequests) {
      for (const originalRequest of originalRequests) {
        // 使用 originalRequest.clientId 作为目标房间
        ss(io.of(namespace).to(originalRequest.clientId)).emit(eventName, stream, {
          streamId: originalData.streamId, // 使用原始 data 中的 streamId
          outputId: originalData.outputId, // 使用原始 data 中的 outputId
          requestId: originalData.requestId, // 使用原始 data 中的 requestId
          source: 'server',
        });
      }
    } else {
      console.warn(`No matching requests found for requestId: ${originalData.requestId}`);
      // 可以选择向发送者发送错误消息
    }

    return stream;
  };
  return forwardingHandler;
}

export { setupServerStreamHandlers, forwardStreamData };
