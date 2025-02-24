// message_forwarder.js (SillyTavern客户端)

import { sendNonStreamMessage } from '../lib/non_stream.js';
import { MSG_TYPE, STREAM_EVENTS } from '../lib/constants.js';
import { uuidv4 } from '../lib/uuid/uuid.js';

/**
 * @description 获取消息类型 (流式或非流式) / Gets the message type (stream or non-stream).
 * @function getMessageType
 * @returns {number} 消息类型 / The message type.
 */
function getMessageType() {
  return isStreamForwardingEnabled ? MSG_TYPE.STREAM : MSG_TYPE.NON_STREAM;
}

let previousLLMData = '';
let currentOutputId = null;
let currentRequestId = null;
let accumulatedStreamData = '';

/**
 * @description 获取当前的 outputId / Gets the current output ID.
 * @function getCurrentOutputId
 * @returns {string | null} 当前的 outputId，如果没有则返回 null / The current output ID, or null if there is none.
 */
function getCurrentOutputId() {
  return currentOutputId;
}

/**
 * @description 设置新的 outputId 和 requestId / Sets a new output ID and request ID.
 * @function setNewOutputId
 * @returns {void}
 */
function setNewOutputId() {
  currentOutputId = uuidv4();
  currentRequestId = uuidv4();
}

/**
 * @description 重置 outputId 和 requestId / Resets the output ID and request ID.
 * @function resetOutputId
 * @returns {void}
 */
function resetOutputId() {
  currentOutputId = null;
  currentRequestId = null;
}

/**
 * @description 重置 previousLLMData / Resets the previous LLM data.
 * @function resetPreviousLLMData
 * @returns {void}
 */
function resetPreviousLLMData() {
  previousLLMData = '';
}

/**
 * @description 处理非流式消息 / Handles a non-stream message.
 * @function handleNonStreamMessage
 * @param {number} messageId - 消息 ID / The message ID.
 * @param {number} messageType - 消息类型 / The message type.
 * @returns {void}
 */
function handleNonStreamMessage(messageId, messageType) {
  const { chat } = SillyTavern.getContext();
  const message = chat[messageId];

  if (message && message.mes) {
    if (globalThis.socket && globalThis.socket.connected) {
      const extensionName = $('#socketio-extensionName').val();
      if (isNonStreamForwardingEnabled) {
        sendNonStreamMessage(globalThis.socket, message.mes, null, null, extensionName);
      } else if (isStreamForwardingEnabled) {
        startStreamFromNonStream(globalThis.socket, message.mes, 5, extensionName);
      }
    } else {
      console.warn('LLM消息转发失败，原因：socket未连接或不存在');
    }
  }
}

/**
 * @description 处理流式 token / Handles a stream token.
 * @function handleStreamToken
 * @param {string} data - 接收到的 token 数据 / The received token data.
 * @param {number} messageType - 消息类型 / The message type.
 * @returns {void}
 */
function handleStreamToken(data, messageType) {
  if (messageType === MSG_TYPE.STREAM && isStreamForwardingEnabled) {
    const llmStreamData = String(data);

    tokenCount += llmStreamData.length;

    if (globalThis.socket && globalThis.socket.connected) {
      if (!currentOutputId) {
        console.warn('Current output ID is null. Ignoring stream data.');
        return;
      }
      const extensionName = $('#socketio-extensionName').val();
      startStreamFromStream(globalThis.socket, llmStreamData, currentOutputId, previousLLMData.length, extensionName);
      previousLLMData = llmStreamData;
    } else {
      console.warn('Socket未连接');
    }
  } else if (messageType !== MSG_TYPE.STREAM) {
    console.warn('消息类型错误：当前为非流式转发');
  }
}

/**
 * @description 从流式数据启动新的流式传输 (用于流式转发) / Starts a new stream from stream data (used for stream forwarding).
 * @function startStreamFromStream
 * @param {import('socket.io').Socket} socket - Socket.IO Socket 实例 / Socket.IO Socket instance.
 * @param {string} newData - 新的流数据 / The new stream data.
 * @param {string} outputId - 输出 ID / The output ID.
 * @param {number} previousLength - 之前数据的长度 / The length of the previous data.
 * @param {string} extensionName - 扩展名称
 * @returns {void}
 */
function startStreamFromStream(socket, newData, outputId, previousLength, extensionName) {
  const streamId = uuidv4(); // 每个 token 都有一个新的 streamId
  let chunk = newData.substring(previousLength);
  const numStreams = 5;

  if (previousLength === 0) {
    chunk = chunk.replace(/^[\n\s]+/g, '');
  }

  socket.emit(STREAM_EVENTS.START, {
    type: MSG_TYPE.STREAM_START,
    streamId: streamId,
    outputId: outputId,
    numStreams: numStreams,
    source: extensionName, // 使用扩展名称
    requestId: currentRequestId,
    target: 'server', // 消息目标设置为服务器
  });

  const chunkSize = Math.ceil(chunk.length / numStreams);
  for (let i = 0; i < numStreams; i++) {
    const start = i * chunkSize;
    const end = Math.min((i + 1) * chunkSize, chunk.length);
    const chunkData = chunk.substring(start, end);

    let dataType;
    let eventName;

    if (previousLength === 0 && i === 0) {
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
      outputId: outputId,
      chunkIndex: i,
      data: chunkData,
      source: extensionName, // 使用扩展名称
      requestId: currentRequestId,
      target: 'server', // 消息目标设置为服务器
    });
  }

  socket.emit(STREAM_EVENTS.END, {
    type: MSG_TYPE.STREAM_END,
    streamId: streamId,
    outputId: outputId,
    source: extensionName, // 使用扩展名称
    requestId: currentRequestId,
    target: 'server', // 消息目标设置为服务器
  });
}

