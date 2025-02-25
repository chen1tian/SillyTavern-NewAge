// lib/constants.js

const MSG_TYPE = {
  NON_STREAM: 0,
  STREAM_START: 1,
  STREAM_DATA: 2, // (Deprecated: 保留兼容性，但不推荐使用)
  STREAM_END: 3, // (Deprecated: 保留兼容性，但不推荐使用)
  STREAM_DATA_FIRST: 4,
  STREAM_DATA_MIDDLE: 5,
  STREAM_DATA_LAST: 6,
  STREAM_DATA_RETRY: 7,
  STREAM_DATA_FAILED: 8,
  LLM_REQUEST: 9, // 客户端/服务器 -> 服务器/SillyTavern：LLM 对话请求
  LLM_RESPONSE: 10, // 服务器/SillyTavern -> 客户端/服务器：LLM 响应
  IDENTIFY_SILLYTAVERN: 11, // SillyTavern -> 服务器: 身份标识 (并设置主密钥)
  CLIENT_SETTINGS: 12, // SillyTavern -> 服务器：客户端设置
  CREATE_ROOM: 13, // SillyTavern -> 服务器：创建房间
  DELETE_ROOM: 14, // SillyTavern -> 服务器：删除房间
  ADD_CLIENT_TO_ROOM: 15, // SillyTavern -> 服务器：将客户端添加到房间
  REMOVE_CLIENT_FROM_ROOM: 16, // SillyTavern/客户端 -> 服务器：将客户端从房间移除
  GENERATE_CLIENT_KEY: 17, // SillyTavern -> 服务器：生成客户端密钥
  REMOVE_CLIENT_KEY: 18, // SillyTavern -> 服务器：移除客户端密钥
  GET_ROOMS: 19, // SillyTavern -> 服务器：获取房间列表
  CLIENT_KEY: 20, // (Deprecated: 客户端密钥现在通过 auth 字段在连接时发送)
  ERROR: 21, // 服务器 -> 客户端/SillyTavern: 错误
  FUNCTION_CALL: 22, // 客户端 -> 服务器：函数调用
  LOGIN: 23, // 新增: 客户端 -> 服务器: 登录请求
  GET_CLIENT_LIST: 24, // 新增: SillyTavern -> 服务器：获取客户端列表
  GET_CLIENTS_IN_ROOM: 25, //新增: SillyTavern -> 服务器：获取房间内的客户端
  GET_CLIENT_KEY: 26, //新增: SillyTavern -> 服务器：获取客户端密钥
};

const STREAM_EVENTS = {
  // 客户端 -> 服务器
  START: 'CLIENT_STREAM_START',
  DATA_FIRST: 'CLIENT_STREAM_DATA_FIRST',
  DATA_MIDDLE: 'CLIENT_STREAM_DATA_MIDDLE',
  DATA_LAST: 'CLIENT_STREAM_DATA_LAST',
  DATA_RETRY: 'CLIENT_STREAM_DATA_RETRY',
  DATA_FAILED: 'CLIENT_STREAM_DATA_FAILED',
  END: 'CLIENT_STREAM_END',

  // 服务器 -> 客户端 (添加 _RESPONSE 后缀)
  START_RESPONSE: 'STREAM_START_RESPONSE',
  DATA_FIRST_RESPONSE: 'STREAM_DATA_FIRST_RESPONSE',
  DATA_MIDDLE_RESPONSE: 'STREAM_DATA_MIDDLE_RESPONSE',
  DATA_LAST_RESPONSE: 'STREAM_DATA_LAST_RESPONSE',
  DATA_RETRY_RESPONSE: 'STREAM_DATA_RETRY_RESPONSE',
  DATA_FAILED_RESPONSE: 'STREAM_DATA_FAILED_RESPONSE',
  END_RESPONSE: 'STREAM_END_RESPONSE',
};

const NAMESPACES = {
  DEFAULT: '/',
  FUNCTION_CALL: '/function_call',
  AUTH: '/auth',
  ROOMS: '/rooms',
  CLIENTS: '/clients',
  LLM: '/llm',
  SILLY_TAVERN: '/sillytavern',
};

export { MSG_TYPE, STREAM_EVENTS, NAMESPACES };
