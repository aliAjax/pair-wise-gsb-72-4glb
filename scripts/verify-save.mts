import assert from 'node:assert/strict'
import { seedDatabase, readDatabase, writeDatabase, commitFlagSave, StorageUnavailableError } from '../src/services/database'
import { listPendingCommits, savePendingCommit, getPendingCommit, clearPendingCommit } from '../src/services/pendingCommits'
import type { FeatureFlag, SaveFlagRequest } from '../src/types'

// ---- localStorage shim ----
let store: Record<string, string> = {}
const localStorageShim = {
  getItem: (key: string) => (key in store ? store[key] : null),
  setItem: (key: string, value: string) => {
    if ((globalThis as { __failStorage?: boolean }).__failStorage) {
      throw new Error('QuotaExceededError')
    }
    store[key] = value
  },
  removeItem: (key: string) => {
    delete store[key]
  },
  clear: () => {
    store = {}
  },
}
;(globalThis as { localStorage?: unknown }).localStorage = localStorageShim
;(globalThis as { window?: unknown }).window = globalThis

const resetDb = () => {
  store = {}
}

const edit = (flag: FeatureFlag, patch: Partial<FeatureFlag>, actor = '测试人'): FeatureFlag => ({
  ...flag,
  ...patch,
  lastChangedBy: actor,
})

let failures = 0
const test = async (name: string, fn: () => void | Promise<void>) => {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures += 1
    console.error(`  ✗ ${name}`)
    console.error(error)
  }
}

await test('历史数据升级：无版本号按原 updatedAt 补建初始版本', () => {
  resetDb()
  // 模拟旧版本数据：没有 version / versionHistory。
  const seed = seedDatabase()
  const legacy = seed.flags.map((flag) => {
    const { version: _v, versionHistory: _h, ...rest } = flag
    void _v
    void _h
    return rest
  }) as unknown as FeatureFlag[]
  writeDatabase({ ...seed, flags: legacy })
  const db = readDatabase()
  for (const flag of db.flags) {
    assert.equal(flag.version, 1)
    assert.equal(flag.versionHistory.length, 1)
    assert.equal(flag.versionHistory[0].version, 1)
    // 初始版本时间沿用原 updatedAt
    assert.equal(flag.versionHistory[0].updatedAt, flag.updatedAt)
  }
})

await test('历史审计记录升级后仍可查（原样保留）', () => {
  const db = readDatabase()
  assert.ok(db.audit.length >= 6)
  assert.equal(db.audit[0].fieldChanges, undefined)
  assert.equal(db.audit[0].fromVersion, undefined)
})

await test('版本一致时保存成功，版本前进并写审计字段级旧值', () => {
  resetDb()
  const before = readDatabase().flags.find((f) => f.id === 'flag-101')!
  const base = before
  const desired = edit(before, { rolloutPercentage: 45, rollbackConditions: [...before.rollbackConditions, '新条件 X'] }, '陈思远')
  const req: SaveFlagRequest = { flag: desired, expectedVersion: 1, base, intent: 'save-draft', commitId: 'commit-a' }
  const result = commitFlagSave(req)
  assert.equal(result.outcome, 'success')
  if (result.outcome !== 'success') return
  assert.equal(result.flag.version, 2)
  assert.equal(result.flag.versionHistory.length, 2)
  assert.equal(result.flag.rolloutPercentage, 45)
  const db = readDatabase()
  const event = db.audit[0]
  assert.equal(event.fromVersion, 1)
  assert.equal(event.toVersion, 2)
  assert.ok(event.fieldChanges!.some((c) => c.field === 'rolloutPercentage'))
  const pctChange = event.fieldChanges!.find((c) => c.field === 'rolloutPercentage')!
  assert.equal(pctChange.oldValue, 20)
  assert.equal(pctChange.newValue, 45)
})

