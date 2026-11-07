import fs from "node:fs"

function relpyPrivate(user_id, msg, bot_id) {
  return Bot.sendFriendMsg(bot_id, user_id, msg)
}

function sleep(...args) {
  return Bot.sleep(...args)
}

async function downFile(url, file, opts) {
  try {
    return await Bot.download(url, file, opts)
  } catch (err) {
    logger.error("下载文件错误", err)
    return false
  }
}

function mkdirs(dirname) {
  if (fs.existsSync(dirname)) return true
  fs.mkdirSync(dirname, { recursive: true })
  return true
}

function makeForwardMsg(e, msg = [], dec) {
  const forwardMsg = []
  if (dec) forwardMsg.push({ message: dec })
  for (const message of Array.isArray(msg) ? msg : [msg]) forwardMsg.push({ message })

  if (e?.group?.makeForwardMsg) return e.group.makeForwardMsg(forwardMsg)
  else if (e?.friend?.makeForwardMsg) return e.friend.makeForwardMsg(forwardMsg)
  else return Bot.makeForwardMsg(forwardMsg)
}

export default { relpyPrivate, sleep, downFile, mkdirs, makeForwardMsg }
