import type {
  AuditEvent,
  AuditFieldChange,
  DashboardData,
  EditableFlagField,
  FeatureFlag,
  FieldConflict,
  ImpactIssue,
  ReviewPayload,
  SaveFlagRequest,
  SaveFlagResult,
  VersionRecord,
} from '@/types'
import { EDITABLE_FIELDS, fieldLabel, getFieldValue, deepEqual } from '@/services/flagFields'

const STORAGE_KEY = 'feature-flag-release-console-v1'

/** 本地存储不可用（隐私模式、配额、短暂 IO 失败）时抛出，调用方应允许重试。 */
export class StorageUnavailableError extends Error {
  constructor(message = '本地存储暂时不可用，请稍后重试') {
    super(message)
    this.name = 'StorageUnavailableError'
  }
}

/** 提交被业务规则拒绝（开关不存在等），重试无意义。 */
export class CommitRejectedError extends Error {}

/** 历史数据结构：升级前的开关没有版本字段。 */
type LegacyFeatureFlag = Omit<FeatureFlag, 'version' | 'versionHistory' | 'lastCommitId'>

export interface Database {
  flags: FeatureFlag[]
  audit: AuditEvent[]
  issues: ImpactIssue[]
}

const flags: LegacyFeatureFlag[] = [
  {
    id: 'flag-101',
    key: 'checkout.express-pay-v2',
    name: '极速支付流程 V2',
    description: '在结算页启用新的地址确认和支付聚合流程。',
    owner: '陈思远',
    team: '交易体验',
    status: 'review',
    environment: 'staging',
    enabled: false,
    rolloutPercentage: 20,
    audienceRules: [
      { id: 'r-101-1', attribute: 'user.tier', operator: 'in', value: 'gold,platinum', negate: false },
      { id: 'r-101-2', attribute: 'client.platform', operator: 'equals', value: 'ios', negate: false },
      { id: 'r-101-3', attribute: 'account.risk_score', operator: 'lte', value: '40', negate: false },
    ],
    regions: ['CN-EAST', 'CN-SOUTH'],
    minClientVersion: { dev: '8.18.0', staging: '8.18.0', production: '8.18.0' },
    dependencies: [
      { flagId: 'flag-104', type: 'requires', condition: '支付聚合服务已启用' },
      { flagId: 'flag-108', type: 'conflicts', condition: '旧版优惠券浮层不可同时启用' },
    ],
    rollbackConditions: ['支付成功率 5 分钟低于 96%', 'P95 延迟高于 2200ms', '错误率高于 1.2%'],
    metricNames: ['checkout_payment_success_rate', 'checkout_p95_latency'],
    deadCodeStatus: 'candidate',
    rolloutSteps: [
      { id: 's-1', percentage: 1, audience: '内部体验账号', startedAt: '2026-09-25T10:00:00+08:00', status: 'completed', guardrails: ['无阻断错误'] },
      { id: 's-2', percentage: 5, audience: '华东区金卡用户', startedAt: '2026-09-27T14:30:00+08:00', status: 'completed', guardrails: ['支付成功率 > 97%'] },
      { id: 's-3', percentage: 20, audience: 'iOS 金卡及铂金用户', startedAt: '2026-09-29T09:00:00+08:00', status: 'running', guardrails: ['错误率 < 1.2%', 'P95 < 2200ms'] },
      { id: 's-4', percentage: 50, audience: '全量高价值用户', startedAt: '2026-10-02T10:00:00+08:00', status: 'planned', guardrails: ['人工审批'] },
    ],
    createdAt: '2026-09-12T14:20:00+08:00',
    updatedAt: '2026-09-29T09:05:00+08:00',
    lastChangedBy: '陈思远',
  },
  {
    id: 'flag-102',
    key: 'catalog.smart-recommendation',
    name: '商品智能推荐位',
    description: '基于实时意图在商品列表插入推荐模块。',
    owner: '许薇',
    team: '增长算法',
    status: 'active',
    environment: 'production',
    enabled: true,
    rolloutPercentage: 35,
    audienceRules: [
      { id: 'r-102-1', attribute: 'app.version', operator: 'gte', value: '9.2.0', negate: false },
      { id: 'r-102-2', attribute: 'user.segment', operator: 'in', value: 'active,high_intent', negate: false },
    ],
    regions: ['CN-EAST', 'CN-NORTH', 'CN-SOUTH'],
    minClientVersion: { dev: '9.1.0', staging: '9.2.0', production: '9.2.0' },
    dependencies: [{ flagId: 'flag-105', type: 'requires', condition: '特征服务延迟稳定在 80ms 内' }],
    rollbackConditions: ['推荐模块点击率下降 15%', '接口超时率高于 2%'],
    metricNames: ['recommend_ctr', 'feature_service_timeout_rate'],
    deadCodeStatus: 'clean',
    rolloutSteps: [
      { id: 's-201', percentage: 10, audience: '活跃用户', startedAt: '2026-09-20T10:00:00+08:00', status: 'completed', guardrails: ['CTR 不低于对照 5%'] },
      { id: 's-202', percentage: 35, audience: '活跃及高意图用户', startedAt: '2026-09-27T10:00:00+08:00', status: 'running', guardrails: ['接口超时率 < 2%'] },
    ],
    createdAt: '2026-08-28T09:30:00+08:00',
    updatedAt: '2026-09-28T16:40:00+08:00',
    lastChangedBy: '周启',
  },
  {
    id: 'flag-103',
    key: 'console.billing-export-v3',
    name: '账单异步导出 V3',
    description: '把大账单导出切换至异步任务和对象存储下载。',
    owner: '周航',
    team: '云控制台',
    status: 'review',
    environment: 'dev',
    enabled: false,
    rolloutPercentage: 0,
    audienceRules: [
      { id: 'r-103-1', attribute: 'account.type', operator: 'equals', value: 'enterprise', negate: false },
    ],
    regions: ['CN-EAST'],
    minClientVersion: { dev: '5.10.0', staging: '5.10.0', production: '5.10.0' },
    dependencies: [{ flagId: 'flag-107', type: 'requires', condition: '异步任务队列容量已扩容' }],
    rollbackConditions: ['任务失败率高于 3%', '导出文件超过 24 小时未生成'],
    metricNames: [],
    deadCodeStatus: 'candidate',
    rolloutSteps: [
      { id: 's-301', percentage: 5, audience: '内部测试企业', startedAt: '2026-10-08T10:00:00+08:00', status: 'planned', guardrails: ['任务成功率 > 98%'] },
    ],
    createdAt: '2026-09-18T11:10:00+08:00',
    updatedAt: '2026-09-28T18:20:00+08:00',
    lastChangedBy: '周航',
  },
  {
    id: 'flag-104',
    key: 'payment.aggregate-router',
    name: '支付聚合路由',
    description: '统一收单渠道和支付降级策略。',
    owner: '韩秋',
    team: '支付平台',
    status: 'active',
    environment: 'production',
    enabled: true,
    rolloutPercentage: 100,
    audienceRules: [],
    regions: ['CN-EAST', 'CN-NORTH', 'CN-SOUTH', 'CN-WEST'],
    minClientVersion: { dev: '8.12.0', staging: '8.12.0', production: '8.12.0' },
    dependencies: [],
    rollbackConditions: ['任一收单渠道连续失败 20 次'],
    metricNames: ['payment_router_error_rate'],
    deadCodeStatus: 'clean',
    rolloutSteps: [{ id: 's-401', percentage: 100, audience: '全部用户', startedAt: '2026-07-01T00:00:00+08:00', status: 'completed', guardrails: [] }],
    createdAt: '2026-06-12T10:00:00+08:00',
    updatedAt: '2026-09-25T12:30:00+08:00',
    lastChangedBy: '韩秋',
  },
  {
    id: 'flag-105',
    key: 'feature.realtime-profile',
    name: '实时用户特征服务',
    description: '向推荐和搜索模块提供实时画像特征。',
    owner: '郭宁',
    team: '数据平台',
    status: 'frozen',
    environment: 'production',
    enabled: true,
    rolloutPercentage: 60,
    audienceRules: [],
    regions: ['CN-EAST', 'CN-SOUTH'],
    minClientVersion: { dev: '1.0.0', staging: '1.0.0', production: '1.0.0' },
    dependencies: [],
    rollbackConditions: ['P99 延迟高于 350ms'],
    metricNames: ['feature_service_latency', 'feature_cache_hit_rate'],
    deadCodeStatus: 'clean',
    rolloutSteps: [{ id: 's-501', percentage: 60, audience: '推荐服务流量', startedAt: '2026-09-28T09:00:00+08:00', status: 'paused', guardrails: ['观察缓存命中率'] }],
    createdAt: '2026-05-18T13:40:00+08:00',
    updatedAt: '2026-09-29T08:50:00+08:00',
    lastChangedBy: '郭宁',
  },
  {
    id: 'flag-106',
    key: 'campaign.new-editor',
    name: '活动配置新版编辑器',
    description: '提供拖拽式活动页面配置能力。',
    owner: '梁琪',
    team: '增长运营',
    status: 'rolled-back',
    environment: 'production',
    enabled: false,
    rolloutPercentage: 0,
    audienceRules: [{ id: 'r-106-1', attribute: 'operator.role', operator: 'equals', value: 'campaign_admin', negate: false }],
    regions: ['CN-EAST'],
    minClientVersion: { dev: '2.6.0', staging: '2.6.0', production: '2.6.0' },
    dependencies: [],
    rollbackConditions: ['配置保存失败率高于 2%'],
    metricNames: ['campaign_editor_save_success'],
    deadCodeStatus: 'confirmed',
    rolloutSteps: [{ id: 's-601', percentage: 20, audience: '华东运营团队', startedAt: '2026-09-27T14:00:00+08:00', status: 'paused', guardrails: [] }],
    createdAt: '2026-08-20T10:15:00+08:00',
    updatedAt: '2026-09-28T15:48:00+08:00',
    lastChangedBy: '梁琪',
  },
  {
    id: 'flag-107',
    key: 'infra.async-task-queue-v2',
    name: '异步任务队列 V2',
    description: '迁移长任务至高吞吐队列。',
    owner: '赵岚',
    team: '基础架构',
    status: 'active',
    environment: 'staging',
    enabled: true,
    rolloutPercentage: 100,
    audienceRules: [],
    regions: ['CN-EAST'],
    minClientVersion: { dev: '1.0.0', staging: '1.0.0', production: '1.0.0' },
    dependencies: [],
    rollbackConditions: ['队列积压超过 10 万'],
    metricNames: ['queue_backlog', 'task_failure_rate'],
    deadCodeStatus: 'clean',
    rolloutSteps: [{ id: 's-701', percentage: 100, audience: '预发长任务', startedAt: '2026-09-22T09:00:00+08:00', status: 'completed', guardrails: [] }],
    createdAt: '2026-08-10T16:20:00+08:00',
    updatedAt: '2026-09-27T11:12:00+08:00',
    lastChangedBy: '赵岚',
  },
  {
    id: 'flag-108',
    key: 'checkout.legacy-coupon-overlay',
    name: '旧版优惠券浮层',
    description: '结算页旧优惠券选择浮层，计划下版本下线。',
    owner: '沈宁',
    team: '交易体验',
    status: 'frozen',
    environment: 'production',
    enabled: true,
    rolloutPercentage: 12,
    audienceRules: [{ id: 'r-108-1', attribute: 'app.version', operator: 'lte', value: '8.17.9', negate: false }],
    regions: ['CN-EAST', 'CN-NORTH', 'CN-SOUTH'],
    minClientVersion: { dev: '8.10.0', staging: '8.10.0', production: '8.10.0' },
    dependencies: [{ flagId: 'flag-101', type: 'conflicts', condition: '新版支付流程不可同时启用' }],
    rollbackConditions: ['优惠券使用率下降 10%'],
    metricNames: ['coupon_apply_success_rate'],
    deadCodeStatus: 'confirmed',
    rolloutSteps: [{ id: 's-801', percentage: 12, audience: '低版本客户端', startedAt: '2026-09-20T09:00:00+08:00', status: 'paused', guardrails: [] }],
    createdAt: '2025-12-10T09:00:00+08:00',
    updatedAt: '2026-09-29T09:10:00+08:00',
    lastChangedBy: '沈宁',
  },
]

