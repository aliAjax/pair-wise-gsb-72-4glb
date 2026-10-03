import { useState, type ReactNode } from 'react'
import {
  AppBar,
  Avatar,
  Box,
  Breadcrumbs,
  Chip,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import ToggleOnOutlinedIcon from '@mui/icons-material/ToggleOnOutlined'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined'
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'

const drawerWidth = 224

const menuItems = [
  { path: '/', label: '发布概览', icon: <DashboardOutlinedIcon /> },
  { path: '/flags', label: '功能开关', icon: <ToggleOnOutlinedIcon /> },
  { path: '/review', label: '影响评审', icon: <FactCheckOutlinedIcon /> },
  { path: '/dependencies', label: '依赖关系', icon: <AccountTreeOutlinedIcon /> },
  { path: '/rollout', label: '灰度发布', icon: <TimelineOutlinedIcon /> },
  { path: '/audit', label: '审计与回滚', icon: <HistoryOutlinedIcon /> },
  { path: '/reports', label: '发布报告', icon: <AssessmentOutlinedIcon /> },
]

const titleMap: Record<string, string> = {
  '/': '发布概览',
  '/flags': '功能开关工作区',
  '/review': '发布影响评审',
  '/dependencies': '依赖与冲突分析',
  '/rollout': '灰度发布时间线',
  '/audit': '审计与回滚',
  '/reports': '发布报告',
}

const getTitle = (pathname: string) => {
  if (pathname === '/flags/new') return '创建功能开关'
  if (pathname.startsWith('/flags/')) return '功能开关编辑器'
  return titleMap[pathname] ?? '功能开关发布审阅台'
}

export function AppLayout({ children }: { children?: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  const selectedPath =
    menuItems
      .map((item) => item.path)
      .filter((path) => path !== '/' && location.pathname.startsWith(path))
      .sort((a, b) => b.length - a.length)[0] ?? '/'

  const drawer = (
    <Box className="sidebar">
      <Box className="brand">
        <Box className="brand-mark">FF</Box>
        <Box>
          <Typography className="brand-title">功能开关发布审阅台</Typography>
          <Typography className="brand-subtitle">Release Control Console</Typography>
        </Box>
      </Box>
      <Typography className="nav-section">发布工作区</Typography>
      <List disablePadding>
        {menuItems.map((item) => (
          <ListItemButton
            key={item.path}
            selected={selectedPath === item.path}
            onClick={() => {
              navigate(item.path)
              setMobileOpen(false)
            }}
            className="nav-item"
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
      <Box className="sidebar-status">
        <Box className="status-dot" />
        <Box>
          <Typography variant="caption" fontWeight={700}>
            配置服务正常
          </Typography>
          <Typography variant="caption" display="block" color="text.secondary">
            最近同步 09:42
          </Typography>
        </Box>
      </Box>
    </Box>
  )

  return (
    <Box className="app-shell">
      <AppBar
        position="fixed"
        color="inherit"
        className="topbar"
        sx={{ width: { lg: `calc(100% - ${drawerWidth}px)` }, ml: { lg: `${drawerWidth}px` } }}
      >
        <Toolbar className="toolbar">
          <Box>
            <Breadcrumbs sx={{ fontSize: 11 }}>
              <Typography variant="caption" color="text.secondary">
                发布工程
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {getTitle(location.pathname)}
              </Typography>
            </Breadcrumbs>
            <Typography variant="h1">{getTitle(location.pathname)}</Typography>
          </Box>
          <Box className="toolbar-actions">
            <Chip label="生产环境" color="success" variant="outlined" size="small" />
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 13 }}>林</Avatar>
            <Box>
              <Typography variant="caption" fontWeight={700} display="block">
                林默
              </Typography>
              <Typography variant="caption" color="text.secondary">
                发布评审人
              </Typography>
            </Box>
          </Box>
        </Toolbar>
      </AppBar>

      <Drawer
        variant="permanent"
        open
        className="desktop-drawer"
        sx={{
          display: { xs: 'none', lg: 'block' },
          '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' },
        }}
      >
        {drawer}
      </Drawer>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ display: { xs: 'block', lg: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth } }}
      >
        {drawer}
      </Drawer>

      <Box component="main" className="main-content" sx={{ ml: { lg: `${drawerWidth}px` } }}>
        {children ?? <Outlet />}
      </Box>
    </Box>
  )
}
