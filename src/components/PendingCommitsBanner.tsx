import { Alert, Button, Stack, Typography } from '@mui/material'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import { Link } from 'react-router-dom'
import { useListPendingCommitsQuery } from '@/services/flagApi'

/**
 * 全局未完成提交提示：刷新或从其他页面重新进入应用时，
 * 引导用户回到编辑器继续同一笔提交。
 */
export function PendingCommitsBanner() {
  const { data: pending = [] } = useListPendingCommitsQuery(undefined, {
    refetchOnMountOrArgChange: true,
  })

  if (pending.length === 0) return null

  return (
    <Alert
      severity="warning"
      variant="outlined"
      sx={{ mb: 2 }}
      action={
        <Stack direction="row" spacing={1}>
          {pending.slice(0, 3).map((item) => (
            <Button
              key={item.request.commitId}
              size="small"
              component={Link}
              to={
                item.request.baseVersion === 0
                  ? '/flags/new'
                  : `/flags/${item.request.flagId}`
              }
              startIcon={<AutorenewIcon />}
            >
              继续{item.request.mode === 'submit' ? '提交评审' : '保存'}
            </Button>
          ))}
        </Stack>
      }
    >
      <Typography variant="body2" fontWeight={700}>
        {pending.length} 笔保存未完成
      </Typography>
      <Typography variant="caption">
        页面刷新、重复点击或本地存储短暂失败都不会丢失配置，可继续同一笔提交；定稿期间的冲突选择会等待你逐项确认。
      </Typography>
    </Alert>
  )
}
