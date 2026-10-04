import { useEffect, useState } from 'react'
import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import PendingActionsIcon from '@mui/icons-material/PendingActions'
import { Link, useLocation } from 'react-router-dom'
import {
  clearPendingCommit,
  listPendingCommits,
  PENDING_CHANGED_EVENT,
} from '@/services/pendingCommits'
import type { PendingFlagCommit } from '@/types'

/**
 * 全局挂起提交提示：
 * 保存过程中刷新、重复点击或本地存储短暂失败后，任何页面都能看到未完成的同一笔提交，
 * 点击即可回到编辑器接着完成；冲突挂起直接进入逐项定稿。
 */
export function PendingCommitsBanner() {
  const [pendingList, setPendingList] = useState<PendingFlagCommit[]>([])
  const location = useLocation()

  useEffect(() => {
    const refresh = () => setPendingList(listPendingCommits())
    refresh()
    window.addEventListener(PENDING_CHANGED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(PENDING_CHANGED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  if (pendingList.length === 0) return null

  // 编辑器页已有内联横幅，这里不重复展示当前正在编辑的那笔。
  const visible = pendingList.filter((pending) => !location.pathname.endsWith(`/flags/${pending.flagId}`))
  if (visible.length === 0) return null

  return (
    <Box sx={{ mb: 2 }}>
      {visible.map((pending) => (
        <Alert
          key={pending.commitId}
          severity={pending.conflict ? 'warning' : pending.lastError ? 'error' : 'info'}
          icon={<PendingActionsIcon />}
          sx={{ mb: 1 }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <Box>
              <Typography variant="body2" fontWeight={700}>
                {pending.flagKey || '未命名开关'} 有一笔{pending.intent === 'submit-review' ? '提交评审' : '保存'}未完成
                （提交编号 {pending.commitId.slice(0, 8)}，已尝试 {pending.attempts} 次）
              </Typography>
              <Typography variant="caption" color="text.secondary">
                基于打开时的 v{pending.expectedVersion}
                {pending.conflict
                  ? ` · 对端已保存到 v${pending.conflict.currentVersion}，${pending.conflict.conflicts.length} 个字段冲突待逐项定稿`
                  : pending.lastError
                    ? ` · ${pending.lastError}`
                    : ' · 正在等待完成'}
              </Typography>
            </Box>
            <Button
              size="small"
              variant="contained"
              color={pending.conflict ? 'warning' : 'primary'}
              component={Link}
              to={pending.expectedVersion === 0 ? '/flags/new' : `/flags/${pending.flagId}`}
            >
              {pending.conflict ? '继续逐项定稿' : '重新打开并完成该提交'}
            </Button>
            <Button
              size="small"
              color="inherit"
              onClick={() => clearPendingCommit(pending.flagId)}
            >
              放弃
            </Button>
          </Stack>
        </Alert>
      ))}
    </Box>
  )
}
