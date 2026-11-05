import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, DialogActions, DialogContent, DialogTitle, LinearProgress, Tab, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tabs, Typography,
} from '@mui/material';
import Dialog from '../../components/Dialog';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { formatDate, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { PAYMENT_METHODS } from '../../utils/payments';
import GoldAdjustmentDialog from './GoldAdjustmentDialog';
import CraftsmanPaymentDialog from './CraftsmanPaymentDialog';
import TablePager, { usePagedRows } from '../../components/TablePager';

const GOLD_TYPES = {
  issue: 'Gold given for job',
  return: 'Finished piece received',
  wastage: 'Wastage',
  extra_issue: 'Extra gold given',
  gold_returned: 'Gold given back',
  adjustment: 'Correction',
};

export default function CraftsmanAccountDialog({ craftsmanId, onClose, onChanged }) {
  const { can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('gold');
  const [adjusting, setAdjusting] = useState(false);
  const [paying, setPaying] = useState(false);

  const load = useCallback(() => {
    api.get(`/craftsmen/${craftsmanId}/account`).then((res) => setData(res.data)).catch((err) => setError(errorMessage(err)));
  }, [craftsmanId]);

  useEffect(() => { load(); }, [load]);

  const changed = () => {
    setAdjusting(false);
    setPaying(false);
    load();
    onChanged?.();
  };

  const c = data?.craftsman;

  const { pageRows: pageGold, pager: pagerGold } = usePagedRows(data?.gold.entries);
  const { pageRows: pageCash, pager: pagerCash } = usePagedRows(data?.cash.entries);

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {c?.name ?? 'Craftsman'} – account
        {c && (
          <Typography variant="body2" color="text.secondary">
            Holds {formatWeight(c.gold_held_g)} of gold · {c.cash_due >= 0 ? `fees owed ${formatMoney(c.cash_due)}` : `advance ${formatMoney(-c.cash_due)}`}
            {c.wastage_percent !== null && ` · average wastage ${c.wastage_percent}%`}
          </Typography>
        )}
      </DialogTitle>
      <Box sx={{ px: 3, pb: 1 }}>
        <Tabs value={tab} onChange={(e, v) => setTab(v)}>
          <Tab value="gold" label="Gold" />
          <Tab value="cash" label="Fees & payments" />
        </Tabs>
      </Box>
      <DialogContent dividers sx={{ p: 0 }}>
        {!data && !error && <LinearProgress />}
        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
        {data && tab === 'gold' && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>What</TableCell>
                  <TableCell>Job</TableCell>
                  <TableCell>Karat</TableCell>
                  <TableCell align="right">Given (+)</TableCell>
                  <TableCell align="right">Back (−)</TableCell>
                  <TableCell align="right">Holds</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={6} sx={{ color: 'text.secondary' }}>Opening</TableCell>
                  <TableCell align="right">{formatWeight(data.gold.opening)}</TableCell>
                </TableRow>
                {pageGold.map((e) => (
                  <TableRow key={e.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(e.txn_date)}</TableCell>
                    <TableCell>
                      {GOLD_TYPES[e.txn_type]}
                      {e.notes && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{e.notes}</Typography>}
                    </TableCell>
                    <TableCell>{e.job_no}</TableCell>
                    <TableCell>{e.karat}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{e.weight_g > 0 ? formatWeight(e.weight_g) : ''}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: e.txn_type === 'wastage' ? 'warning.main' : undefined }}>
                      {e.weight_g < 0 ? formatWeight(-e.weight_g) : ''}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatWeight(e.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePager {...pagerGold} />
          </TableContainer>
        )}
        {data && tab === 'cash' && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Reference</TableCell>
                  <TableCell>Details</TableCell>
                  <TableCell align="right">Fee earned</TableCell>
                  <TableCell align="right">Paid</TableCell>
                  <TableCell align="right">Owed</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={5} sx={{ color: 'text.secondary' }}>Opening</TableCell>
                  <TableCell align="right">{formatMoney(data.cash.opening)}</TableCell>
                </TableRow>
                {pageCash.map((e) => (
                  <TableRow key={`${e.type}-${e.id}`} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(e.date)}</TableCell>
                    <TableCell>{e.ref}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>
                      {e.type === 'payment' ? PAYMENT_METHODS[e.detail?.split(' · ')[0]] + (e.detail?.includes(' · ') ? ` · ${e.detail.split(' · ')[1]}` : '') : e.detail}
                    </TableCell>
                    <TableCell align="right">{e.amount > 0 ? formatMoney(e.amount) : ''}</TableCell>
                    <TableCell align="right">{e.amount < 0 ? formatMoney(-e.amount) : ''}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(e.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePager {...pagerCash} />
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ mr: 'auto' }}>Close</Button>
        {c && can('craftsman_account.adjust') && <Button variant="outlined" onClick={() => setAdjusting(true)}>Record gold movement</Button>}
        {c && can('craftsman_payments.create') && <Button variant="contained" onClick={() => setPaying(true)}>Pay craftsman</Button>}
      </DialogActions>
      {adjusting && <GoldAdjustmentDialog craftsman={c} onClose={() => setAdjusting(false)} onSaved={changed} />}
      {paying && <CraftsmanPaymentDialog craftsman={c} onClose={() => setPaying(false)} onSaved={changed} />}
    </Dialog>
  );
}
