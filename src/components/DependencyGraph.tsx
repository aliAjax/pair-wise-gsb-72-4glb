import { Box, Chip, Paper, Typography } from '@mui/material'
import type { FeatureFlag } from '@/types'

interface DependencyGraphProps {
  selectedFlag: FeatureFlag
  allFlags: FeatureFlag[]
}

export function DependencyGraph({ selectedFlag, allFlags }: DependencyGraphProps) {
  const related = selectedFlag.dependencies
    .map((dependency) => ({
      ...dependency,
      flag: allFlags.find((flag) => flag.id === dependency.flagId),
    }))
    .filter((item) => item.flag)

  return (
    <Box className="dependency-graph">
      <Box className="graph-source">
        <Box className="graph-node selected">
          <Typography variant="body2" fontWeight={700}>
            {selectedFlag.name}
          </Typography>
          <Typography variant="caption">{selectedFlag.key}</Typography>
          <Chip size="small" label={`${selectedFlag.rolloutPercentage}%`} />
        </Box>
      </Box>
      <Box className="graph-connectors">
        {related.map((item) => (
          <Box key={item.flagId} className={`connector ${item.type}`}>
            <Typography variant="caption">{item.condition}</Typography>
          </Box>
        ))}
      </Box>
      <Box className="graph-targets">
        {related.map((item) => (
          <Paper key={item.flagId} variant="outlined" className={`graph-node ${item.type}`}>
            <Typography variant="body2" fontWeight={700}>
              {item.flag?.name}
            </Typography>
            <Typography variant="caption">{item.flag?.key}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.8 }}>
              <Chip
                size="small"
                color={item.type === 'conflicts' ? 'error' : item.type === 'requires' ? 'primary' : 'default'}
                label={item.type === 'requires' ? '前置依赖' : item.type === 'conflicts' ? '冲突' : '降级'}
              />
              <Chip size="small" variant="outlined" label={item.flag?.status} />
            </Box>
          </Paper>
        ))}
        {related.length === 0 && (
          <Paper variant="outlined" className="graph-node empty">
            <Typography variant="body2" color="text.secondary">
              暂未配置依赖关系
            </Typography>
          </Paper>
        )}
      </Box>
    </Box>
  )
}
