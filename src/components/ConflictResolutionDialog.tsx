import { useMemo, useState } from 'react'
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
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import GavelIcon from '@mui/icons-material/Gavel'
import { FIELD_LABELS, formatFieldValue } from '@/services/flagFields'
import type {
  ConflictResolutionChoice,
  EditableFlagField,
  FieldConflict,
} from '@/types'

interface ConflictResolutionDialogProps {
  open: boolean
  conflicts: FieldConflict[]
  expectedVersion: number
  currentVersion: number
  autoMergedFields: EditableFlagField[]
  saving: boolean
  onResolve: (
    resolutions: Partial<Record<EditableFlagField, ConflictResolutionChoice>>,
    reviewer: string,
  ) => void
  onClose: () => void
}

const choiceLabel: Record<ConflictResolutionChoice, string> = {
  mine: '采用本页修改',
  theirs: '采用对端已保存',
  base: '保留打开时旧值',
}

/**
 * 版本冲突逐项定稿：每个字段列出基线旧值、本页修改、对端已保存三列，
 * 评审人逐字段选择，未全部定稿前不能提交。
 */
export function ConflictResolutionDialog({
  open,
  conflicts,
  expectedVersion,
  currentVersion,
  autoMergedFields,
  saving,
  onResolve,
  onClose,
}: ConflictResolutionDialogProps) {
  const [reviewer, setReviewer] = useState('林默')
  const [choices, setChoices] = useState<Partial<Record<EditableFlagField, ConflictResolutionChoice>>>({})

  const allDecided = useMemo(
    () => conflicts.every((conflict) => choices[conflict.field]),
    [choices, conflicts],
  )

  const decideAll = (choice: ConflictResolutionChoice) => {
    const next = { ...choices }
    conflicts.forEach((conflict) => {
      next[conflict.field] = choice
    })
    setChoices(next)
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="lg">
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <GavelIcon color="warning" />
          <span>配置版本冲突，需要逐项定稿</span>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity="warning" sx={{ mb: 2 }}>
          您打开页面时配置为 v{expectedVersion}，对端标签页已保存到 v{currentVersion}
          （灰度比例、回滚条件等可能已被调整）。请逐字段确认保留哪一边的值；所有字段的旧值都会写入审计记录。
        </Alert>
        {autoMergedFields.length > 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            以下字段仅对端做了修改，将自动并入本笔提交：
            {autoMergedFields.map((field) => FIELD_LABELS[field]).join('、')}
          </Alert>
        )}

        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
            快速定稿：
          </Typography>
          <Button size="small" onClick={() => decideAll('mine')}>全部采用本页修改</Button>
          <Button size="small" onClick={() => decideAll('theirs')}>全部采用对端已保存</Button>
          <Button size="small" onClick={() => decideAll('base')}>全部保留旧值</Button>
        </Stack>

        {conflicts.map((conflict) => (
          <Box key={conflict.field} sx={{ mb: 2 }}>
            <Stack
              direction="row"
              spacing={2}
              alignItems="flex-start"
              className="conflict-row"
            >
              <Box sx={{ width: 150, flex: '0 0 auto', pt: 1 }}>
                <Typography fontWeight={700}>{conflict.fieldLabel}</Typography>
                <Chip
                  size="small"
                  color={choices[conflict.field] ? 'success' : 'warning'}
                  variant="outlined"
                  sx={{ mt: 0.5 }}
                  label={choices[conflict.field] ? choiceLabel[choices[conflict.field]!] : '待定稿'}
                />
              </Box>
              <Box className="conflict-values">
                <Typography variant="caption" color="text.secondary">
                  打开时旧值（v{expectedVersion}）
                </Typography>
                <Typography variant="body2" className="conflict-value">
                  {formatFieldValue(conflict.field, conflict.baseValue)}
                </Typography>
              </Box>
              <Box className="conflict-values">
                <Typography variant="caption" color="primary.main">
                  本页修改
                </Typography>
                <Typography variant="body2" className="conflict-value">
                  {formatFieldValue(conflict.field, conflict.requestedValue)}
                </Typography>
              </Box>
              <Box className="conflict-values">
                <Typography variant="caption" color="warning.main">
                  对端已保存（v{currentVersion}）
                </Typography>
                <Typography variant="body2" className="conflict-value">
                  {formatFieldValue(conflict.field, conflict.currentValue)}
                </Typography>
              </Box>
              <TextField
                select
                size="small"
                label="定稿选择"
                sx={{ width: 180, flex: '0 0 auto' }}
                value={choices[conflict.field] ?? ''}
                onChange={(event) =>
                  setChoices((current) => ({
                    ...current,
                    [conflict.field]: event.target.value as ConflictResolutionChoice,
                  }))
                }
              >
                <MenuItem value="mine">采用本页修改</MenuItem>
                <MenuItem value="theirs">采用对端已保存</MenuItem>
                <MenuItem value="base">保留打开时旧值</MenuItem>
              </TextField>
            </Stack>
            <Divider sx={{ mt: 2 }} />
          </Box>
        ))}

        <TextField
          label="定稿评审人"
          size="small"
          value={reviewer}
          onChange={(event) => setReviewer(event.target.value)}
          sx={{ width: 240, mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          取消，稍后继续
        </Button>
        <Button
          variant="contained"
          disabled={!allDecided || !reviewer.trim() || saving}
          loading={saving}
          onClick={() => onResolve(choices, reviewer.trim())}
        >
          按定稿结果提交{conflicts.length > 0 ? `（${conflicts.length} 项冲突）` : ''}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