await test('版本已前进且双方改不同字段：无冲突自动合并', () => {
  resetDb()
  const base = readDatabase().flags.find((f) => f.id === 'flag-101')!
  // 对端先改回滚条件并保存 v2
  const theirs = edit(base, { rollbackConditions: [...base.rollbackConditions, '对端加的条件'] }, '许薇')
  commitFlagSave({ flag: theirs, expectedVersion: 1, base, intent: 'save-draft', commitId: 'commit-theirs' })
  // 本页改灰度比例（基线仍是 v1）
  const mine = edit(base, { rolloutPercentage: 60 }, '陈思远')
  const result = commitFlagSave({ flag: mine, expectedVersion: 1, base, intent: 'save-draft', commitId: 'commit-mine' })
  assert.equal(result.outcome, 'success')
  if (result.outcome !== 'success') return
  assert.equal(result.flag.version, 3)
  assert.equal(result.flag.rolloutPercentage, 60)
  assert.ok(result.flag.rollbackConditions.includes('对端加的条件'))
  assert.deepEqual(result.autoMergedFields, ['rollbackConditions'])
})

await test('版本已前进且双方改同字段不同值：列出冲突，不落库', () => {
  resetDb()
  const base = readDatabase().flags.find((f) => f.id === 'flag-101')!
  const theirs = edit(base, { rolloutPercentage: 30 }, '许薇')
  commitFlagSave({ flag: theirs, expectedVersion: 1, base, intent: 'save-draft', commitId: 'c-t1' })
  const mine = edit(base, { rolloutPercentage: 60 }, '陈思远')
  const result = commitFlagSave({ flag: mine, expectedVersion: 1, base, intent: 'save-draft', commitId: 'c-m1' })
  assert.equal(result.outcome, 'conflict')
  if (result.outcome !== 'conflict') return
  assert.equal(result.currentVersion, 2)
  const fields = result.conflicts.map((c) => c.field)
  assert.ok(fields.includes('rolloutPercentage'))
  const conflict = result.conflicts.find((c) => c.field === 'rolloutPercentage')!
  assert.equal(conflict.baseValue, 20)
  assert.equal(conflict.requestedValue, 60)
  assert.equal(conflict.currentValue, 30)
  // 冲突未定稿不写入：仍是 v2/30%
  const db = readDatabase()
  const current = db.flags.find((f) => f.id === 'flag-101')!
  assert.equal(current.version, 2)
  assert.equal(current.rolloutPercentage, 30)
  // 审计没有新增（冲突记账）
  assert.ok(!db.audit.some((e) => e.commitId === 'c-m1'))
})

await test('逐项定稿后重试：采用本页值，审计保留三方值与定稿人', () => {
  resetDb()
  const base = readDatabase().flags.find((f) => f.id === 'flag-101')!
  commitFlagSave({ flag: edit(base, { rolloutPercentage: 30 }, '许薇'), expectedVersion: 1, base, intent: 'save-draft', commitId: 'd-t1' })
  const mine = edit(base, { rolloutPercentage: 60 }, '陈思远')
  const conflictResult = commitFlagSave({ flag: mine, expectedVersion: 1, base, intent: 'save-draft', commitId: 'd-m1' })
  assert.equal(conflictResult.outcome, 'conflict')
  if (conflictResult.outcome !== 'conflict') return
  const resolved = commitFlagSave({
    flag: mine,
    expectedVersion: 1,
    base,
    intent: 'save-draft',
    commitId: 'd-m1',
    resolutions: { rolloutPercentage: 'mine' },
    resolvedAgainstVersion: 2,
    resolvedBy: '评审人林默',
  })
  assert.equal(resolved.outcome, 'success')
  if (resolved.outcome !== 'success') return
  assert.equal(resolved.flag.rolloutPercentage, 60)
  assert.equal(resolved.flag.version, 3)
  const event = readDatabase().audit[0]
  assert.equal(event.conflictResolved, true)
  const change = event.fieldChanges!.find((c) => c.field === 'rolloutPercentage')!
  assert.equal(change.oldValue, 30)
  assert.equal(change.newValue, 60)
  assert.equal(change.baseValue, 20)
  assert.equal(change.requestedValue, 60)
  assert.equal(change.resolution, 'mine')
  assert.equal(change.resolvedBy, '评审人林默')
})

