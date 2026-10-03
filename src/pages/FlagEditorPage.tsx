import { useEffect, useMemo, useState } from 'react'
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
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useGetAuditQuery, useGetFlagQuery, useGetFlagsQuery, useSaveFlagMutation, useSubmitForReviewMutation } from '@/services/flagApi'
import { FlagStatusChip } from '@/components/FlagStatusChip'
import { DependencyGraph } from '@/components/DependencyGraph'
import type { AudienceRule, Dependency, FeatureFlag, RuleOperator, RolloutStep } from '@/types'

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

export function FlagEditorPage() {
  const { id } = useParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const [tab, setTab] = useState(0)
  const [draft, setDraft] = useState<FeatureFlag>(emptyFlag)
  const [errors, setErrors] = useState<string[]>([])
  const [savedFlag, setSavedFlag] = useState<FeatureFlag | null>(null)
  const [metricInput, setMetricInput] = useState('')
  const { data: existing, isLoading } = useGetFlagQuery(id ?? '', { skip: isNew })
  const { data: allFlags = [] } = useGetFlagsQuery({})
  const { data: audit = [] } = useGetAuditQuery({ flagId: id ?? '' }, { skip: isNew })
  const [saveFlag, saveState] = useSaveFlagMutation()
  const [submitReview, submitState] = useSubmitForReviewMutation()
  const activeFlag = savedFlag ?? draft

  useEffect(() => {
    if (existing) setDraft(existing)
  }, [existing])

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

  const persist = async () => {
    if (!validate()) return null
    try {
      const result = await saveFlag({ ...draft, updatedAt: new Date().toISOString() }).unwrap()
      setSavedFlag(result)
      setDraft(result)
      if (isNew) navigate(`/flags/${result.id}`, { replace: true })
      return result
    } catch {
      setErrors(['保存失败，请检查本地存储权限后重试'])
      return null
    }
  }

  const handleSubmit = async () => {
    const saved = await persist()
    if (!saved) return
    try {
      await submitReview({ id: saved.id, actor: saved.lastChangedBy }).unwrap()
      navigate('/review')
    } catch {
      setErrors(['提交评审失败，请稍后重试'])
    }
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
          </Stack>
          <Typography color="text.secondary">
            {activeFlag.key || '尚未设置 Key'} · 最近更新 {activeFlag.updatedAt.slice(0, 16).replace('T', ' ')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button component={Link} to="/flags" startIcon={<ArrowBackIcon />}>
            返回列表
          </Button>
          <Button
            variant="outlined"
            startIcon={<SaveOutlinedIcon />}
            loading={saveState.isLoading}
            onClick={() => void persist()}
          >
            保存草稿
          </Button>
          <Button
            variant="contained"
            startIcon={<SendOutlinedIcon />}
            loading={submitState.isLoading}
            onClick={() => void handleSubmit()}
          >
            提交影响评审
          </Button>
        </Stack>
      </Box>

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
                    </Typography>
                    {(event.before || event.after) && (
                      <Typography variant="caption" display="block" color="text.secondary">
                        {event.before || '-'} → {event.after || '-'}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
              {audit.length === 0 && <Typography className="empty-state">新开关尚未产生审计记录。</Typography>}
            </Box>
          </CardContent>
        )}
      </Card>
    </Box>
  )
}
