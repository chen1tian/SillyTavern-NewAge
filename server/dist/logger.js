import path from 'path';
const { resolve, dirname, join } = path;
import winston from 'winston';
const { combine, timestamp, errors, printf, colorize, simple } = winston.format;
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

// 4. 自定义日志格式：日期 - 等级 - message
const myFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} - ${level} - ${message}`;
});

const logger = winston.createLogger({
  level: 'info', // 设置最低记录级别为 info
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    myFormat // 使用自定义格式
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

// 6. 开发环境下添加控制台输出
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: combine(
      colorize(),
      simple() // 使用 simple() 格式，保留颜色并简化输出
    )
  }));
}

export { logger };