await test('定稿选择 theirs/base 均生效', () => {
  resetDb()
  const base = readDatabase().flags.find((f) => f.id === 'flag-101')!
  commitFlagSave({ flag: edit(base, { rolloutPercentage: 30 }, '许薇'), expectedVersion: 1, base, intent: 'save-draft', commitId: 'e-t1' })
  const mine = edit(base, { rolloutPercentage: 60 }, '陈思远')
  const r1 = commitFlagSave({ flag: mine, expectedVersion: 1, base, intent: 'save-draft', commitId: 'e-m1', resolutions: { rolloutPercentage: 'theirs' }, resolvedAgainstVersion: 2, resolvedBy: 'r' })
  assert.equal(r1.outcome, 'success')
  if (r1.outcome === 'success') assert.equal(r1.flag.rolloutPercentage, 30)

  // 再来一次 base
  const db1 = readDatabase()
  const flag3 = db1.flags.find((f) => f.id === 'flag-101')!
  // 构造对方再改一次到 80
  const base3 = flag3
  commitFlagSave({ flag: edit(flag3, { rolloutPercentage: 80 }, '许薇'), expectedVersion: 3, base: base3, intent: 'save-draft', commitId: 'e-t2' })
  const mine3 = edit(base3, { rolloutPercentage: 70 }, '陈思远')
  const r2 = commitFlagSave({ flag: mine3, expectedVersion: 3, base: base3, intent: 'save-draft', commitId: 'e-m2', resolutions: { rolloutPercentage: 'base' }, resolvedAgainstVersion: 4, resolvedBy: 'r' })
  assert.equal(r2.outcome, 'success')
  if (r2.outcome === 'success') assert.equal(r2.flag.rolloutPercentage, 30)
})

await test('定稿期间版本再前进：旧定稿作废，重新报冲突', () => {
  resetDb()
  const base = readDatabase().flags.find((f) => f.id === 'flag-101')!
  commitFlagSave({ flag: edit(base, { rolloutPercentage: 30 }, '许薇'), expectedVersion: 1, base, intent: 'save-draft', commitId: 'f-t1' })
  const mine = edit(base, { rolloutPercentage: 60 }, '陈思远')
  // 对方又前进到 v3（90）
  const v2 = readDatabase().flags.find((f) => f.id === 'flag-101')!
  commitFlagSave({ flag: edit(v2, { rolloutPercentage: 90 }, '许薇'), expectedVersion: 2, base: v2, intent: 'save-draft', commitId: 'f-t2' })
  // 带着针对 v2 的定稿去提交，应当作废
  const result = commitFlagSave({ flag: mine, expectedVersion: 1, base, intent: 'save-draft', commitId: 'f-m1', resolutions: { rolloutPercentage: 'mine' }, resolvedAgainstVersion: 2, resolvedBy: 'r' })
  assert.equal(result.outcome, 'conflict')
  if (result.outcome === 'conflict') assert.equal(result.currentVersion, 3)
})

await test('重复点击 / 刷新后同 commitId 重试幂等', () => {
  resetDb()
  const base = readDatabase().flags.find((f) => f.id === 'flag-101')!
  const desired = edit(base, { rolloutPercentage: 40 }, '陈思远')
  const req: SaveFlagRequest = { flag: desired, expectedVersion: 1, base, intent: 'save-draft', commitId: 'idem-1' }
  const r1 = commitFlagSave(req)
  assert.equal(r1.outcome, 'success')
  const auditCountAfter1 = readDatabase().audit.length
  const r2 = commitFlagSave(req)
  assert.equal(r2.outcome, 'success')
  if (r2.outcome === 'success') assert.equal(r2.flag.version, 2)
  assert.equal(readDatabase().audit.length, auditCountAfter1)
})

