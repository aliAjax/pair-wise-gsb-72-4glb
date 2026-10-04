import type {
  AudienceRule,
  Dependency,
  EditableFlagField,
  FeatureFlag,
  RolloutStep,
} from '@/types'

/**
 * 参与乐观锁版本比对的字段清单：灰度比例、回滚条件等配置项都在这里逐项对比。
 * key/createdAt 等标识字段不参与冲突合并。
 */
export const EDITABLE_FIELDS: EditableFlagField[] = [
  'name',
  'description',
  'owner',
  'team',
  'environment',
  'status',
  'enabled',
  'rolloutPercentage',
  'audienceRules',
  'regions',
  'minClientVersion',
  'dependencies',
  'rollbackConditions',
  'metricNames',
  'deadCodeStatus',
  'rolloutSteps',
]

export const FIELD_LABELS: Record<EditableFlagField, string> = {
  name: '开关名称',
  description: '业务说明',
  owner: '负责人',
  team: '团队',
  environment: '目标环境',
  status: '状态',
  enabled: '开关启用',
  rolloutPercentage: '灰度比例',
  audienceRules: '受众规则',
  regions: '生效地区',
  minClientVersion: '最低客户端版本',
  dependencies: '依赖关系',
  rollbackConditions: '回滚条件',
  metricNames: '监控指标',
  deadCodeStatus: '死代码扫描状态',
  rolloutSteps: '灰度阶段',
}

export const fieldLabel = (field: EditableFlagField): string => FIELD_LABELS[field]

export const getFieldValue = (
  flag: FeatureFlag,
  field: EditableFlagField,
): unknown => flag[field]

export const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }
  const aKeys = Object.keys(a as Record<string, unknown>).sort()
  const bKeys = Object.keys(b as Record<string, unknown>).sort()
  if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index])) {
    return false
  }
  return aKeys.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  )
}

const statusLabel: Record<FeatureFlag['status'], string> = {
  draft: '草稿',
  review: '待评审',
  active: '已发布',
  frozen: '已冻结',
  'rolled-back': '已回滚',
}

const environmentLabel: Record<FeatureFlag['environment'], string> = {
  dev: '开发',
  staging: '预发',
  production: '生产',
}

const deadCodeLabel: Record<FeatureFlag['deadCodeStatus'], string> = {
  clean: '无残留',
  candidate: '存在待清理分支',
  confirmed: '确认存在死代码',
}

const formatRules = (rules: AudienceRule[]): string =>
  rules.length === 0
    ? '（无受众规则，面向全部用户）'
    : rules
        .map((rule) => {
          const prefix = rule.negate ? '排除：' : ''
          return `${prefix}${rule.attribute} ${rule.operator} ${rule.value || '（空值）'}`
        })
        .join('；')

const formatDependencies = (dependencies: Dependency[]): string =>
  dependencies.length === 0
    ? '（无依赖）'
    : dependencies
        .map(
          (dependency) =>
            `${dependency.type}:${dependency.flagId || '（未选择）'}（${dependency.condition || '无条件说明'}）`,
        )
        .join('；')

const formatSteps = (steps: RolloutStep[]): string =>
  steps.length === 0
    ? '（无灰度阶段）'
    : steps
        .map(
          (step, index) =>
            `阶段${index + 1} ${step.percentage}%「${step.audience}」${step.status}`,
        )
        .join('；')

/** 将字段值渲染成评审人可读的单行文本，用于冲突对照和审计记录。 */
export const formatFieldValue = (field: EditableFlagField, value: unknown): string => {
  if (value === undefined || value === null) return '—'
  switch (field) {
    case 'enabled':
      return value ? '启用' : '关闭'
    case 'rolloutPercentage':
      return `${String(value)}%`
    case 'status':
      return statusLabel[value as FeatureFlag['status']] ?? String(value)
    case 'environment':
      return environmentLabel[value as FeatureFlag['environment']] ?? String(value)
    case 'deadCodeStatus':
      return deadCodeLabel[value as FeatureFlag['deadCodeStatus']] ?? String(value)
    case 'regions':
    case 'rollbackConditions':
    case 'metricNames': {
      const list = value as string[]
      return list.length === 0 ? '（空）' : list.join('、')
    }
    case 'audienceRules':
      return formatRules(value as AudienceRule[])
    case 'dependencies':
      return formatDependencies(value as Dependency[])
    case 'rolloutSteps':
      return formatSteps(value as RolloutStep[])
    case 'minClientVersion': {
      const record = value as FeatureFlag['minClientVersion']
      return `开发 ${record.dev} / 预发 ${record.staging} / 生产 ${record.production}`
    }
    default:
      return String(value)
  }
}
