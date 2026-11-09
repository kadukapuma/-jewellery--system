import { useEffect, useState } from 'react';
import {
  Card, Chip, LinearProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import api, { errorMessage } from '../api/client';
import { useNotify } from '../components/Notify';
import PageHeader from '../components/PageHeader';
import TablePager, { usePagedRows } from '../components/TablePager';
import { formatDateTime } from '../utils/format';
import { REQUEST_STATUS, requestTitle } from '../utils/changes';

// Edits and deletes this user sent to Admin, and Admin's answer.
export default function MyRequestsPage() {
  const notify = useNotify();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/change-requests/mine')
      .then((res) => setRows(res.data))
      .catch((err) => notify(errorMessage(err), 'error'))
      .finally(() => setLoading(false));
  }, [notify]);

  const { pageRows, pager } = usePagedRows(rows);

  return (
    <>
      <PageHeader title="My Requests" subtitle="Edits and deletes you sent to Admin for approval" />
      <Card>
        {loading && <LinearProgress />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Asked on</TableCell>
                <TableCell>Change</TableCell>
                <TableCell>Your reason</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Admin&apos;s answer</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {pageRows.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.requested_at)}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{requestTitle(r)}</TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{r.reason || '—'}</TableCell>
                  <TableCell><Chip size="small" variant="outlined" {...REQUEST_STATUS[r.status]} /></TableCell>
                  <TableCell>
                    {r.reviewed_at ? (
                      <>
                        {r.review_note || '—'}
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {r.reviewed_by_name} · {formatDateTime(r.reviewed_at)}
                        </Typography>
                      </>
                    ) : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {!loading && !rows.length && (
                <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5, color: 'text.secondary' }}>You have not sent any requests</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <TablePager {...pager} />
        </TableContainer>
      </Card>
    </>
  );
}
