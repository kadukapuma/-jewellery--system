import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Avatar, Box, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip,
  Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import DiamondIcon from '@mui/icons-material/DiamondOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import PeopleIcon from '@mui/icons-material/PeopleAltOutlined';
import ShieldIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import HistoryIcon from '@mui/icons-material/HistoryOutlined';
import PriceIcon from '@mui/icons-material/SellOutlined';
import KaratIcon from '@mui/icons-material/WorkspacePremiumOutlined';
import ItemsIcon from '@mui/icons-material/Inventory2Outlined';
import CategoryIcon from '@mui/icons-material/CategoryOutlined';
import TagIcon from '@mui/icons-material/LocalOfferOutlined';
import PurchaseIcon from '@mui/icons-material/ShoppingBagOutlined';
import SupplierIcon from '@mui/icons-material/LocalShippingOutlined';
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined';
import CraftIcon from '@mui/icons-material/HandymanOutlined';
import CraftsmanIcon from '@mui/icons-material/EngineeringOutlined';
import PosIcon from '@mui/icons-material/PointOfSaleOutlined';
import BillIcon from '@mui/icons-material/ReceiptLongOutlined';
import CustomerIcon from '@mui/icons-material/GroupOutlined';
import ReceiptIcon from '@mui/icons-material/RequestQuoteOutlined';
import ReportIcon from '@mui/icons-material/AssessmentOutlined';
import { useAuth } from '../auth/AuthContext';
import { gold, ink, stone } from '../theme';

const SIDEBAR_WIDTH = 260;

// Side navigation. New modules add their section / links here.
const NAV = [
  { items: [{ label: 'Overview', path: '/', icon: <DashboardIcon /> }] },
  {
    section: 'Sales',
    items: [
      { label: 'New Sale', path: '/pos', icon: <PosIcon />, perm: 'sales.create' },
      { label: 'Bills', path: '/sales', icon: <BillIcon />, perm: 'sales.view' },
      { label: 'Customers', path: '/customers', icon: <CustomerIcon />, perm: 'customers.view' },
      { label: 'Receipts', path: '/customer-payments', icon: <ReceiptIcon />, perm: 'customer_payments.view' },
      { label: 'Reports', path: '/reports', icon: <ReportIcon />, perm: ['reports.sales', 'reports.profit', 'reports.stock', 'reports.wastage', 'reports.customer_balances', 'reports.supplier_balances', 'reports.craftsman_balances'] },
    ],
  },
  {
    section: 'Pricing',
    items: [
      { label: 'Gold Prices', path: '/gold-prices', icon: <PriceIcon />, perm: 'gold_prices.view' },
      { label: 'Karats', path: '/karats', icon: <KaratIcon />, perm: 'karats.view' },
    ],
  },
  {
    section: 'Stock',
    items: [
      { label: 'Items', path: '/items', icon: <ItemsIcon />, perm: 'items.view' },
      { label: 'Categories', path: '/categories', icon: <CategoryIcon />, perm: 'categories.view' },
      { label: 'Tag Templates', path: '/tag-templates', icon: <TagIcon />, perm: 'tag_templates.edit' },
    ],
  },
  {
    section: 'Purchasing',
    items: [
      { label: 'Purchases', path: '/purchases', icon: <PurchaseIcon />, perm: 'purchases.view' },
      { label: 'Suppliers', path: '/suppliers', icon: <SupplierIcon />, perm: 'suppliers.view' },
      { label: 'Supplier Payments', path: '/supplier-payments', icon: <PaymentsIcon />, perm: 'supplier_payments.view' },
    ],
  },
  {
    section: 'Workshop',
    items: [
      { label: 'Craft Jobs', path: '/craft-jobs', icon: <CraftIcon />, perm: 'craft_jobs.view' },
      { label: 'Craftsmen', path: '/craftsmen', icon: <CraftsmanIcon />, perm: 'craftsmen.view' },
    ],
  },
  {
    section: 'Administration',
    items: [
      { label: 'Users', path: '/users', icon: <PeopleIcon />, perm: 'users.view' },
      { label: 'Roles & Permissions', path: '/roles', icon: <ShieldIcon />, perm: 'roles.view' },
      { label: 'Activity Log', path: '/activity', icon: <HistoryIcon />, perm: 'audit_logs.view' },
      { label: 'Settings', path: '/settings', icon: <SettingsIcon />, perm: 'settings.edit' },
    ],
  },
];

function Logo() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ width: 36, height: 36, borderRadius: '50%', bgcolor: gold[700], color: '#fff', display: 'grid', placeItems: 'center' }}>
        <DiamondIcon fontSize="small" />
      </Box>
      <Typography sx={{ fontWeight: 700, fontSize: 20, letterSpacing: -0.5 }}>jewellery</Typography>
    </Box>
  );
}

