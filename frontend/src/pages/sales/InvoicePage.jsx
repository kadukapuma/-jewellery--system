import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Box, Button, Chip, DialogActions, DialogContent, DialogTitle, LinearProgress, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import CancelDialog from '../../components/CancelDialog';
import Dialog from '../../components/Dialog';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import AddShoppingCartIcon from '@mui/icons-material/AddShoppingCart';
import EditNoteIcon from '@mui/icons-material/EditNoteOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { METHOD_LABELS, PAYMENT_STATUS } from '../../utils/payments';
import RecordActions from '../../components/RecordActions';
import ReceivePaymentDialog from './ReceivePaymentDialog';

// Only the bill is printed: everything else on the page is hidden while printing.
const PRINT_CSS = `
  @media print {
    @page { size: A5 portrait; margin: 8mm; }
    body * { visibility: hidden !important; }
    #invoice, #invoice * { visibility: visible !important; }
    #invoice { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; border: none !important; padding: 0 !important; }
    .no-print { display: none !important; }
  }
`;

// correcting: "Correct bill" - cancel, then open the same items at the counter to make the right bill.
function CancelSaleDialog({ sale, correcting, onClose, onDone }) {
  return (
    <CancelDialog
      title={`${correcting ? 'Correct' : 'Cancel'} ${sale.invoice_no}`}
      url={`/sales/${sale.id}/cancel`}
      intro={correcting ? 'Bills cannot be changed once saved, so this bill is cancelled and its items open at the counter for the right bill.' : null}
      reasonRequired
      defaultReason={correcting ? 'Corrected - wrong items or price' : ''}
      keepText="Keep bill"
      confirmText={correcting ? 'Cancel and open at counter' : 'Cancel bill'}
      doneText={correcting ? 'Open at counter' : 'Close'}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

export default function InvoicePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sale, setSale] = useState(null);
  const [shop, setShop] = useState({});
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const justCreated = location.state?.justCreated;

  const load = useCallback(async () => {
    try {
      const [s, sh] = await Promise.all([api.get(`/sales/${id}`), api.get('/settings/shop')]);
      setSale(s.data);
      setShop(sh.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!sale) return <LinearProgress />;

  const status = PAYMENT_STATUS[sale.payment_status];
  const cancelled = sale.status === 'cancelled';
  // Old gold taken in exchange is shown on its own line, not as money paid.
  const oldGoldPaid = Math.round(sale.payments.filter((p) => p.method === 'old_gold').reduce((s, p) => s + Number(p.amount), 0) * 100) / 100;
  const oldGoldWeight = (sale.old_gold || []).filter((g) => g.status === 'active').reduce((s, g) => s + g.total_net_weight_g, 0);
  const totals = sale.lines.reduce((t, l) => ({ net: t.net + Number(l.net_weight_g), wastage: t.wastage + Number(l.wastage_g), billed: t.billed + Number(l.billed_weight_g) }), { net: 0, wastage: 0, billed: 0 });
  const rates = [...new Map(sale.lines.map((l) => [l.karat_name, l.gram_price_used])).entries()];

  return (
    <>
      <style>{PRINT_CSS}</style>
      <Box className="no-print" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2, alignItems: 'center' }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/sales')}>All bills</Button>
        <Box sx={{ flexGrow: 1 }} />
        {can('sales.create') && <Button startIcon={<AddShoppingCartIcon />} onClick={() => navigate('/pos')}>New sale</Button>}
        {!cancelled && sale.balance > 0 && sale.customer_id && can('customer_payments.create') && (
          <Button variant="outlined" startIcon={<PaymentsIcon />} onClick={() => setPaying(true)}>Receive {formatMoney(sale.balance)}</Button>
        )}
        <RecordActions record={sale} label={sale.invoice_no} url={`/sales/${sale.id}`} module="sales"
          fields={[{ name: 'due_date', label: 'Credit due date', type: 'date' }, { name: 'notes', label: 'Notes' }]}
          onDone={load} onDeleted={() => navigate('/sales', { replace: true })} />
        {!cancelled && can('sales.cancel') && can('sales.create') && (
          <Button startIcon={<EditNoteIcon />} onClick={() => setCorrecting(true)}>Correct bill</Button>
        )}
        {!cancelled && can('sales.cancel') && <Button color="error" startIcon={<CancelIcon />} onClick={() => setCancelling(true)}>Cancel bill</Button>}
        <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>Print</Button>
      </Box>

      {justCreated && (
        <Alert severity="success" className="no-print" sx={{ mb: 2 }}>
          Bill saved.{location.state?.change ? ` Give change: ${formatMoney(location.state.change)}.` : ''}
        </Alert>
      )}
      {cancelled && <Alert severity="warning" className="no-print" sx={{ mb: 2 }}>This bill was cancelled.</Alert>}

      <Box id="invoice" sx={{ maxWidth: 820, mx: 'auto', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: '20px', p: { xs: 2, md: 4 }, color: '#000' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <Box>
            <Typography sx={{ fontSize: 22, fontWeight: 700 }}>{shop.shop_name}</Typography>
            {shop.shop_address && <Typography variant="body2">{shop.shop_address}</Typography>}
            {shop.shop_phone && <Typography variant="body2">Tel: {shop.shop_phone}</Typography>}
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography sx={{ fontSize: 18, fontWeight: 700 }}>{cancelled ? 'CANCELLED BILL' : 'INVOICE'}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{sale.invoice_no}</Typography>
            <Typography variant="body2">{formatDateTime(sale.sale_date)}</Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2, py: 1.5, borderTop: '1px solid #ddd', borderBottom: '1px solid #ddd' }}>
          <Box>
            <Typography variant="caption" color="text.secondary">Customer</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{sale.customer_name || 'Walk-in customer'}</Typography>
            {sale.customer_phone && <Typography variant="body2">{sale.customer_phone}</Typography>}
            {sale.customer_address && <Typography variant="body2">{sale.customer_address}</Typography>}
          </Box>
          {sale.salesman_name && (
            <Box>
              <Typography variant="caption" color="text.secondary">Salesman</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{sale.salesman_name}</Typography>
              {sale.salesman_code && <Typography variant="caption" color="text.secondary">{sale.salesman_code}</Typography>}
            </Box>
          )}
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="caption" color="text.secondary">Gold rate (per gram)</Typography>
            {rates.map(([k, r]) => <Typography key={k} variant="body2">{k}: {formatMoney(r)}</Typography>)}
          </Box>
        </Box>

        <Table size="small" sx={{ '& td, & th': { px: 0.75, borderColor: '#e5e5e5' } }}>
          <TableHead>
            <TableRow>
              <TableCell>Item</TableCell>
              <TableCell align="right">Net wt</TableCell>
              <TableCell align="right">Wastage</TableCell>
              <TableCell align="right">Billed wt</TableCell>
              <TableCell align="right">Gold value</TableCell>
              <TableCell align="right">Making</TableCell>
              <TableCell align="right">Amount</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sale.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{l.item_name}{l.qty > 1 ? ` × ${l.qty}` : ''}</Typography>
                  <Typography variant="caption">{l.item_code} · {l.karat_name}</Typography>
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatWeight(l.net_weight_g)}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{Number(l.wastage_g) ? formatWeight(l.wastage_g) : '—'}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatWeight(l.billed_weight_g)}</TableCell>
                <TableCell align="right">{formatMoney(l.gold_value)}</TableCell>
                <TableCell align="right">{Number(l.making_charge) ? formatMoney(l.making_charge) : '—'}</TableCell>
                {/* Listed at the max price; any discount is shown once under the subtotal. */}
                <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(Number(l.price_max) || l.line_total)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell sx={{ fontWeight: 600 }}>Total weight</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{formatWeight(totals.net)}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{totals.wastage ? formatWeight(totals.wastage) : '—'}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{formatWeight(totals.billed)}</TableCell>
              <TableCell colSpan={3} />
            </TableRow>
          </TableBody>
        </Table>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
          <Box sx={{ width: { xs: '100%', sm: 300 } }}>
            {[
              ['Subtotal', formatMoney(sale.subtotal)],
              ...(Number(sale.discount) ? [['Discount', `− ${formatMoney(sale.discount)}`]] : []),
            ].map(([label, v]) => (
              <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
                <Typography variant="body2">{label}</Typography><Typography variant="body2">{v}</Typography>
              </Box>
            ))}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, borderTop: '2px solid #000', mt: 0.5 }}>
              <Typography sx={{ fontWeight: 700 }}>Total</Typography>
              <Typography sx={{ fontWeight: 700, fontSize: 18 }}>{formatMoney(sale.total)}</Typography>
            </Box>
            {oldGoldPaid > 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
                <Typography variant="body2">Old gold exchanged{oldGoldWeight > 0 ? ` (${formatWeight(oldGoldWeight)})` : ''}</Typography>
                <Typography variant="body2">− {formatMoney(oldGoldPaid)}</Typography>
              </Box>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
              <Typography variant="body2">Paid</Typography><Typography variant="body2">{formatMoney(Number(sale.paid_amount) - oldGoldPaid)}</Typography>
            </Box>
            {!cancelled && Number(sale.balance) > 0 && (
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>Balance due{sale.due_date ? ` by ${formatDate(sale.due_date)}` : ''}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatMoney(sale.balance)}</Typography>
              </Box>
            )}
          </Box>
        </Box>

        {sale.payments.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">Payments</Typography>
            {sale.payments.map((p) => (
              <Typography key={p.payment_id} variant="body2">
                {formatDate(p.payment_date)} · {p.receipt_no} · {METHOD_LABELS[p.method]}{p.reference_no ? ` (${p.reference_no})` : ''} · {formatMoney(p.amount)}
              </Typography>
            ))}
          </Box>
        )}

        {sale.instalment_plan && sale.instalment_plan.status !== 'cancelled' && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">Instalments</Typography>
            <Table size="small" sx={{ '& td, & th': { px: 0.75, py: 0.5 } }}>
              <TableHead>
                <TableRow><TableCell>#</TableCell><TableCell>Due</TableCell><TableCell align="right">Amount</TableCell><TableCell align="right">Paid</TableCell><TableCell className="no-print">Status</TableCell></TableRow>
              </TableHead>
              <TableBody>
                {sale.instalment_plan.schedule.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.instalment_no}</TableCell>
                    <TableCell>{formatDate(r.due_date)}</TableCell>
                    <TableCell align="right">{formatMoney(r.amount_due)}</TableCell>
                    <TableCell align="right">{Number(r.amount_paid) ? formatMoney(r.amount_paid) : '—'}</TableCell>
                    <TableCell className="no-print">
                      <Chip size="small" variant="outlined" label={r.is_overdue ? 'Overdue' : r.status === 'paid' ? 'Paid' : r.status === 'partial' ? 'Part paid' : 'Due'}
                        color={r.is_overdue ? 'error' : r.status === 'paid' ? 'success' : r.status === 'partial' ? 'warning' : 'default'} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        <Box sx={{ mt: 3, pt: 1.5, borderTop: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="caption">{shop.invoice_footer}</Typography>
          <Typography variant="caption">Served by {sale.created_by_name}</Typography>
        </Box>
        {sale.notes && <Typography variant="caption" className="no-print" sx={{ display: 'block', mt: 1 }}>Notes: {sale.notes}</Typography>}
        <Box className="no-print" sx={{ mt: 1 }}>
          <Chip size="small" variant="outlined" label={cancelled ? 'Cancelled' : status.label} color={cancelled ? 'default' : status.color} />
        </Box>
      </Box>

      {paying && <ReceivePaymentDialog sale={sale} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); load(); }} />}
      {cancelling && <CancelSaleDialog sale={sale} onClose={() => setCancelling(false)} onDone={() => { setCancelling(false); load(); }} />}
      {correcting && (
        <CancelSaleDialog sale={sale} correcting onClose={() => setCorrecting(false)}
          onDone={() => navigate('/pos', {
            state: {
              correcting: {
                invoice_no: sale.invoice_no,
                customer_id: sale.customer_id,
                lines: sale.lines.map((l) => ({ item_id: l.item_id, qty: l.qty, unit_price: Math.round((Number(l.line_total) / l.qty) * 100) / 100 })),
              },
            },
          })} />
      )}
    </>
  );
}
