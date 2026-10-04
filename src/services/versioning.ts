import type {
  AuditFieldChange,
  ConflictSide,
  EditableField,
  FeatureFlag,
  FieldConflict,
  FieldResolution,
} from '@/types'

/**
 * 参与乐观锁冲突检测的可编辑字段及中文名。
 * status / version / 时间戳等由服务端流程管理，不在这里比较。
 */
export const EDITABLE_FIELDS: EditableField[] = [
  'key',
  'name',
  'description',
  'owner',
  'team',
  'environment',
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

export const FIELD_LABELS: Record<EditableField, string> = {
  key: '开关 Key',
  name: '开关名称',
  description: '业务说明',
  owner: '负责人',
  team: '团队',
  environment: '目标环境',
  enabled: '启用状态',
  rolloutPercentage: '灰度比例',
  audienceRules: '受众规则',
  regions: '生效地区',
  minClientVersion: '客户端最低版本',
  dependencies: '依赖关系',
  rollbackConditions: '回滚条件',
  metricNames: '监控指标',
  deadCodeStatus: '死代码状态',
  rolloutSteps: '灰度阶段',
}

/** 稳定序列化：字段顺序固定，避免同值因键序被判为变更 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

export const sameValue = (a: unknown, b: unknown): boolean =>
  stableStringify(a) === stableStringify(b)

export function formatValue(field: EditableField, value: unknown): string {
  if (value === undefined || value === null) return '—'
  switch (field) {
    case 'enabled':
      return value ? '已启用' : '已关闭'
    case 'rolloutPercentage':
      return `${value}%`
    case 'environment':
      return { dev: '开发', staging: '预发', production: '生产' }[value as string] ?? String(value)
    case 'deadCodeStatus':
      return (
        { clean: '无残留', candidate: '存在待清理分支', confirmed: '确认存在死代码' }[
          value as string
        ] ?? String(value)
      )
    case 'regions':
    case 'metricNames':
    case 'rollbackConditions':
      return (value as string[]).length ? (value as string[]).join('、') : '（空）'
    case 'audienceRules': {
      const rules = value as FeatureFlag['audienceRules']
      if (rules.length === 0) return '（无条件，面向全部用户）'
      return rules
        .map((rule) => `${rule.attribute} ${rule.operator} ${rule.value}${rule.negate ? '（排除）' : ''}`)
        .join('；')
    }
    case 'dependencies': {
      const deps = value as FeatureFlag['dependencies']
      if (deps.length === 0) return '（无依赖）'
      const typeLabel = { requires: '前置依赖', conflicts: '互斥冲突', fallback: '降级路径' }
      return deps
        .map((dep) => `${dep.flagId}[${typeLabel[dep.type]}]：${dep.condition || '条件未填'}`)
        .join('；')
    }
    case 'minClientVersion': {
      const versions = value as FeatureFlag['minClientVersion']
      return `dev ${versions.dev} / staging ${versions.staging} / production ${versions.production}`
    }
    case 'rolloutSteps': {
      const steps = value as FeatureFlag['rolloutSteps']
      if (steps.length === 0) return '（未配置阶段）'
      return steps
        .map((step, index) => `${index + 1}. ${step.percentage}% · ${step.audience} · ${step.status}`)
        .join('；')
    }
    default:
      return String(value)
  }
}

export interface MergeResult {
  /** 合并后待保存的完整配置（未含 version/updatedAt） */
  merged: FeatureFlag
  conflicts: FieldConflict[]
  /** 自动合入的对方变更（我方未动该字段） */
  autoMerged: EditableField[]
}

/**
 * 三方合并：
 * - base == mine：采用 theirs（对方已改、我方未动，自动合入）
 * - base == theirs：采用 mine（我方修改、对方未动）
 * - 三方都不同：冲突，由评审人逐项定稿；未定稿前不出结果
 * - 两边改成相同值：等价于无冲突
 *
 * 上一轮已定稿、但定稿期间对方又改了同一字段时，旧定稿自动失效
 * （它针对的是旧的对侧值），必须按新一轮冲突重新逐项定稿。
 */