const SIDEBAR_KEY = 'sidebarOpen';

function readSidebarPref() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== 'false';
  } catch {
    return true;
  }
}

function saveSidebarPref(open) {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(open));
  } catch {
    // preference just won't be remembered
  }
}

function SideNav({ onNavigate, onHide }) {
  const { can } = useAuth();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ px: 3, py: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Logo />
        <Tooltip title="Hide menu">
          <IconButton aria-label="Hide menu" size="small" onClick={onHide} sx={{ border: `1px solid ${stone[200]}` }}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ flexGrow: 1, overflowY: 'auto', px: 2 }}>
        {NAV.map((group, i) => {
          const items = group.items.filter((item) => !item.perm || can(...[].concat(item.perm)));
          if (!items.length) return null;
          return (
            <Box key={i} sx={{ mb: 2 }}>
              {group.section && (
                <Typography sx={{ px: 1.5, mb: 1, fontSize: 12, fontWeight: 600, color: stone[400], textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {group.section}
                </Typography>
              )}
              <List disablePadding sx={{ display: 'grid', gap: 0.5 }}>
                {items.map((item) => (
                  <ListItemButton
                    key={item.path}
                    component={NavLink}
                    to={item.path}
                    end={item.path === '/'}
                    onClick={onNavigate}
                    sx={{
                      borderRadius: 999,
                      py: 1.1,
                      color: ink,
                      '& .MuiListItemIcon-root': { color: stone[600] },
                      '&:hover': { bgcolor: stone[50] },
                      '&.active': {
                        bgcolor: gold[700],
                        color: '#fff',
                        '& .MuiListItemIcon-root': { color: '#fff' },
                        '&:hover': { bgcolor: gold[800] },
                      },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 38 }}>{item.icon}</ListItemIcon>
                    <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontWeight: 600, fontSize: 14 } } }} />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(readSidebarPref);
  const [menuAnchor, setMenuAnchor] = useState(null);

  const sidebarOpen = isDesktop ? desktopOpen : mobileOpen;
  const setSidebarOpen = (open) => {
    if (isDesktop) {
      setDesktopOpen(open);
      saveSidebarPref(open);
    } else {
      setMobileOpen(open);
    }
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#fff' }}>
      <Drawer
        variant={isDesktop ? 'persistent' : 'temporary'}
        open={sidebarOpen}
        onClose={() => setMobileOpen(false)}
        sx={{
          width: isDesktop && desktopOpen ? SIDEBAR_WIDTH : 0,
          flexShrink: 0,
          transition: theme.transitions.create('width'),
          '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, boxSizing: 'border-box', borderRight: `1px solid ${stone[100]}` },
        }}
      >
        <SideNav onNavigate={() => setMobileOpen(false)} onHide={() => setSidebarOpen(false)} />
      </Drawer>

      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box component="header" sx={{ display: 'flex', alignItems: 'center', gap: 2, px: { xs: 2, md: 5 }, pt: { xs: 2, md: 3 }, mb: { xs: 2, md: 3 } }}>
          {!sidebarOpen && (
            <>
              <Tooltip title="Show menu">
                <IconButton aria-label="Show menu" onClick={() => setSidebarOpen(true)} sx={{ border: `1px solid ${stone[200]}` }}>
                  <MenuIcon />
                </IconButton>
              </Tooltip>
              <Logo />
            </>
          )}
          <Box sx={{ flexGrow: 1 }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 0.5, pr: { xs: 0.5, sm: 0.75 }, bgcolor: stone[50], borderRadius: 999 }}>
            <Avatar sx={{ bgcolor: gold[200], color: gold[800], width: 40, height: 40, fontWeight: 700 }}>{user.name[0]}</Avatar>
            <Box sx={{ display: { xs: 'none', sm: 'block' }, lineHeight: 1.2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{user.name}</Typography>
              <Typography variant="caption" color="text.secondary">{user.role_name}</Typography>
            </Box>
            <IconButton aria-label="Account menu" onClick={(e) => setMenuAnchor(e.currentTarget)} sx={{ bgcolor: '#fff', border: `1px solid ${stone[200]}` }}>
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Box>
          <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
            <MenuItem onClick={() => { setMenuAnchor(null); navigate('/change-password'); }}>Change password</MenuItem>
            <MenuItem onClick={() => { setMenuAnchor(null); logout(); }}>Log out</MenuItem>
          </Menu>
        </Box>

        <Box component="main" sx={{ px: { xs: 2, md: 5 }, pb: { xs: 2, md: 4 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
