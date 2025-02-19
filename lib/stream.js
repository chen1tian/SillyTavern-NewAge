// lib/stream.js
import { MSG_TYPE, STREAM_EVENTS } from './constants.js';
import { uuidv4 } from './uuid/uuid.js';

// 客户端流式传输 - 此函数不再需要，客户端的流式逻辑已经全部在llm_message_handler.js实现，当前只剩下服务器的流式实现
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
 * 服务器端流式处理
 * @param {import('socket.io').Server} io Socket.IO Server 实例
 * @param {string} namespace 命名空间
 * @param {function} [forwardingHandler] 自定义转发处理函数 (可选)
 */
function setupServerStreamHandlers(io, namespace, forwardingHandler) {
  const streamBuffers = {};
  // 用于存储每个 outputId 对应的完整消息
  const outputBuffers = {};
  // 用于存储每个 requestId 的处理状态
  const requestStatus = {};

  io.of(namespace).on('connection', (socket) => {
    console.log(`Client connected to ${namespace}:`, socket.id);

    socket.on(STREAM_EVENTS.START, (data) => {
      if (data.type === MSG_TYPE.STREAM_START) {
        console.log(`Stream started from ${socket.id} with stream ID ${data.streamId} and output ID ${data.outputId}`);
        // 为每个 streamId 创建缓冲区
        streamBuffers[data.streamId] = {};
        // 为每个 outputId 创建缓冲区, 如果之前不存在的话
        if (!outputBuffers[data.outputId]) {
          outputBuffers[data.outputId] = "";
        }
        // 初始化 requestId 的状态
        if (data.requestId) {
          requestStatus[data.requestId] = 'started';
        }

        //socket.join(data.streamId); // 加入 streamId 房间 (可能不需要, 取决于你的转发逻辑)

        if (forwardingHandler) {
          forwardingHandler(socket, data);
        }
      }
    });

    // 监听客户端发送的事件
    socket.on(STREAM_EVENTS.DATA_FIRST, (data) => handleStreamData(socket, data));
    socket.on(STREAM_EVENTS.DATA_MIDDLE, (data) => handleStreamData(socket, data));
    socket.on(STREAM_EVENTS.DATA_LAST, (data) => handleStreamData(socket, data));
    socket.on(STREAM_EVENTS.DATA_RETRY, (data) => handleStreamData(socket, data));
    socket.on(STREAM_EVENTS.DATA_FAILED, (data) => handleStreamData(socket, data));

    function handleStreamData(socket, data) {
      console.log(`Received stream chunk from ${socket.id} for stream ${data.streamId}, output ${data.outputId}, chunk ${data.chunkIndex}, type: ${data.type}`);

      if (!streamBuffers[data.streamId]) {
        console.warn(`Received data for unknown stream ${data.streamId}. Ignoring.`);
        return;
      }
      // 将数据块添加到 streamBuffers
      streamBuffers[data.streamId][data.chunkIndex] = data.data;
      // 将数据块添加到 outputBuffers
      outputBuffers[data.outputId] += data.data;

      // 更新 requestId 的状态 (如果存在)
      if (data.requestId && requestStatus[data.requestId]) {
        requestStatus[data.requestId] = 'processing';
      }


      if (forwardingHandler) {
        forwardingHandler(socket, data);
      }
    }

    socket.on(STREAM_EVENTS.END, (data) => {
      if (data.type === MSG_TYPE.STREAM_END) {
        console.log(`Stream ended from ${socket.id} for stream ${data.streamId}, output ${data.outputId}`);

        if (streamBuffers[data.streamId]) {
          // 拼接 streamBuffers 中的数据 (这里可能不需要, 因为 outputBuffers 已经有了)
          const sortedChunks = [];
          const chunks = streamBuffers[data.streamId];
          for (let i = 0; i < Object.keys(chunks).length; i++) {
            sortedChunks.push(chunks[i]);
          }
          const fullStreamMessage = sortedChunks.join(''); // 只是为了log
          console.log(`Full message for stream ${data.streamId}: ${fullStreamMessage}`);

          // 获取 outputBuffers 中的完整消息
          const fullOutputMessage = outputBuffers[data.outputId];
          console.log(`Full message for output ${data.outputId}: ${fullOutputMessage}`);


          delete streamBuffers[data.streamId];
          // 在所有属于该 outputId 的流都结束后, 可以删除 outputBuffers[data.outputId];
          // 但这里需要判断是否所有流都结束了, 比较复杂, 可以先不删除, 或者定期清理
        }
        // 更新 requestId 的状态 (如果存在)
        if (data.requestId && requestStatus[data.requestId]) {
          requestStatus[data.requestId] = 'completed';
          // 在这里可以根据 requestStatus[data.requestId] 的最终状态做一些处理, 比如记录日志, 触发事件等.
          console.log(`Request ${data.requestId} completed.`);
        }
        socket.leave(data.streamId);

        if (forwardingHandler) {
          forwardingHandler(socket, data);
        }
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`Client disconnected from ${namespace}:`, socket.id, 'Reason:', reason);
      // 可以选择在这里清理 streamBuffers 和 outputBuffers
      // 但更安全的做法是在 END 事件中处理, 确保所有数据都已接收
    });

    // 其他事件 (connect_error, reconnect_attempt 等) ...
    socket.on('connect_error', (error) => {
      console.log(`Client:${socket.id} connect_error, error:`, error);
    });

    socket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`Client:${socket.id} reconnect_attempt, attemptNumber:`, attemptNumber);
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log(`Client:${socket.id} reconnected, attemptNumber:`, attemptNumber);
    });

    socket.on('reconnect_failed', () => {
      console.log(`Client:${socket.id} reconnected fail`);
    });
  });
}