export function threeWayMerge(
  base: FeatureFlag,
  mine: FeatureFlag,
  theirs: FeatureFlag,
  resolutions: Partial<Record<EditableField, FieldResolution>> = {},
): MergeResult {
  const merged = { ...mine }
  const conflicts: FieldConflict[] = []
  const autoMerged: EditableField[] = []

  for (const field of EDITABLE_FIELDS) {
    const baseVal = base[field]
    const mineVal = mine[field]
    const theirsVal = theirs[field]
    const mineChanged = !sameValue(baseVal, mineVal)
    const theirsChanged = !sameValue(baseVal, theirsVal)

    if (!mineChanged && theirsChanged) {
      ;(merged as Record<string, unknown>)[field] = theirsVal
      autoMerged.push(field)
    } else if (mineChanged && theirsChanged && !sameValue(mineVal, theirsVal)) {
      const previous = resolutions[field]
      // 旧定稿仅在它针对的两边值都未再变化时有效；对方又改过则必须重新定稿
      const stillValid =
        previous !== undefined &&
        previous.mineFingerprint === stableStringify(mineVal) &&
        previous.theirsFingerprint === stableStringify(theirsVal)
      const resolution: ConflictSide | null = stillValid ? previous.side : null
      conflicts.push({
        field,
        label: FIELD_LABELS[field],
        baseValue: formatValue(field, baseVal),
        mineValue: formatValue(field, mineVal),
        theirsValue: formatValue(field, theirsVal),
        resolution,
        mineFingerprint: stableStringify(mineVal),
        theirsFingerprint: stableStringify(theirsVal),
      })
      if (resolution === 'theirs') {
        ;(merged as Record<string, unknown>)[field] = theirsVal
      }
    }
  }

  return { merged, conflicts, autoMerged }
}

/** 计算最终落库配置相对旧值（base）的字段级变更，用于审计 */
export function diffForAudit(
  base: FeatureFlag,
  next: FeatureFlag,
  context: {
    conflicts: FieldConflict[]
    autoMerged: EditableField[]
  },
): AuditFieldChange[] {
  const changes: AuditFieldChange[] = []
  for (const field of EDITABLE_FIELDS) {
    if (sameValue(base[field], next[field])) continue
    const conflict = context.conflicts.find((item) => item.field === field)
    if (conflict) {
      changes.push({
        field,
        label: FIELD_LABELS[field],
        oldValue: conflict.baseValue,
        newValue: formatValue(field, next[field]),
        baseValue: conflict.baseValue,
        mineValue: conflict.mineValue,
        theirsValue: conflict.theirsValue,
        conflict: true,
        resolution: conflict.resolution === 'mine' ? 'mine' : 'theirs',
      })
    } else {
      changes.push({
        field,
        label: FIELD_LABELS[field],
        oldValue: formatValue(field, base[field]),
        newValue: formatValue(field, next[field]),
      })
    }
  }
  if (!sameValue(base.status, next.status)) {
    changes.push({
      field: 'status',
      label: '状态',
      oldValue: base.status,
      newValue: next.status,
    })
  }
  return changes
}

/** 无冲突场景下的简单字段对比（创建 / 审批 / 回滚复用） */
export function simpleDiff(
  before: FeatureFlag,
  after: FeatureFlag,
  fields: EditableField[] = EDITABLE_FIELDS,
): AuditFieldChange[] {
  const changes: AuditFieldChange[] = []
  for (const field of fields) {
    if (!sameValue(before[field], after[field])) {
      changes.push({
        field,
        label: FIELD_LABELS[field],
        oldValue: formatValue(field, before[field]),
        newValue: formatValue(field, after[field]),
      })
    }
  }
  return changes
}
