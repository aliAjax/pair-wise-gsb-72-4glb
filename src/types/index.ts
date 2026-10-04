export type FlagStatus = 'draft' | 'review' | 'active' | 'frozen' | 'rolled-back'
export type Environment = 'dev' | 'staging' | 'production'
export type RuleOperator = 'equals' | 'not-equals' | 'contains' | 'in' | 'gte' | 'lte'
export type IssueSeverity = 'blocker' | 'warning' | 'info'
export type IssueCategory =
  | 'rule-conflict'
  | 'dead-code'
  | 'missing-metric'
  | 'overlap'
  | 'client-compatibility'

export interface AudienceRule {
  id: string
  attribute: string
  operator: RuleOperator
  value: string
  negate: boolean
}

export interface RolloutStep {
  id: string
  percentage: number
  audience: string
  startedAt: string
  status: 'completed' | 'running' | 'planned' | 'paused'
  guardrails: string[]
}

export interface Dependency {
  flagId: string
  type: 'requires' | 'conflicts' | 'fallback'
  condition: string
}

export interface FeatureFlag {
  id: string
  key: string
  name: string
  description: string
  owner: string
  team: string
  status: FlagStatus
  environment: Environment
  enabled: boolean
  rolloutPercentage: number
  audienceRules: AudienceRule[]
  regions: string[]
  minClientVersion: Record<Environment, string>
  dependencies: Dependency[]
  rollbackConditions: string[]
  metricNames: string[]
  deadCodeStatus: 'clean' | 'candidate' | 'confirmed'
  rolloutSteps: RolloutStep[]
  createdAt: string
  updatedAt: string
  /** 乐观锁版本号，每次成功保存/审批/回滚递增；旧数据迁移时按 updatedAt 补建为 1 */
  version: number
  /** 当前版本产生时间，v1 取原 updatedAt */
  versionedAt: string
  lastChangedBy: string
}

/** 审计记录中的字段级变更；冲突定稿时保留三边值与定稿选择 */
export interface AuditFieldChange {
  field: string
  label: string
  oldValue: string
  newValue: string
  baseValue?: string
  mineValue?: string
  theirsValue?: string
  conflict?: boolean
  resolution?: 'mine' | 'theirs'
}

export interface AuditEvent {
  id: string
  flagId: string
  flagKey: string
  action:
    | 'created'
    | 'updated'
    | 'submitted'
    | 'approved'
    | 'rejected'
    | 'frozen'
    | 'unfrozen'
    | 'rolled-back'
    | 'rollout-adjusted'
  actor: string
  summary: string
  before?: string
  after?: string
  /** 本次保存涉及的字段级变更（含冲突定稿记录）；旧审计记录没有该字段，展示时回退 */
  changes?: AuditFieldChange[]
  /** 保存后新版本号；迁移前的旧记录为空 */
  version?: number
  affectedUsers: number
  createdAt: string
}

export interface ImpactIssue {
  id: string
  flagId: string
  flagKey: string
  category: IssueCategory
  severity: IssueSeverity
  title: string
  detail: string
  suggestion: string
  resolved: boolean
}

export interface DashboardData {
  activeFlags: number
  pendingReview: number
  blockerIssues: number
  affectedUsers: number
  environmentDiff: Array<{ flag: string; dev: number; staging: number; production: number }>
  adoptionTrend: Array<{ date: string; flags: number; rollbacks: number }>
}

export interface FlagFilter {
  keyword?: string
  status?: FlagStatus | ''
  environment?: Environment | ''
  team?: string
  owner?: string
}

export interface ReviewPayload {
  reviewer: string
  decision: 'approved' | 'rejected'
  comment: string
  freezeUntil?: string
}

// ── 版本校验、冲突合并与可恢复提交 ───────────────────────────────────────────

export type CommitMode = 'save' | 'submit'

/** 允许在编辑器/灰度页修改并参与冲突检测的字段 */
export type EditableField =
  | 'key'
  | 'name'
  | 'description'
  | 'owner'
  | 'team'
  | 'environment'
  | 'enabled'
  | 'rolloutPercentage'
  | 'audienceRules'
  | 'regions'
  | 'minClientVersion'
  | 'dependencies'
  | 'rollbackConditions'
  | 'metricNames'
  | 'deadCodeStatus'
  | 'rolloutSteps'

export type ConflictSide = 'mine' | 'theirs'

/** 逐项定稿：除采用哪一边外，还记录定稿时看到的两边值指纹，防止旧定稿被套用到新一轮冲突 */
export interface FieldResolution {
  side: ConflictSide
  /** 定稿时我的值与对方值的稳定指纹 */
  mineFingerprint: string
  theirsFingerprint: string
}

export interface FieldConflict {
  field: EditableField
  label: string
  /** 打开页面时的旧值（base） */
  baseValue: string
  /** 当前页面待保存的值 */
  mineValue: string
  /** 版本前进后服务端的最新值 */
  theirsValue: string
  /** 已逐项定稿的结果；未定时为 null */
  resolution: ConflictSide | null
  /** 供重试校验用的值指纹 */
  mineFingerprint: string
  theirsFingerprint: string
}

export interface CommitRequest {
  commitId: string
  flagId: string
  mode: CommitMode
  actor: string
  /** 打开页面时看到的版本；新建为 0 */
  baseVersion: number
  /** 打开页面时的完整配置快照，作为三方合并的 base 与冲突时的旧值来源 */
  base: FeatureFlag
  /** 页面上完整的待保存配置 */
  intent: FeatureFlag
  /** 冲突逐项定稿结果（字段 → 采用哪一边及其值指纹） */
  resolutions?: Partial<Record<EditableField, FieldResolution>>
}

/** 落盘的待完成提交（outbox），刷新页面后可继续同一笔提交 */
export interface PendingCommit {
  request: CommitRequest
  createdAt: string
  attempts: number
  /** 最近一次遇到的冲突快照，重新打开后直接进入逐项定稿 */
  lastConflict?: {
    serverVersion: number
    conflicts: FieldConflict[]
  }
  lastError?: string
}

export interface CommitStorageError {
  type: 'storage-error'
  message: string
}

export interface CommitNotFound {
  type: 'not-found'
  message: string
}

export interface CommitConflict {
  type: 'conflict'
  message: string
  serverVersion: number
  conflicts: FieldConflict[]
  /** outbox 中该笔提交的 ID，定稿重试时沿用 */
  commitId: string
}

export interface CommitCommitted {
  type: 'committed'
  flag: FeatureFlag
  auditId: string
  wasSubmit: boolean
}

export type CommitOutcome = CommitStorageError | CommitNotFound | CommitConflict | CommitCommitted

export interface SaveRequest {
  commitId?: string
  flagId: string
  mode: CommitMode
  actor: string
  baseVersion: number
  base: FeatureFlag
  intent: FeatureFlag
  resolutions?: Partial<Record<EditableField, FieldResolution>>
}
