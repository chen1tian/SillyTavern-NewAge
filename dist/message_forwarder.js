// message_forwarder.js (SillyTavern客户端)

import { sendNonStreamMessage } from '../lib/non_stream.js';
import { MSG_TYPE, STREAM_EVENTS } from '../lib/constants.js';
import { uuidv4 } from '../lib/uuid/uuid.js';

function getMessageType() {
  return isStreamForwardingEnabled ? MSG_TYPE.STREAM : MSG_TYPE.NON_STREAM;
}

let previousLLMData = "";
let currentOutputId = null;
let currentRequestId = null; // 新增: 存储当前的 requestId
let accumulatedStreamData = "";

function getCurrentOutputId() {
  return currentOutputId;
}

function setNewOutputId() {
  currentOutputId = uuidv4();
  currentRequestId = uuidv4(); // 新增: 生成新的 requestId
}

function resetOutputId() {
  currentOutputId = null;
  currentRequestId = null; // 新增: 重置 requestId
}

function resetPreviousLLMData() {
  previousLLMData = "";
}

function handleNonStreamMessage(messageId, messageType) {
  const { chat } = SillyTavern.getContext();
  const message = chat[messageId];

  if (message && message.mes) {
    if (globalThis.socket && globalThis.socket.connected) {
      if (isNonStreamForwardingEnabled) {
        //toastr.info("非流式到非流式转发", "调试");
        //这里直接调用了sendNonStreamMessage，这个函数内部会生成requestId
        sendNonStreamMessage(globalThis.socket, message.mes);
      } else if (isStreamForwardingEnabled) {
        //toastr.info("非流式到流式转发", "调试");
        startStreamFromNonStream(globalThis.socket, message.mes, 5); //这里调用了startStreamFromNonStream，这个函数内部会生成requestId
      }
    } else {
      console.warn("LLM消息转发失败，原因：socket未连接或不存在");
    }
  }
}

function handleStreamToken(data, messageType) {
  if (messageType === MSG_TYPE.STREAM && isStreamForwardingEnabled) {
    const llmStreamData = String(data);

    tokenCount += llmStreamData.length;

    if (globalThis.socket && globalThis.socket.connected) {
      if (!currentOutputId) {
        console.warn("Current output ID is null. Ignoring stream data.");
        return;
      }

      startStreamFromStream(globalThis.socket, llmStreamData, currentOutputId, previousLLMData.length);
      previousLLMData = llmStreamData;

    } else {
      console.warn("Socket未连接");
    }
  } else if (messageType !== MSG_TYPE.STREAM) {
    console.warn("消息类型错误：当前为非流式转发");
  }
}

function startStreamFromStream(socket, newData, outputId, previousLength) {
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
    source: 'client',
    requestId: currentRequestId, // 添加 requestId
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
      source: 'client',
      requestId: currentRequestId, // 添加 requestId
    });
  }

  socket.emit(STREAM_EVENTS.END, {
    type: MSG_TYPE.STREAM_END,
    streamId: streamId,
    outputId: outputId,
    source: 'client',
    requestId: currentRequestId, // 添加 requestId
  });
}

function startStreamFromNonStream(socket, message, numStreams) {
  const streamId = uuidv4();
  const chunkSize = Math.ceil(message.length / numStreams);
  const outputId = uuidv4();
  const requestId = uuidv4();

  //toastr.info("非流式到流式转发", "调试");
  socket.emit(STREAM_EVENTS.START, {
    type: MSG_TYPE.STREAM_START,
    streamId: streamId,
    outputId: outputId,
    numStreams: numStreams,
    source: 'client',
    requestId: requestId, // 添加 requestId
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
      source: 'client',
      requestId: requestId, // 添加 requestId
    });
  }

  socket.emit(STREAM_EVENTS.END, {
    type: MSG_TYPE.STREAM_END,
    streamId: streamId,
    outputId: outputId,
    source: 'client',
    requestId: requestId, // 添加 requestId
  });
}

function accumulateStreamData(data) {
  accumulatedStreamData += String(data);
}

function sendAccumulatedData() {
  if (accumulatedStreamData && globalThis.socket && globalThis.socket.connected) {
    //这里直接调用了sendNonStreamMessage，这个函数内部会生成requestId
    sendNonStreamMessage(globalThis.socket, accumulatedStreamData);
  }
  accumulatedStreamData = "";
}

let isStreamForwardingEnabled = false;
let isNonStreamForwardingEnabled = false;

function enableStreamForwarding() {
  isStreamForwardingEnabled = true;
}
function disableStreamForwarding() {
  isStreamForwardingEnabled = false;
}
function enableNonStreamForwarding() {
  isNonStreamForwardingEnabled = true;
}
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