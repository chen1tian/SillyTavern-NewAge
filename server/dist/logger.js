import path from 'path';
const { resolve, dirname, join } = path
import winston from 'winston';
const { combine, timestamp, errors, printf, colorize, simple } = winston.format;
import { fileURLToPath } from 'url';
import * as fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


// 1. 定义日志目录
const logDir = path.resolve(__dirname, '..','logs');

// 2. 确保日志目录存在
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 3. 自定义日志格式：日期 - 等级 - message
const myFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} - ${level} - ${message}`;
});


const logger = winston.createLogger({
  level: 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    myFormat // 使用自定义的格式
  ),
  defaultMeta: { service: 'llm-server' },
  transports: [
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: combine(
      colorize(),
      //simple()
      myFormat //console也用myFormat的话，没有颜色
    )
  }));
}

export { logger }