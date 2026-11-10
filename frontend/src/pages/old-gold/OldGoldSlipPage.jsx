import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, LinearProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { formatDate, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { OLD_GOLD_MODES, OLD_GOLD_USAGE } from './OldGoldPage';
import { CancelOldGoldDialog } from './OldGoldDialog';

const PRINT_CSS = `
  @media print {
    @page { size: A5 portrait; margin: 8mm; }
    body * { visibility: hidden !important; }
    #old-gold-slip, #old-gold-slip * { visibility: visible !important; }
    #old-gold-slip { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; border: none !important; padding: 0 !important; }
    .no-print { display: none !important; }
  }
`;

const cell = { px: 0.75, py: 0.5, fontSize: 12, color: '#000', borderColor: '#ddd' };

function Line({ label, value, strong }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.4 }}>
      <Typography variant="body2" sx={{ color: '#555' }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: strong ? 700 : 600, textAlign: 'right' }}>{value}</Typography>
    </Box>
  );
}

// Old gold receipt: what the customer handed in, how it was weighed and valued, and what they got for it.
export default function OldGoldSlipPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [receipt, setReceipt] = useState(null);
  const [shop, setShop] = useState({});
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, sh] = await Promise.all([api.get(`/old-gold/${id}`), api.get('/settings/shop')]);
      setReceipt(r.data);
      setShop(sh.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!receipt) return <LinearProgress />;

  const cancelled = receipt.status === 'cancelled';
  const mode = OLD_GOLD_MODES[receipt.mode];
  const credit = receipt.payments.find((p) => p.status === 'active');
  const deduction = receipt.lines[0]?.deduction_percent || 0;

  return (
    <>
      <style>{PRINT_CSS}</style>
      <Box className="no-print" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2, alignItems: 'center' }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/old-gold')}>All old gold</Button>
        {receipt.sale_id && <Button onClick={() => navigate(`/sales/${receipt.sale_id}`)}>Bill {receipt.invoice_no}</Button>}
        <Box sx={{ flexGrow: 1 }} />
        <Chip variant="outlined" label={cancelled ? 'Cancelled' : mode.label} color={cancelled ? 'default' : mode.color} />
        {!cancelled && receipt.usage !== 'paid_out' && (
          <Chip label={OLD_GOLD_USAGE[receipt.usage].label} color={OLD_GOLD_USAGE[receipt.usage].color} variant={receipt.usage === 'used' ? 'filled' : 'outlined'} />
        )}
        {!cancelled && can('old_gold.cancel') && (
          <Button color="error" startIcon={<CancelIcon />} onClick={() => setCancelling(true)}>Cancel</Button>
        )}
        <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>Print</Button>
      </Box>
      {!cancelled && receipt.usage !== 'paid_out' && (
        <Alert severity={receipt.usage === 'used' ? 'success' : 'info'} className="no-print" sx={{ mb: 2 }}>
          {receipt.usage === 'unused' && `Not used yet: ${formatMoney(receipt.available_amount)} is waiting as ${receipt.customer_name}'s advance for their next bill.`}
          {receipt.usage === 'partly_used' && `${formatMoney(receipt.used_amount)} used on ${receipt.used_on}. ${formatMoney(receipt.available_amount)} is still an advance.`}
          {receipt.usage === 'used' && `Fully used on ${receipt.used_on}.`}
        </Alert>
      )}
      {cancelled && receipt.cancel_reason && <Alert severity="warning" className="no-print" sx={{ mb: 2 }}>Cancelled: {receipt.cancel_reason}</Alert>}

      <Box id="old-gold-slip" sx={{ maxWidth: 620, mx: 'auto', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: '20px', p: { xs: 2, md: 4 }, color: '#000' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <Box>
            <Typography sx={{ fontSize: 20, fontWeight: 700 }}>{shop.shop_name}</Typography>
            {shop.shop_address && <Typography variant="body2">{shop.shop_address}</Typography>}
            {shop.shop_phone && <Typography variant="body2">Tel: {shop.shop_phone}</Typography>}
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{cancelled ? 'CANCELLED' : 'OLD GOLD RECEIPT'}</Typography>
            <Typography sx={{ fontSize: 18, fontWeight: 700 }}>{receipt.receipt_no}</Typography>
            <Typography variant="body2">{formatDate(receipt.receipt_date)}</Typography>
          </Box>
        </Box>

        <Box sx={{ py: 1.5, borderTop: '1px solid #ddd', borderBottom: '1px solid #ddd', mb: 1.5 }}>
          <Typography variant="caption" sx={{ color: '#555' }}>Customer</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{receipt.customer_name || 'Walk-in customer'}</Typography>
          {receipt.customer_phone && <Typography variant="body2">{receipt.customer_phone}</Typography>}
          {receipt.customer_nic && <Typography variant="body2">NIC {receipt.customer_nic}</Typography>}
        </Box>

        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={cell}>Piece</TableCell>
                <TableCell sx={cell}>Karat</TableCell>
                <TableCell sx={cell} align="right">Weight</TableCell>
                <TableCell sx={cell} align="right">Stones</TableCell>
                <TableCell sx={cell} align="right">Net</TableCell>
                <TableCell sx={cell} align="right">Rate / g</TableCell>
                <TableCell sx={cell} align="right">Value</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {receipt.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell sx={cell}>
                    {l.description}
                    <Typography className="no-print" variant="caption" sx={{ display: 'block', color: '#777' }}>
                      Stock {l.item_code}{l.item_status && l.item_status !== 'in_stock' ? ` · ${l.item_status.replace('_', ' ')}` : ''}
                    </Typography>
                  </TableCell>
                  <TableCell sx={cell}>{l.karat_name}</TableCell>
                  <TableCell sx={cell} align="right">{formatWeight(l.gross_weight_g)}</TableCell>
                  <TableCell sx={cell} align="right">{l.stone_weight_g > 0 ? formatWeight(l.stone_weight_g) : '—'}</TableCell>
                  <TableCell sx={cell} align="right">{formatWeight(l.net_weight_g)}</TableCell>
                  <TableCell sx={cell} align="right">{formatMoney(l.gram_rate)}</TableCell>
                  <TableCell sx={cell} align="right">{formatMoney(l.value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>

        <Box sx={{ borderTop: '1px solid #ddd', mt: 1.5, pt: 1.5 }}>
          <Line label="Net gold" value={formatWeight(receipt.total_net_weight_g)} />
          {deduction > 0 && <Line label="Deduction" value={`${deduction}% of the day's rate`} />}
          <Line label="Total value" value={formatMoney(receipt.total_value)} strong />
          {receipt.mode === 'cash' && <Line label={`Paid to customer (${receipt.payout_method === 'cash' ? 'cash' : 'bank transfer'})`} value={formatMoney(receipt.total_value)} />}
          {receipt.mode === 'exchange' && <Line label={`Taken off bill ${receipt.invoice_no || ''}`} value={formatMoney(credit ? Math.min(credit.allocated, credit.amount) : receipt.total_value)} />}
          {receipt.mode !== 'cash' && credit && credit.amount - credit.allocated > 0.009 && (
            <Line label="Kept as advance" value={formatMoney(credit.amount - credit.allocated)} />
          )}
          {receipt.mode === 'credit' && credit && credit.allocated > 0 && <Line label="Paid towards bills owed" value={formatMoney(credit.allocated)} />}
        </Box>

        {receipt.notes && <Typography variant="body2" sx={{ mt: 1.5 }}>{receipt.notes}</Typography>}
        <Typography variant="caption" sx={{ display: 'block', mt: 3, color: '#555' }}>
          The gold was weighed in front of the customer. I confirm it is my own property and I sell it to the shop at the value above.
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 5, gap: 4 }}>
          <Box sx={{ flex: 1, borderTop: '1px solid #999', pt: 0.5 }}><Typography variant="caption">Customer signature</Typography></Box>
          <Box sx={{ flex: 1, borderTop: '1px solid #999', pt: 0.5, textAlign: 'right' }}><Typography variant="caption">For {shop.shop_name}</Typography></Box>
        </Box>
      </Box>

      {cancelling && <CancelOldGoldDialog receipt={receipt} onClose={() => setCancelling(false)} onDone={() => { setCancelling(false); load(); }} />}
    </>
  );
}