await test('本地存储短暂失败抛出可重试错误，成功后不留半套', () => {
  resetDb()
  const base = readDatabase().flags.find((f) => f.id === 'flag-101')!
  const desired = edit(base, { rolloutPercentage: 40 }, '陈思远')
  ;(globalThis as { __failStorage?: boolean }).__failStorage = true
  assert.throws(
    () => commitFlagSave({ flag: desired, expectedVersion: 1, base, intent: 'save-draft', commitId: 'fail-1' }),
    StorageUnavailableError,
  )
  ;(globalThis as { __failStorage?: boolean }).__failStorage = false
  // 失败后数据完全未变
  const afterFail = readDatabase().flags.find((f) => f.id === 'flag-101')!
  assert.equal(afterFail.version, 1)
  assert.equal(afterFail.rolloutPercentage, 20)
  // 重试成功
  const retry = commitFlagSave({ flag: desired, expectedVersion: 1, base, intent: 'save-draft', commitId: 'fail-1' })
  assert.equal(retry.outcome, 'success')
})

await test('挂起提交持久化：刷新后仍可读取并重试同一笔', () => {
  resetDb()
  const base = readDatabase().flags.find((f) => f.id === 'flag-101')!
  const desired = edit(base, { rolloutPercentage: 40 }, '陈思远')
  savePendingCommit({
    commitId: 'wal-1',
    flagId: 'flag-101',
    flagKey: base.key,
    intent: 'save-draft',
    createdAt: new Date().toISOString(),
    lastAttemptAt: new Date().toISOString(),
    attempts: 1,
    expectedVersion: 1,
    desired,
    base,
    lastError: '本地存储暂时不可用',
  })
  assert.equal(listPendingCommits().length, 1)
  const pending = getPendingCommit('flag-101')!
  assert.equal(pending.commitId, 'wal-1')
  const result = commitFlagSave({
    flag: pending.desired,
    expectedVersion: pending.expectedVersion,
    base: pending.base,
    intent: pending.intent,
    commitId: pending.commitId,
  })
  assert.equal(result.outcome, 'success')
  clearPendingCommit('flag-101')
  assert.equal(listPendingCommits().length, 0)
})

await test('提交评审意图：状态置为 review 并记 submitted 审计', () => {
  resetDb()
  const base = readDatabase().flags.find((f) => f.id === 'flag-103')!
  const desired = edit(base, { status: 'draft' }, '周航')
  const result = commitFlagSave({ flag: desired, expectedVersion: 1, base, intent: 'submit-review', commitId: 'sub-1' })
  assert.equal(result.outcome, 'success')
  if (result.outcome !== 'success') return
  assert.equal(result.flag.status, 'review')
  assert.equal(readDatabase().audit[0].action, 'submitted')
})

await test('新建开关：expectedVersion 0 创建 v1，重复提交不重复创建', () => {
  resetDb()
  const now = new Date().toISOString()
  const fresh: FeatureFlag = {
    ...seedDatabase().flags[0],
    id: 'flag-new-1',
    key: 'new.test-flag',
    name: '新开关',
    version: 0,
    versionHistory: [],
    createdAt: now,
    updatedAt: now,
  }
  const r1 = commitFlagSave({ flag: fresh, expectedVersion: 0, intent: 'save-draft', commitId: 'new-1' })
  assert.equal(r1.outcome, 'success')
  if (r1.outcome !== 'success') return
  assert.equal(r1.flag.version, 1)
  const r2 = commitFlagSave({ flag: fresh, expectedVersion: 0, intent: 'save-draft', commitId: 'new-1' })
  assert.equal(r2.outcome, 'success')
  const db = readDatabase()
  assert.equal(db.flags.filter((f) => f.key === 'new.test-flag').length, 1)
})

console.log(failures === 0 ? '\n全部验证通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
