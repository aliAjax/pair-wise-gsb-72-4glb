import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#165dff', dark: '#0e42d2', light: '#e8f3ff' },
    secondary: { main: '#00a870' },
    warning: { main: '#ff7d00' },
    error: { main: '#d92d20' },
    background: { default: '#f2f3f5', paper: '#ffffff' },
    text: { primary: '#1d2129', secondary: '#6b7785' },
    divider: '#e5e6eb',
  },
  shape: { borderRadius: 7 },
  typography: {
    fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
    h1: { fontSize: 22, fontWeight: 700, letterSpacing: 0 },
    h2: { fontSize: 18, fontWeight: 700, letterSpacing: 0 },
    h3: { fontSize: 15, fontWeight: 700, letterSpacing: 0 },
    body1: { fontSize: 13 },
    body2: { fontSize: 12 },
    button: { textTransform: 'none', fontSize: 13, fontWeight: 600 },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: 'none',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: '1px solid #e5e6eb',
          boxShadow: 'none',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
    MuiTextField: {
      defaultProps: { size: 'small' },
    },
    MuiSelect: {
      defaultProps: { size: 'small' },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { fontSize: 12 },
        head: { background: '#f7f8fa', color: '#4e5969', fontWeight: 700 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 4, fontWeight: 600 },
      },
    },
  },
})
