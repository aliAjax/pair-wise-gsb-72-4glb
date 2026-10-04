import { createApi, fakeBaseQuery } from '@reduxjs/toolkit/query/react'
import {
  applyReview,
  CommitRejectedError,
  commitFlagSave,
  getDashboardStats,
  readDatabase,
  rollbackFlag,
  StorageUnavailableError,
  submitFlagForReview,
} from '@/services/database'
import type {
  AuditEvent,
  DashboardData,
  FeatureFlag,
  FlagFilter,
  ImpactIssue,
  ReviewPayload,
  SaveFlagRequest,
  SaveFlagResult,
} from '@/types'

const delay = (milliseconds = 180) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds))

export type ApiErrorKind = 'storage' | 'rejected'

export interface ApiError {
  message: string
  kind: ApiErrorKind
}

const toApiError = (error: unknown): ApiError => {
  if (error instanceof StorageUnavailableError) {
    return { message: error.message, kind: 'storage' }
  }
  if (error instanceof CommitRejectedError) {
    return { message: error.message, kind: 'rejected' }
  }
  return {
    message: error instanceof Error ? error.message : '操作失败，请稍后重试',
    kind: 'storage',
  }
}

export const flagApi = createApi({
  reducerPath: 'flagApi',
  baseQuery: fakeBaseQuery<ApiError>(),
  tagTypes: ['Flags', 'Flag', 'Issues', 'Audit', 'Dashboard'],
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
        return flag ? { data: flag } : { error: { message: '功能开关不存在', kind: 'rejected' } }
      },
      providesTags: (_result, _error, id) => [{ type: 'Flag', id }],
    }),
    saveFlag: builder.mutation<SaveFlagResult, SaveFlagRequest>({
      async queryFn(request) {
        await delay(260)
        try {
          return { data: commitFlagSave(request) }
        } catch (error) {
          return { error: toApiError(error) }
        }
      },
      invalidatesTags: (result, _error, arg) =>
        result?.outcome === 'success'
          ? ['Flags', 'Dashboard', 'Audit', { type: 'Flag', id: arg.flag.id }]
          : [],
    }),
    submitForReview: builder.mutation<FeatureFlag, { id: string; actor: string }>({
      async queryFn({ id, actor }) {
        await delay(220)
        try {
          return { data: submitFlagForReview(id, actor) }
        } catch (error) {
          return { error: toApiError(error) }
        }
      },
      invalidatesTags: (_result, _error, arg) => [
        'Flags',
        'Dashboard',
        'Audit',
        { type: 'Flag', id: arg.id },
      ],
    }),
    reviewFlag: builder.mutation<FeatureFlag, { id: string; payload: ReviewPayload }>({
      async queryFn({ id, payload }) {
        await delay(260)
        try {
          return { data: applyReview(id, payload) }
        } catch (error) {
          return { error: toApiError(error) }
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
          return { data: rollbackFlag(id, actor, reason) }
        } catch (error) {
          return { error: toApiError(error) }
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
  useSubmitForReviewMutation,
  useReviewFlagMutation,
  useRollbackFlagMutation,
  useGetIssuesQuery,
  useGetAuditQuery,
} = flagApi
