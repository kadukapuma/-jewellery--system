import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Avatar, Box, Button, Collapse, Drawer, IconButton, Menu, MenuItem,
  Popover, Tooltip, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AureonLogo from './AureonLogo';
import Footer from './Footer';

// Icons
import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
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
import FinanceIcon from '@mui/icons-material/AccountBalanceOutlined';
import MasterIcon from '@mui/icons-material/FolderSharedOutlined';
import DayEndIcon from '@mui/icons-material/EventAvailableOutlined';

import { useAuth } from '../auth/AuthContext';
import { gold, stone } from '../theme';

// Helper to render icon whether passed as a component or element
function renderNavIcon(IconComp, props = {}) {
  if (!IconComp) return null;
  if (typeof IconComp === 'function' || (typeof IconComp === 'object' && IconComp.$$typeof && !IconComp.props)) {
    const Component = IconComp;
    return <Component {...props} />;
  }
  return IconComp;
}

// Helper to determine if a route is active (exact or subpath)
const isRouteActive = (childPath, currentPath) => {
  if (childPath === '/') return currentPath === '/';
  return currentPath === childPath || currentPath.startsWith(childPath + '/');
};

// Navigation structure matching jewellery system capabilities and modern sidebar design
const NAV_CATEGORIES = [
  {
    title: 'MAIN',
    items: [
      {
        label: 'Overview',
        path: '/',
        icon: DashboardIcon,
      },
      {
        label: 'Gold Prices',
        path: '/gold-prices',
        icon: PriceIcon,
        perm: 'gold_prices.view',
      },
      {
        label: 'Sales',
        icon: PosIcon,
        children: [
          { label: 'New Sale', path: '/pos', perm: 'sales.create' },
          { label: 'Bills', path: '/sales', perm: 'sales.view' },
          { label: 'Receipts', path: '/customer-payments', perm: 'customer_payments.view' },
          { label: 'Old Gold', path: '/old-gold', perm: 'old_gold.view' },
        ],
      },
      {
        label: 'Day End',
        path: '/day-end',
        icon: DayEndIcon,
        perm: 'day_end.view',
      },
    ],
  },
  {
    title: 'MASTER DATA',
    items: [
      {
        label: 'Master Forms',
        icon: MasterIcon,
        children: [
          { label: 'Customers', path: '/customers', perm: 'customers.view' },
          { label: 'Salesmen', path: '/salesmen', perm: 'salesmen.view' },
          { label: 'Suppliers', path: '/suppliers', perm: 'suppliers.view' },
          { label: 'Item Categories', path: '/categories', perm: 'categories.view' },
          { label: 'Karats', path: '/karats', perm: 'karats.view' },
          { label: 'Craftsmen', path: '/craftsmen', perm: 'craftsmen.view' },
          { label: 'Tag Templates', path: '/tag-templates', perm: 'tag_templates.edit' },
        ],
      },
    ],
  },
  {
    title: 'INVENTORY',
    items: [
      {
        label: 'Stock',
        icon: ItemsIcon,
        children: [
          { label: 'Items', path: '/items', perm: 'items.view' },
          { label: 'Stock History', path: '/stock-history', perm: 'items.view' },
        ],
      },
    ],
  },
  {
    title: 'WORKSHOP & PURCHASES',
    items: [
      {
        label: 'Purchasing',
        icon: PurchaseIcon,
        children: [
          { label: 'Purchases', path: '/purchases', perm: 'purchases.view' },
          { label: 'Supplier Payments', path: '/supplier-payments', perm: 'supplier_payments.view' },
        ],
      },
      {
        label: 'Workshop',
        icon: CraftIcon,
        children: [
          { label: 'Craft Jobs', path: '/craft-jobs', perm: 'craft_jobs.view' },
          { label: 'Customer Repairs', path: '/repairs', perm: 'repairs.view' },
        ],
      },
    ],
  },
  {
    title: 'FINANCE',
    items: [
      {
        label: 'Finance',
        icon: FinanceIcon,
        children: [
          { label: 'Overview', path: '/finance', perm: 'finance.view' },
          { label: 'Expenses', path: '/expenses', perm: 'expenses.view' },
          { label: 'Cash & Bank', path: '/cash-bank', perm: 'finance.view' },
          { label: 'Bank Accounts', path: '/bank-accounts', perm: 'bank_accounts.view' },
        ],
      },
    ],
  },
  {
    title: 'SYSTEM',
    items: [
      {
        label: 'Reports',
        path: '/reports',
        icon: ReportIcon,
        perm: [
          'reports.sales',
          'reports.profit',
          'reports.stock',
          'reports.wastage',
          'reports.customer_balances',
          'reports.supplier_balances',
          'reports.craftsman_balances',
        ],
      },
      {
        label: 'Administration',
        icon: ShieldIcon,
        children: [
          { label: 'Users', path: '/users', perm: 'users.view' },
          { label: 'Roles & Permissions', path: '/roles', perm: 'roles.view' },
          { label: 'Activity Log', path: '/activity', perm: 'audit_logs.view' },
          { label: 'Settings', path: '/settings', adminOnly: true },
          { label: 'Danger Zone', path: '/danger-zone', adminOnly: true },
          { label: 'My Requests', path: '/my-requests' },
        ],
      },
    ],
  },
];

