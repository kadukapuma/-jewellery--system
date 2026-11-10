import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Button, Chip, LinearProgress, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import api, { errorMessage } from '../../api/client';
import { formatDate, formatMoney } from '../../utils/format';
import { formatWeight } from '../../utils/pricing';
import { PAYMENT_METHODS } from '../../utils/payments';
import { REPAIR_STATUS } from './RepairsPage';

// Only the slip is printed: everything else on the page is hidden while printing.
const PRINT_CSS = `
  @media print {
    @page { size: A5 portrait; margin: 8mm; }
    body * { visibility: hidden !important; }
    #repair-slip, #repair-slip * { visibility: visible !important; }
    #repair-slip { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; border: none !important; padding: 0 !important; }
    .no-print { display: none !important; }
  }
`;

function Line({ label, value, strong }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.4 }}>
      <Typography variant="body2" sx={{ color: '#555' }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: strong ? 700 : 600, textAlign: 'right' }}>{value}</Typography>
    </Box>
  );
}

// Repair slip: given to the customer when the item is handed in, brought back to collect it.
export default function RepairSlipPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [repair, setRepair] = useState(null);
  const [shop, setShop] = useState({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [r, sh] = await Promise.all([api.get(`/repairs/${id}`), api.get('/settings/shop')]);
      setRepair(r.data);
      setShop(sh.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!repair) return <LinearProgress />;

  const payments = repair.payments.filter((p) => p.status === 'active');
  const delivered = repair.status === 'delivered';

  return (
    <>
      <style>{PRINT_CSS}</style>
      <Box className="no-print" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2, alignItems: 'center' }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/repairs')}>All repairs</Button>
        <Box sx={{ flexGrow: 1 }} />
        <Chip variant="outlined" label={REPAIR_STATUS[repair.status].label} color={REPAIR_STATUS[repair.status].color} />
        <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()}>Print</Button>
      </Box>
      {location.state?.justCreated && <Alert severity="success" className="no-print" sx={{ mb: 2 }}>Repair saved. Print the slip and give it to the customer.</Alert>}

      <Box id="repair-slip" sx={{ maxWidth: 560, mx: 'auto', bgcolor: '#fff', border: '1px solid', borderColor: 'divider', borderRadius: '20px', p: { xs: 2, md: 4 }, color: '#000' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <Box>
            <Typography sx={{ fontSize: 20, fontWeight: 700 }}>{shop.shop_name}</Typography>
            {shop.shop_address && <Typography variant="body2">{shop.shop_address}</Typography>}
            {shop.shop_phone && <Typography variant="body2">Tel: {shop.shop_phone}</Typography>}
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{repair.status === 'cancelled' ? 'CANCELLED REPAIR' : 'REPAIR SLIP'}</Typography>
            <Typography sx={{ fontSize: 18, fontWeight: 700 }}>{repair.repair_no}</Typography>
            <Typography variant="body2">{formatDate(repair.received_date)}</Typography>
          </Box>
        </Box>

        <Box sx={{ py: 1.5, borderTop: '1px solid #ddd', borderBottom: '1px solid #ddd', mb: 1.5 }}>
          <Typography variant="caption" sx={{ color: '#555' }}>Customer</Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{repair.customer_name}</Typography>
          {repair.customer_phone && <Typography variant="body2">{repair.customer_phone}</Typography>}
        </Box>

        <Line label="Item" value={repair.item_description} />
        <Line label="Karat" value={repair.karat_name} />
        <Line label="Weight received" value={formatWeight(repair.weight_in_g)} strong />
        <Line label="Work to do" value={repair.work_to_do} />
        <Line label="Ready by" value={repair.promised_date ? formatDate(repair.promised_date) : null} />

        <Box sx={{ borderTop: '1px solid #ddd', mt: 1.5, pt: 1.5 }}>
          {delivered ? (
            <>
              <Line label="Repair charge" value={formatMoney(repair.repair_charge)} />
              {Number(repair.gold_charge) > 0 && <Line label={`Gold added (${formatWeight(repair.extra_gold_g)})`} value={formatMoney(repair.gold_charge)} />}
              <Line label="Total" value={formatMoney(repair.total_charge)} strong />
              <Line label="Weight handed back" value={formatWeight(repair.weight_out_g)} />
              <Line label="Collected on" value={formatDate(repair.delivered_date)} />
            </>
          ) : (
            <Line label="Estimated charge" value={Number(repair.estimated_charge) > 0 ? formatMoney(repair.estimated_charge) : 'To be told'} />
          )}
          {payments.map((p) => (
            <Line key={p.id} label={`Paid ${formatDate(p.payment_date)} · ${PAYMENT_METHODS[p.method]} · ${p.receipt_no}`} value={formatMoney(p.amount)} />
          ))}
          {delivered && repair.balance_due > 0 && <Line label="Balance due" value={formatMoney(repair.balance_due)} strong />}
        </Box>

        {!delivered && (
          <Typography variant="caption" sx={{ display: 'block', mt: 3, color: '#555' }}>
            Please bring this slip to collect your item. The item was weighed in front of you.
          </Typography>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 5, gap: 4 }}>
          <Box sx={{ flex: 1, borderTop: '1px solid #999', pt: 0.5 }}><Typography variant="caption">Customer signature</Typography></Box>
          <Box sx={{ flex: 1, borderTop: '1px solid #999', pt: 0.5, textAlign: 'right' }}><Typography variant="caption">For {shop.shop_name}</Typography></Box>
        </Box>
      </Box>
    </>
  );
}
