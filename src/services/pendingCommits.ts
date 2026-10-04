import type { PendingFlagCommit } from '@/types'

/**
 * 未完成提交独立于主数据库存储：
 * 保存过程中刷新、重复点击或本地存储短暂失败后，重新打开页面仍能接着完成同一笔提交。
 * 主库始终只在一次原子写入中改变，避免出现半套配置。
 */
const PENDING_KEY = 'feature-flag-release-console-pending-v1'

export const PENDING_CHANGED_EVENT = 'pending-flag-commits-changed'

const notifyChanged = (): void => {
  try {
    window.dispatchEvent(new CustomEvent(PENDING_CHANGED_EVENT))
  } catch {
    // CustomEvent 不可用时静默忽略。
  }
}

type PendingStore = Record<string, PendingFlagCommit>

const readAll = (): PendingStore => {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as PendingStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const writeAll = (store: PendingStore): void => {
  localStorage.setItem(PENDING_KEY, JSON.stringify(store))
}

export const listPendingCommits = (): PendingFlagCommit[] => {
  const store = readAll()
  return Object.values(store).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export const getPendingCommit = (flagId: string): PendingFlagCommit | undefined =>
  readAll()[flagId]

export const savePendingCommit = (pending: PendingFlagCommit): void => {
  const store = readAll()
  store[pending.flagId] = pending
  writeAll(store)
  notifyChanged()
}

export const updatePendingCommit = (
  flagId: string,
  patch: Partial<PendingFlagCommit>,
): void => {
  const store = readAll()
  const current = store[flagId]
  if (current) {
    store[flagId] = { ...current, ...patch }
    writeAll(store)
    notifyChanged()
  }
}

export const clearPendingCommit = (flagId: string): void => {
  const store = readAll()
  if (store[flagId]) {
    delete store[flagId]
    writeAll(store)
    notifyChanged()
  }
}
