import path from "node:path"
import KnowledgeBase from "./KnowledgeBase.js"
import cfg from "../config/config.js"
import { WEBUI_DATA_DIR } from "../webui/dataDir.js"

let instance = null

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

export function reloadKnowledgeBase() {
  if (instance) {
    instance.save()
    instance = null
  }

  globalThis.__yunzaiKbGeneration = (Number(globalThis.__yunzaiKbGeneration) || 0) + 1
  return getKnowledgeBase()
}

export function knowledgeBaseGeneration() {
  return Number(globalThis.__yunzaiKbGeneration) || 0
}