const issues: ImpactIssue[] = [
  {
    id: 'issue-1',
    flagId: 'flag-101',
    flagKey: 'checkout.express-pay-v2',
    category: 'overlap',
    severity: 'blocker',
    title: '与旧版优惠券实验组重叠',
    detail: '20% 灰度人群中有 3.8% 同时命中 checkout.legacy-coupon-overlay。',
    suggestion: '将 risk_score <= 40 与旧版浮层实验排除条件合并，或先将旧开关灰度降至 0。',
    resolved: false,
  },
  {
    id: 'issue-2',
    flagId: 'flag-101',
    flagKey: 'checkout.express-pay-v2',
    category: 'client-compatibility',
    severity: 'warning',
    title: '低版本客户端缺少聚合支付能力',
    detail: 'iOS 8.17.x 用户仍会命中新流程，但客户端未注册 pay.aggregate.v2。',
    suggestion: '把 app.version >= 8.18.0 加入受众前置条件。',
    resolved: false,
  },
  {
    id: 'issue-3',
    flagId: 'flag-103',
    flagKey: 'console.billing-export-v3',
    category: 'missing-metric',
    severity: 'blocker',
    title: '缺少下载完成率监控',
    detail: '当前仅配置任务创建指标，无法自动触发导出文件生成失败回滚。',
    suggestion: '接入 billing_export_download_success_rate 并配置 15 分钟窗口。',
    resolved: false,
  },
  {
    id: 'issue-4',
    flagId: 'flag-103',
    flagKey: 'console.billing-export-v3',
    category: 'dead-code',
    severity: 'warning',
    title: '旧同步导出入口仍可达',
    detail: '代码扫描发现 feature.billing_export_sync 分支仍被路由引用。',
    suggestion: '提供旧入口下线任务，并在新开关全量后移除分支。',
    resolved: false,
  },
  {
    id: 'issue-5',
    flagId: 'flag-106',
    flagKey: 'campaign.new-editor',
    category: 'rule-conflict',
    severity: 'warning',
    title: '保存权限中存在互斥角色条件',
    detail: '角色 equals campaign_admin 与后续 not-equals 临时审核员规则同时存在。',
    suggestion: '合并为明确的白名单，避免规则求值顺序变化。',
    resolved: true,
  },
  {
    id: 'issue-6',
    flagId: 'flag-108',
    flagKey: 'checkout.legacy-coupon-overlay',
    category: 'dead-code',
    severity: 'info',
    title: '开关已进入下线候选',
    detail: '最近 30 天没有新增代码引用，仅保留旧客户端兼容分支。',
    suggestion: '在最低客户端版本达到 8.18.0 后安排代码清理。',
    resolved: false,
  },
]