/**
 * @description 从非流式消息启动新的流式传输 / Starts a new stream from a non-stream message.
 * @function startStreamFromNonStream
 * @param {import('socket.io').Socket} socket - Socket.IO Socket 实例 / Socket.IO Socket instance.
 * @param {string} message - 非流式消息 / The non-stream message.
 * @param {number} numStreams - 分块数量 / The number of streams to divide the message into.
 * @param {string} extensionName - 扩展名称
 * @returns {void}
 */
function startStreamFromNonStream(socket, message, numStreams, extensionName) {
  const streamId = uuidv4();
  const chunkSize = Math.ceil(message.length / numStreams);
  const outputId = uuidv4();
  const requestId = uuidv4();

  socket.emit(STREAM_EVENTS.START, {
    type: MSG_TYPE.STREAM_START,
    streamId: streamId,
    outputId: outputId,
    numStreams: numStreams,
    source: extensionName, // 使用扩展名称
    requestId: requestId,
    target: 'server', // 消息目标设置为服务器
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
      outputId: outputId,
      chunkIndex: i,
      data: chunk,
      source: extensionName, // 使用扩展名称
      requestId: requestId,
      target: 'server', // 消息目标设置为服务器
    });
  }

  socket.emit(STREAM_EVENTS.END, {
    type: MSG_TYPE.STREAM_END,
    streamId: streamId,
    outputId: outputId,
    source: extensionName, // 使用扩展名称
    requestId: requestId,
    target: 'server', // 消息目标设置为服务器
  });
}

/**
 * @description 累积流式数据 / Accumulates stream data.
 * @function accumulateStreamData
 * @param {string} data - 要累积的数据 / The data to accumulate.
 * @returns {void}
 */
function accumulateStreamData(data) {
  accumulatedStreamData += String(data);
}

/**
 * @description 发送累积的流式数据 / Sends the accumulated stream data.
 * @function sendAccumulatedData
 * @returns {void}
 */
function sendAccumulatedData() {
  if (accumulatedStreamData && globalThis.socket && globalThis.socket.connected) {
    const extensionName = $('#socketio-extensionName').val();
    //这里直接调用了sendNonStreamMessage，这个函数内部会生成requestId
    sendNonStreamMessage(globalThis.socket, accumulatedStreamData, null, null, extensionName);
  }
  accumulatedStreamData = '';
}

let isStreamForwardingEnabled = false;
let isNonStreamForwardingEnabled = false;

/**
 * @description 启用流式转发 / Enables stream forwarding.
 * @function enableStreamForwarding
 * @returns {void}
 */
function enableStreamForwarding() {
  isStreamForwardingEnabled = true;
}

/**
 * @description 禁用流式转发 / Disables stream forwarding.
 * @function disableStreamForwarding
 * @returns {void}
 */
function disableStreamForwarding() {
  isStreamForwardingEnabled = false;
}

/**
 * @description 启用非流式转发 / Enables non-stream forwarding.
 * @function enableNonStreamForwarding
 * @returns {void}
 */
function enableNonStreamForwarding() {
  isNonStreamForwardingEnabled = true;
}

/**
 * @description 禁用非流式转发 / Disables non-stream forwarding.
 * @function disableNonStreamForwarding
 * @returns {void}
 */
function disableNonStreamForwarding() {
  isNonStreamForwardingEnabled = false;
}

let tokenCount = 0;
const BACKPRESSURE_CHECK_INTERVAL = 1000;
const BACKPRESSURE_THRESHOLD = 1000;

setInterval(() => {
  if (tokenCount > BACKPRESSURE_THRESHOLD) {
    console.warn(`Backpressure: Token count exceeded threshold (${tokenCount} > ${BACKPRESSURE_THRESHOLD})`);
  }
  tokenCount = 0;
}, BACKPRESSURE_CHECK_INTERVAL);

export {
  getMessageType,
  handleNonStreamMessage,
  handleStreamToken,
  enableStreamForwarding,
  disableStreamForwarding,
  enableNonStreamForwarding,
  disableNonStreamForwarding,
  startStreamFromNonStream,
  startStreamFromStream,
  getCurrentOutputId,
  setNewOutputId,
  resetOutputId,
  resetPreviousLLMData,
  accumulateStreamData,
  sendAccumulatedData,
  isStreamForwardingEnabled,
  isNonStreamForwardingEnabled,
};
