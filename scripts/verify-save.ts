/* 端到端逻辑验证：并发版本校验 / 冲突定稿 / outbox 恢复 / 旧数据迁移 */
import { readDatabase } from '@/services/database'
import {
  discardPendingCommit,
  executeCommit,
  getPendingCommit,
  listPendingCommits,
  retryPendingCommit,
} from '@/services/commitLog'
import type { CommitRequest, EditableField, FeatureFlag } from '@/types'

/** 按当前冲突快照构造指纹定稿 */
const resolve = (
  conflicts: { field: EditableField; mineFingerprint: string; theirsFingerprint: string }[],
  field: EditableField,
  side: 'mine' | 'theirs',
) => {
  const conflict = conflicts.find((c) => c.field === field)!
  return {
    [field]: { side, mineFingerprint: conflict.mineFingerprint, theirsFingerprint: conflict.theirsFingerprint },
  }
}

const MAIN_KEY = 'feature-flag-release-console-v1'
const OUTBOX_KEY = 'feature-flag-release-console-pending-commits-v1'

class MemoryStorage {
  data = new Map<string, string>()
  // 让主库前 N 次写入失败，模拟本地存储短暂不可用
  failMainWrites = 0
  setItem(key: string, value: string) {
    if (key === MAIN_KEY && this.failMainWrites > 0) {
      this.failMainWrites -= 1
      throw new Error('QuotaExceededError (simulated)')
    }
    this.data.set(key, value)
  }
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
}

const storage = new MemoryStorage()
;(globalThis as any).localStorage = storage
;(globalThis as any).window = { setTimeout: (fn: any) => setTimeout(fn, 1) }

