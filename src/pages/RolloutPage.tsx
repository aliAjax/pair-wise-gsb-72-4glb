import { useEffect, useState } from 'react'
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
  LinearProgress,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material'
import PlayArrowOutlinedIcon from '@mui/icons-material/PlayArrowOutlined'
import UndoOutlinedIcon from '@mui/icons-material/UndoOutlined'
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline'
import { useGetFlagsQuery, useRollbackFlagMutation, useSaveFlagMutation } from '@/services/flagApi'
import { FlagStatusChip } from '@/components/FlagStatusChip'

export function RolloutPage() {
  const { data: flags = [], isLoading } = useGetFlagsQuery({})
  const [selectedId, setSelectedId] = useState('')
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [saveFlag, saveState] = useSaveFlagMutation()
  const [rollbackFlag, rollbackState] = useRollbackFlagMutation()

  useEffect(() => {
    if (!selectedId && flags.length > 0) setSelectedId(flags[0].id)
  }, [flags, selectedId])

  const flag = flags.find((item) => item.id === selectedId)
  const currentStepIndex = flag?.rolloutSteps.findIndex((step) => step.status === 'running') ?? -1

  const advanceRollout = async () => {
    if (!flag) return
    const steps = flag.rolloutSteps.map((step, index) => ({
      ...step,
      status:
        index === currentStepIndex
          ? ('completed' as const)
          : index === currentStepIndex + 1
            ? ('running' as const)
            : step.status,
    }))
    const nextPercentage =
      steps.find((step) => step.status === 'running')?.percentage ?? flag.rolloutPercentage
    try {
      await saveFlag({
        ...flag,
        rolloutSteps: steps,
        rolloutPercentage: nextPercentage,
        enabled: true,
        status: 'active',
        lastChangedBy: '林默',
      }).unwrap()
      setMessage(`灰度已推进至 ${nextPercentage}%，新的回滚边界已保存`)
    } catch {
      setMessage('推进失败，请检查配置后重试')
    }
  }

  const pauseRollout = async () => {
    if (!flag) return
    try {
      await saveFlag({
        ...flag,
        status: 'frozen',
        lastChangedBy: '林默',
        rolloutSteps: flag.rolloutSteps.map((step) =>
          step.status === 'running' ? { ...step, status: 'paused' } : step,
        ),
      }).unwrap()
      setMessage('灰度流量已冻结，现有用户继续使用当前配置')
    } catch {
      setMessage('冻结失败，请重试')
    }
  }

  const submitRollback = async () => {
    if (!flag || reason.trim().length < 8) {
      setMessage('回滚原因至少 8 个字符')
      return
    }
    try {
      await rollbackFlag({ id: flag.id, actor: '林默', reason }).unwrap()
      setRollbackOpen(false)
      setReason('')
      setMessage('已完成回滚，开关关闭并写入审计日志')
    } catch {
      setMessage('回滚失败，请重试')
    }
  }

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">灰度发布时间线</Typography>
          <Typography color="text.secondary">
            逐步放量、冻结流量或回滚生产配置，每次变化都记录影响范围与操作者。
          </Typography>
        </Box>
        <TextField
          select
          label="发布目标"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
          sx={{ width: 300 }}
        >
          {flags.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
        </TextField>
      </Box>

      {message && <Alert severity={message.includes('失败') ? 'error' : 'success'} onClose={() => setMessage('')} sx={{ mb: 2 }}>{message}</Alert>}
      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      {flag && (
        <>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 3 }}>
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h3">{flag.name}</Typography>
                    <FlagStatusChip status={flag.status} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">{flag.key} · 当前 {flag.rolloutPercentage}%</Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button variant="outlined" startIcon={<PauseCircleOutlineIcon />} onClick={() => void pauseRollout()} disabled={saveState.isLoading || flag.status === 'frozen'}>
                    冻结流量
                  </Button>
                  <Button variant="contained" startIcon={<PlayArrowOutlinedIcon />} onClick={() => void advanceRollout()} disabled={saveState.isLoading || currentStepIndex < 0 || currentStepIndex >= flag.rolloutSteps.length - 1}>
                    推进下一阶段
                  </Button>
                  <Button color="error" variant="outlined" startIcon={<UndoOutlinedIcon />} onClick={() => setRollbackOpen(true)}>
                    紧急回滚
                  </Button>
                </Stack>
              </Stack>
              <Stepper activeStep={Math.max(currentStepIndex, 0)} alternativeLabel>
                {flag.rolloutSteps.map((step) => (
                  <Step key={step.id} completed={step.status === 'completed'}>
                    <StepLabel
                      optional={
                        <Typography variant="caption" color={step.status === 'paused' ? 'warning.main' : 'text.secondary'}>
                          {step.audience}
                        </Typography>
                      }
                    >
                      {step.percentage}% · {step.status === 'completed' ? '已完成' : step.status === 'running' ? '进行中' : step.status === 'paused' ? '已暂停' : '计划中'}
                    </StepLabel>
                  </Step>
                ))}
              </Stepper>
            </CardContent>
          </Card>

          <Box className="rollout-grid">
            <Card>
              <CardContent>
                <Typography variant="h3" sx={{ mb: 1.5 }}>阶段守护指标</Typography>
                {flag.rolloutSteps.map((step) => (
                  <Box key={step.id} className="guardrail-row">
                    <Box>
                      <Typography variant="body2" fontWeight={700}>{step.percentage}% · {step.audience}</Typography>
                      <Stack direction="row" spacing={0.7} sx={{ mt: 0.7 }} flexWrap="wrap" useFlexGap>
                        {step.guardrails.map((guardrail) => <Chip key={guardrail} size="small" variant="outlined" label={guardrail} />)}
                      </Stack>
                    </Box>
                    <Chip
                      size="small"
                      label={step.status === 'completed' ? '已通过' : step.status === 'running' ? '观察中' : step.status === 'paused' ? '已暂停' : '待执行'}
                      color={step.status === 'completed' ? 'success' : step.status === 'running' ? 'primary' : step.status === 'paused' ? 'warning' : 'default'}
                    />
                  </Box>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Typography variant="h3" sx={{ mb: 1.5 }}>环境差异与客户端约束</Typography>
                <Box className="environment-compare">
                  {(['dev', 'staging', 'production'] as const).map((environment, index) => (
                    <Box key={environment}>
                      <Typography variant="caption" color="text.secondary">{environment.toUpperCase()}</Typography>
                      <Typography className="summary-value">{index === 0 ? 100 : index === 1 ? flag.rolloutPercentage : Math.max(flag.rolloutPercentage - 20, 0)}%</Typography>
                      <Typography variant="caption">最低 {flag.minClientVersion[environment]}</Typography>
                    </Box>
                  ))}
                </Box>
                <Alert severity="warning" sx={{ mt: 2 }}>
                  生产环境低于最低版本的用户会走降级路径，不会命中新逻辑。
                </Alert>
                <Typography variant="h3" sx={{ mt: 2.5, mb: 1 }}>回滚条件</Typography>
                {flag.rollbackConditions.map((condition) => <Typography key={condition} variant="body2">• {condition}</Typography>)}
              </CardContent>
            </Card>
          </Box>
        </>
      )}

      <Dialog open={rollbackOpen} onClose={() => setRollbackOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>确认紧急回滚</DialogTitle>
        <DialogContent dividers>
          <Alert severity="error" sx={{ mb: 2 }}>
            回滚会立即关闭开关、将灰度降至 0，并把所有运行中阶段标记为暂停。
          </Alert>
          <TextField
            label="回滚原因与异常证据"
            multiline
            minRows={3}
            fullWidth
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRollbackOpen(false)}>取消</Button>
          <Button color="error" variant="contained" loading={rollbackState.isLoading} onClick={() => void submitRollback()}>
            执行回滚
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
