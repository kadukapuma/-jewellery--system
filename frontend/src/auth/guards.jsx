import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useAuth } from './AuthContext';

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (user.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

function NoAccess() {
  return (
    <Box sx={{ textAlign: 'center', mt: 10, color: 'text.secondary' }}>
      <LockOutlinedIcon sx={{ fontSize: 48 }} />
      <Typography variant="h6">You do not have access to this page</Typography>
    </Box>
  );
}

// Admin role only (Danger Zone).
export function RequireAdmin({ children }) {
  const { user } = useAuth();
  return user?.is_super_admin ? children : <NoAccess />;
}

// Shows a "no access" message instead of the page when the user lacks every listed permission.
export function RequirePermission({ perm, children }) {
  const { can } = useAuth();
  const perms = Array.isArray(perm) ? perm : [perm];
  if (can(...perms)) return children;
  return <NoAccess />;
}