const COLLAPSED_STORAGE_KEY = 'jewellery_sidebar_collapsed';

function readCollapsedPref() {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveCollapsedPref(val) {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, String(val));
  } catch {
    // ignore
  }
}

// User Profile widget at top of sidebar
function SidebarUserProfile({ user, collapsed }) {
  const initial = user?.name ? user.name[0].toUpperCase() : 'A';
  const role = user?.role_name || 'PRODUCT DESIGNER';
  const name = user?.name || 'Andrew Smith';

  if (collapsed) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 2.5, pb: 2 }}>
        <Tooltip title={`${name} • ${role}`} placement="right" arrow>
          <Avatar
            sx={{
              width: 38,
              height: 38,
              bgcolor: '#342926',
              color: '#FFB23F',
              fontWeight: 700,
              fontSize: 14,
              border: '1.5px solid rgba(255, 255, 255, 0.12)',
              cursor: 'pointer',
            }}
          >
            {initial}
          </Avatar>
        </Tooltip>
      </Box>
    );
  }

  return (
    <Box sx={{ px: 2.5, pt: 2.5, pb: 2.2, display: 'flex', alignItems: 'center', gap: 1.4 }}>
      <Avatar
        sx={{
          width: 38,
          height: 38,
          bgcolor: '#342926',
          color: '#FFB23F',
          fontWeight: 700,
          fontSize: 14,
          border: '1.5px solid rgba(255, 255, 255, 0.12)',
        }}
      >
        {initial}
      </Avatar>
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
        <Typography
          sx={{
            fontSize: 9.5,
            fontWeight: 700,
            color: '#8D8178',
            textTransform: 'uppercase',
            letterSpacing: 0.9,
            lineHeight: 1.2,
          }}
          noWrap
        >
          {role}
        </Typography>
        <Typography
          sx={{
            fontSize: 13.5,
            fontWeight: 600,
            color: '#FFFFFF',
            lineHeight: 1.35,
          }}
          noWrap
        >
          {name}
        </Typography>
      </Box>
    </Box>
  );
}

