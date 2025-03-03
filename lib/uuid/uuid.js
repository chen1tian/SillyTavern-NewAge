// client/node_modules/uuid/uuid.js
function uuidv4(length = 36) {
  // 默认长度为36（标准UUID）
  if (length <= 0) {
    return ''; //或者抛出错误，根据您的需求
  }

  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.substring(0, length);
  return template.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c == 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
export { uuidv4 };