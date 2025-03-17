// server/dist/logger.js

import path from 'path';
const { resolve, dirname, join } = path;
import winston from 'winston';
const { combine, timestamp, errors, printf, colorize, json } = winston.format;
import { fileURLToPath } from 'url';
import * as fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 1. 定义日志目录
const logDir = path.resolve(__dirname, '..', 'logs');

// 2. 确保日志目录存在
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 3. 清空已有的日志文件 (在服务器启动时)
const logFiles = ['error.log', 'warn.log', 'info.log', 'combined.log'];
logFiles.forEach(file => {
  const filePath = path.join(logDir, file);
  if (fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, ''); // 清空文件内容
  }
});

// 4. 自定义日志格式 (改进版)
const myFormat = printf(({ level, message, timestamp, service, code, ...meta }) => {
  let logMessage = `${timestamp} [${level}] [${service}]`;

  if (code !== undefined) {
    logMessage += ` [${code}]`; // 添加错误码/警告码
  }

  logMessage += `: ${message}`;

  // 如果有其他元数据，则将其转换为 JSON 字符串并附加到消息中
  if (Object.keys(meta).length > 0) {
    logMessage += `\n${JSON.stringify(meta, null, 2)}`; // 使用缩进格式化 JSON
  }

  return logMessage;
});

const logger = winston.createLogger({
  level: 'info', // 设置最低记录级别为 info
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }), // 包含错误堆栈信息
    myFormat, // 使用自定义格式
  ),
  defaultMeta: { service: 'llm-server' },
  transports: [
    // 5. 定义不同级别的日志文件
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logDir, 'warn.log'), level: 'warn' }),
    new winston.transports.File({ filename: path.join(logDir, 'info.log'), level: 'info' }),
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') }), // 包含所有级别
  ],
});

// 6. 开发环境下添加控制台输出 (改进版)
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: combine(
      colorize(), // 添加颜色
      timestamp({ format: 'HH:mm:ss' }), // 简化时间戳格式
      printf(({ level, message, timestamp, service, code, ...meta }) => {
        let logMessage = `${timestamp} [${level}] [${service}]`;

        if (code !== undefined) {
          logMessage += ` [${code}]`; // 添加错误码/警告码
        }
        logMessage += `: ${message}`;

        // 如果有其他元数据，则将其转换为 JSON 字符串并附加到消息中
        if (Object.keys(meta).length > 0) {
          const metaString = Object.entries(meta)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(', ');
          logMessage += `\n\t${metaString}`; // 使用简洁的格式化
        }

        return logMessage;
      }),
    ),
  }));
}

// 7. 添加带有可选错误码/警告码的日志记录函数
/**
 * 记录日志消息。
 * @param {string} level - 日志级别 ('error', 'warn', 'info', 'debug', etc.)
 * @param {string} message - 日志消息
 * @param {object} [meta] - 可选的元数据对象
 * @param {string|number} [code] - 可选的错误码/警告码
 */
function log(level, message, meta = {}, code) {
  logger.log({ level, message, code, ...meta });
}

// 8. 导出方便的函数 (可选)
const error = (message, meta = {}, code) => log('error', message, meta, code);
const warn = (message, meta = {}, code) => log('warn', message, meta, code);
const info = (message, meta = {}, code) => log('info', message, meta, code);
const debug = (message, meta = {}, code) => log('debug', message, meta, code);

export { logger, log, error, warn, info, debug };