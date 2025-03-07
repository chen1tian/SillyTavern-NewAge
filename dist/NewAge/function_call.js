/**
 * 注册一个函数列表，用于 function call。
 *
 * @param {object[]} functions - 要注册的函数列表。每个对象应包含 name 和 func 属性。
 * @param {string} functions[].name - 函数的名称。
 * @param {function} functions[].func - 函数本身。
 * @param {object} [options] - 注册选项。
 * @param {boolean} [options.overwrite=false] - 是否覆盖已注册的函数。
 * @param {boolean} [options.prefix] - 是否添加前缀。
 * @throws {Error} 如果提供了无效的函数或名称冲突且不允许覆盖。
 */
function registerFunctions(functions, options = {}) {
  const { overwrite = false, prefix = "" } = options;

  functions.forEach(item => {
    if (!item || typeof item.name !== 'string' || typeof item.func !== 'function') {
      throw new Error(`Invalid function item provided: ${JSON.stringify(item)}`);
    }

    const functionName = prefix ? `${prefix}${item.name}`: item.name;

    if (functionRegistry[functionName] && !overwrite) {
      throw new Error(`Function "${functionName}" is already registered. Use 'overwrite: true' to overwrite.`);
    }
    functionRegistry[functionName] = item.func;
    console.log(`Function "${functionName}" registered for function_call.`);

  });
}