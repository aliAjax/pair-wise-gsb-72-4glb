import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import ToggleOnOutlinedIcon from '@mui/icons-material/ToggleOnOutlined'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined'
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { Link } from 'react-router-dom'
import { useGetDashboardQuery, useGetFlagsQuery, useGetIssuesQuery } from '@/services/flagApi'
import { StatCard } from '@/components/StatCard'
import { FlagStatusChip } from '@/components/FlagStatusChip'

export function DashboardPage() {
  const { data, isLoading } = useGetDashboardQuery()
  const { data: flags } = useGetFlagsQuery({})
  const { data: issues } = useGetIssuesQuery({ resolved: false })

  const pendingFlags = flags?.filter((flag) => flag.status === 'review' || flag.status === 'frozen') ?? []
  const blockerIssues = issues?.filter((issue) => issue.severity === 'blocker') ?? []

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">今日发布态势</Typography>
          <Typography color="text.secondary">
            聚合待评审变更、规则影响和灰度风险，阻断问题必须在扩大流量前处理。
          </Typography>
        </Box>
        <Button component={Link} to="/flags/new" variant="contained" startIcon={<ToggleOnOutlinedIcon />}>
          创建功能开关
        </Button>
      </Box>

      <Box className="stat-grid">
        <StatCard
          label="生产中开关"
          value={data?.activeFlags ?? 0}
          note="覆盖 6 个核心业务域"
          icon={<ToggleOnOutlinedIcon />}
          tone="green"
        />
        <StatCard
          label="待影响评审"
          value={data?.pendingReview ?? 0}
          note="其中 1 项含阻断问题"
          icon={<FactCheckOutlinedIcon />}
          tone="orange"
        />
        <StatCard
          label="阻断级问题"
          value={data?.blockerIssues ?? 0}
          note="规则冲突与监控缺失"
          icon={<WarningAmberOutlinedIcon />}
          tone="red"
        />
        <StatCard
          label="当前影响用户"
          value={(data?.affectedUsers ?? 0).toLocaleString()}
          note="按已发布灰度口径估算"
          icon={<GroupOutlinedIcon />}
          tone="blue"
        />
      </Box>

      {isLoading && <LinearProgress sx={{ mb: 2 }} />}

      {blockerIssues.length > 0 && (
        <Alert
          severity="error"
          action={
            <Button component={Link} to="/review" color="inherit" size="small" endIcon={<ArrowForwardIcon />}>
              进入评审
            </Button>
          }
          sx={{ mb: 2, alignItems: 'center' }}
        >
          有 {blockerIssues.length} 项阻断问题尚未处理：{blockerIssues.map((issue) => issue.title).join('、')}
        </Alert>
      )}

      <Box className="dashboard-grid">
        <Card>
          <CardHeader title="开关采用与回滚趋势" subheader="近七日配置变化" />
          <CardContent>
            <Box className="trend-chart">
              {data?.adoptionTrend.map((point) => (
                <Box key={point.date} className="trend-column">
                  <Box className="trend-bars">
                    <Box className="trend-flags" sx={{ height: `${point.flags * 4}px` }} />
                    <Box className="trend-rollback" sx={{ height: `${Math.max(point.rollbacks * 14, 4)}px` }} />
                  </Box>
                  <Typography variant="caption" fontWeight={700}>
                    {point.flags}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {point.date}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                开关调整
              </Typography>
              <Typography variant="caption" color="text.secondary">
                紧急回滚
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="环境放量差异"
            subheader="同一开关在各环境的流量占比"
            action={
              <Button component={Link} to="/rollout" size="small">
                发布计划
              </Button>
            }
          />
          <CardContent className="environment-list">
            {data?.environmentDiff.map((item) => (
              <Box key={item.flag} className="environment-row">
                <Box className="environment-name">
                  <Typography variant="body2" fontWeight={700}>
                    {item.flag}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    差异 {item.staging - item.production} 个百分点
                  </Typography>
                </Box>
                <Box className="environment-values">
                  <Box>
                    <Typography variant="caption">DEV</Typography>
                    <Typography fontWeight={700}>{item.dev}%</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption">STG</Typography>
                    <Typography fontWeight={700}>{item.staging}%</Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption">PROD</Typography>
                    <Typography fontWeight={700}>{item.production}%</Typography>
                  </Box>
                </Box>
              </Box>
            ))}
          </CardContent>
        </Card>
      </Box>

      <Card>
        <CardHeader
          title="需要关注的发布"
          subheader="待评审或已冻结，优先处理影响范围较大的开关"
          action={
            <Button component={Link} to="/flags" size="small">
              查看全部
            </Button>
          }
        />
        <CardContent className="attention-list">
          {pendingFlags.map((flag) => (
            <Box key={flag.id} className="attention-row">
              <Box className="attention-copy">
                <Typography component={Link} to={`/flags/${flag.id}`} fontWeight={700}>
                  {flag.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {flag.key} · {flag.owner} · {flag.team}
                </Typography>
              </Box>
              <Chip label={`${flag.rolloutPercentage}%`} size="small" variant="outlined" />
              <FlagStatusChip status={flag.status} />
              <Button component={Link} to={`/flags/${flag.id}`} size="small">
                审阅配置
              </Button>
            </Box>
          ))}
        </CardContent>
      </Card>
    </Box>
  )
}
