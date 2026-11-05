import path from "node:path"
import KnowledgeBase from "./KnowledgeBase.js"
import cfg from "../config/config.js"
import { WEBUI_DATA_DIR } from "../webui/dataDir.js"

let instance = null

/** 获取全局共享的知识库实例（插件与 WebUI 共用，避免重复加载/写入） */
export function getKnowledgeBase() {
  if (instance) return instance

  const storagePath = path.resolve(
    process.cwd(),
    cfg.ai?.kbStoragePath || path.join(WEBUI_DATA_DIR, "ai_knowledge.json"),
  )
  instance = new KnowledgeBase({
    storagePath,
    archivePath: cfg.ai?.kbArchivePath
      ? path.resolve(process.cwd(), cfg.ai.kbArchivePath)
      : undefined,
    maxEntries: cfg.ai?.kbMaxEntries || 1000,
    maxEntrySize: cfg.ai?.kbMaxEntrySize || 10000,
    coldAfterDays: cfg.ai?.kbColdAfterDays ?? 180,
    recencyHalfLifeDays: cfg.ai?.kbRecencyHalfLifeDays ?? 90,
    mergeSimilarity: cfg.ai?.kbMergeSimilarity ?? 0.85,
  })
  instance.load()

  if (typeof Bot === "object") Bot.aiKnowledgeBase = instance
  return instance
}

/** 路径或容量配置变更后重建实例；先把待写入数据落盘，避免丢失 */
export function reloadKnowledgeBase() {
  if (instance) {
    instance.save()
    instance = null
  }
  // 让 AIManager 的懒加载缓存失效（它每次会重新向本模块要单例）
  globalThis.__yunzaiKbGeneration = (Number(globalThis.__yunzaiKbGeneration) || 0) + 1
  return getKnowledgeBase()
}

/** 当前单例代号，用于判断调用方缓存是否过期 */
export function knowledgeBaseGeneration() {
  return Number(globalThis.__yunzaiKbGeneration) || 0
}
