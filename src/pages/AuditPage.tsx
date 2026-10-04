import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import { Link } from 'react-router-dom'
import { useGetAuditQuery, useGetFlagsQuery, useRollbackFlagMutation } from '@/services/flagApi'
import { FlagStatusChip } from '@/components/FlagStatusChip'
import { formatFieldValue } from '@/services/flagFields'
import type { AuditEvent, AuditFieldChange } from '@/types'

const actionLabel: Record<string, string> = {
  created: '创建',
  updated: '更新',
  submitted: '提交评审',
  approved: '批准',
  rejected: '驳回',
  frozen: '冻结',
  unfrozen: '解冻',
  'rolled-back': '回滚',
  'rollout-adjusted': '调整灰度',
}

const resolutionLabel: Record<NonNullable<AuditFieldChange['resolution']>, string> = {
  mine: '采用本页修改',
  theirs: '采用对端已保存',
  base: '保留打开时旧值',
}

export function AuditPage() {
  const { data: flags = [] } = useGetFlagsQuery({})
  const [flagId, setFlagId] = useState('')
  const [action, setAction] = useState('')
  const { data: events = [], isLoading } = useGetAuditQuery({ flagId: flagId || undefined, action: action || undefined })
  const [rollbackFlag, rollbackState] = useRollbackFlagMutation()
  const [selectedFlagId, setSelectedFlagId] = useState('')
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [detailEvent, setDetailEvent] = useState<AuditEvent | null>(null)

  const selectedFlag = flags.find((flag) => flag.id === selectedFlagId)
  const totalImpact = useMemo(
    () => events.reduce((sum, event) => sum + event.affectedUsers, 0),
    [events],
  )

  const submitRollback = async () => {
    if (!selectedFlag || reason.trim().length < 8) {
      setMessage('回滚原因至少 8 个字符')
      return
    }
    try {
      await rollbackFlag({ id: selectedFlag.id, actor: '林默', reason }).unwrap()
      setSelectedFlagId('')
      setReason('')
      setMessage('回滚已执行并写入审计记录')
    } catch {
      setMessage('回滚失败，请重试')
    }
  }

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">审计与回滚</Typography>
          <Typography color="text.secondary">
            查看每次配置调整、审批、冻结和异常回滚记录；版本化保存逐字段留存旧值，冲突定稿全程可追溯。
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<DownloadOutlinedIcon />} onClick={() => window.print()}>
          打印审计记录
        </Button>
      </Box>

      {message && <Alert severity={message.includes('失败') ? 'error' : 'success'} onClose={() => setMessage('')} sx={{ mb: 2 }}>{message}</Alert>}

      <Box className="audit-summary">
        <Box><Typography variant="caption">审计事件</Typography><Typography className="summary-value">{events.length}</Typography></Box>
        <Box><Typography variant="caption">回滚操作</Typography><Typography className="summary-value">{events.filter((event) => event.action === 'rolled-back').length}</Typography></Box>
        <Box><Typography variant="caption">累计影响用户</Typography><Typography className="summary-value">{totalImpact.toLocaleString()}</Typography></Box>
        <Box><Typography variant="caption">平均响应时间</Typography><Typography className="summary-value">8.4 分钟</Typography></Box>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={1.5}>
            <TextField select label="功能开关" value={flagId} onChange={(event) => setFlagId(event.target.value)} sx={{ width: 280 }}>
              <MenuItem value="">全部开关</MenuItem>
              {flags.map((flag) => <MenuItem key={flag.id} value={flag.id}>{flag.name}</MenuItem>)}
            </TextField>
            <TextField select label="操作类型" value={action} onChange={(event) => setAction(event.target.value)} sx={{ width: 180 }}>
              <MenuItem value="">全部操作</MenuItem>
              {Object.entries(actionLabel).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
            </TextField>
          </Stack>
        </CardContent>
      </Card>

      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>时间 / 操作</TableCell>
                <TableCell>功能开关</TableCell>
                <TableCell>变更说明</TableCell>
                <TableCell>状态 / 版本</TableCell>
                <TableCell>影响用户</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {events.map((event) => {
                const relatedFlag = flags.find((flag) => flag.id === event.flagId)
                return (
                  <TableRow key={event.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>{actionLabel[event.action] ?? event.action}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {event.createdAt.slice(0, 16).replace('T', ' ')} · {event.actor}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography component={Link} to={`/flags/${event.flagId}`} variant="body2" fontWeight={700}>{event.flagKey}</Typography>
                      {relatedFlag && <FlagStatusChip status={relatedFlag.status} />}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 420 }}>
                      {event.summary}
                      {event.conflictResolved && (
                        <Chip size="small" color="warning" variant="outlined" sx={{ ml: 1 }} label="冲突定稿" />
                      )}
                    </TableCell>
                    <TableCell>
                      {event.fromVersion ? (
                        <Chip size="small" variant="outlined" label={`v${event.fromVersion} → v${event.toVersion}`} />
                      ) : (
                        <Chip size="small" variant="outlined" label={`${event.before || '-'} → ${event.after || '-'}`} />
                      )}
                      {event.fieldChanges && event.fieldChanges.length > 0 && (
                        <Chip size="small" variant="outlined" sx={{ ml: 0.5 }} label={`${event.fieldChanges.length} 个字段`} />
                      )}
                    </TableCell>
                    <TableCell>{event.affectedUsers.toLocaleString()}</TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        {event.fieldChanges && event.fieldChanges.length > 0 && (
                          <Button
                            size="small"
                            startIcon={<VisibilityOutlinedIcon />}
                            onClick={() => setDetailEvent(event)}
                          >
                            字段明细
                          </Button>
                        )}
                        <Button
                          size="small"
                          color="error"
                          startIcon={<UndoOutlinedIcon />}
                          disabled={!relatedFlag || relatedFlag.status === 'rolled-back'}
                          onClick={() => {
                            setSelectedFlagId(event.flagId)
                            setReason('生产异常触发人工回滚，停止继续放量。')
                          }}
                        >
                          回滚
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}
              {!isLoading && events.length === 0 && (
                <TableRow><TableCell colSpan={6} align="center" sx={{ py: 6 }} color="text.secondary">没有符合条件的审计记录</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={Boolean(detailEvent)} onClose={() => setDetailEvent(null)} fullWidth maxWidth="md">
        <DialogTitle>
          字段级变更明细
          {detailEvent?.conflictResolved && (
            <Chip size="small" color="warning" variant="outlined" sx={{ ml: 1 }} label="含版本冲突逐项定稿" />
          )}
        </DialogTitle>
        <DialogContent dividers>
          {detailEvent && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {detailEvent.flagKey} · {detailEvent.actor} · {detailEvent.createdAt.slice(0, 16).replace('T', ' ')}
                {detailEvent.fromVersion && ` · v${detailEvent.fromVersion} → v${detailEvent.toVersion}`}
                {detailEvent.commitId && ` · 提交编号 ${detailEvent.commitId.slice(0, 8)}`}
              </Typography>
              {detailEvent.fieldChanges?.map((change) => (
                <Box key={change.field} className="audit-field-detail" sx={{ mb: 2 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography fontWeight={700}>{change.fieldLabel}</Typography>
                    {change.resolution && (
                      <Chip size="small" color="warning" variant="outlined" label={`冲突定稿：${resolutionLabel[change.resolution]}${change.resolvedBy ? ` · ${change.resolvedBy}` : ''}`} />
                    )}
                  </Stack>
                  {change.resolution ? (
                    <Box className="conflict-audit-grid">
                      <Box>
                        <Typography variant="caption" color="text.secondary">打开时旧值</Typography>
                        <Typography variant="body2">{formatFieldValue(change.field, change.baseValue)}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="primary.main">本页修改</Typography>
                        <Typography variant="body2">{formatFieldValue(change.field, change.requestedValue)}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="warning.main">对端已保存</Typography>
                        <Typography variant="body2">{formatFieldValue(change.field, change.oldValue)}</Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="success.main">最终定稿</Typography>
                        <Typography variant="body2" fontWeight={700}>{formatFieldValue(change.field, change.newValue)}</Typography>
                      </Box>
                    </Box>
                  ) : (
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="caption" color="text.secondary">旧值</Typography>
                        <Typography variant="body2" className="audit-old-value">{formatFieldValue(change.field, change.oldValue)}</Typography>
                      </Box>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="caption" color="success.main">新值</Typography>
                        <Typography variant="body2" fontWeight={700}>{formatFieldValue(change.field, change.newValue)}</Typography>
                      </Box>
                    </Stack>
                  )}
                  <Divider sx={{ mt: 1.5 }} />
                </Box>
              ))}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailEvent(null)}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(selectedFlag)} onClose={() => setSelectedFlagId('')} fullWidth maxWidth="sm">
        <DialogTitle>回滚 {selectedFlag?.name}</DialogTitle>
        <DialogContent dividers>
          <Alert severity="error" sx={{ mb: 2 }}>回滚会关闭生产开关、停止灰度并写入审计日志。</Alert>
          <TextField
            label="回滚原因"
            multiline
            minRows={3}
            fullWidth
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedFlagId('')}>取消</Button>
          <Button variant="contained" color="error" loading={rollbackState.isLoading} onClick={() => void submitRollback()}>
            确认回滚
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
