import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Box, Button, Card, Chip, Grid, LinearProgress, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LabelIcon from '@mui/icons-material/LocalOfferOutlined';
import PaymentsIcon from '@mui/icons-material/PaymentsOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlined';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useNotify } from '../../components/Notify';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatAmount, formatDate, formatDateTime, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { PAYMENT_METHODS, PAYMENT_STATUS, todayYmd } from '../../utils/payments';
import PrintTagsDialog from '../tags/PrintTagsDialog';
import SupplierPaymentDialog from './SupplierPaymentDialog';

export default function PurchaseDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const notify = useNotify();
  const navigate = useNavigate();
  const location = useLocation();
  const [purchase, setPurchase] = useState(null);
  const [error, setError] = useState('');
  const [printing, setPrinting] = useState(null);
  const [paying, setPaying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const justCreated = location.state?.justCreated;

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/purchases/${id}`);
      setPurchase(res.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/purchases/${id}`);
      notify(`${purchase.purchase_no} deleted`);
      navigate('/purchases', { replace: true });
    } catch (err) {
      notify(errorMessage(err), 'error');
      setDeleting(false);
      setBusy(false);
    }
  };

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!purchase) return <LinearProgress />;

  const status = PAYMENT_STATUS[purchase.payment_status];
  const newItems = purchase.lines.filter((l) => l.created_item).map((l) => ({
    id: l.item_id, item_code: l.item_code, barcode: l.barcode, name: l.item_name, karat_name: l.karat_name,
    category_name: l.category_name, net_weight_g: l.net_weight_g, wastage_g: 0,
  }));
  const overdue = purchase.balance > 0 && purchase.due_date && purchase.due_date < todayYmd();

  return (
    <>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/purchases')} sx={{ mb: 1 }}>All purchases</Button>
      <PageHeader
        title={purchase.purchase_no}
        subtitle={`${purchase.supplier_name} · ${formatDate(purchase.purchase_date)}${purchase.supplier_invoice_no ? ` · Invoice ${purchase.supplier_invoice_no}` : ''}`}
        actions={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {can('tags.print') && newItems.length > 0 && (
              <Button variant="outlined" startIcon={<LabelIcon />} onClick={() => setPrinting(newItems)}>Print tags ({newItems.length})</Button>
            )}
            {can('supplier_payments.create') && purchase.balance > 0 && (
              <Button variant="contained" startIcon={<PaymentsIcon />} onClick={() => setPaying(true)}>Pay {formatMoney(purchase.balance)}</Button>
            )}
          </Box>
        }
      />

      {justCreated && newItems.length > 0 && can('tags.print') && (
        <Alert severity="success" sx={{ mb: 2.5 }} action={<Button color="inherit" size="small" onClick={() => setPrinting(newItems)}>Print tags</Button>}>
          Saved. {newItems.length} new item(s) are now in stock — print their barcode tags.
        </Alert>
      )}

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard tone="gold" label="Purchase total" note={`${purchase.lines.length} line(s) · ${formatWeight(purchase.total_weight_g)}`} value={formatAmount(purchase.total_amount)} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard tone="light" label="Paid" note={`${purchase.payments.length} payment(s)`} value={formatAmount(purchase.paid_amount)} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <StatCard tone="gray" label="Balance" note={purchase.due_date ? `Due ${formatDate(purchase.due_date)}${overdue ? ' · overdue' : ''}` : ''} value={formatAmount(purchase.balance)} />
        </Grid>
      </Grid>

      <Card sx={{ mb: 2.5 }}>
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>Items</Typography>
          <Chip size="small" variant="outlined" label={status.label} color={status.color} />
          {overdue && <Chip size="small" color="error" label="Overdue" />}
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Item</TableCell>
                <TableCell>Karat</TableCell>
                <TableCell align="right">Qty</TableCell>
                <TableCell align="right">Weight</TableCell>
                <TableCell align="right">Price / g</TableCell>
                <TableCell align="right">Price paid</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {purchase.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell sx={{ fontWeight: 600 }}>{l.item_code}</TableCell>
                  <TableCell>
                    {l.item_name}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {l.category_name} · {l.created_item ? 'new item' : 'added to existing stock'}
                    </Typography>
                  </TableCell>
                  <TableCell>{l.karat_name}</TableCell>
                  <TableCell align="right">{l.qty}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatWeight(l.weight_g)}</TableCell>
                  <TableCell align="right">{formatMoney(l.price_per_gram)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(l.purchase_price)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Card sx={{ mb: 2.5 }}>
        <Typography sx={{ fontWeight: 600, p: 2 }}>Payments</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Payment</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Paid by</TableCell>
                <TableCell align="right">Amount for this purchase</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {purchase.payments.map((p) => (
                <TableRow key={p.payment_id}>
                  <TableCell>{p.payment_no}</TableCell>
                  <TableCell>{formatDate(p.payment_date)}</TableCell>
                  <TableCell>{PAYMENT_METHODS[p.method]}{p.reference_no ? ` · ${p.reference_no}` : ''}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatMoney(p.amount)}</TableCell>
                </TableRow>
              ))}
              {!purchase.payments.length && (
                <TableRow><TableCell colSpan={4} align="center" sx={{ py: 3, color: 'text.secondary' }}>Not paid yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'text.secondary' }}>
        <Typography variant="caption" sx={{ flexGrow: 1 }}>
          Entered by {purchase.created_by_name} on {formatDateTime(purchase.created_at)}{purchase.notes ? ` · ${purchase.notes}` : ''}
        </Typography>
        {can('purchases.delete') && purchase.payments.length === 0 && (
          <Button color="error" startIcon={<DeleteIcon />} onClick={() => setDeleting(true)}>Delete purchase</Button>
        )}
      </Box>

      {printing && <PrintTagsDialog items={printing} onClose={() => setPrinting(null)} onPrinted={() => {}} />}
      {paying && (
        <SupplierPaymentDialog purchase={purchase} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); load(); }} />
      )}
      <ConfirmDialog
        open={deleting}
        title="Delete purchase"
        message={`Delete ${purchase.purchase_no}? Its new items are removed from stock and added stock is taken back. This only works while nothing has been sold or changed.`}
        confirmText="Delete"
        color="error"
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(false)}
      />
    </>
  );
}
