import { useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined'
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined'
import { useGetAuditQuery, useGetDashboardQuery, useGetFlagsQuery, useGetIssuesQuery } from '@/services/flagApi'
import { FlagStatusChip } from '@/components/FlagStatusChip'

const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`

export function ReportsPage() {
  const [environment, setEnvironment] = useState('')
  const [message, setMessage] = useState('')
  const { data: flags = [], isLoading } = useGetFlagsQuery({})
  const { data: dashboard } = useGetDashboardQuery()
  const { data: issues = [] } = useGetIssuesQuery({})
  const { data: audit = [] } = useGetAuditQuery({})

  const reportFlags = useMemo(
    () => flags.filter((flag) => !environment || flag.environment === environment),
    [environment, flags],
  )

  const exportReport = () => {
    const rows = [
      ['开关Key', '名称', '环境', '状态', '灰度比例', '负责人', '团队', '受众规则', '依赖数', '监控指标', '回滚条件', '预计影响用户'],
      ...reportFlags.map((flag) => [
        flag.key,
        flag.name,
        flag.environment,
        flag.status,
        `${flag.rolloutPercentage}%`,
        flag.owner,
        flag.team,
        flag.audienceRules.length,
        flag.dependencies.length,
        flag.metricNames.join('|'),
        flag.rollbackConditions.join('|'),
        Math.round(980000 * (flag.rolloutPercentage / 100)),
      ]),
    ]
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `feature-flag-release-report-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
    setMessage('发布报告已导出')
  }

  const riskFlags = reportFlags.filter((flag) => {
    const flagIssues = issues.filter((issue) => issue.flagId === flag.id && !issue.resolved)
    return flagIssues.some((issue) => issue.severity === 'blocker')
  })

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">发布报告</Typography>
          <Typography color="text.secondary">
            汇总开关配置、影响评审问题、灰度状态与审计轨迹，导出可归档的发布报告。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <TextField select label="环境范围" value={environment} onChange={(event) => setEnvironment(event.target.value)} sx={{ width: 160 }}>
            <MenuItem value="">全部环境</MenuItem>
            <MenuItem value="dev">开发</MenuItem>
            <MenuItem value="staging">预发</MenuItem>
            <MenuItem value="production">生产</MenuItem>
          </TextField>
          <Button variant="contained" startIcon={<DownloadOutlinedIcon />} onClick={exportReport}>
            导出 CSV
          </Button>
        </Stack>
      </Box>

      {message && <Alert severity="success" onClose={() => setMessage('')} sx={{ mb: 2 }}>{message}</Alert>}
      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      <Box className="report-summary">
        <Box className="report-summary-main">
          <AssessmentOutlinedIcon />
          <Box>
            <Typography variant="caption">报告范围</Typography>
            <Typography className="summary-value">{reportFlags.length} 个开关</Typography>
          </Box>
        </Box>
        <Box><Typography variant="caption">生产已启用</Typography><Typography className="summary-value">{reportFlags.filter((flag) => flag.enabled).length}</Typography></Box>
        <Box><Typography variant="caption">未解决阻断项</Typography><Typography className="summary-value danger">{riskFlags.length}</Typography></Box>
        <Box><Typography variant="caption">审计事件</Typography><Typography className="summary-value">{audit.length}</Typography></Box>
        <Box><Typography variant="caption">影响用户</Typography><Typography className="summary-value">{(dashboard?.affectedUsers ?? 0).toLocaleString()}</Typography></Box>
      </Box>

      <Box className="report-grid">
        <Card>
          <CardContent>
            <Typography variant="h3" sx={{ mb: 2 }}>环境采用率</Typography>
            {dashboard?.environmentDiff.map((item) => (
              <Box key={item.flag} className="report-bar-row">
                <Box className="report-bar-copy">
                  <Typography variant="body2" fontWeight={700}>{item.flag}</Typography>
                  <Typography variant="caption" color="text.secondary">DEV {item.dev}% · STG {item.staging}% · PROD {item.production}%</Typography>
                </Box>
                <Box className="report-bar-track"><Box className="report-bar-fill" sx={{ width: `${Math.max(item.production, item.staging / 2)}%` }} /></Box>
              </Box>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography variant="h3" sx={{ mb: 2 }}>影响问题分布</Typography>
            <Box className="issue-distribution">
              {(['blocker', 'warning', 'info'] as const).map((severity) => {
                const count = issues.filter((issue) => issue.severity === severity && !issue.resolved).length
                return (
                  <Box key={severity}>
                    <Chip color={severity === 'blocker' ? 'error' : severity === 'warning' ? 'warning' : 'default'} size="small" label={severity === 'blocker' ? '阻断' : severity === 'warning' ? '警告' : '提示'} />
                    <Typography className="summary-value">{count}</Typography>
                    <Typography variant="caption" color="text.secondary">未解决</Typography>
                  </Box>
                )
              })}
            </Box>
          </CardContent>
        </Card>
      </Box>

      <Card>
        <CardContent>
          <Typography variant="h3" sx={{ mb: 1.5 }}>发布明细</Typography>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>功能开关</TableCell>
                  <TableCell>环境 / 状态</TableCell>
                  <TableCell>灰度</TableCell>
                  <TableCell>影响规则</TableCell>
                  <TableCell>监控与回滚</TableCell>
                  <TableCell>最后变更</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reportFlags.map((flag) => (
                  <TableRow key={flag.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={700}>{flag.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{flag.key}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={flag.environment.toUpperCase()} />
                      <Box sx={{ mt: 0.5 }}><FlagStatusChip status={flag.status} /></Box>
                    </TableCell>
                    <TableCell>{flag.rolloutPercentage}%</TableCell>
                    <TableCell>{flag.audienceRules.length} 条规则 · {flag.regions.length} 地区</TableCell>
                    <TableCell>{flag.metricNames.length} 指标 · {flag.rollbackConditions.length} 回滚条件</TableCell>
                    <TableCell>
                      <Typography variant="body2">{flag.lastChangedBy}</Typography>
                      <Typography variant="caption" color="text.secondary">{flag.updatedAt.slice(0, 16).replace('T', ' ')}</Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  )
}