let failures = 0
const assert = (cond: boolean, msg: string) => {
  if (cond) console.log(`  ✓ ${msg}`)
  else {
    failures += 1
    console.error(`  ✗ ${msg}`)
  }
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

// ── 场景 0：旧数据迁移 ─────────────────────────────────────────────
console.log('\n[0] 旧数据升级：无版本号 → 按 updatedAt 补建 v1，审计保留')
const legacyFlag: FeatureFlag = JSON.parse(JSON.stringify(readDatabase().flags[0]))
delete (legacyFlag as any).version
delete (legacyFlag as any).versionedAt
const legacyDb = {
  flags: [legacyFlag],
  audit: [{ id: 'audit-old-1', flagId: legacyFlag.id, flagKey: legacyFlag.key, action: 'rollout-adjusted', actor: '老人', summary: '历史调整', before: '5%', after: '20%', affectedUsers: 100, createdAt: '2026-09-01T00:00:00+08:00' }],
  issues: [],
}
storage.data.clear()
storage.setItem(MAIN_KEY, JSON.stringify(legacyDb))
const migrated = readDatabase()
assert(migrated.flags[0].version === 1, '旧开关补建版本号为 1')
assert(migrated.flags[0].versionedAt === migrated.flags[0].updatedAt, '版本时间取原 updatedAt')
assert(migrated.audit[0].id === 'audit-old-1' && migrated.audit[0].changes === undefined, '原有审计记录原样保留可查')

// ── 场景 1：两个标签页并发编辑同一开关 ─────────────────────────────
console.log('\n[1] 并发保存：后保存者先检测版本冲突，逐项定稿后才落库')
storage.data.clear()
const db0 = readDatabase()
const flag = db0.flags.find((f) => f.id === 'flag-101')!
assert(flag.version === 1, '种子开关初始 v1')

// A、B 两个标签页都在 v1 时打开
const baseA = clone(flag)
const baseB = clone(flag)

// B 先保存：灰度 35%，并修改一条回滚条件
const intentB = clone(baseB)
intentB.rolloutPercentage = 35
intentB.rollbackConditions = [...intentB.rollbackConditions.slice(0, 2), 'B 新增：客服告警 5 分钟 > 10 单']
const commitB: CommitRequest = {
  commitId: 'commit-B',
  flagId: flag.id,
  mode: 'save',
  actor: '许薇',
  baseVersion: 1,
  base: baseB,
  intent: intentB,
}
const resB = await executeCommit(commitB)
assert(resB.type === 'committed', 'B 首次保存成功')
if (resB.type === 'committed') assert(resB.flag.version === 2, 'B 保存后版本前进到 v2')

// A 保存：灰度 25%（与 B 的 35% 冲突），回滚条件 A 没动（应自动合并 B 的值），
// 且 A 改了业务说明（B 没动，应自动保留 A 的值）
const intentA = clone(baseA)
intentA.rolloutPercentage = 25
intentA.description = baseA.description + '（A 补充的业务背景）'
const commitA: CommitRequest = {
  commitId: 'commit-A',
  flagId: flag.id,
  mode: 'save',
  actor: '陈思远',
  baseVersion: 1,
  base: baseA,
  intent: intentA,
}
const resA1 = await executeCommit(commitA)
assert(resA1.type === 'conflict', 'A 提交时检测到版本已前进')
if (resA1.type === 'conflict') {
  assert(resA1.serverVersion === 2, '冲突响应告知服务端 v2')
  const fields = resA1.conflicts.map((c) => c.field)
  assert(fields.length === 1 && fields[0] === 'rolloutPercentage', `只列真正冲突字段（灰度比例），实际：${fields.join(',')}`)
  assert(resA1.conflicts[0].mineValue === '25%' && resA1.conflicts[0].theirsValue === '35%', '冲突列出两边值 25% / 35%')
  assert(resA1.conflicts[0].baseValue === '20%', '冲突保留旧值 20%')

  // outbox 中保留该提交
  const pending = getPendingCommit(flag.id)
  assert(Boolean(pending) && pending!.request.commitId === 'commit-A', '冲突提交已进 outbox，刷新可继续')
  assert(pending!.lastConflict?.conflicts[0].field === 'rolloutPercentage', 'outbox 记录冲突快照，重开直接定稿')

  // A 逐项定稿：灰度采用自己的 25%
  const resA2 = await retryPendingCommit(
    flag.id,
    resolve(resA1.conflicts, 'rolloutPercentage', 'mine'),
  )
  assert(resA2.type === 'committed', '定稿后同一笔提交重试成功')
  if (resA2.type === 'committed') {
    const saved = resA2.flag
    assert(saved.version === 3, '合并保存后版本为 v3')
    assert(saved.rolloutPercentage === 25, '灰度采用定稿值 25%（A）')
    assert(saved.rollbackConditions[2] === 'B 新增：客服告警 5 分钟 > 10 单', 'A 未动的回滚条件自动合并 B 的新值')
    assert(saved.description.endsWith('（A 补充的业务背景）'), 'B 未动的业务说明保留 A 的修改')

    const event = readDatabase().audit.find((e) => e.id === 'audit-commit-A')!
    assert(Boolean(event), '审计记录存在')
    assert(event.version === 3 && event.changes!.length >= 2, '审计记录版本与字段级变更')
    const pctChange = event.changes!.find((c) => c.field === 'rolloutPercentage')!
    assert(
      pctChange.conflict === true &&
        pctChange.baseValue === '20%' &&
        pctChange.mineValue === '25%' &&
        pctChange.theirsValue === '35%' &&
        pctChange.newValue === '25%' &&
        pctChange.resolution === 'mine',
      '审计写入冲突字段的旧值/两边值/定稿选择',
    )
    // 自动合入的字段相对 v2 无变化，不重复记账；其旧值已在 B 的 v1→v2 审计中
    const eventB = readDatabase().audit.find((e) => e.id === 'audit-commit-B')!
    const rbChangeB = eventB.changes!.find((c) => c.field === 'rollbackConditions')!
    assert(rbChangeB && rbChangeB.oldValue.includes('错误率高于 1.2%') && rbChangeB.newValue.includes('B 新增'), 'B 的保存已记录回滚条件旧值→新值')
    assert(!event.changes!.some((c) => c.field === 'rollbackConditions'), 'A 的 v2→v3 审计不重复记录 B 的自动合入字段')
  }

  // 幂等：重复执行同一 commitId 不产生第二次版本递增/重复审计
  const resA3 = await executeCommit({
    ...commitA,
    resolutions: resolve(resA1.conflicts, 'rolloutPercentage', 'mine'),
  })
  assert(resA3.type === 'committed' && readDatabase().flags.find((f) => f.id === flag.id)!.version === 3, '重复提交同一 commitId 幂等，版本仍为 v3')
  assert(readDatabase().audit.filter((e) => e.id === 'audit-commit-A').length === 1, '审计记录不重复')
  assert(listPendingCommits().every((p) => p.request.commitId !== 'commit-A'), '完成后 outbox 已清理')
}

// ── 场景 2：本地存储短暂失败 → 重试成功；刷新后续提 ────────────────
console.log('\n[2] 存储短暂失败：主库不出现半套配置，重试完成同一笔提交')
storage.data.clear()
const db2 = readDatabase() // 先完成播种
storage.failMainWrites = 3 // 主库写在内部 3 次重试内全部失败（outbox 先写成功）
const f2 = db2.flags[1]
const base2 = clone(f2)
const intent2 = clone(base2)
intent2.rolloutPercentage = 50
const commit2: CommitRequest = {
  commitId: 'commit-2',
  flagId: f2.id,
  mode: 'save',
  actor: '周启',
  baseVersion: f2.version,
  base: base2,
  intent: intent2,
}
const r2a = await executeCommit(commit2)
assert(r2a.type === 'storage-error', '存储失败返回 storage-error 而非半写入')
// 主库中该开关仍为旧值（无半套配置）
const afterFail = readDatabase().flags.find((f) => f.id === f2.id)!
assert(afterFail.rolloutPercentage === base2.rolloutPercentage && afterFail.version === f2.version, '失败后主库配置不变，无半套配置')
assert(getPendingCommit(f2.id)?.request.commitId === 'commit-2', '提交保留在 outbox')

// 模拟刷新页面：不再持有任何内存状态，仅凭 outbox 继续
const r2b = await retryPendingCommit(f2.id)
assert(r2b.type === 'committed', '刷新后重试同一笔提交成功')
if (r2b.type === 'committed') {
  assert(r2b.flag.version === f2.version + 1 && r2b.flag.rolloutPercentage === 50, '重试后完整落库并递增版本')
}
assert(!getPendingCommit(f2.id), '成功后 outbox 清空')

// ── 场景 3：放弃未完成提交 ─────────────────────────────────────────
console.log('\n[3] 放弃未完成提交：outbox 清理，主库不变')
storage.failMainWrites = 4 // 超过内部重试上限，提交留在 outbox
const db3 = readDatabase()
const f3 = db3.flags[2]
const base3 = clone(f3)
const intent3 = clone(base3)
intent3.description = '尝试修改但存储一直失败'
const r3 = await executeCommit({
  commitId: 'commit-3',
  flagId: f3.id,
  mode: 'save',
  actor: '周航',
  baseVersion: f3.version,
  base: base3,
  intent: intent3,
})
assert(r3.type === 'storage-error', '持续失败时报 storage-error')
await discardPendingCommit(f3.id)
assert(!getPendingCommit(f3.id), '放弃后 outbox 无残留')
assert(readDatabase().flags.find((f) => f.id === f3.id)!.description === base3.description, '放弃后主库完全未变')
storage.failMainWrites = 0

// ── 场景 4：新建开关 ───────────────────────────────────────────────
console.log('\n[4] 新建开关直接 v1，重复提交幂等')
const newFlag: FeatureFlag = {
  ...clone(readDatabase().flags[0]),
  id: 'flag-new-x',
  key: 'new.example-flag',
  name: '新开关',
  version: 0,
}
const newCommit: CommitRequest = {
  commitId: 'commit-new',
  flagId: 'flag-new-x',
  mode: 'submit',
  actor: '林默',
  baseVersion: 0,
  base: { ...newFlag },
  intent: newFlag,
}
const rn1 = await executeCommit(newCommit)
assert(rn1.type === 'committed', '新建成功')
if (rn1.type === 'committed') {
  assert(rn1.flag.version === 1 && rn1.flag.status === 'review' && rn1.wasSubmit, '新建即提交：v1 且状态 review')
}
const rn2 = await executeCommit(newCommit)
assert(readDatabase().flags.filter((f) => f.id === 'flag-new-x').length === 1, '新建提交重试不会产生重复开关')
assert(readDatabase().audit.filter((e) => e.id === 'audit-commit-new').length === 1, '新建审计不重复')

// ── 场景 5：对方又前进了一版，二次冲突仍按原 base 重新合并 ─────────
console.log('\n[5] 定稿期间对方再保存：二次冲突仍能逐项定稿')
storage.data.clear()
const db5 = readDatabase()
const f5 = db5.flags[0]
const base5 = clone(f5)
const intent5a = clone(base5)
intent5a.rolloutPercentage = 25
await executeCommit({ commitId: 'c5a', flagId: f5.id, mode: 'save', actor: 'A', baseVersion: 1, base: base5, intent: intent5a })
// A 的冲突提交
const intent5b = clone(base5)
intent5b.rolloutPercentage = 30
const r5b = await executeCommit({ commitId: 'c5b', flagId: f5.id, mode: 'save', actor: 'B', baseVersion: 1, base: base5, intent: intent5b })
assert(r5b.type === 'conflict', 'B 检测到 v2 冲突')
// C 又推进一版，且 C 也修改了灰度（与 B 待保存的 30% 形成真正的二次冲突）
const server2 = readDatabase().flags.find((f) => f.id === f5.id)!
const intentC = clone(server2)
intentC.rolloutPercentage = 40
await executeCommit({ commitId: 'c5c', flagId: f5.id, mode: 'save', actor: 'C', baseVersion: server2.version, base: clone(server2), intent: intentC })
// B 带着定稿重试：服务器已到 v3，旧定稿针对的是 35%，需二次冲突
const r5c = await retryPendingCommit(
  f5.id,
  resolve(
    [
      {
        field: 'rolloutPercentage',
        mineFingerprint: JSON.stringify(intent5b.rolloutPercentage),
        // 故意使用上一轮对方值（25%）的指纹，模拟用户拿着旧定稿直接重试
        theirsFingerprint: JSON.stringify(25),
      },
    ],
    'rolloutPercentage',
    'mine',
  ),
)
assert(r5c.type === 'conflict', '定稿期间版本再前进，旧定稿失效，返回二次冲突而不是脏写')
if (r5c.type === 'conflict') {
  assert(r5c.serverVersion === 3, '告知最新 v3')
  assert(r5c.conflicts[0].theirsValue === '40%', '二次冲突展示对方最新值 40%')
  const r5d = await retryPendingCommit(f5.id, resolve(r5c.conflicts, 'rolloutPercentage', 'theirs'))
  assert(r5d.type === 'committed' && r5d.flag.version === 4 && r5d.flag.rolloutPercentage === 40, '改用对方值后定稿为 v4 / 40%')
}

console.log(`\n${failures === 0 ? '全部断言通过 ✅' : `有 ${failures} 条断言失败 ❌`}`)
process.exit(failures === 0 ? 0 : 1)
