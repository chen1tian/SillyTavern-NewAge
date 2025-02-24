// lib/stream.js
import { MSG_TYPE, STREAM_EVENTS } from './constants.js';
import { uuidv4 } from './uuid/uuid.js';

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
 * 设置服务器端流式处理程序 / Sets up server-side stream handlers.
 * @param {import('socket.io').Server} io - Socket.IO Server 实例 / Socket.IO Server instance.
 * @param {string} namespace - 命名空间 / Namespace.
 * @param {function} [forwardingHandler] - 自定义转发处理函数 (可选) / Custom forwarding handler function (optional).
 * @returns {void}
 */
function setupServerStreamHandlers(io, namespace, forwardingHandler) {
  const streamBuffers = {}; // { [streamId]: { [chunkIndex]: data } }
  const outputBuffers = {}; // { [outputId]: messageString }
  const requestStatus = {}; // { [requestId]: 'started' | 'processing' | 'completed' }

  io.of(namespace).on('connection', socket => {
    console.log(`Client connected to ${namespace}:`, socket.id);

    socket.on(STREAM_EVENTS.START, data => {
      if (data.type === MSG_TYPE.STREAM_START) {
        console.log(`Stream started from ${socket.id} with stream ID ${data.streamId} and output ID ${data.outputId}`);

        streamBuffers[data.streamId] = {};
        if (!outputBuffers[data.outputId]) {
          outputBuffers[data.outputId] = '';
        }

        if (data.requestId) {
          requestStatus[data.requestId] = 'started';
        }

        if (forwardingHandler) {
          forwardingHandler(socket, data);
        }
      }
    });

    socket.on(STREAM_EVENTS.DATA_FIRST, data => handleStreamData(socket, data));
    socket.on(STREAM_EVENTS.DATA_MIDDLE, data => handleStreamData(socket, data));
    socket.on(STREAM_EVENTS.DATA_LAST, data => handleStreamData(socket, data));
    socket.on(STREAM_EVENTS.DATA_RETRY, data => handleStreamData(socket, data));
    socket.on(STREAM_EVENTS.DATA_FAILED, data => handleStreamData(socket, data));

    function handleStreamData(socket, data) {
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

      if (forwardingHandler) {
        forwardingHandler(socket, data);
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
        }
        // socket.leave(data.streamId); // 不需要

        if (forwardingHandler) {
          forwardingHandler(socket, data);
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
 * 流式转发数据 (给服务器端 server.js 使用) / Forwards stream data (used by server.js).
 * @param {import('socket.io').Server} io - Socket.IO Server 实例 / Socket.IO Server instance.
 * @param {string} namespace - 命名空间 / Namespace.
 * @param {string | string[]} [targetRoom] - 目标房间名 (可选, 如果提供则只转发给该房间) / Target room name (optional, if provided, only forwards to that room).
 * @returns {function} - 转发处理函数 / Forwarding handler function.
 */
function forwardStreamData(io, namespace, targetRoom) {
  const forwardingHandler = (socket, data) => {
    let eventName;
    switch (data.type) {
      case MSG_TYPE.STREAM_START:
        eventName = STREAM_EVENTS.START_RESPONSE;
        break;
      case MSG_TYPE.STREAM_DATA_FIRST:
        eventName = STREAM_EVENTS.DATA_FIRST_RESPONSE;
        break;
      case MSG_TYPE.STREAM_DATA_MIDDLE:
        eventName = STREAM_EVENTS.DATA_MIDDLE_RESPONSE;
        break;
      case MSG_TYPE.STREAM_DATA_LAST:
        eventName = STREAM_EVENTS.DATA_LAST_RESPONSE;
        break;
      case MSG_TYPE.STREAM_DATA_RETRY:
        eventName = STREAM_EVENTS.DATA_RETRY_RESPONSE;
        break;
      case MSG_TYPE.STREAM_DATA_FAILED:
        eventName = STREAM_EVENTS.DATA_FAILED_RESPONSE;
        break;
      case MSG_TYPE.STREAM_END:
        eventName = STREAM_EVENTS.END_RESPONSE;
        break;
      default:
        return;
    }

    const serverData = { ...data, source: 'server', requestId: data.requestId };

    if (Array.isArray(targetRoom)) {
      for (const room of targetRoom) {
        io.of(namespace).to(room).emit(eventName, serverData);
      }
    } else if (targetRoom) {
      io.of(namespace).to(targetRoom).emit(eventName, serverData);
    }
    socket.emit(eventName, serverData);
  };
  return forwardingHandler;
}

export { setupServerStreamHandlers, forwardStreamData };