const audit: AuditEvent[] = [
  {
    id: 'audit-1',
    flagId: 'flag-101',
    flagKey: 'checkout.express-pay-v2',
    action: 'rollout-adjusted',
    actor: '陈思远',
    summary: '灰度比例由 5% 调整至 20%，仅覆盖 iOS 金卡及铂金用户。',
    before: '5%',
    after: '20%',
    affectedUsers: 48620,
    createdAt: '2026-09-29T09:05:00+08:00',
  },
  {
    id: 'audit-2',
    flagId: 'flag-105',
    flagKey: 'feature.realtime-profile',
    action: 'frozen',
    actor: '郭宁',
    summary: 'P99 延迟升高，冻结配置并暂停扩大流量。',
    before: 'active',
    after: 'frozen',
    affectedUsers: 1200000,
    createdAt: '2026-09-29T08:50:00+08:00',
  },
  {
    id: 'audit-3',
    flagId: 'flag-106',
    flagKey: 'campaign.new-editor',
    action: 'rolled-back',
    actor: '梁琪',
    summary: '配置保存失败率触发自动回滚条件。',
    before: '20%',
    after: '0%',
    affectedUsers: 638,
    createdAt: '2026-09-28T15:48:00+08:00',
  },
  {
    id: 'audit-4',
    flagId: 'flag-102',
    flagKey: 'catalog.smart-recommendation',
    action: 'rollout-adjusted',
    actor: '周启',
    summary: '灰度扩大到 35%，推荐接口错误率保持低于阈值。',
    before: '20%',
    after: '35%',
    affectedUsers: 812430,
    createdAt: '2026-09-28T16:40:00+08:00',
  },
  {
    id: 'audit-5',
    flagId: 'flag-103',
    flagKey: 'console.billing-export-v3',
    action: 'submitted',
    actor: '周航',
    summary: '提交发布评审，等待补齐导出完成率监控。',
    before: 'draft',
    after: 'draft',
    affectedUsers: 0,
    createdAt: '2026-09-28T18:20:00+08:00',
  },
  {
    id: 'audit-6',
    flagId: 'flag-104',
    flagKey: 'payment.aggregate-router',
    action: 'approved',
    actor: '林默',
    summary: '确认回滚条件和支付通道指标完整。',
    before: 'review',
    after: 'active',
    affectedUsers: 3200000,
    createdAt: '2026-09-25T12:30:00+08:00',
  },
]

