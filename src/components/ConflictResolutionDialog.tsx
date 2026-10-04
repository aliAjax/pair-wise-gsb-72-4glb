import { useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import type { ConflictSide, FieldConflict, FieldResolution } from '@/types'

interface ConflictResolutionDialogProps {
  open: boolean
  conflicts: FieldConflict[]
  baseVersion: number
  serverVersion: number
  actor: string
  busy?: boolean
  onResolve: (resolutions: Record<string, FieldResolution>) => void
  onClose: () => void
}

/**
 * 版本冲突逐项定稿：
 * 每个字段展示打开页面时的旧值、本人待保存值、服务端最新值，
 * 由评审人逐项选择采用哪一边；全部定稿后才能提交。
 * 定稿携带本轮两边值指纹，对方在定稿期间再改过时旧选择自动失效。
 */
export function ConflictResolutionDialog({
  open,
  conflicts,
  baseVersion,
  serverVersion,
  actor,
  busy,
  onResolve,
  onClose,
}: ConflictResolutionDialogProps) {
  const [picked, setPicked] = useState<Record<string, ConflictSide>>({})

  // 新一轮冲突（指纹变化）到达时清空上一轮选择
  const roundKey = conflicts.map((c) => `${c.field}:${c.theirsFingerprint}`).join('|')
  useEffect(() => {
    setPicked({})
  }, [roundKey])

  const selections = picked

  const resolvedCount = conflicts.filter((conflict) => selections[conflict.field]).length
  const allResolved = conflicts.length > 0 && resolvedCount === conflicts.length

  const handlePick = (field: string) => (_event: unknown, value: ConflictSide | null) => {
    if (!value) return
    setPicked((current) => ({ ...current, [field]: value }))
  }

  const submit = () => {
    const resolutions: Record<string, FieldResolution> = {}
    for (const conflict of conflicts) {
      const side = selections[conflict.field]
      if (!side) continue
      resolutions[conflict.field] = {
        side,
        mineFingerprint: conflict.mineFingerprint,
        theirsFingerprint: conflict.theirsFingerprint,
      }
    }
    onResolve(resolutions)
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>
        配置版本冲突 · v{baseVersion} → v{serverVersion}
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity="warning" sx={{ mb: 2 }}>
          该开关在你打开页面后已被其他人更新。为避免覆盖灰度比例和回滚条件，请逐项核对并选择最终保留的值。
          定稿结果（含三方旧值）会完整写入审计记录，保存人：{actor}。
        </Alert>
        <Stack spacing={2}>
          {conflicts.map((conflict) => {
            const choice = selections[conflict.field]
            return (
              <Box
                key={conflict.field}
                className={`conflict-field ${choice ? 'resolved' : ''}`}
                sx={{
                  border: '1px solid',
                  borderColor: choice ? 'success.light' : 'warning.light',
                  borderRadius: 1.5,
                  p: 2,
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography fontWeight={700}>{conflict.label}</Typography>
                  {choice && <Chip size="small" color="success" label={`已采用${choice === 'mine' ? '本人' : '对方'}值`} />}
                </Stack>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                  <Box className="conflict-value conflict-base" sx={{ flex: 1, bgcolor: 'action.hover', borderRadius: 1, p: 1.2 }}>
                    <Typography variant="caption" color="text.secondary">打开页面时（v{baseVersion} 旧值）</Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{conflict.baseValue}</Typography>
                  </Box>
                  <Box
                    className="conflict-value conflict-mine"
                    sx={{
                      flex: 1,
                      borderRadius: 1,
                      p: 1.2,
                      bgcolor: choice === 'mine' ? 'success.lighter' : undefined,
                      border: '1px solid',
                      borderColor: choice === 'mine' ? 'success.main' : 'divider',
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">我的修改（本页待保存）</Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{conflict.mineValue}</Typography>
                  </Box>
                  <Box
                    className="conflict-value conflict-theirs"
                    sx={{
                      flex: 1,
                      borderRadius: 1,
                      p: 1.2,
                      bgcolor: choice === 'theirs' ? 'info.lighter' : undefined,
                      border: '1px solid',
                      borderColor: choice === 'theirs' ? 'info.main' : 'divider',
                    }}
                  >
                    <Typography variant="caption" color="text.secondary">对方已保存（v{serverVersion} 最新）</Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{conflict.theirsValue}</Typography>
                  </Box>
                </Stack>
                <Divider sx={{ my: 1.5 }} />
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={choice ?? null}
                  onChange={handlePick(conflict.field)}
                >
                  <ToggleButton value="mine">采用我的值</ToggleButton>
                  <ToggleButton value="theirs">采用对方最新值</ToggleButton>
                </ToggleButtonGroup>
              </Box>
            )
          })}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
          已定稿 {resolvedCount} / {conflicts.length} 项。未改动的字段已自动合并对方的最新值。
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>取消</Button>
        <Button
          variant="contained"
          disabled={!allResolved || busy}
          onClick={submit}
        >
          {busy ? '提交中…' : `按定稿结果保存（${resolvedCount}/${conflicts.length}）`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
