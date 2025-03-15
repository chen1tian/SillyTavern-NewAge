// lib/constants.js

const MSG_TYPE = {
  // 通用
  ERROR: 'ERROR',
  WARNING: 'WARNING',

  // 连接与认证
  LOGIN: 'LOGIN', // 客户端 -> 服务器: 登录请求
  CLIENT_KEY_ASSIGNED: 'CLIENT_KEY_ASSIGNED', // 服务器 -> 客户端: 分配的客户端密钥
  // CLIENT_KEY: 'CLIENT_KEY', // 已废弃: 客户端密钥现在通过 auth 字段在连接时发送
  CLIENT_DISCONNECTED: 'CLIENT_DISCONNECTED', // 服务器/客户端 -> 客户端/服务器: 客户端断开连接
  UPDATE_CONNECTED_CLIENTS: 'UPDATE_CONNECTED_CLIENTS', // 服务器 -> SillyTavern: 更新已连接客户端列表（用于ST显示）
  CONNECTED_CLIENTS_UPDATE: "CONNECTED_CLIENTS_UPDATE",// 服务器 -> 客户端: 更新已连接客户端列表（用于客户端显示）

  // 客户端管理 (SillyTavern -> 服务器)
  GET_CLIENT_LIST: 'GET_CLIENT_LIST',
  GET_ALL_CLIENT_KEYS: 'GET_ALL_CLIENT_KEYS', // 获取所有客户端密钥（用于服务器内部管理）
  UPDATE_CONNECTED_CLIENTS: 'UPDATE_CONNECTED_CLIENTS',  // 服务器 -> 管理前端：客户端连接/断开/更新
  GENERATE_CLIENT_KEY: 'GENERATE_CLIENT_KEY',
  REMOVE_CLIENT_KEY: 'REMOVE_CLIENT_KEY',
  GET_CLIENT_KEY: 'GET_CLIENT_KEY', // 获取单个客户端的密钥

  // 房间管理 (SillyTavern -> 服务器)
  CREATE_ROOM: 'CREATE_ROOM',
  DELETE_ROOM: 'DELETE_ROOM',
  GET_ROOMS: 'GET_ROOMS',
  ADD_CLIENT_TO_ROOM: 'ADD_CLIENT_TO_ROOM',
  REMOVE_CLIENT_FROM_ROOM: 'REMOVE_CLIENT_FROM_ROOM',
  GET_CLIENTS_IN_ROOM: 'GET_CLIENTS_IN_ROOM',

  // LLM 交互
  LLM_REQUEST: 'LLM_REQUEST', // 客户端/服务器 -> 服务器/SillyTavern：LLM 对话请求
  LLM_RESPONSE: 'LLM_RESPONSE', // 服务器/SillyTavern -> 客户端/服务器：LLM 响应

  // SillyTavern 相关
  IDENTIFY_SILLYTAVERN: 'IDENTIFY_SILLYTAVERN', // SillyTavern -> 服务器: 身份标识
  CLIENT_SETTINGS: 'CLIENT_SETTINGS', // SillyTavern -> 服务器：客户端设置
  GET_SILLYTAVERN_EXTENSION: "GET_SILLYTAVERN_EXTENSION",

  // 函数调用
  FUNCTION_CALL: 'FUNCTION_CALL', // 客户端 -> 服务器：函数调用

  //debug 命名空间
  TOGGLE_DEBUG_MODE: 'TOGGLE_DEBUG_MODE',
  DEBUG_MODE_CHANGED: 'DEBUG_MODE_CHANGED',

  // 流式消息类型 (SillyTavern扩展端和服务器之间的流式传输)
  NON_STREAM: 0,
  STREAM_START: 1,
  STREAM_DATA: 2,
  STREAM_END: 3,
  STREAM_DATA_FIRST: 4,
  STREAM_DATA_MIDDLE: 5,
  STREAM_DATA_LAST: 6,
  STREAM_DATA_RETRY: 7,
  STREAM_DATA_FAILED: 8,
};

const STREAM_EVENTS = {
  // SillyTavern -> 服务器
  START: 'CLIENT_STREAM_START',
  DATA_FIRST: 'CLIENT_STREAM_DATA_FIRST',
  DATA_MIDDLE: 'CLIENT_STREAM_DATA_MIDDLE',
  DATA_LAST: 'CLIENT_STREAM_DATA_LAST',
  DATA_RETRY: 'CLIENT_STREAM_DATA_RETRY',
  DATA_FAILED: 'CLIENT_STREAM_DATA_FAILED',
  END: 'CLIENT_STREAM_END',

  // 服务器 -> 客户端
  streamed_data: 'SERVER_STREAM_DATA',
  streamed_end: 'SERVER_STREAM_END',
};

const NAMESPACES = {
  DEFAULT: '/',
  AUTH: '/auth',
  CLIENTS: '/clients',
  ROOMS: '/rooms',
  LLM: '/llm',
  SILLY_TAVERN: '/sillytavern',
  FUNCTION_CALL: '/function_call',
  DEBUG: '/debug',
};

// 导出时按字母顺序排列，方便查找
export { MSG_TYPE, NAMESPACES, STREAM_EVENTS };