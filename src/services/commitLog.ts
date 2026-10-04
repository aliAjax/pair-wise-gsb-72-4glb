import type {
  AuditEvent,
  CommitOutcome,
  CommitRequest,
  EditableField,
  FeatureFlag,
  FieldConflict,
  FieldResolution,
  PendingCommit,
} from '@/types'
import { persistDatabase, readDatabase } from '@/services/database'
import { diffForAudit, threeWayMerge } from '@/services/versioning'

const OUTBOX_KEY = 'feature-flag-release-console-pending-commits-v1'

// 同一笔提交在本标签页内的进行中 Promise，防止重复点击产生重复落库
const inFlight = new Map<string, Promise<CommitOutcome>>()

const readOutbox = (): PendingCommit[] => {
  const raw = localStorage.getItem(OUTBOX_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as PendingCommit[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const writeOutbox = async (items: PendingCommit[], attempts = 3): Promise<void> => {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      if (items.length === 0) localStorage.removeItem(OUTBOX_KEY)
      else localStorage.setItem(OUTBOX_KEY, JSON.stringify(items))
      return
    } catch (error) {
      lastError = error
      if (attempt < attempts - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 120 * (attempt + 1)))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('待提交记录写入失败')
}

/**
 * 某开关在本标签页未完成的提交。
 * outbox 按 commitId 存放（不同标签页的并发提交互不覆盖），
 * 这里取该开关最近一笔未应用的提交。
 */
export const getPendingCommit = (flagId: string): PendingCommit | undefined =>
  pruneApplied(readOutbox())
    .filter((item) => item.request.flagId === flagId)
    .at(-1)

/** 清理已在主库标记为 applied 的 outbox 条目（例如另一标签页刚完成） */
const pruneApplied = (items: PendingCommit[]): PendingCommit[] => {
  const applied = new Set(readDatabase().appliedCommits ?? [])
  return items.filter((item) => !applied.has(item.request.commitId))
}

export const listPendingCommits = (): PendingCommit[] => pruneApplied(readOutbox())

const upsertPending = async (pending: PendingCommit): Promise<void> => {
  // outbox 与主库分键存储；先写 outbox 再动主库，任何时刻都不存在半套配置。
  // 按 commitId 存放：不同标签页对同一开关的并发待提交互不覆盖。
  const items = readOutbox().filter(
    (item) => item.request.commitId !== pending.request.commitId,
  )
  items.push(pending)
  await writeOutbox(items)
}

const updatePending = async (
  commitId: string,
  patch: Partial<Omit<PendingCommit, 'request'>> & { request?: CommitRequest },
): Promise<void> => {
  const items = readOutbox().map((item) =>
    item.request.commitId === commitId
      ? {
          ...item,
          ...patch,
          request: patch.request ? patch.request : item.request,
          attempts: item.attempts + 1,
        }
      : item,
  )
  await writeOutbox(items)
}

const removePending = async (commitId: string): Promise<void> => {
  await writeOutbox(readOutbox().filter((item) => item.request.commitId !== commitId))
}

export const discardPendingCommit = async (flagId: string): Promise<void> => {
  await writeOutbox(readOutbox().filter((item) => item.request.flagId !== flagId))
}

/** 取该开关最近一笔仍未应用的提交（已应用的先剪枝） */
const findLatestPending = (flagId: string): PendingCommit | undefined =>
  pruneApplied(readOutbox())
    .filter((item) => item.request.flagId === flagId)
    .at(-1)

const conflictOutcome = (
  request: CommitRequest,
  server: FeatureFlag,
  resolutions: Partial<Record<EditableField, FieldResolution>> | undefined,
): CommitOutcome => {
  const { conflicts } = threeWayMerge(request.base, request.intent, server, resolutions)
  const shaped: FieldConflict[] = conflicts.map((conflict) => ({
    ...conflict,
    resolution: conflict.resolution ?? null,
  }))
  return {
    type: 'conflict',
    message: `该开关已被其他人更新到 v${server.version}，请逐项定稿冲突字段后重试。`,
    serverVersion: server.version,
    conflicts: shaped,
    commitId: request.commitId,
  }
}

/**
 * 应用一笔提交（幂等）：
 * - 已应用过的 commitId 直接返回结果，重试不会产生第二条审计/第二次版本递增；
 * - 主库单次整体写入，开关与审计记录同时生效，不会出现半套配置。
 */
const applyCommitOnce = async (request: CommitRequest): Promise<CommitOutcome> => {
  const db = readDatabase()
  const applied = new Set(db.appliedCommits ?? [])
  if (applied.has(request.commitId)) {
    const flag = db.flags.find((item) => item.id === request.flagId)
    const auditEvent = db.audit.find((event) => event.id === `audit-${request.commitId}`)
    if (flag && auditEvent) {
      return { type: 'committed', flag, auditId: auditEvent.id, wasSubmit: request.mode === 'submit' }
    }
  }

  const index = db.flags.findIndex((item) => item.id === request.flagId)
  const timestamp = new Date().toISOString()

  // 新建开关：无版本竞争，直接落库
  if (index < 0) {
    if (request.baseVersion !== 0) {
      return { type: 'not-found', message: '功能开关不存在或已被删除，请刷新列表' }
    }
    const next: FeatureFlag = {
      ...request.intent,
      id: request.flagId,
      status: request.mode === 'submit' ? 'review' : 'draft',
      version: 1,
      versionedAt: timestamp,
      updatedAt: timestamp,
      lastChangedBy: request.actor,
    }
    const auditId = `audit-${request.commitId}`
    const auditEvent: AuditEvent = {
      id: auditId,
      flagId: next.id,
      flagKey: next.key,
      action: 'created',
      actor: request.actor,
      summary: '创建功能开关草稿。',
      after: next.status,
      version: 1,
      affectedUsers: 0,
      createdAt: timestamp,
    }
    db.flags.unshift(next)
    db.audit.unshift(auditEvent)
    db.appliedCommits = [...(db.appliedCommits ?? []), request.commitId]
    try {
      await persistDatabase(db)
    } catch (error) {
      return { type: 'storage-error', message: error instanceof Error ? error.message : '本地存储写入失败' }
    }
    return { type: 'committed', flag: next, auditId, wasSubmit: request.mode === 'submit' }
  }

  const server = db.flags[index]

  // 版本已前进：三方合并，未全部定稿则返回冲突清单
  if (server.version !== request.baseVersion) {
    if (server.version < request.baseVersion) {
      return { type: 'conflict', message: '本地版本记录异常（高于当前版本），请刷新页面后重试。', serverVersion: server.version, conflicts: [], commitId: request.commitId }
    }
    const base: FeatureFlag = request.base
    const { merged, conflicts, autoMerged } = threeWayMerge(base, request.intent, server, request.resolutions)
    if (conflicts.some((conflict) => conflict.resolution === null)) {
      return conflictOutcome(request, server, request.resolutions)
    }

    const next: FeatureFlag = {
      ...server,
      ...merged,
      status: request.mode === 'submit' ? 'review' : merged.status,
      version: server.version + 1,
      versionedAt: timestamp,
      updatedAt: timestamp,
      lastChangedBy: request.actor,
    }
    const changes = diffForAudit(server, next, { conflicts, autoMerged })
    const auditId = `audit-${request.commitId}`
    const hasResolutions = Object.values(request.resolutions ?? {}).length > 0
    const auditEvent: AuditEvent = {
      id: auditId,
      flagId: next.id,
      flagKey: next.key,
      action: request.mode === 'submit' ? 'submitted' : 'updated',
      actor: request.actor,
      summary:
        request.mode === 'submit'
          ? '保存合并结果并提交发布影响评审。'
          : hasResolutions
            ? `检测到 v${request.baseVersion} → v${server.version} 的并发修改，评审人逐项定稿后保存。`
            : '更新开关配置。',
      before: `v${server.version}`,
      after: `v${next.version}`,
      changes,
      version: next.version,
      affectedUsers: Math.round(900000 * (next.rolloutPercentage / 100)),
      createdAt: timestamp,
    }
    db.flags[index] = next
    db.audit.unshift(auditEvent)
    db.appliedCommits = [...(db.appliedCommits ?? []), request.commitId]
    try {
      await persistDatabase(db)
    } catch (error) {
      return { type: 'storage-error', message: error instanceof Error ? error.message : '本地存储写入失败' }
    }
    return { type: 'committed', flag: next, auditId, wasSubmit: request.mode === 'submit' }
  }

  // 版本未变：正常保存
  const before = server
  const next: FeatureFlag = {
    ...server,
    ...request.intent,
    id: server.id,
    createdAt: server.createdAt,
    status: request.mode === 'submit' ? 'review' : request.intent.status,
    version: server.version + 1,
    versionedAt: timestamp,
    updatedAt: timestamp,
    lastChangedBy: request.actor,
  }
  const changes = diffForAudit(before, next, { conflicts: [], autoMerged: [] })
  const auditId = `audit-${request.commitId}`
  const auditEvent: AuditEvent = {
    id: auditId,
    flagId: next.id,
    flagKey: next.key,
    action: request.mode === 'submit' ? 'submitted' : 'updated',
    actor: request.actor,
    summary: request.mode === 'submit' ? '提交发布影响评审。' : '更新开关配置。',
    before: `v${before.version}`,
    after: `v${next.version}`,
    changes,
    version: next.version,
    affectedUsers: Math.round(900000 * (next.rolloutPercentage / 100)),
    createdAt: timestamp,
  }
  db.flags[index] = next
  db.audit.unshift(auditEvent)
  db.appliedCommits = [...(db.appliedCommits ?? []), request.commitId]
  try {
    await persistDatabase(db)
  } catch (error) {
    return { type: 'storage-error', message: error instanceof Error ? error.message : '本地存储写入失败' }
  }
  return { type: 'committed', flag: next, auditId, wasSubmit: request.mode === 'submit' }
}

/**
 * 执行提交：先确保 outbox 落盘（刷新/崩溃也能续上同一笔），
 * 再应用到主库；成功后才移除 outbox。
 */
export const executeCommit = async (request: CommitRequest): Promise<CommitOutcome> => {
  const running = inFlight.get(request.commitId)
  if (running) return running

  const task = (async (): Promise<CommitOutcome> => {
    const existing = readOutbox().find((item) => item.request.commitId === request.commitId)
    if (!existing) {
      const pending: PendingCommit = {
        request,
        createdAt: new Date().toISOString(),
        attempts: 1,
      }
      try {
        await upsertPending(pending)
      } catch (error) {
        return { type: 'storage-error', message: error instanceof Error ? error.message : '待提交记录无法写入本地存储' }
      }
    }

    const outcome = await applyCommitOnce(request)

    if (outcome.type === 'committed') {
      try {
        await removePending(request.commitId)
      } catch {
        // 主库已落盘；outbox 残留会在下次 list 时按 appliedCommits 剪枝
      }
      inFlight.delete(request.commitId)
      return outcome
    }

    if (outcome.type === 'conflict') {
      await updatePending(request.commitId, {
        lastConflict: { serverVersion: outcome.serverVersion, conflicts: outcome.conflicts },
        lastError: undefined,
      }).catch(() => undefined)
    } else if (outcome.type === 'storage-error') {
      await updatePending(request.commitId, { lastError: outcome.message }).catch(() => undefined)
    }
    inFlight.delete(request.commitId)
    return outcome
  })()

  inFlight.set(request.commitId, task)
  return task
}

/** 重试 outbox 中某笔待完成提交，可携带本轮冲突定稿结果 */
export const retryPendingCommit = async (
  flagId: string,
  resolutions?: CommitRequest['resolutions'],
): Promise<CommitOutcome> => {
  const pending = findLatestPending(flagId)
  if (!pending) return { type: 'not-found', message: '没有可继续的待完成提交' }
  const request: CommitRequest =
    resolutions && Object.keys(resolutions).length > 0
      ? { ...pending.request, resolutions }
      : pending.request
  return executeCommit(request)
}
