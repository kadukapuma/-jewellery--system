import { createTheme } from '@mui/material/styles';

export const gold = {
  900: '#4A3810',
  800: '#6B5218',
  700: '#8B6B1F',
  600: '#A8842E',
  500: '#C29B45',
  300: '#E3CC94',
  200: '#EFE2BF',
  100: '#F6EEDA',
  50: '#FBF7EE',
};
export const ink = '#1E1A14';
export const stone = { 600: '#6F685C', 400: '#8A8274', 200: '#E6E0D4', 100: '#F1EDE4', 50: '#F6F4EF' };

const theme = createTheme({
  palette: {
    primary: { main: gold[700], dark: gold[800], light: gold[500], contrastText: '#fff' },
    secondary: { main: ink, contrastText: '#fff' },
    background: { default: '#fff', paper: '#fff' },
    text: { primary: ink, secondary: stone[600] },
    divider: stone[100],
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: '"Plus Jakarta Sans", "Segoe UI", Roboto, sans-serif',
    h1: { fontWeight: 600 },
    h2: { fontWeight: 600 },
    h3: { fontWeight: 600 },
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 999, paddingInline: 20 },
        sizeLarge: { paddingBlock: 12 },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { borderRadius: 28, border: `1px solid ${stone[100]}` } },
    },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 28 } } },
    MuiDialogTitle: { styleOverrides: { root: { fontWeight: 600, fontSize: 20, paddingTop: 24 } } },
    MuiMenu: {
      styleOverrides: { paper: { borderRadius: 16, boxShadow: '0 12px 32px rgba(30,26,20,.12)', marginTop: 6 } },
    },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 14, backgroundColor: '#fff' },
        notchedOutline: { borderColor: stone[200] },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${stone[100]}`, paddingTop: 12, paddingBottom: 12 },
        head: { color: stone[400], fontWeight: 500, fontSize: 12.5, borderBottom: 'none' },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 500, borderRadius: 999 } } },
    // Tabs look like the pill filter buttons ("All", "Sales Overview" …).
    MuiTabs: {
      styleOverrides: { root: { minHeight: 40 }, indicator: { display: 'none' }, flexContainer: { gap: 8 } },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          minHeight: 40,
          borderRadius: 999,
          border: `1px solid ${stone[200]}`,
          paddingInline: 20,
          color: ink,
          '&.Mui-selected': { backgroundColor: ink, color: '#fff', borderColor: ink },
        },
      },
    },
    MuiToggleButton: { styleOverrides: { root: { textTransform: 'none' } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 14 } } },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 4 } } },
  },
});

export default theme;
