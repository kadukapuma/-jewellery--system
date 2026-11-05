import { useEffect, useState } from 'react';
import {
  Card, Chip, LinearProgress, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Typography,
} from '@mui/material';
import api, { errorMessage } from '../../api/client';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import { formatDateTime } from '../../utils/format';
import TablePager, { usePagedRows } from '../../components/TablePager';

function summarize(values) {
  if (!values) return '';
  const obj = typeof values === 'string' ? JSON.parse(values) : values;
  return JSON.stringify(obj);
}

export default function ActivityPage() {
  const notify = useNotify();
  const [tab, setTab] = useState('logins');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true; // ignore a slow response from the previous tab
    setLoading(true);
    api
      .get(tab === 'logins' ? '/activity/login-logs' : '/activity/audit-logs')
      .then((res) => active && setRows(res.data))
      .catch((err) => active && notify(errorMessage(err), 'error'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [tab, notify]);

  // Clear rows in the same render as the tab switch, so old rows never meet the new columns.
  const changeTab = (value) => {
    setRows([]);
    setTab(value);
  };

  const { pageRows, pager } = usePagedRows(rows);

  return (
    <>
      <PageHeader title="Activity Log" subtitle="Latest 200 entries" />
      <Card>
        <Tabs value={tab} onChange={(e, v) => changeTab(v)} sx={{ p: 2 }}>
          <Tab value="logins" label="Login history" />
          <Tab value="changes" label="Changes" />
        </Tabs>
        {loading && <LinearProgress />}
        <TableContainer>
          {tab === 'logins' ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Username</TableCell>
                  <TableCell>User</TableCell>
                  <TableCell>Result</TableCell>
                  <TableCell>IP address</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pageRows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>{formatDateTime(r.created_at)}</TableCell>
                    <TableCell>{r.username_tried}</TableCell>
                    <TableCell>{r.user_name || '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" label={r.success ? 'Success' : 'Failed'} color={r.success ? 'success' : 'error'} variant="outlined" />
                    </TableCell>
                    <TableCell>{r.ip_address}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>User</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Record</TableCell>
                  <TableCell>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pageRows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.created_at)}</TableCell>
                    <TableCell>{r.user_name}</TableCell>
                    <TableCell><Chip size="small" label={r.action.replace(/_/g, ' ')} /></TableCell>
                    <TableCell>{r.table_name}{r.record_id ? ` #${r.record_id}` : ''}</TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                        {summarize(r.new_values)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <TablePager {...pager} />
          {!loading && !rows.length && (
            <Typography align="center" color="text.secondary" sx={{ py: 4 }}>Nothing yet</Typography>
          )}
        </TableContainer>
      </Card>
    </>
  );
}
