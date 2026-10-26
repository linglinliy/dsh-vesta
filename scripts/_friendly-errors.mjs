/**
 * 把未捕获异常/未处理的 Promise 拒绝变成一行中文错误 + 退出码 2。
 * 生成器脚本在文件读不到、结构解析失败时用，避免把 Node 堆栈甩给用户。
 */
export function installFriendlyErrors() {
  const report = (error) => {
    if (error && error.code === 'ENOENT') {
      console.error(`找不到文件：${error.path ?? '(未知路径)'}`)
      process.exit(2)
    }
    const message = error && error.message ? error.message : String(error)
    console.error(`错误：${message}`)
    process.exit(2)
  }
  process.on('uncaughtException', report)
  process.on('unhandledRejection', report)
}
