import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Slider,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined'
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import AutorenewIcon from '@mui/icons-material/Autorenew'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  useDiscardCommitMutation,
  useGetAuditQuery,
  useGetFlagQuery,
  useGetFlagsQuery,
  useGetPendingCommitQuery,
  useListPendingCommitsQuery,
  useRetryCommitMutation,
  useSaveFlagMutation,
} from '@/services/flagApi'
import { FlagStatusChip } from '@/components/FlagStatusChip'
import { DependencyGraph } from '@/components/DependencyGraph'
import { ConflictResolutionDialog } from '@/components/ConflictResolutionDialog'
import type {
  AudienceRule,
  CommitMode,
  Dependency,
  FeatureFlag,
  FieldConflict,
  FieldResolution,
  RuleOperator,
  RolloutStep,
} from '@/types'

const now = new Date().toISOString()

const emptyFlag = (): FeatureFlag => ({
  id: `flag-${Date.now()}`,
  key: '',
  name: '',
  description: '',
  owner: '林默',
  team: '交易体验',
  status: 'draft',
  environment: 'dev',
  enabled: false,
  rolloutPercentage: 0,
  audienceRules: [],
  regions: ['CN-EAST'],
  minClientVersion: { dev: '1.0.0', staging: '1.0.0', production: '1.0.0' },
  dependencies: [],
  rollbackConditions: [],
  metricNames: [],
  deadCodeStatus: 'candidate',
  rolloutSteps: [],
  createdAt: now,
  updatedAt: now,
  version: 0,
  versionedAt: now,
  lastChangedBy: '林默',
})

