import { Box, Typography } from '@mui/material'
import type { ReactNode } from 'react'

interface StatCardProps {
  label: string
  value: string | number
  note: string
  icon: ReactNode
  tone?: 'blue' | 'orange' | 'red' | 'green'
}

export function StatCard({ label, value, note, icon, tone = 'blue' }: StatCardProps) {
  return (
    <Box className={`stat-card tone-${tone}`}>
      <Box className="stat-icon">{icon}</Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography className="stat-value">{value}</Typography>
        <Typography variant="caption" color="text.secondary">
          {note}
        </Typography>
      </Box>
    </Box>
  )
}
