import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  InputAdornment,
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
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import FilterAltOffOutlinedIcon from '@mui/icons-material/FilterAltOffOutlined'
import { Link, useNavigate } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '@/app/hooks'
import {
  setEnvironmentFilter,
  setKeyword,
  setStatusFilter,
  setTeamFilter,
} from '@/app/uiSlice'
import { useGetFlagsQuery } from '@/services/flagApi'
import { FlagStatusChip } from '@/components/FlagStatusChip'
import type { Environment, FlagStatus } from '@/types'

const teams = ['交易体验', '增长算法', '云控制台', '支付平台', '数据平台', '增长运营', '基础架构']

export function FlagsPage() {
  const dispatch = useAppDispatch()
  const filters = useAppSelector((state) => state.ui.flagFilters)
  const navigate = useNavigate()
  const { data: flags, isLoading } = useGetFlagsQuery(filters)

  const resetFilters = () => {
    dispatch(setKeyword(''))
    dispatch(setStatusFilter(''))
    dispatch(setEnvironmentFilter(''))
    dispatch(setTeamFilter(''))
  }

  return (
    <Box>
      <Box className="page-heading">
        <Box>
          <Typography variant="h2">功能开关工作区</Typography>
          <Typography color="text.secondary">
            维护状态、受众、客户端版本、依赖与回滚条件，再进入影响评审。
          </Typography>
        </Box>
        <Button component={Link} to="/flags/new" variant="contained" startIcon={<AddIcon />}>
          新建开关
        </Button>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box className="filter-grid">
            <TextField
              value={filters.keyword}
              onChange={(event) => dispatch(setKeyword(event.target.value))}
              placeholder="名称、Key 或负责人"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              select
              value={filters.status}
              onChange={(event) => dispatch(setStatusFilter(event.target.value as FlagStatus | ''))}
              label="状态"
            >
              <MenuItem value="">全部状态</MenuItem>
              <MenuItem value="draft">草稿</MenuItem>
              <MenuItem value="review">待评审</MenuItem>
              <MenuItem value="active">已发布</MenuItem>
              <MenuItem value="frozen">已冻结</MenuItem>
              <MenuItem value="rolled-back">已回滚</MenuItem>
            </TextField>
            <TextField
              select
              value={filters.environment}
              onChange={(event) => dispatch(setEnvironmentFilter(event.target.value as Environment | ''))}
              label="环境"
            >
              <MenuItem value="">全部环境</MenuItem>
              <MenuItem value="dev">开发</MenuItem>
              <MenuItem value="staging">预发</MenuItem>
              <MenuItem value="production">生产</MenuItem>
            </TextField>
            <TextField
              select
              value={filters.team}
              onChange={(event) => dispatch(setTeamFilter(event.target.value))}
              label="团队"
            >
              <MenuItem value="">全部团队</MenuItem>
              {teams.map((team) => (
                <MenuItem key={team} value={team}>
                  {team}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.5 }}>
            <Button startIcon={<FilterAltOffOutlinedIcon />} onClick={resetFilters}>
              重置条件
            </Button>
            <Typography variant="caption" color="text.secondary">
              共 {flags?.length ?? 0} 个开关
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>功能开关</TableCell>
                <TableCell>环境 / 状态</TableCell>
                <TableCell>当前放量</TableCell>
                <TableCell>受众条件</TableCell>
                <TableCell>依赖与风险</TableCell>
                <TableCell>负责人</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {flags?.map((flag) => (
                <TableRow key={flag.id} hover>
                  <TableCell>
                    <Typography component={Link} to={`/flags/${flag.id}`} fontWeight={700} variant="body2">
                      {flag.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {flag.key}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack spacing={0.6} alignItems="flex-start">
                      <Chip label={flag.environment.toUpperCase()} size="small" variant="outlined" />
                      <FlagStatusChip status={flag.status} />
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography fontWeight={700}>{flag.rolloutPercentage}%</Typography>
                    <Typography variant="caption" color="text.secondary">
                      最低客户端 {flag.minClientVersion[flag.environment]}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{flag.audienceRules.length} 条规则</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {flag.regions.join('、')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{flag.dependencies.length} 个依赖</Typography>
                    <Typography variant="caption" color={flag.deadCodeStatus === 'confirmed' ? 'error.main' : 'text.secondary'}>
                      死代码：{flag.deadCodeStatus === 'clean' ? '无' : flag.deadCodeStatus === 'candidate' ? '候选' : '已确认'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{flag.owner}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {flag.team}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={() => navigate(`/flags/${flag.id}`)}
                    >
                      编辑
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && flags?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 6 }} color="text.secondary">
                    当前筛选条件下没有功能开关
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  )
}
