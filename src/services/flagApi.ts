import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import {
  applyReview,
  getDashboardStats,
  readDatabase,
  rollbackFlag,
} from '@/services/database'
import {
  discardPendingCommit,
  executeCommit,
  getPendingCommit,
  listPendingCommits,
  retryPendingCommit,
} from '@/services/commitLog'
import type {
  AuditEvent,
  CommitOutcome,
  DashboardData,
  EditableField,
  FeatureFlag,
  FieldResolution,
  FlagFilter,
  ImpactIssue,
  PendingCommit,
  ReviewPayload,
  SaveRequest,
} from '@/types'

const delay = (milliseconds = 180) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

const commitInvalidation = (result?: CommitOutcome) =>
  result?.type === 'committed'
    ? ([
        'Flags',
        'Dashboard',
        'Audit',
        'PendingCommits',
        { type: 'Flag' as const, id: result.flag.id },
      ] as const)
    : (['PendingCommits'] as const)

export const flagApi = createApi({
  reducerPath: 'flagApi',
  baseQuery: fakeBaseQuery<{ message: string }>(),
  tagTypes: ['Flags', 'Flag', 'Issues', 'Audit', 'Dashboard', 'PendingCommits'],
  endpoints: (builder) => ({
    getDashboard: builder.query<DashboardData, void>({
      async queryFn() {
        await delay()
        return { data: getDashboardStats() }
      },
      providesTags: ['Dashboard'],
    }),
    getFlags: builder.query<FeatureFlag[], FlagFilter>({
      async queryFn(filters) {
        await delay()
        const keyword = filters.keyword?.trim().toLowerCase()
        const data = readDatabase().flags.filter(
          (flag) =>
            (!filters.status || flag.status === filters.status) &&
            (!filters.environment || flag.environment === filters.environment) &&
            (!filters.team || flag.team === filters.team) &&
            (!filters.owner || flag.owner === filters.owner) &&
            (!keyword ||
              flag.name.toLowerCase().includes(keyword) ||
              flag.key.toLowerCase().includes(keyword) ||
              flag.owner.toLowerCase().includes(keyword)),
        )
        return { data }
      },
      providesTags: ['Flags'],
    }),
    getFlag: builder.query<FeatureFlag, string>({
      async queryFn(id) {
        await delay()
        const flag = readDatabase().flags.find((item) => item.id === id)
        return flag ? { data: flag } : { error: { message: '功能开关不存在' } }
      },
      providesTags: (_result, _error, id) => [{ type: 'Flag', id }],
    }),
    /**
     * 版本校验保存：
     * - 冲突时返回 { type: 'conflict' }，由页面逐项定稿后带 resolutions 重试同一笔提交；
     * - 存储短暂失败返回 { type: 'storage-error' }，提交已在 outbox，可直接重试；
     * - 成功返回 { type: 'committed' }。
     */
    saveFlag: builder.mutation<CommitOutcome, SaveRequest>({
      async queryFn(request) {
        await delay(260)
        const outcome = await executeCommit({
          commitId: request.commitId ?? `commit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          flagId: request.flagId,
          mode: request.mode,
          actor: request.actor,
          baseVersion: request.baseVersion,
          base: request.base,
          intent: request.intent,
          resolutions: request.resolutions,
        })
        return { data: outcome }
      },
      invalidatesTags: (_result) => commitInvalidation(_result),
    }),
    /** 继续 outbox 中同一笔未完成提交（刷新页面 / 存储失败恢复 / 冲突定稿后重试） */
    retryCommit: builder.mutation<
      CommitOutcome,
      { flagId: string; resolutions?: Partial<Record<EditableField, FieldResolution>> }
    >({
      async queryFn({ flagId, resolutions }) {
        await delay(220)
        return { data: await retryPendingCommit(flagId, resolutions) }
      },
      invalidatesTags: (_result) => commitInvalidation(_result),
    }),
    /** 放弃未完成提交，清理本地 outbox */
    discardCommit: builder.mutation<void, string>({
      async queryFn(flagId) {
        await discardPendingCommit(flagId)
        return { data: undefined }
      },
      invalidatesTags: ['PendingCommits'],
    }),
    getPendingCommit: builder.query<PendingCommit | undefined, string>({
      async queryFn(flagId) {
        await delay(60)
        return { data: getPendingCommit(flagId) }
      },
      providesTags: (_result, _error, flagId) => [{ type: 'PendingCommits' }, { type: 'Flag', id: flagId }],
    }),
    listPendingCommits: builder.query<PendingCommit[], void>({
      async queryFn() {
        return { data: listPendingCommits() }
      },
      providesTags: ['PendingCommits'],
    }),
    reviewFlag: builder.mutation<FeatureFlag, { id: string; payload: ReviewPayload }>({
      async queryFn({ id, payload }) {
        await delay(260)
        try {
          return { data: await applyReview(id, payload) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '审批失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Dashboard',
        'Audit',
        { type: 'Flag', id: arg.id },
      ],
    }),
    rollbackFlag: builder.mutation<FeatureFlag, { id: string; actor: string; reason: string }>({
      async queryFn({ id, actor, reason }) {
        await delay(260)
        try {
          return { data: await rollbackFlag(id, actor, reason) }
        } catch (error) {
          return { error: { message: error instanceof Error ? error.message : '回滚失败' } }
        }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Dashboard',
        'Audit',
        { type: 'Flag', id: arg.id },
      ],
    }),
    getIssues: builder.query<ImpactIssue[], { category?: string; resolved?: boolean }>({
      async queryFn(filters) {
        await delay()
        const data = readDatabase().issues.filter(
          (issue) =>
            (!filters.category || issue.category === filters.category) &&
            (filters.resolved === undefined || issue.resolved === filters.resolved),
        )
        return { data }
      },
      providesTags: ['Issues'],
    }),
    getAudit: builder.query<AuditEvent[], { flagId?: string; action?: string }>({
      async queryFn(filters) {
        await delay()
        const data = readDatabase().audit.filter(
          (event) =>
            (!filters.flagId || event.flagId === filters.flagId) &&
            (!filters.action || event.action === filters.action),
        )
        return { data }
      },
      providesTags: ['Audit'],
    }),
  }),
})

export const {
  useGetDashboardQuery,
  useGetFlagsQuery,
  useGetFlagQuery,
  useSaveFlagMutation,
  useRetryCommitMutation,
  useDiscardCommitMutation,
  useGetPendingCommitQuery,
  useListPendingCommitsQuery,
  useReviewFlagMutation,
  useRollbackFlagMutation,
  useGetIssuesQuery,
  useGetAuditQuery,
} = flagApi

/**
 * 其他标签页写入主库或 outbox 后（storage 事件只在非当前标签页触发），
 * 让本标签页的缓存失效，保证打开编辑器时能立刻看到版本前进并弹出冲突。
 */
export const setupCrossTabSync = (
  onInvalidate: (tags: Parameters<typeof flagApi.util.invalidateTags>[0]) => void,
): (() => void) => {
  const listener = (event: StorageEvent) => {
    if (!event.key) return
    if (event.key.includes('pending-commits')) {
      onInvalidate(['PendingCommits'])
    } else {
      onInvalidate(['Flags', 'Flag', 'Audit', 'Dashboard', 'PendingCommits'])
    }
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}