/**
 * 流式转发数据 (给服务器端 server.js 使用)
 * @param {import('socket.io').Server} io  Socket.IO Server 实例
 * @param {string} namespace 命名空间
 * @param {string | string[]} targetRoom  目标房间名 (可选, 如果提供则只转发给该房间)
 */
function forwardStreamData(io, namespace, targetRoom) {
  const forwardingHandler = (socket, data) => {
    let eventName;
    switch (data.type) {
      case MSG_TYPE.STREAM_START:
        eventName = STREAM_EVENTS.START_RESPONSE; // 使用带后缀的事件名
        break;
      case MSG_TYPE.STREAM_DATA_FIRST:
        eventName = STREAM_EVENTS.DATA_FIRST_RESPONSE; // 使用带后缀的事件名
        break;
      case MSG_TYPE.STREAM_DATA_MIDDLE:
        eventName = STREAM_EVENTS.DATA_MIDDLE_RESPONSE; // 使用带后缀的事件名
        break;
      case MSG_TYPE.STREAM_DATA_LAST:
        eventName = STREAM_EVENTS.DATA_LAST_RESPONSE; // 使用带后缀的事件名
        break;
      case MSG_TYPE.STREAM_DATA_RETRY:
        eventName = STREAM_EVENTS.DATA_RETRY_RESPONSE; // 使用带后缀的事件名
        break;
      case MSG_TYPE.STREAM_DATA_FAILED:
        eventName = STREAM_EVENTS.DATA_FAILED_RESPONSE; // 使用带后缀的事件名
        break;
      case MSG_TYPE.STREAM_END:
        eventName = STREAM_EVENTS.END_RESPONSE; // 使用带后缀的事件名
        break;
      default:
        return;
    }

    // 添加 source: 'server' 和 requestId
    const serverData = { ...data, source: 'server', requestId: data.requestId }; // 添加 requestId
    
    //console.log('data.type0:', data.type)

    // 同时转发到 targetRoom 和 发送者客户端
    if (Array.isArray(targetRoom)) {
      for (const room of targetRoom) {
        io.of(namespace).to(room).emit(eventName, serverData);
      }
    } else if (targetRoom) {
      io.of(namespace).to(targetRoom).emit(eventName, serverData); // 转发到 targetRoom
    }
    socket.emit(eventName, serverData); // 发送回客户端 (使用相同的事件名)
  };
  return forwardingHandler;
}

export { /*startClientStream,*/ setupServerStreamHandlers, forwardStreamData };