export const seedDatabase = (): Database => ({
  flags: flags.map(migrateLegacyFlag),
  audit,
  issues,
})

let uidCounter = 0
const uid = (prefix: string): string => {
  uidCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${uidCounter}-${Math.random().toString(36).slice(2, 7)}`
}

/** 升级读取：没有版本号的历史开关，按原更新时间补建初始版本。 */
const migrateLegacyFlag = (flag: FeatureFlag | LegacyFeatureFlag): FeatureFlag => {
  if ('version' in flag && Number.isInteger(flag.version) && flag.version > 0) {
    if (flag.versionHistory && flag.versionHistory.length > 0) return flag
    return {
      ...flag,
      versionHistory: [
        {
          version: 1,
          updatedAt: flag.updatedAt,
          actor: flag.lastChangedBy,
          note: '按原更新时间补建的初始版本',
        },
      ],
    }
  }
  const history: VersionRecord[] = [
    {
      version: 1,
      updatedAt: flag.updatedAt,
      actor: flag.lastChangedBy,
      note: '按原更新时间补建的初始版本',
    },
  ]
  return { ...(flag as LegacyFeatureFlag), version: 1, versionHistory: history }
}

interface StoredDatabase {
  flags?: Array<FeatureFlag | LegacyFeatureFlag>
  audit?: AuditEvent[]
  issues?: ImpactIssue[]
}

export const readDatabase = (): Database => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const seed = seedDatabase()
    writeDatabase(seed)
    return seed
  }
  let parsed: StoredDatabase
  try {
    parsed = JSON.parse(raw) as StoredDatabase
  } catch {
    const seed = seedDatabase()
    writeDatabase(seed)
    return seed
  }
  let migrated = false
  const nextFlags = (parsed.flags ?? []).map((flag) => {
    const needsVersion =
      !('version' in flag) || !Number.isInteger((flag as FeatureFlag).version) || (flag as FeatureFlag).version < 1
    const needsHistory =
      !('versionHistory' in flag) ||
      !Array.isArray((flag as FeatureFlag).versionHistory) ||
      (flag as FeatureFlag).versionHistory.length === 0
    if (needsVersion || needsHistory) {
      migrated = true
      return migrateLegacyFlag(flag)
    }
    return flag as FeatureFlag
  })
  const database: Database = {
    flags: nextFlags,
    audit: parsed.audit ?? [],
    issues: parsed.issues ?? [],
  }
  // 补建结果尽力回写；回写失败不影响本次读取，历史审计记录原样保留。
  if (migrated) {
    try {
      writeDatabase(database)
    } catch {
      // 忽略：下次读取仍会再次补建。
    }
  }
  return database
}

/** 唯一落库入口：一次 setItem 写入完整数据库，任何异常都不会留下半套配置。 */
export const writeDatabase = (database: Database): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(database))
  } catch (error) {
    throw new StorageUnavailableError(
      error instanceof Error ? error.message : '本地存储写入失败，请稍后重试',
    )
  }
}

const pushAudit = (db: Database, event: Omit<AuditEvent, 'id' | 'createdAt'>): AuditEvent => {
  const full: AuditEvent = { ...event, id: uid('audit'), createdAt: new Date().toISOString() }
  db.audit.unshift(full)
  return full
}

const advanceVersion = (
  flag: FeatureFlag,
  actor: string,
  commitId: string | undefined,
  note?: string,
): FeatureFlag => ({
  ...flag,
  version: flag.version + 1,
  versionHistory: [
    ...flag.versionHistory,
    { version: flag.version + 1, updatedAt: new Date().toISOString(), actor, commitId, note },
  ],
})

const affectedUsersOf = (percentage: number): number => Math.round(900000 * (percentage / 100))

interface ResolvedConflict {
  field: EditableFlagField
  resolution: NonNullable<SaveFlagRequest['resolutions']>[EditableFlagField]
  baseValue: unknown
  requestedValue: unknown
  currentValue: unknown
}

interface MergeOutcome {
  merged: Partial<FeatureFlag>
  conflicts: FieldConflict[]
  autoMergedFields: EditableFlagField[]
  resolvedConflicts: ResolvedConflict[]
}

/**
 * 三方合并：base 为打开页面时的版本，requested 为本页修改，current 为库中最新版本。
 * 仅一方修改的字段自动收敛；双方都改且不同值的字段进入冲突列表，由评审人逐项定稿。
 */
const mergeFields = (
  base: FeatureFlag,
  requested: FeatureFlag,
  current: FeatureFlag,
  saveRequest: SaveFlagRequest,
): MergeOutcome => {
  const mergedRecord: Record<string, unknown> = {}
  const conflicts: FieldConflict[] = []
  const autoMergedFields: EditableFlagField[] = []
  const resolvedConflicts: ResolvedConflict[] = []
  // 提交评审时状态由意图决定，不参与字段冲突；保存草稿时状态照常比对。
  const fields =
    saveRequest.intent === 'submit-review'
      ? EDITABLE_FIELDS.filter((field) => field !== 'status')
      : EDITABLE_FIELDS

  // 定稿只在版本与定稿时所依据的版本一致时有效，避免旧决定覆盖更新的对端值。
  const resolutionsHonored =
    saveRequest.resolvedAgainstVersion === undefined ||
    saveRequest.resolvedAgainstVersion === current.version

  for (const field of fields) {
    const baseValue = getFieldValue(base, field)
    const requestedValue = getFieldValue(requested, field)
    const currentValue = getFieldValue(current, field)
    const mineChanged = !deepEqual(requestedValue, baseValue)
    const theirsChanged = !deepEqual(currentValue, baseValue)

    if (!mineChanged && !theirsChanged) {
      mergedRecord[field] = currentValue
      continue
    }
    if (mineChanged && !theirsChanged) {
      mergedRecord[field] = requestedValue
      continue
    }
    if (!mineChanged && theirsChanged) {
      mergedRecord[field] = currentValue
      autoMergedFields.push(field)
      continue
    }
    // 双方都改：值一致视为一致收敛。
    if (deepEqual(requestedValue, currentValue)) {
      mergedRecord[field] = requestedValue
      continue
    }
    const resolution = resolutionsHonored ? saveRequest.resolutions?.[field] : undefined
    if (resolution) {
      mergedRecord[field] =
        resolution === 'mine'
          ? requestedValue
          : resolution === 'theirs'
            ? currentValue
            : baseValue
      resolvedConflicts.push({
        field,
        resolution,
        baseValue,
        requestedValue,
        currentValue,
      })
      continue
    }
    conflicts.push({ field, fieldLabel: fieldLabel(field), baseValue, requestedValue, currentValue })
  }

  return { merged: mergedRecord as Partial<FeatureFlag>, conflicts, autoMergedFields, resolvedConflicts }
}

/**
 * 按版本校验保存：
 * - 版本未前进时直接写入；
 * - 版本已前进时做三方合并，冲突字段逐项列出，未定稿则不落库；
 * - 同一 commitId 重试直接幂等返回；
 * - 成功路径只有一次原子写入。
 */
export const commitFlagSave = (request: SaveFlagRequest): SaveFlagResult => {
  const db = readDatabase()
  const { flag: requested, expectedVersion, intent, commitId, resolvedBy } = request
  const index = db.flags.findIndex((item) => item.id === requested.id)
  const now = new Date().toISOString()

  if (index < 0) {
    if (expectedVersion !== 0) {
      throw new CommitRejectedError('功能开关不存在或已被删除')
    }
    const created: FeatureFlag = {
      ...requested,
      status: intent === 'submit-review' ? 'review' : requested.status,
      updatedAt: now,
      version: 1,
      versionHistory: [
        {
          version: 1,
          updatedAt: now,
          actor: requested.lastChangedBy,
          commitId,
          note: intent === 'submit-review' ? '创建并提交影响评审' : '创建草稿',
        },
      ],
      lastCommitId: commitId,
    }
    db.flags.unshift(created)
    pushAudit(db, {
      flagId: created.id,
      flagKey: created.key,
      action: intent === 'submit-review' ? 'submitted' : 'created',
      actor: created.lastChangedBy,
      summary:
        intent === 'submit-review'
          ? `创建开关并提交影响评审（提交编号 ${commitId.slice(0, 8)}）。`
          : `创建功能开关草稿（提交编号 ${commitId.slice(0, 8)}）。`,
      before: undefined,
      after: `v1 · ${created.status}`,
      affectedUsers: affectedUsersOf(created.rolloutPercentage),
      commitId,
      toVersion: 1,
    })
    writeDatabase(db)
    return { outcome: 'success', flag: created, autoMergedFields: [] }
  }

  const current = db.flags[index]

  // 刷新或重复点击后的幂等重试：同一笔提交只生效一次。
  if (current.lastCommitId === commitId) {
    return { outcome: 'success', flag: current, autoMergedFields: [] }
  }

  if (current.version === expectedVersion) {
    const finalFlag = applyIntent(
      {
        ...current,
        ...pickEditable(requested),
        key: requested.key,
      },
      intent,
    )
    const saved = finalizeFlag(db, {
      current,
      finalFlag,
      intent,
      commitId,
      now,
      fieldChanges: buildFieldChanges(current, finalFlag, [], undefined),
      autoMergedFields: [],
      conflictResolved: false,
      index,
    })
    return { outcome: 'success', flag: saved, autoMergedFields: [] }
  }

  // 版本已前进：以请求携带的打开时快照为基线做三方合并。
  const base = request.base
  if (!base || base.version !== expectedVersion) {
    throw new CommitRejectedError('缺少打开页面时的版本快照，请刷新页面后重试')
  }
  const { merged, conflicts, autoMergedFields, resolvedConflicts } = mergeFields(
    base,
    requested,
    current,
    request,
  )
  if (conflicts.length > 0) {
    // 冲突未定稿：不写入任何数据，页面保持完整的旧版本。
    return {
      outcome: 'conflict',
      flagId: current.id,
      flagKey: current.key,
      expectedVersion,
      currentVersion: current.version,
      conflicts,
      autoMergedFields,
      commitId,
    }
  }

  const finalFlag = applyIntent(
    {
      ...current,
      ...merged,
      key: requested.key,
    },
    intent,
  )
  const fieldChanges = buildFieldChanges(current, finalFlag, resolvedConflicts, resolvedBy)
  const saved = finalizeFlag(db, {
    current,
    finalFlag,
    intent,
    commitId,
    now,
    fieldChanges,
    autoMergedFields,
    conflictResolved: resolvedConflicts.length > 0,
    index,
  })
  return { outcome: 'success', flag: saved, autoMergedFields }
}

const pickEditable = (flag: FeatureFlag): Partial<FeatureFlag> => {
  const result: Partial<FeatureFlag> = {}
  for (const field of EDITABLE_FIELDS) {
    ;(result as Record<string, unknown>)[field] = getFieldValue(flag, field)
  }
  return result
}

const applyIntent = (flag: FeatureFlag, intent: SaveFlagRequest['intent']): FeatureFlag =>
  intent === 'submit-review' ? { ...flag, status: 'review' } : flag

const buildFieldChanges = (
  current: FeatureFlag,
  finalFlag: FeatureFlag,
  resolvedConflicts: ResolvedConflict[],
  resolvedBy?: string,
): AuditFieldChange[] => {
  const changes: AuditFieldChange[] = []
  for (const field of EDITABLE_FIELDS) {
    const oldValue = getFieldValue(current, field)
    const newValue = getFieldValue(finalFlag, field)
    if (deepEqual(oldValue, newValue)) continue
    const resolved = resolvedConflicts.find((item) => item.field === field)
    changes.push({
      field,
      fieldLabel: fieldLabel(field),
      oldValue,
      newValue,
      ...(resolved
        ? {
            baseValue: resolved.baseValue,
            requestedValue: resolved.requestedValue,
            resolution: resolved.resolution,
            resolvedBy,
          }
        : {}),
    })
  }
  return changes
}

interface FinalizeInput {
  current: FeatureFlag
  finalFlag: FeatureFlag
  intent: SaveFlagRequest['intent']
  commitId: string
  now: string
  fieldChanges: AuditFieldChange[]
  autoMergedFields: EditableFlagField[]
  conflictResolved: boolean
  index: number
}

const finalizeFlag = (db: Database, input: FinalizeInput): FeatureFlag => {
  const { current, intent, commitId, now, fieldChanges, autoMergedFields, conflictResolved, index } =
    input
  const saved: FeatureFlag = {
    ...input.finalFlag,
    updatedAt: now,
    lastChangedBy: input.finalFlag.lastChangedBy,
    version: current.version + 1,
    versionHistory: [
      ...current.versionHistory,
      {
        version: current.version + 1,
        updatedAt: now,
        actor: input.finalFlag.lastChangedBy,
        commitId,
        note:
          intent === 'submit-review'
            ? conflictResolved
              ? '冲突逐项定稿后提交评审'
              : '提交影响评审'
            : conflictResolved
              ? '冲突逐项定稿后保存'
              : '保存配置',
      },
    ],
    lastCommitId: commitId,
  }

  const summaryParts = [
    intent === 'submit-review' ? '提交影响评审' : '保存配置',
    `基于 v${current.version} 校验后版本前进至 v${saved.version}`,
    `变更 ${fieldChanges.length} 个字段`,
  ]
  if (autoMergedFields.length > 0) {
    summaryParts.push(
      `自动并入对方已保存的 ${autoMergedFields.map(fieldLabel).join('、')}`,
    )
  }
  if (conflictResolved) {
    summaryParts.push('冲突字段已由评审人逐项定稿，旧值见审计明细')
  }

  pushAudit(db, {
    flagId: saved.id,
    flagKey: saved.key,
    action: intent === 'submit-review' ? 'submitted' : 'updated',
    actor: saved.lastChangedBy,
    summary: `${summaryParts.join('，')}（提交编号 ${commitId.slice(0, 8)}）。`,
    before: `v${current.version} · ${current.status} · ${current.rolloutPercentage}%`,
    after: `v${saved.version} · ${saved.status} · ${saved.rolloutPercentage}%`,
    affectedUsers: affectedUsersOf(saved.rolloutPercentage),
    fieldChanges,
    fromVersion: current.version,
    toVersion: saved.version,
    conflictResolved,
    commitId,
  })

  db.flags[index] = saved
  writeDatabase(db)
  return saved
}

const bumpExistingFlag = (
  flag: FeatureFlag,
  actor: string,
  note: string,
): FeatureFlag => advanceVersion({ ...flag, updatedAt: new Date().toISOString(), lastChangedBy: actor }, actor, undefined, note)

export const applyReview = (flagId: string, payload: ReviewPayload): FeatureFlag => {
  const db = readDatabase()
  const index = db.flags.findIndex((item) => item.id === flagId)
  if (index < 0) throw new Error('功能开关不存在')
  const flag = db.flags[index]
  const before = flag.status
  const reviewed: FeatureFlag = {
    ...flag,
    status: payload.decision === 'approved' ? 'active' : 'draft',
    enabled: payload.decision === 'approved',
  }
  if (payload.freezeUntil && payload.decision === 'approved') {
    reviewed.rollbackConditions = [
      ...reviewed.rollbackConditions,
      `冻结至 ${payload.freezeUntil}，期间禁止扩大流量`,
    ]
  }
  const saved = bumpExistingFlag(reviewed, payload.reviewer, payload.decision === 'approved' ? '审批通过' : '审批驳回')
  db.flags[index] = saved
  pushAudit(db, {
    flagId,
    flagKey: flag.key,
    action: payload.decision,
    actor: payload.reviewer,
    summary: payload.comment,
    before: `v${flag.version} · ${before}`,
    after: `v${saved.version} · ${saved.status}`,
    affectedUsers: affectedUsersOf(saved.rolloutPercentage),
    fieldChanges: buildFieldChanges(flag, saved, [], payload.reviewer),
    fromVersion: flag.version,
    toVersion: saved.version,
  })
  writeDatabase(db)
  return saved
}

export const rollbackFlag = (flagId: string, actor: string, reason: string): FeatureFlag => {
  const db = readDatabase()
  const index = db.flags.findIndex((item) => item.id === flagId)
  if (index < 0) throw new Error('功能开关不存在')
  const flag = db.flags[index]
  const beforePercentage = flag.rolloutPercentage
  const before = `${flag.status} / ${beforePercentage}%`
  const rolledBack: FeatureFlag = {
    ...flag,
    status: 'rolled-back',
    enabled: false,
    rolloutPercentage: 0,
    rolloutSteps: flag.rolloutSteps.map((step) =>
      step.status === 'running' ? { ...step, status: 'paused' } : step,
    ),
  }
  const saved = bumpExistingFlag(rolledBack, actor, '紧急回滚')
  db.flags[index] = saved
  pushAudit(db, {
    flagId,
    flagKey: flag.key,
    action: 'rolled-back',
    actor,
    summary: reason,
    before: `v${flag.version} · ${before}`,
    after: `v${saved.version} · rolled-back / 0%`,
    affectedUsers: affectedUsersOf(beforePercentage),
    fieldChanges: buildFieldChanges(flag, saved, [], actor),
    fromVersion: flag.version,
    toVersion: saved.version,
  })
  writeDatabase(db)
  return saved
}

export const submitFlagForReview = (flagId: string, actor: string): FeatureFlag => {
  const db = readDatabase()
  const index = db.flags.findIndex((item) => item.id === flagId)
  if (index < 0) throw new Error('功能开关不存在')
  const flag = db.flags[index]
  const submitted: FeatureFlag = { ...flag, status: 'review' }
  const saved = bumpExistingFlag(submitted, actor, '提交影响评审')
  db.flags[index] = saved
  pushAudit(db, {
    flagId,
    flagKey: flag.key,
    action: 'submitted',
    actor,
    summary: '提交发布影响评审。',
    before: `v${flag.version} · ${flag.status}`,
    after: `v${saved.version} · review`,
    affectedUsers: affectedUsersOf(saved.rolloutPercentage),
    fieldChanges: buildFieldChanges(flag, saved, [], actor),
    fromVersion: flag.version,
    toVersion: saved.version,
  })
  writeDatabase(db)
  return saved
}

export const getDashboardStats = (): DashboardData => {
  const db = readDatabase()
  return {
    activeFlags: db.flags.filter((flag) => flag.enabled).length,
    pendingReview: db.flags.filter((flag) => flag.status === 'review').length + 2,
    blockerIssues: db.issues.filter((issue) => issue.severity === 'blocker' && !issue.resolved).length,
    affectedUsers: 5246900,
    environmentDiff: [
      { flag: '极速支付流程 V2', dev: 100, staging: 20, production: 0 },
      { flag: '账单异步导出 V3', dev: 5, staging: 0, production: 0 },
      { flag: '商品智能推荐位', dev: 100, staging: 50, production: 35 },
      { flag: '实时用户特征服务', dev: 100, staging: 80, production: 60 },
    ],
    adoptionTrend: [
      { date: '09-23', flags: 18, rollbacks: 1 },
      { date: '09-24', flags: 21, rollbacks: 0 },
      { date: '09-25', flags: 19, rollbacks: 2 },
      { date: '09-26', flags: 24, rollbacks: 1 },
      { date: '09-27', flags: 27, rollbacks: 0 },
      { date: '09-28', flags: 31, rollbacks: 3 },
      { date: '09-29', flags: 29, rollbacks: 1 },
    ],
  }
}
