import { Chip } from '@mui/material'
import type { FlagStatus } from '@/types'

const statusMap: Record<FlagStatus, { label: string; color: 'default' | 'info' | 'success' | 'warning' | 'error' }> = {
  draft: { label: '草稿', color: 'default' },
  review: { label: '待评审', color: 'warning' },
  active: { label: '已发布', color: 'success' },
  frozen: { label: '已冻结', color: 'info' },
  'rolled-back': { label: '已回滚', color: 'error' },
}

export function FlagStatusChip({ status }: { status: FlagStatus }) {
  const value = statusMap[status]
  return <Chip label={value.label} color={value.color} size="small" variant={status === 'active' ? 'filled' : 'outlined'} />
}