const operators: Array<{ value: RuleOperator; label: string }> = [
  { value: 'equals', label: '等于' },
  { value: 'not-equals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'in', label: '属于集合' },
  { value: 'gte', label: '大于等于' },
  { value: 'lte', label: '小于等于' },
]

interface ConflictState {
  conflicts: FieldConflict[]
  baseVersion: number
  serverVersion: number
  commitId: string
}

export function FlagEditorPage() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const [tab, setTab] = useState(0)
  const [draft, setDraft] = useState<FeatureFlag>(emptyFlag)
  /** 打开页面时记下的版本与完整快照，提交前据此做版本校验 */
  const [baseFlag, setBaseFlag] = useState<FeatureFlag | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState<{ severity: 'success' | 'info' | 'warning' | 'error'; text: string } | null>(null)
  const [metricInput, setMetricInput] = useState('')
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [pendingId, setPendingId] = useState<string>(id && !isNew ? id : '')
  /** 新建开关刷新后，从 outbox 恢复其待提交 ID */
  const [newPendingId, setNewPendingId] = useState('')

  const { data: existing, isLoading } = useGetFlagQuery(id ?? '', { skip: isNew })
  const { data: allFlags = [] } = useGetFlagsQuery({})
  const { data: audit = [] } = useGetAuditQuery({ flagId: id ?? '' }, { skip: isNew })
  const { data: allPending = [] } = useListPendingCommitsQuery(undefined, {
    skip: !isNew,
    refetchOnMountOrArgChange: true,
  })
  const activePendingId = pendingId || newPendingId
  const { currentData: pending } = useGetPendingCommitQuery(activePendingId, {
    skip: !activePendingId,
    refetchOnMountOrArgChange: true,
  })
  const [saveFlag, saveState] = useSaveFlagMutation()
  const [retryCommit, retryState] = useRetryCommitMutation()
  const [discardCommit] = useDiscardCommitMutation()

  const baseLoaded = useRef(false)

  // 新建页刷新后：从 outbox 找回未完成的新建提交
  useEffect(() => {
    if (!isNew || newPendingId) return
    const orphan = allPending.find((item) => item.request.baseVersion === 0)
    if (orphan) {
      setNewPendingId(orphan.request.flagId)
      setBaseFlag(orphan.request.base)
      setDraft(orphan.request.intent)
      setNotice({ severity: 'info', text: '已恢复一笔未完成的新建提交，可继续保存或放弃。' })
    }
  }, [allPending, isNew, newPendingId])

  // 首次加载服务端配置：记录 base 快照（记下当时版本）
  useEffect(() => {
    if (existing && !baseLoaded.current) {
      baseLoaded.current = true
      setBaseFlag(existing)
      setDraft(existing)
    }
  }, [existing])

  // 重新打开时若该开关存在未完成提交：接着完成同一笔提交
  useEffect(() => {
    if (pending && !conflict) {
      setDraft(pending.request.intent)
      if (!baseFlag) setBaseFlag(pending.request.base)
      if (pending.lastConflict && pending.lastConflict.conflicts.length > 0) {
        setConflict({
          conflicts: pending.lastConflict.conflicts,
          baseVersion: pending.request.baseVersion,
          serverVersion: pending.lastConflict.serverVersion,
          commitId: pending.request.commitId,
        })
      } else if (pending.lastError) {
        setNotice({
          severity: 'warning',
          text: `上一次保存因本地存储短暂失败未完成（${pending.lastError}），配置未受影响，可直接重试。`,
        })
      } else {
        setNotice({ severity: 'info', text: '检测到一笔未完成的保存，可继续提交或放弃。' })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.request.commitId])

  const busy = saveState.isLoading || retryState.isLoading
  const activeFlag = draft

  const availableDependencies = useMemo(
    () => allFlags.filter((flag) => flag.id !== activeFlag.id),
    [activeFlag.id, allFlags],
  )

  const update = <K extends keyof FeatureFlag>(key: K, value: FeatureFlag[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const validate = () => {
    const nextErrors: string[] = []
    if (!draft.name.trim()) nextErrors.push('开关名称不能为空')
    if (!/^[a-z0-9]+(?:\.[a-z0-9-]+)+$/.test(draft.key)) {
      nextErrors.push('Key 必须使用小写点分格式，例如 checkout.express-pay')
    }
    if (!draft.description.trim()) nextErrors.push('请补充业务说明')
    if (draft.metricNames.length === 0) nextErrors.push('至少配置一个监控指标')
    if (draft.rollbackConditions.length === 0) nextErrors.push('至少配置一个自动回滚条件')
    if (draft.audienceRules.some((rule) => !rule.attribute || !rule.value)) {
      nextErrors.push('受众规则存在空属性或空值')
    }
    if (draft.dependencies.some((dependency) => !dependency.flagId || !dependency.condition.trim())) {
      nextErrors.push('依赖关系缺少目标开关或条件')
    }
    setErrors(nextErrors)
    return nextErrors.length === 0
  }

  const runSave = async (mode: CommitMode): Promise<boolean> => {
    if (!validate()) return false
    const base = baseFlag ?? { ...emptyFlag(), id: draft.id }
    try {
      const outcome = await saveFlag({
        commitId: pending?.request.commitId,
        flagId: draft.id,
        mode,
        actor: draft.lastChangedBy,
        baseVersion: base.version,
        base,
        intent: draft,
      }).unwrap()

      if (outcome.type === 'conflict') {
        if (outcome.conflicts.length === 0) {
          setNotice({ severity: 'error', text: outcome.message })
          return false
        }
        if (isNew) setNewPendingId(draft.id)
        else setPendingId(draft.id)
        setConflict({
          conflicts: outcome.conflicts,
          baseVersion: base.version,
          serverVersion: outcome.serverVersion,
          commitId: outcome.commitId,
        })
        setNotice({ severity: 'warning', text: outcome.message })
        return false
      }

      if (outcome.type === 'storage-error') {
        if (isNew) setNewPendingId(draft.id)
        else setPendingId(draft.id)
        setNotice({
          severity: 'warning',
          text: `本地存储短暂失败，配置未被部分写入；提交已暂存，请点击“重试未完成保存”。（${outcome.message}）`,
        })
        return false
      }

      if (outcome.type === 'not-found') {
        setNotice({ severity: 'error', text: outcome.message })
        return false
      }

      // committed：保存原子完成
      setBaseFlag(outcome.flag)
      setDraft(outcome.flag)
      setPendingId('')
      setNewPendingId('')
      setConflict(null)
      if (isNew) {
        navigate(`/flags/${outcome.flag.id}`, { replace: true })
      }
      if (outcome.wasSubmit) {
        navigate('/review')
      } else {
        setNotice({ severity: 'success', text: `已保存为 v${outcome.flag.version}，旧值与变更已写入审计记录。` })
      }
      return true
    } catch {
      // 网络层异常（含刷新中断）：outbox 仍保留该提交，重新打开可继续
      if (isNew) setNewPendingId(draft.id)
      else setPendingId(draft.id)
      setErrors(['保存中断，提交已保留为未完成状态，可重试同一笔提交。'])
      return false
    }
  }

  const handleConflictResolve = async (resolutions: Record<string, FieldResolution>) => {
    if (!conflict) return
    const typed = resolutions as Partial<Record<FieldConflict['field'] & string, FieldResolution>>
    try {
      const outcome = await retryCommit({ flagId: draft.id, resolutions: typed }).unwrap()
      if (outcome.type === 'conflict') {
        // 对方又前进了一版，或还有未定稿项：更新清单继续定稿
        setConflict({
          conflicts: outcome.conflicts,
          baseVersion: conflict.baseVersion,
          serverVersion: outcome.serverVersion,
          commitId: outcome.commitId,
        })
        setNotice({ severity: 'warning', text: outcome.message })
        return
      }
      if (outcome.type === 'storage-error') {
        setNotice({ severity: 'warning', text: `本地存储仍不可用，定稿已暂存，请稍后重试。（${outcome.message}）` })
        return
      }
      if (outcome.type === 'not-found') {
        setNotice({ severity: 'error', text: outcome.message })
        return
      }
      setBaseFlag(outcome.flag)
      setDraft(outcome.flag)
      setPendingId('')
      setNewPendingId('')
      setConflict(null)
      const wasSubmit = pending?.request.mode === 'submit'
      if (wasSubmit || outcome.wasSubmit) {
        navigate('/review')
      } else {
        setNotice({ severity: 'success', text: `冲突已定稿并保存为 v${outcome.flag.version}，三方值与定稿选择已写入审计。` })
      }
    } catch {
      setErrors(['定稿提交中断，请点击重试继续同一笔提交。'])
    }
  }

  const retryPending = async () => {
    try {
      const outcome = await retryCommit({ flagId: draft.id }).unwrap()
      if (outcome.type === 'conflict') {
        setConflict({
          conflicts: outcome.conflicts,
          baseVersion: pending?.request.baseVersion ?? 0,
          serverVersion: outcome.serverVersion,
          commitId: outcome.commitId,
        })
      } else if (outcome.type === 'storage-error') {
        setNotice({ severity: 'warning', text: `本地存储仍不可用，请稍后重试。（${outcome.message}）` })
      } else if (outcome.type === 'not-found') {
        setNotice({ severity: 'error', text: outcome.message })
      } else {
        setBaseFlag(outcome.flag)
        setDraft(outcome.flag)
        setPendingId('')
        setNewPendingId('')
        setConflict(null)
        if (outcome.wasSubmit) navigate('/review')
        else setNotice({ severity: 'success', text: `未完成提交已成功保存为 v${outcome.flag.version}。` })
      }
    } catch {
      setErrors(['重试失败，请再次点击重试。'])
    }
  }

  const abandonPending = async () => {
    if (!activePendingId) return
    await discardCommit(draft.id).unwrap().catch(() => undefined)
    setPendingId('')
    setNewPendingId('')
    setConflict(null)
    if (existing) {
      setBaseFlag(existing)
      setDraft(existing)
    } else {
      const fresh = emptyFlag()
      setBaseFlag(null)
      setDraft(fresh)
    }
    setNotice({ severity: 'info', text: '已放弃该笔未完成提交，配置未发生任何变化。' })
  }

  const addRule = () => {
    const rule: AudienceRule = {
      id: `rule-${Date.now()}`,
      attribute: 'user.segment',
      operator: 'equals',
      value: '',
      negate: false,
    }
    update('audienceRules', [...draft.audienceRules, rule])
  }

  const updateRule = (ruleId: string, patch: Partial<AudienceRule>) => {
    update(
      'audienceRules',
      draft.audienceRules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
    )
  }

  const addDependency = () => {
    update('dependencies', [
      ...draft.dependencies,
      { flagId: availableDependencies[0]?.id ?? '', type: 'requires', condition: '' },
    ])
  }

  const updateDependency = (index: number, patch: Partial<Dependency>) => {
    update(
      'dependencies',
      draft.dependencies.map((dependency, itemIndex) =>
        itemIndex === index ? { ...dependency, ...patch } : dependency,
      ),
    )
  }

  const addRolloutStep = () => {
    const percentages = [1, 5, 20, 50, 100]
    const percentage = percentages[draft.rolloutSteps.length] ?? 100
    const step: RolloutStep = {
      id: `step-${Date.now()}`,
      percentage,
      audience: '待配置人群',
      startedAt: new Date(Date.now() + draft.rolloutSteps.length * 86_400_000).toISOString(),
      status: 'planned',
      guardrails: ['人工确认指标稳定'],
    }
    update('rolloutSteps', [...draft.rolloutSteps, step])
  }

  if (isLoading) return <LinearProgress />

  return (
    <Box>
      <Box className="page-heading editor-heading">
        <Box>
          <Stack direction="row" spacing={1.2} alignItems="center">
            <Typography variant="h2">{isNew ? '创建功能开关' : activeFlag.name || '未命名开关'}</Typography>
            <FlagStatusChip status={activeFlag.status} />
            {baseFlag && baseFlag.version > 0 && (
              <Chip size="small" variant="outlined" color="primary" label={`基于 v${baseFlag.version} 编辑`} />
            )}
          </Stack>
          <Typography color="text.secondary">
            {activeFlag.key || '尚未设置 Key'} · 当前 v{activeFlag.version || '新建'} · 最近更新{' '}
            {activeFlag.updatedAt.slice(0, 16).replace('T', ' ')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button component={Link} to="/flags" startIcon={<ArrowBackIcon />}>
            返回列表
          </Button>
          <Button
            variant="outlined"
            startIcon={<SaveOutlinedIcon />}
            loading={busy}
            disabled={Boolean(pending)}
            onClick={() => void runSave('save')}
          >
            {pending ? '存在未完成保存' : '保存草稿'}
          </Button>
          <Button
            variant="contained"
            startIcon={<SendOutlinedIcon />}
            loading={busy}
            disabled={Boolean(pending)}
            onClick={() => void runSave('submit')}
          >
            保存并提交评审
          </Button>
        </Stack>
      </Box>

      {pending && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Stack direction="row" spacing={1}>
              <Button size="small" startIcon={<AutorenewIcon />} loading={retryState.isLoading} onClick={() => void retryPending()}>
                重试未完成保存
              </Button>
              <Button size="small" color="inherit" onClick={() => void abandonPending()}>
                放弃该提交
              </Button>
            </Stack>
          }
        >
          有一笔{`“${pending.request.mode === 'submit' ? '保存并提交评审' : '保存草稿'}”`}尚未完成（创建于{' '}
          {pending.createdAt.slice(0, 16).replace('T', ' ')}，已尝试 {pending.attempts} 次）。
          {pending.lastError ? `原因：${pending.lastError}。` : '页面刷新或中断不会丢失，可继续同一笔提交。'}
        </Alert>
      )}

      {notice && (
        <Alert severity={notice.severity} onClose={() => setNotice(null)} sx={{ mb: 2 }}>
          {notice.text}
        </Alert>
      )}

      {errors.length > 0 && (
        <Alert severity="error" onClose={() => setErrors([])} sx={{ mb: 2 }}>
          {errors.map((error) => (
            <Typography key={error} variant="body2">
              {error}
            </Typography>
          ))}
        </Alert>
      )}

      <Card>
        <Tabs value={tab} onChange={(_event, value: number) => setTab(value)} className="editor-tabs">
          <Tab label="基础信息" />
          <Tab label="受众规则" />
          <Tab label="依赖与兼容" />
          <Tab label="灰度与回滚" />
          <Tab label="审计记录" />
        </Tabs>

        {tab === 0 && (
          <CardContent className="editor-panel">
            <Box className="form-grid two-column">
              <TextField label="开关名称" required value={draft.name} onChange={(event) => update('name', event.target.value)} />
              <TextField label="开关 Key" required value={draft.key} onChange={(event) => update('key', event.target.value)} helperText="稳定标识，发布后不建议修改" />
              <TextField label="负责人" required value={draft.owner} onChange={(event) => update('owner', event.target.value)} />
              <TextField select label="团队" value={draft.team} onChange={(event) => update('team', event.target.value)}>
                {['交易体验', '增长算法', '云控制台', '支付平台', '数据平台', '增长运营', '基础架构'].map((team) => (
                  <MenuItem key={team} value={team}>{team}</MenuItem>
                ))}
              </TextField>
              <TextField select label="环境" value={draft.environment} onChange={(event) => update('environment', event.target.value as FeatureFlag['environment'])}>
                <MenuItem value="dev">开发</MenuItem>
                <MenuItem value="staging">预发</MenuItem>
                <MenuItem value="production">生产</MenuItem>
              </TextField>
              <TextField select label="状态" value={draft.status} onChange={(event) => update('status', event.target.value as FeatureFlag['status'])}>
                <MenuItem value="draft">草稿</MenuItem>
                <MenuItem value="review">待评审</MenuItem>
                <MenuItem value="active">已发布</MenuItem>
                <MenuItem value="frozen">已冻结</MenuItem>
                <MenuItem value="rolled-back">已回滚</MenuItem>
              </TextField>
            </Box>
            <TextField
              label="业务说明"
              required
              multiline
              minRows={3}
              value={draft.description}
              onChange={(event) => update('description', event.target.value)}
              sx={{ mt: 2 }}
            />
            <Divider sx={{ my: 3 }} />
            <Typography variant="h3" sx={{ mb: 1.5 }}>客户端版本约束</Typography>
            <Box className="form-grid three-column">
              {(['dev', 'staging', 'production'] as const).map((environment) => (
                <TextField
                  key={environment}
                  label={`${environment.toUpperCase()} 最低版本`}
                  value={draft.minClientVersion[environment]}
                  onChange={(event) =>
                    update('minClientVersion', {
                      ...draft.minClientVersion,
                      [environment]: event.target.value,
                    })
                  }
                />
              ))}
            </Box>
            <Typography variant="h3" sx={{ mt: 3, mb: 1 }}>生效地区</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {['CN-EAST', 'CN-NORTH', 'CN-SOUTH', 'CN-WEST', 'APAC'].map((region) => (
                <FormControlLabel
                  key={region}
                  control={
                    <Checkbox
                      checked={draft.regions.includes(region)}
                      onChange={(event) =>
                        update(
                          'regions',
                          event.target.checked
                            ? [...draft.regions, region]
                            : draft.regions.filter((item) => item !== region),
                        )
                      }
                    />
                  }
                  label={region}
                />
              ))}
            </Stack>
          </CardContent>
        )}

        {tab === 1 && (
          <CardContent className="editor-panel">
            <Box className="section-heading">
              <Box>
                <Typography variant="h3">受众规则编辑器</Typography>
                <Typography variant="body2" color="text.secondary">
                  条件按 AND 求值；使用否定条件排除实验组，避免规则顺序依赖。
                </Typography>
              </Box>
              <Button startIcon={<AddIcon />} onClick={addRule}>添加规则</Button>
            </Box>
            <Box className="rule-editor">
              {draft.audienceRules.map((rule, index) => (
                <Box key={rule.id} className="rule-row">
                  <Typography className="rule-index">IF</Typography>
                  <TextField label="用户属性" value={rule.attribute} onChange={(event) => updateRule(rule.id, { attribute: event.target.value })} />
                  <TextField select label="运算符" value={rule.operator} onChange={(event) => updateRule(rule.id, { operator: event.target.value as RuleOperator })}>
                    {operators.map((operator) => (
                      <MenuItem key={operator.value} value={operator.value}>{operator.label}</MenuItem>
                    ))}
                  </TextField>
                  <TextField label="值" value={rule.value} onChange={(event) => updateRule(rule.id, { value: event.target.value })} />
                  <FormControlLabel
                    control={<Checkbox checked={rule.negate} onChange={(event) => updateRule(rule.id, { negate: event.target.checked })} />}
                    label="排除"
                  />
                  <IconButton
                    color="error"
                    onClick={() => update('audienceRules', draft.audienceRules.filter((item) => item.id !== rule.id))}
                    aria-label={`删除第 ${index + 1} 条规则`}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </Box>
              ))}
              {draft.audienceRules.length === 0 && (
                <Typography className="empty-state">尚未配置受众规则，当前配置会面向全部用户。</Typography>
              )}
            </Box>
            <Alert severity="info" sx={{ mt: 2 }}>
              评审时系统会与实验组、旧版兼容规则和地区条件交叉检查，发现重叠后阻止扩大流量。
            </Alert>
          </CardContent>
        )}

        {tab === 2 && (
          <CardContent className="editor-panel">
            <Box className="section-heading">
              <Box>
                <Typography variant="h3">依赖关系与影响图</Typography>
                <Typography variant="body2" color="text.secondary">
                  明确前置依赖、互斥开关和降级路径，发布前自动执行可达性检查。
                </Typography>
              </Box>
              <Button startIcon={<AddIcon />} onClick={addDependency}>添加依赖</Button>
            </Box>
            <DependencyGraph selectedFlag={activeFlag} allFlags={allFlags} />
            <Box className="dependency-editor">
              {draft.dependencies.map((dependency, index) => (
                <Box key={`${dependency.flagId}-${index}`} className="dependency-row">
                  <TextField
                    select
                    label="目标开关"
                    value={dependency.flagId}
                    onChange={(event) => updateDependency(index, { flagId: event.target.value })}
                  >
                    {availableDependencies.map((flag) => (
                      <MenuItem key={flag.id} value={flag.id}>{flag.name} · {flag.key}</MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    label="关系类型"
                    value={dependency.type}
                    onChange={(event) => updateDependency(index, { type: event.target.value as Dependency['type'] })}
                  >
                    <MenuItem value="requires">前置依赖</MenuItem>
                    <MenuItem value="conflicts">互斥冲突</MenuItem>
                    <MenuItem value="fallback">降级路径</MenuItem>
                  </TextField>
                  <TextField label="条件说明" value={dependency.condition} onChange={(event) => updateDependency(index, { condition: event.target.value })} />
                  <IconButton color="error" onClick={() => update('dependencies', draft.dependencies.filter((_, itemIndex) => itemIndex !== index))}>
                    <DeleteOutlineIcon />
                  </IconButton>
                </Box>
              ))}
            </Box>
            <Divider sx={{ my: 3 }} />
            <Typography variant="h3" sx={{ mb: 1.5 }}>低版本客户端兼容</Typography>
            <Alert severity={draft.deadCodeStatus === 'confirmed' ? 'error' : 'warning'}>
              代码扫描状态：{draft.deadCodeStatus === 'clean' ? '无残留' : draft.deadCodeStatus === 'candidate' ? '存在待清理分支' : '确认存在死代码'}。
              发布前需确认最低客户端版本与降级实现。
            </Alert>
          </CardContent>
        )}

        {tab === 3 && (
          <CardContent className="editor-panel">
            <Box className="section-heading">
              <Box>
                <Typography variant="h3">逐步放量与回滚边界</Typography>
                <Typography variant="body2" color="text.secondary">
                  每一步都需要可观测指标和自动回滚阈值。
                </Typography>
              </Box>
              <Button startIcon={<AddIcon />} onClick={addRolloutStep}>添加阶段</Button>
            </Box>
            <Box className="rollout-editor">
              {draft.rolloutSteps.map((step, index) => (
                <Card variant="outlined" key={step.id}>
                  <CardContent>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography fontWeight={700}>阶段 {index + 1} · {step.percentage}%</Typography>
                      <Chip
                        size="small"
                        label={step.status === 'completed' ? '已完成' : step.status === 'running' ? '进行中' : step.status === 'paused' ? '已暂停' : '计划中'}
                        color={step.status === 'running' ? 'success' : step.status === 'paused' ? 'warning' : 'default'}
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{step.audience}</Typography>
                    <Slider
                      value={step.percentage}
                      min={1}
                      max={100}
                      marks={[{ value: 1, label: '1%' }, { value: 20, label: '20%' }, { value: 50, label: '50%' }, { value: 100, label: '100%' }]}
                      onChange={(_event, value) =>
                        update(
                          'rolloutSteps',
                          draft.rolloutSteps.map((item) =>
                            item.id === step.id ? { ...item, percentage: value as number } : item,
                          ),
                        )
                      }
                    />
                    <TextField
                      label="阶段受众"
                      value={step.audience}
                      onChange={(event) =>
                        update(
                          'rolloutSteps',
                          draft.rolloutSteps.map((item) =>
                            item.id === step.id ? { ...item, audience: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </CardContent>
                </Card>
              ))}
            </Box>
            <Divider sx={{ my: 3 }} />
            <Typography variant="h3" sx={{ mb: 1.5 }}>监控指标</Typography>
            <Box className="tag-editor">
              {draft.metricNames.map((metric) => (
                <Chip
                  key={metric}
                  label={metric}
                  onDelete={() => update('metricNames', draft.metricNames.filter((item) => item !== metric))}
                />
              ))}
              <TextField
                placeholder="输入指标名后回车"
                value={metricInput}
                onChange={(event) => setMetricInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && metricInput.trim()) {
                    update('metricNames', [...draft.metricNames, metricInput.trim()])
                    setMetricInput('')
                  }
                }}
              />
            </Box>
            <Typography variant="h3" sx={{ mt: 3, mb: 1.5 }}>自动回滚条件</Typography>
            <Stack spacing={1}>
              {draft.rollbackConditions.map((condition, index) => (
                <Box key={`${condition}-${index}`} className="condition-row">
                  <TextField
                    value={condition}
                    onChange={(event) =>
                      update(
                        'rollbackConditions',
                        draft.rollbackConditions.map((item, itemIndex) =>
                          itemIndex === index ? event.target.value : item,
                        ),
                      )
                    }
                  />
                  <IconButton color="error" onClick={() => update('rollbackConditions', draft.rollbackConditions.filter((_, itemIndex) => itemIndex !== index))}>
                    <DeleteOutlineIcon />
                  </IconButton>
                </Box>
              ))}
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => update('rollbackConditions', [...draft.rollbackConditions, '指标阈值待配置'])}
              >
                添加回滚条件
              </Button>
            </Stack>
          </CardContent>
        )}

        {tab === 4 && (
          <CardContent className="editor-panel">
            <Typography variant="h3" sx={{ mb: 2 }}>配置审计记录</Typography>
            <Box className="audit-timeline">
              {audit.map((event) => (
                <Box className="audit-event" key={event.id}>
                  <Box className="audit-dot" />
                  <Box>
                    <Typography variant="body2" fontWeight={700}>{event.summary}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {event.actor} · {event.createdAt.slice(0, 16).replace('T', ' ')}
                      {event.version ? ` · v${event.version}` : ''}
                    </Typography>
                    {(event.before || event.after) && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        {event.before || '-'} → {event.after || '-'}
                      </Typography>
                    )}
                    {event.changes && event.changes.length > 0 && (
                      <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                        {event.changes.map((change) => (
                          <Box key={`${event.id}-${change.field}`}>
                            <Chip
                              size="small"
                              variant="outlined"
                              color={change.conflict ? 'warning' : 'default'}
                              label={
                                change.conflict
                                  ? `${change.label}（冲突定稿·采用${change.resolution === 'mine' ? '本人' : '对方'}）：${change.oldValue} → ${change.newValue}`
                                  : `${change.label}：${change.oldValue} → ${change.newValue}`
                              }
                              sx={{ maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.3 } }}
                            />
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </Box>
                </Box>
              ))}
              {audit.length === 0 && <Typography className="empty-state">新开关尚未产生审计记录。</Typography>}
            </Box>
          </CardContent>
        )}
      </Card>

      <ConflictResolutionDialog
        open={Boolean(conflict)}
        conflicts={conflict?.conflicts ?? []}
        baseVersion={conflict?.baseVersion ?? 0}
        serverVersion={conflict?.serverVersion ?? 0}
        actor={draft.lastChangedBy}
        busy={retryState.isLoading}
        onResolve={(resolutions) => void handleConflictResolve(resolutions)}
        onClose={() => setConflict(null)}
      />
    </Box>
  )
}