// Full custom modern dark sidebar component
function ModernSidebar({
  collapsed,
  onToggleCollapse,
  isMobile,
  onNavigate,
}) {
  const { user, can } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const canCreateSale = can('sales.create');

  // Accordion state for expanded groups
  const [openGroups, setOpenGroups] = useState(() => {
    const map = {};
    NAV_CATEGORIES.forEach((cat) => {
      cat.items.forEach((item) => {
        if (item.children) {
          const hasActive = item.children.some((child) => isRouteActive(child.path, location.pathname));
          if (hasActive) map[item.label] = true;
        }
      });
    });
    // Default Sales to open if none active
    if (Object.keys(map).length === 0) {
      map['Sales'] = true;
    }
    return map;
  });

  // Keep group open if current route is inside it
  useEffect(() => {
    NAV_CATEGORIES.forEach((cat) => {
      cat.items.forEach((item) => {
        if (item.children) {
          const hasActive = item.children.some((child) => isRouteActive(child.path, location.pathname));
          if (hasActive) {
            setOpenGroups((prev) => ({ ...prev, [item.label]: true }));
          }
        }
      });
    });
  }, [location.pathname]);

  const toggleGroup = (label) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  // Popover state for flyout menu in collapsed mode
  const [flyoutAnchor, setFlyoutAnchor] = useState(null);
  const [flyoutGroup, setFlyoutGroup] = useState(null);

  const handleOpenFlyout = (event, item) => {
    setFlyoutAnchor(event.currentTarget);
    setFlyoutGroup(item);
  };

  const handleCloseFlyout = () => {
    setFlyoutAnchor(null);
    setFlyoutGroup(null);
  };

  // Filter items by user permission
  const checkPerm = (item) => {
    if (item.adminOnly) return !!user?.is_super_admin;
    if (!item.perm) return true;
    return can(...[].concat(item.perm));
  };

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        color: '#FFFFFF',
      }}
    >
      {/* Collapse / Expand Toggle Button on right border */}
      {!isMobile && (
        <IconButton
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          size="small"
          sx={{
            position: 'absolute',
            right: -11,
            top: 28,
            zIndex: 30,
            width: 22,
            height: 22,
            p: 0,
            bgcolor: '#231B19',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            color: '#B2A79F',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            transition: 'all 0.2s ease',
            '&:hover': {
              bgcolor: '#322724',
              color: '#FFFFFF',
              borderColor: 'rgba(255, 255, 255, 0.3)',
            },
          }}
        >
          {collapsed ? (
            <ChevronRightRoundedIcon sx={{ fontSize: 15 }} />
          ) : (
            <ChevronLeftRoundedIcon sx={{ fontSize: 15 }} />
          )}
        </IconButton>
      )}

      {/* Profile Header */}
      <SidebarUserProfile user={user} collapsed={collapsed} />

      {/* Scrollable Navigation Items */}
      <Box
        sx={{
          flexGrow: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          px: collapsed ? 1.2 : 2,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {NAV_CATEGORIES.map((cat, catIdx) => {
          // Filter category items
          const visibleItems = cat.items
            .map((item) => {
              if (item.children) {
                const permittedChildren = item.children.filter(checkPerm);
                if (permittedChildren.length === 0) return null;
                return { ...item, children: permittedChildren };
              }
              return checkPerm(item) ? item : null;
            })
            .filter(Boolean);

          if (visibleItems.length === 0) return null;

          return (
            <Box key={catIdx} sx={{ mb: collapsed ? 1.5 : 2.2 }}>
              {/* Category Header */}
              {collapsed ? (
                <Box
                  sx={{
                    width: 20,
                    height: '1.5px',
                    bgcolor: 'rgba(255, 255, 255, 0.08)',
                    mx: 'auto',
                    my: 1.2,
                    borderRadius: 1,
                  }}
                />
              ) : (
                <Typography
                  sx={{
                    px: 1.2,
                    mb: 0.8,
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#655A53',
                    textTransform: 'uppercase',
                    letterSpacing: 1.2,
                  }}
                >
                  {cat.title}
                </Typography>
              )}

              {/* Items List */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
                {visibleItems.map((item) => {
                  const hasChildren = item.children && item.children.length > 0;
                  const hasActiveChild =
                    hasChildren && item.children.some((c) => isRouteActive(c.path, location.pathname));
                  const isSingleActive = !hasChildren && isRouteActive(item.path, location.pathname);
                  const isOpen = Boolean(openGroups[item.label]);

                  // --- COLLAPSED VIEW ITEM ---
                  if (collapsed) {
                    if (hasChildren) {
                      return (
                        <Box key={item.label} sx={{ display: 'flex', justifyContent: 'center' }}>
                          <Tooltip title={item.label} placement="right" arrow>
                            <IconButton
                              onClick={(e) => handleOpenFlyout(e, item)}
                              sx={{
                                width: 42,
                                height: 42,
                                borderRadius: '13px',
                                color: hasActiveChild ? '#FFA726' : '#9E938B',
                                bgcolor: hasActiveChild ? '#2B211E' : 'transparent',
                                border: '1px solid',
                                borderColor: hasActiveChild ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                                boxShadow: hasActiveChild ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
                                '&:hover': {
                                  bgcolor: 'rgba(255, 255, 255, 0.06)',
                                  color: '#FFFFFF',
                                },
                              }}
                            >
                              {renderNavIcon(item.icon)}
                            </IconButton>
                          </Tooltip>
                        </Box>
                      );
                    }

                    // Single item in collapsed mode
                    return (
                      <Box key={item.path} sx={{ display: 'flex', justifyContent: 'center' }}>
                        <Tooltip title={item.label} placement="right" arrow>
                          <IconButton
                            component={NavLink}
                            to={item.path}
                            end={item.path === '/'}
                            onClick={onNavigate}
                            sx={{
                              width: 42,
                              height: 42,
                              borderRadius: '13px',
                              color: isSingleActive ? '#FFA726' : '#9E938B',
                              bgcolor: isSingleActive ? '#2B211E' : 'transparent',
                              border: '1px solid',
                              borderColor: isSingleActive ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                              boxShadow: isSingleActive ? '0 2px 8px rgba(0,0,0,0.3)' : 'none',
                              '&:hover': {
                                bgcolor: 'rgba(255, 255, 255, 0.06)',
                                color: '#FFFFFF',
                              },
                            }}
                          >
                            {renderNavIcon(item.icon)}
                          </IconButton>
                        </Tooltip>
                      </Box>
                    );
                  }

                  // --- EXPANDED VIEW ITEM ---
                  if (hasChildren) {
                    return (
                      <Box key={item.label}>
                        {/* Parent Group Header */}
                        <Box
                          onClick={() => toggleGroup(item.label)}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            px: 1.2,
                            py: 0.8,
                            borderRadius: '13px',
                            cursor: 'pointer',
                            userSelect: 'none',
                            bgcolor: isOpen || hasActiveChild ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                            border: '1px solid',
                            borderColor: isOpen || hasActiveChild ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
                            transition: 'all 0.15s ease',
                            '&:hover': {
                              bgcolor: 'rgba(255, 255, 255, 0.06)',
                            },
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, minWidth: 0 }}>
                            <Box
                              sx={{
                                width: 30,
                                height: 30,
                                borderRadius: '8px',
                                bgcolor: isOpen || hasActiveChild ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)',
                                display: 'grid',
                                placeItems: 'center',
                                color: isOpen || hasActiveChild ? '#FFFFFF' : '#9E938B',
                                '& .MuiSvgIcon-root': { fontSize: 18 },
                              }}
                            >
                              {renderNavIcon(item.icon)}
                            </Box>
                            <Typography
                              sx={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: isOpen || hasActiveChild ? '#FFFFFF' : '#CCC4BD',
                              }}
                              noWrap
                            >
                              {item.label}
                            </Typography>
                          </Box>
                          <KeyboardArrowDownRoundedIcon
                            sx={{
                              fontSize: 18,
                              color: '#7B7068',
                              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                              transition: 'transform 0.2s ease',
                            }}
                          />
                        </Box>

                        {/* Tree Branch Submenu */}
                        <Collapse in={isOpen} timeout="auto" unmountOnExit>
                          <Box sx={{ pl: '14px', position: 'relative', pt: 0.4, pb: 0.2 }}>
                            {item.children.map((child, cIdx) => {
                              const isLast = cIdx === item.children.length - 1;
                              const isActive = isRouteActive(child.path, location.pathname);

                              return (
                                <Box
                                  key={child.path}
                                  sx={{
                                    position: 'relative',
                                    display: 'flex',
                                    alignItems: 'center',
                                    py: 0.35,
                                    pl: '26px',
                                  }}
                                >
                                  {/* Vertical Trunk Line */}
                                  <Box
                                    sx={{
                                      position: 'absolute',
                                      left: 14,
                                      top: 0,
                                      bottom: isLast ? '50%' : 0,
                                      width: '1.5px',
                                      bgcolor: '#382D2A',
                                    }}
                                  />
                                  {/* Horizontal Branch Line */}
                                  <Box
                                    sx={{
                                      position: 'absolute',
                                      left: 14,
                                      top: '50%',
                                      width: 12,
                                      height: '1.5px',
                                      bgcolor: '#382D2A',
                                    }}
                                  />
                                  {/* Sub-item Pill */}
                                  <Box
                                    component={NavLink}
                                    to={child.path}
                                    onClick={onNavigate}
                                    sx={{
                                      flexGrow: 1,
                                      py: 0.65,
                                      px: 1.5,
                                      borderRadius: '10px',
                                      textDecoration: 'none',
                                      fontSize: 12.5,
                                      fontWeight: isActive ? 600 : 500,
                                      color: isActive ? '#FFFFFF' : '#9E938B',
                                      bgcolor: isActive ? '#342A27' : 'transparent',
                                      boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.25)' : 'none',
                                      border: '1px solid',
                                      borderColor: isActive ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                                      transition: 'all 0.15s ease',
                                      '&:hover': {
                                        color: '#FFFFFF',
                                        bgcolor: isActive ? '#382D2A' : 'rgba(255, 255, 255, 0.04)',
                                      },
                                    }}
                                  >
                                    {child.label}
                                  </Box>
                                </Box>
                              );
                            })}
                          </Box>
                        </Collapse>
                      </Box>
                    );
                  }

                  // Single item in expanded mode
                  return (
                    <Box
                      key={item.path}
                      component={NavLink}
                      to={item.path}
                      end={item.path === '/'}
                      onClick={onNavigate}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.2,
                        px: 1.2,
                        py: 0.8,
                        borderRadius: '13px',
                        textDecoration: 'none',
                        userSelect: 'none',
                        color: '#CCC4BD',
                        transition: 'all 0.15s ease',
                        '&:hover': {
                          bgcolor: 'rgba(255, 255, 255, 0.06)',
                          color: '#FFFFFF',
                        },
                        '&.active': {
                          bgcolor: '#342A27',
                          color: '#FFFFFF',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                          border: '1px solid rgba(255, 255, 255, 0.05)',
                          '& .item-icon': {
                            color: '#FFA726',
                            bgcolor: 'rgba(255, 255, 255, 0.08)',
                          },
                        },
                      }}
                    >
                      <Box
                        className="item-icon"
                        sx={{
                          width: 30,
                          height: 30,
                          borderRadius: '8px',
                          bgcolor: 'rgba(255, 255, 255, 0.04)',
                          display: 'grid',
                          placeItems: 'center',
                          color: '#9E938B',
                          '& .MuiSvgIcon-root': { fontSize: 18 },
                        }}
                      >
                        {renderNavIcon(item.icon)}
                      </Box>
                      <Typography sx={{ fontSize: 13, fontWeight: 600 }} noWrap>
                        {item.label}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Popover Flyout for Collapsed Mode (as in screenshot on right) */}
      <Popover
        open={Boolean(flyoutAnchor)}
        anchorEl={flyoutAnchor}
        onClose={handleCloseFlyout}
        anchorOrigin={{ vertical: 'center', horizontal: 'right' }}
        transformOrigin={{ vertical: 'center', horizontal: 'left' }}
        slotProps={{
          paper: {
            sx: {
              ml: 1.5,
              bgcolor: '#231B19',
              backgroundImage: 'none',
              color: '#FFFFFF',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              boxShadow: '0 16px 36px rgba(0, 0, 0, 0.55)',
              p: 1.5,
              minWidth: 175,
            },
          },
        }}
      >
        {flyoutGroup && (
          <Box>
            <Typography
              sx={{
                px: 1,
                mb: 1,
                fontSize: 10.5,
                fontWeight: 700,
                color: '#7D7068',
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              {flyoutGroup.label}
            </Typography>
            <Box sx={{ pl: '12px', position: 'relative' }}>
              {flyoutGroup.children?.map((child, idx) => {
                const isLast = idx === flyoutGroup.children.length - 1;
                const isActive = isRouteActive(child.path, location.pathname);
                return (
                  <Box
                    key={child.path}
                    sx={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      py: 0.35,
                      pl: '24px',
                    }}
                  >
                    <Box
                      sx={{
                        position: 'absolute',
                        left: 12,
                        top: 0,
                        bottom: isLast ? '50%' : 0,
                        width: '1.5px',
                        bgcolor: '#3E322F',
                      }}
                    />
                    <Box
                      sx={{
                        position: 'absolute',
                        left: 12,
                        top: '50%',
                        width: 12,
                        height: '1.5px',
                        bgcolor: '#3E322F',
                      }}
                    />
                    <Box
                      component={NavLink}
                      to={child.path}
                      onClick={() => {
                        handleCloseFlyout();
                        onNavigate?.();
                      }}
                      sx={{
                        flexGrow: 1,
                        py: 0.65,
                        px: 1.5,
                        borderRadius: '10px',
                        textDecoration: 'none',
                        fontSize: 12.5,
                        fontWeight: isActive ? 600 : 500,
                        color: isActive ? '#FFFFFF' : '#A49991',
                        bgcolor: isActive ? '#382D2A' : 'transparent',
                        boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.25)' : 'none',
                        border: '1px solid',
                        borderColor: isActive ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s ease',
                        '&:hover': {
                          color: '#FFFFFF',
                          bgcolor: isActive ? '#3E322F' : 'rgba(255, 255, 255, 0.05)',
                        },
                      }}
                    >
                      {child.label}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}
      </Popover>

      {/* Bottom Action Card (Matching "Let's start! / Add New Task" card in design) */}
      {canCreateSale && (
        collapsed ? (
          <Box
            sx={{
              mt: 'auto',
              display: 'flex',
              justifyContent: 'center',
              pt: 1.5,
              pb: 2,
            }}
          >
            <Tooltip title="Add New Sale (POS)" placement="right" arrow>
              <IconButton
                onClick={() => {
                  navigate('/pos');
                  onNavigate?.();
                }}
                sx={{
                  width: 42,
                  height: 42,
                  borderRadius: '13px',
                  bgcolor: '#E67E22',
                  color: '#FFFFFF',
                  boxShadow: '0 4px 14px rgba(230, 126, 34, 0.35)',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    bgcolor: '#F38C30',
                    transform: 'scale(1.05)',
                  },
                }}
              >
                <AddRoundedIcon sx={{ fontSize: 22 }} />
              </IconButton>
            </Tooltip>
          </Box>
        ) : (
          <Box sx={{ mt: 'auto', p: 1.5, pt: 1 }}>
            <Button
              fullWidth
              variant="contained"
              startIcon={<AddRoundedIcon sx={{ fontSize: 18 }} />}
              onClick={() => {
                navigate('/pos');
                onNavigate?.();
              }}
              sx={{
                bgcolor: '#E67E22',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: 12.5,
                borderRadius: 999,
                py: 0.85,
                textTransform: 'none',
                boxShadow: '0 4px 14px rgba(230, 126, 34, 0.35)',
                '&:hover': {
                  bgcolor: '#F38C30',
                  boxShadow: '0 6px 18px rgba(230, 126, 34, 0.45)',
                },
              }}
            >
              Add New Sale
            </Button>
          </Box>
        )
      )}
    </Box>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

  // Mobile drawer open state
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop collapsed mode state (persisted)
  const [desktopCollapsed, setDesktopCollapsed] = useState(readCollapsedPref);
  const [menuAnchor, setMenuAnchor] = useState(null);

  const toggleDesktopCollapse = () => {
    setDesktopCollapsed((prev) => {
      const next = !prev;
      saveCollapsedPref(next);
      return next;
    });
  };

  const currentSidebarWidth = desktopCollapsed ? 76 : 260;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: '#FFFFFF' }}>
      {/* --- DESKTOP FLOATING SIDEBAR --- */}
      {isDesktop && (
        <Box
          sx={{
            width: currentSidebarWidth,
            flexShrink: 0,
            m: 1.5,
            mr: 2,
            transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <Box
            sx={{
              width: currentSidebarWidth,
              height: 'calc(100vh - 24px)',
              position: 'sticky',
              top: 12,
              bgcolor: '#181311',
              borderRadius: '28px',
              boxShadow:
                '0 20px 45px -10px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.06)',
              overflow: 'visible',
              transition: 'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <ModernSidebar
              collapsed={desktopCollapsed}
              onToggleCollapse={toggleDesktopCollapse}
              isMobile={false}
            />
          </Box>
        </Box>
      )}

      {/* --- MOBILE TEMPORARY DRAWER --- */}
      {!isDesktop && (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': {
              bgcolor: 'transparent',
              boxShadow: 'none',
              border: 'none',
              p: 1.5,
              width: 290,
            },
          }}
        >
          <Box
            sx={{
              width: '100%',
              height: 'calc(100vh - 24px)',
              bgcolor: '#181311',
              borderRadius: '28px',
              boxShadow:
                '0 20px 45px -10px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)',
              overflow: 'hidden',
            }}
          >
            <ModernSidebar
              collapsed={false}
              onToggleCollapse={() => { }}
              isMobile={true}
              onNavigate={() => setMobileOpen(false)}
            />
          </Box>
        </Drawer>
      )}

      {/* --- MAIN CONTENT AREA --- */}
      <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Header (Original functionality preserved) */}
        <Box
          component="header"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            px: { xs: 2, md: 4 },
            pt: { xs: 2, md: 3 },
            mb: { xs: 2, md: 3 },
          }}
        >
          {/* Mobile hamburger icon */}
          {!isDesktop && (
            <IconButton
              aria-label="Open menu"
              onClick={() => setMobileOpen(true)}
              sx={{ border: `1px solid ${stone[200]}` }}
            >
              <MenuIcon />
            </IconButton>
          )}

          {/* Logo in header */}
          <AureonLogo size={34} />

          <Box sx={{ flexGrow: 1 }} />

          {/* Account Profile Badge in Header */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: 0.5,
              pr: { xs: 0.5, sm: 0.75 },
              bgcolor: stone[50],
              borderRadius: 999,
            }}
          >
            <Avatar
              sx={{
                bgcolor: gold[200],
                color: gold[800],
                width: 40,
                height: 40,
                fontWeight: 700,
              }}
            >
              {user?.name ? user.name[0] : 'U'}
            </Avatar>
            <Box sx={{ display: { xs: 'none', sm: 'block' }, lineHeight: 1.2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {user?.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user?.role_name}
              </Typography>
            </Box>
            <IconButton
              aria-label="Account menu"
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{ bgcolor: '#fff', border: `1px solid ${stone[200]}` }}
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Box>

          <Menu
            anchorEl={menuAnchor}
            open={!!menuAnchor}
            onClose={() => setMenuAnchor(null)}
          >
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                navigate('/change-password');
              }}
            >
              Change password
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenuAnchor(null);
                logout();
              }}
            >
              Log out
            </MenuItem>
          </Menu>
        </Box>

        {/* Page Outlet */}
        <Box component="main" sx={{ px: { xs: 2, md: 4 }, pb: { xs: 2, md: 4 }, flexGrow: 1 }}>
          <Outlet />
        </Box>
        <Footer />
      </Box>
    </Box>
  );
}
