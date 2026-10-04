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

/** 一个版本对应一次成功落库的配置提交，用于审计追溯。 */
export interface VersionRecord {
  version: number
  updatedAt: string
  actor: string
  /** 该版本由哪一笔提交写入，用于刷新后重试时去重。 */
  commitId?: string
  note?: string
}

/** 可在编辑器中逐项冲突比对的配置字段。 */
export type EditableFlagField =
  | 'name'
  | 'description'
  | 'owner'
  | 'team'
  | 'environment'
  | 'status'
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
  lastChangedBy: string
  /** 乐观锁版本号；历史数据在升级读取时按原 updatedAt 补建为 1。 */
  version: number
  versionHistory: VersionRecord[]
  /** 最近一次成功提交的编号，保证重复重试幂等。 */
  lastCommitId?: string
}

/** 审计记录中单字段的定稿结果，冲突时保留三方值。 */
export interface AuditFieldChange {
  field: EditableFlagField
  fieldLabel: string
  oldValue: unknown
  newValue: unknown
  /** 冲突定稿场景下，本页打开时的基线值与评审人的修改值。 */
  baseValue?: unknown
  requestedValue?: unknown
  resolution?: 'mine' | 'theirs' | 'base'
  resolvedBy?: string
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
  affectedUsers: number
  createdAt: string
  /** 版本化保存的字段级明细，旧值全部留存；历史审计记录不含该字段，保持可查。 */
  fieldChanges?: AuditFieldChange[]
  /** 版本化提交附带的版本信息。 */
  fromVersion?: number
  toVersion?: number
  /** 仅当本笔提交由冲突定稿合并而来时存在。 */
  conflictResolved?: boolean
  /** 幂等提交编号，刷新后重试同一笔提交不会重复记账。 */
  commitId?: string
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

// ---- 乐观锁保存协议 ----

export type SaveIntent = 'save-draft' | 'submit-review'

export interface FieldConflict {
  field: EditableFlagField
  fieldLabel: string
  /** 打开页面时记录的基线值（版本 expectedVersion）。 */
  baseValue: unknown
  /** 当前页评审人期望写入的值。 */
  requestedValue: unknown
  /** 对端标签页已经保存的最新值。 */
  currentValue: unknown
}

export type ConflictResolutionChoice = 'mine' | 'theirs' | 'base'

export interface SaveFlagRequest {
  flag: FeatureFlag
  /** 打开页面时记下的版本号；新建传 0。 */
  expectedVersion: number
  /** 打开页面时记下的完整配置快照，版本前进时用于三方合并。 */
  base?: FeatureFlag
  intent: SaveIntent
  commitId: string
  /** 冲突逐项定稿后重试时携带，字段定稿后不再重复报冲突。 */
  resolutions?: Partial<Record<EditableFlagField, ConflictResolutionChoice>>
  /** 定稿时所依据的库中最新版本；版本再前进则定稿作废，需重新比对。 */
  resolvedAgainstVersion?: number
  /** 冲突定稿的评审人，写入审计记录。 */
  resolvedBy?: string
}

export type SaveFlagResult =
  | {
      outcome: 'success'
      flag: FeatureFlag
      /** 非冲突场景下本页修改被对端值自动合并的字段，供页面提示。 */
      autoMergedFields: EditableFlagField[]
    }
  | {
      outcome: 'conflict'
      flagId: string
      flagKey: string
      expectedVersion: number
      currentVersion: number
      conflicts: FieldConflict[]
      /** 无冲突、自动并入本笔提交的对端字段。 */
      autoMergedFields: EditableFlagField[]
      commitId: string
    }

/** 尚未完成的提交，持久化在独立本地存储键中，刷新/重开后可继续同一笔。 */
export interface PendingFlagCommit {
  commitId: string
  flagId: string
  flagKey: string
  intent: SaveIntent
  createdAt: string
  lastAttemptAt: string
  attempts: number
  /** 打开页面时的版本与期望写入的完整配置。 */
  expectedVersion: number
  desired: FeatureFlag
  /** 打开页面时的完整配置快照，随挂起记录一起恢复，保证冲突比对基线不丢失。 */
  base?: FeatureFlag
  /** 最近一次冲突结果，重开时直接让评审人逐项定稿。 */
  conflict?: {
    currentVersion: number
    conflicts: FieldConflict[]
    autoMergedFields: EditableFlagField[]
    /** 评审人逐项定稿结果，保存时随请求重试。 */
    resolutions?: Partial<Record<EditableFlagField, ConflictResolutionChoice>>
    resolvedBy?: string
  }
  /** 最近一次失败原因（如本地存储短暂失败），用于重试提示。 */
  lastError?: string
}
