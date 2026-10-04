import { useCallback, useEffect, useRef, useState } from 'react'
import { useSaveFlagMutation } from '@/services/flagApi'
import {
  clearPendingCommit,
  getPendingCommit,
  savePendingCommit,
  updatePendingCommit,
} from '@/services/pendingCommits'
import type {
  ConflictResolutionChoice,
  EditableFlagField,
  FeatureFlag,
  PendingFlagCommit,
  SaveFlagResult,
  SaveIntent,
} from '@/types'

export interface StartSaveOptions {
  desired: FeatureFlag
  expectedVersion: number
  base?: FeatureFlag
  intent: SaveIntent
}

export const createCommitId = (): string =>
  `commit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/**
 * 保存编排：
 * - 提交前先把整笔请求写入独立的挂起存储（WAL），刷新 / 重开后可继续同一笔提交；
 * - 同一时刻只允许一个保存请求在飞，重复点击直接忽略；
 * - 冲突时保留挂起记录供逐项定稿，存储短暂失败后可原样重试；
 * - 成功或明确放弃后清除挂起记录。
 */
export function useVersionedSave(flagId: string) {
  const [saveFlag] = useSaveFlagMutation()
  const inFlightRef = useRef(false)
  const [isSaving, setIsSaving] = useState(false)
  const [pending, setPending] = useState<PendingFlagCommit | null>(null)
  const [lastError, setLastError] = useState<string>('')
  const [autoMergedNotice, setAutoMergedNotice] = useState<EditableFlagField[]>([])

  useEffect(() => {
    setPending(getPendingCommit(flagId) ?? null)
  }, [flagId])

  const runCommit = useCallback(
    async (
      commit: PendingFlagCommit,
      resolutions?: Partial<Record<EditableFlagField, ConflictResolutionChoice>>,
      resolvedBy?: string,
    ): Promise<SaveFlagResult | undefined> => {
      if (inFlightRef.current) return undefined
      inFlightRef.current = true
      setIsSaving(true)
      setLastError('')
      const updated: PendingFlagCommit = {
        ...commit,
        lastAttemptAt: new Date().toISOString(),
        attempts: commit.attempts + 1,
        conflict:
          resolutions && commit.conflict
            ? { ...commit.conflict, resolutions, resolvedBy: resolvedBy ?? commit.conflict.resolvedBy }
            : commit.conflict,
      }
      savePendingCommit(updated)
      setPending(updated)
      try {
        const result = await saveFlag({
          flag: updated.desired,
          expectedVersion: updated.expectedVersion,
          base: updated.base,
          intent: updated.intent,
          commitId: updated.commitId,
          resolutions: updated.conflict?.resolutions,
          resolvedAgainstVersion: updated.conflict?.currentVersion,
          resolvedBy: updated.conflict?.resolvedBy,
        }).unwrap()

        if (result.outcome === 'conflict') {
          const nextPending: PendingFlagCommit = {
            ...updated,
            conflict: {
              currentVersion: result.currentVersion,
              conflicts: result.conflicts,
              autoMergedFields: result.autoMergedFields,
            },
            lastError: undefined,
          }
          savePendingCommit(nextPending)
          setPending(nextPending)
          if (result.autoMergedFields.length > 0) setAutoMergedNotice(result.autoMergedFields)
          return result
        }

        clearPendingCommit(updated.flagId)
        setPending(null)
        if (result.autoMergedFields.length > 0) setAutoMergedNotice(result.autoMergedFields)
        return result
      } catch (error) {
        const message =
          error && typeof error === 'object' && 'message' in error
            ? String((error as { message: unknown }).message)
            : '本地存储暂时不可用，请稍后重试'
        const failed: PendingFlagCommit = { ...updated, lastError: message }
        savePendingCommit(failed)
        setPending(failed)
        setLastError(message)
        return undefined
      } finally {
        inFlightRef.current = false
        setIsSaving(false)
      }
    },
    [saveFlag],
  )

  const startSave = useCallback(
    async (options: StartSaveOptions): Promise<SaveFlagResult | undefined> => {
      if (inFlightRef.current) return undefined
      // 同一开关只允许一笔挂起提交：新的保存意图复用原提交编号，保证仍是“同一笔”。
      const existing = getPendingCommit(flagId)
      const commit: PendingFlagCommit = {
        commitId: existing?.commitId ?? createCommitId(),
        flagId,
        flagKey: options.desired.key,
        intent: options.intent,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
        attempts: existing?.attempts ?? 0,
        expectedVersion: options.expectedVersion,
        desired: options.desired,
        base: options.base,
      }
      savePendingCommit(commit)
      setPending(commit)
      return runCommit(commit)
    },
    [flagId, runCommit],
  )

  const resolveConflict = useCallback(
    async (
      resolutions: Partial<Record<EditableFlagField, ConflictResolutionChoice>>,
      resolvedBy: string,
    ): Promise<SaveFlagResult | undefined> => {
      const current = getPendingCommit(flagId)
      if (!current?.conflict) return undefined
      return runCommit(current, resolutions, resolvedBy)
    },
    [flagId, runCommit],
  )

  const retry = useCallback(async (): Promise<SaveFlagResult | undefined> => {
    const current = getPendingCommit(flagId)
    if (!current) return undefined
    return runCommit(current)
  }, [flagId, runCommit])

  const discard = useCallback(() => {
    clearPendingCommit(flagId)
    setPending(null)
    setLastError('')
  }, [flagId])

  const updateResolutions = useCallback(
    (resolutions: Partial<Record<EditableFlagField, ConflictResolutionChoice>>, resolvedBy?: string) => {
      const current = getPendingCommit(flagId)
      if (!current?.conflict) return
      const patch = { conflict: { ...current.conflict, resolutions, resolvedBy } }
      updatePendingCommit(flagId, patch)
      setPending({ ...current, ...patch })
    },
    [flagId],
  )

  const dismissAutoMergedNotice = useCallback(() => setAutoMergedNotice([]), [])

  return {
    pending,
    isSaving,
    lastError,
    autoMergedNotice,
    startSave,
    resolveConflict,
    retry,
    discard,
    updateResolutions,
    dismissAutoMergedNotice,
  }
}
