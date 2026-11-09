import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, Box, Button, Card, Chip, Grid, LinearProgress, Table, TableBody, TableCell, TableRow, TextField, Typography,
} from '@mui/material';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import LockIcon from '@mui/icons-material/LockOutlined';
import LockOpenIcon from '@mui/icons-material/LockOpenOutlined';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightIcon from '@mui/icons-material/ChevronRightRounded';
import api, { errorMessage } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';
import { formatAmount, formatDate, formatDateTime, formatMoney, formatTime } from '../../utils/format';
import { PAYMENT_METHODS, PAYMENT_STATUS, todayYmd } from '../../utils/payments';
import { ACCOUNTS, CASH_ENTRY_TYPES, MONEY_KINDS } from '../../utils/finance';
import { MOVEMENT_TYPES } from '../../utils/stock';
import { downloadCsv } from '../../utils/csv';
import { ReportTable } from '../reports/ReportParts';
import { gold, stone } from '../../theme';
import CloseDayDialog, { ReopenDayDialog } from './CloseDayDialog';
import DayEndHistory from './DayEndHistory';

const PRINT_CSS = `
  @media print {
    @page { size: A4 portrait; margin: 10mm; }
    body * { visibility: hidden !important; }
    #day-end, #day-end * { visibility: visible !important; }
    #day-end { position: absolute; left: 0; top: 0; width: 100%; }
    .no-print { display: none !important; }
  }
`;

const g = (v) => `${Number(v || 0).toFixed(3)} g`;
const round = (v) => formatAmount(Math.round(v));
const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const method = (m) => PAYMENT_METHODS[m] || m || '—';
const JOB_TYPES = { new: 'New piece', make_item: 'Make saved item', rework: 'Rework' };
const GOLD_TXN = { extra_issue: 'Extra gold given', gold_returned: 'Gold returned', adjustment: 'Adjustment' };
const SOURCES = { purchase: 'Purchase', craft: 'Made by craftsman', opening: 'Opening stock' };

function shiftDay(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// A numbered section heading.
function Section({ no, title, note, children }) {
  return (
    <Box component="section" sx={{ mt: 4, breakInside: 'avoid-page' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 1.5, pb: 1, borderBottom: `2px solid ${gold[200]}` }}>
        <Typography sx={{ fontWeight: 700, color: gold[800], fontSize: 13 }}>{String(no).padStart(2, '0')}</Typography>
        <Typography component="h2" sx={{ fontWeight: 600, fontSize: 20, flexGrow: 1 }}>{title}</Typography>
        {note && <Typography variant="body2" color="text.secondary">{note}</Typography>}
      </Box>
      {children}
    </Box>
  );
}

// A strip of small label / value boxes.
function KeyFigures({ items }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' }, gap: 1.25, mb: 2.5 }}>
      {items.filter(Boolean).map((it) => (
        <Box key={it.label} sx={{ bgcolor: it.strong ? gold[50] : stone[50], border: `1px solid ${it.strong ? gold[200] : stone[100]}`, borderRadius: '16px', px: 1.75, py: 1.25 }}>
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary', fontWeight: 600 }}>{it.label}</Typography>
          <Typography sx={{ fontWeight: 700, fontSize: 17, color: it.color }}>{it.value}</Typography>
          {it.note && <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{it.note}</Typography>}
        </Box>
      ))}
    </Box>
  );
}

// A statement: label on the left, amount on the right; totals in bold with a rule above.
function Statement({ title, rows }) {
  return (
    <Card sx={{ mb: 2.5, breakInside: 'avoid' }}>
      <Typography sx={{ fontWeight: 600, px: 2, pt: 1.5, pb: 0.5 }}>{title}</Typography>
      <Table size="small">
        <TableBody>
          {rows.filter(Boolean).map((r, i) => (
            <TableRow key={`${r.label}-${i}`} sx={{ '& td': { fontWeight: r.total ? 700 : 400, borderTop: r.total ? `2px solid ${stone[200]}` : undefined, fontSize: r.big ? 16 : undefined } }}>
              <TableCell sx={{ pl: r.indent ? 4 : 2, color: r.muted ? 'text.secondary' : undefined }}>{r.label}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: r.color }}>{r.value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

const diffColor = (d) => (Math.abs(d) < 0.005 ? 'success.main' : d < 0 ? 'error.main' : 'warning.main');
const diffText = (d) => (Math.abs(d) < 0.005 ? 'Matches' : d < 0 ? `Short ${formatMoney(-d)}` : `Over ${formatMoney(d)}`);

function StatusBanner({ data, isAdmin, onPick }) {
  const c = data.closing;
  if (data.is_future) return <Alert severity="info" sx={{ mb: 2.5 }}>This date is in the future.</Alert>;
  return (
    <>
      {c?.status === 'closed' && (
        <Alert severity="success" icon={<LockIcon />} sx={{ mb: 2 }}>
          <strong>Day closed</strong> by {c.closed_by_name} on {formatDateTime(c.closed_at)}. Expected cash {formatMoney(c.expected_cash)},
          counted {formatMoney(c.counted_cash)} — <Box component="span" sx={{ color: diffColor(c.cash_difference), fontWeight: 700 }}>{diffText(c.cash_difference)}</Box>.
          {c.notes && <> Note: {c.notes}</>} Entries for this date are locked{isAdmin ? ' (you can re-open it).' : '.'}
        </Alert>
      )}
      {c?.status === 'reopened' && (
        <Alert severity="warning" icon={<LockOpenIcon />} sx={{ mb: 2 }}>
          <strong>Re-opened</strong> by {c.reopened_by_name} on {formatDateTime(c.reopened_at)} — {c.reopen_reason}. Close the day again when the corrections are done.
        </Alert>
      )}
      {!c && (
        <Alert severity="info" icon={<LockOpenIcon />} sx={{ mb: 2 }}>
          This day is <strong>open</strong>. When the shop closes, count the cash and press <strong>Close day</strong>.
        </Alert>
      )}
      {data.unclosed_days.length > 0 && (
        <Alert severity="warning" className="no-print" sx={{ mb: 2 }}>
          Earlier days with activity that were not closed:{' '}
          {data.unclosed_days.map((d) => (
            <Chip key={d} size="small" label={formatDate(d)} onClick={() => onPick(d)} sx={{ ml: 0.5, mb: 0.25 }} />
          ))}
        </Alert>
      )}
    </>
  );
}

function SnapshotCheck({ data }) {
  const c = data.closing;
  const snap = c?.status === 'closed' ? c.snapshot?.headline : null;
  if (!snap) return null;
  const live = data.summary.headline;
  const changed = Math.abs(snap.sales - live.sales) > 0.005 || Math.abs(snap.expected_cash - live.expected_cash) > 0.005;
  if (!changed) return null;
  return (
    <Alert severity="error" sx={{ mb: 2 }}>
      Numbers changed after the day was closed (at closing: sales {formatMoney(snap.sales)}, expected cash {formatMoney(snap.expected_cash)};
      now: sales {formatMoney(live.sales)}, expected cash {formatMoney(live.expected_cash)}). Check the Activity log.
    </Alert>
  );
}

function DayView({ data }) {
  const s = data.summary;
  const file = (name) => `${name}_${data.date}.csv`;
  const sales = s.sales.totals;
  const rc = s.receipts.totals;
  const pu = s.purchases.totals;
  const ex = s.expenses.totals;
  const cm = s.craftsmen.totals;
  const st = s.stock.totals;
  const p = s.profit;
  const closing = data.closing?.status === 'closed' ? data.closing : null;

  return (
    <>
      {/* ---------- Headline ---------- */}
      <Grid container columns={{ xs: 12, lg: 15 }} spacing={2.5}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="gold" label="Sales" note={`${sales.bills} bill(s) · ${sales.pieces} piece(s)`} value={round(sales.total)} to="/sales" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="light" label="Money in" note="Customer receipts" value={round(s.cash.trading_in)} to="/customer-payments" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}><StatCard tone="light" label="Money out" note="Suppliers, craftsmen, expenses" value={round(s.cash.trading_out)} to="/finance" /></Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          {p
            ? <StatCard tone="gray" label={p.net_profit >= 0 ? 'Net profit' : 'Net loss'} note={`Margin ${pct(p.net_margin_percent)}`} value={round(p.net_profit)} />
            : <StatCard tone="gray" label="Net cash flow" note="Money in − money out" value={round(s.headline.net_cash_flow)} />}
        </Grid>
        <Grid size={{ xs: 12, sm: 12, lg: 3 }}><StatCard tone="gold" label="Cash in drawer" note="Expected by the system" value={round(s.cash.accounts.cash.closing)} to="/cash-bank" /></Grid>
      </Grid>

      {/* ---------- 1. Sales ---------- */}
      <Section no={1} title="Sales" note={sales.cancelled ? `${sales.cancelled} bill(s) cancelled (${formatMoney(sales.cancelled_amount)})` : undefined}>
        <KeyFigures items={[
          { label: 'Bills', value: sales.bills },
          { label: 'Pieces sold', value: sales.pieces },
          { label: 'Gold billed', value: g(sales.billed_g), note: `Net ${g(sales.net_g)} + wastage ${g(sales.wastage_g)}` },
          { label: 'At full price', value: formatMoney(sales.subtotal) },
          { label: 'Discounts', value: formatMoney(sales.discount), color: sales.discount > 0 ? 'error.main' : undefined },
          { label: 'Net sales', value: formatMoney(sales.total), strong: true },
          { label: 'Gold value', value: formatMoney(sales.gold_value) },
          { label: 'Making charges', value: formatMoney(sales.making) },
          { label: 'Paid on bills', value: formatMoney(sales.paid) },
          { label: 'Left on credit', value: formatMoney(sales.on_credit), color: sales.on_credit > 0 ? 'warning.main' : undefined },
        ]} />
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, md: 4 }}>
            <ReportTable title="By karat" rows={s.sales.by_karat} empty="No sales" columns={[
              { label: 'Karat', render: (r) => r.label },
              { label: 'Pcs', align: 'right', render: (r) => r.pieces },
              { label: 'Weight', align: 'right', nowrap: true, render: (r) => g(r.weight_g) },
              { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
            ]} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <ReportTable title="By category" rows={s.sales.by_category} empty="No sales" columns={[
              { label: 'Category', render: (r) => r.label },
              { label: 'Pcs', align: 'right', render: (r) => r.pieces },
              { label: 'Weight', align: 'right', nowrap: true, render: (r) => g(r.weight_g) },
              { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
            ]} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <ReportTable title="By cashier" rows={s.sales.by_cashier} empty="No sales" columns={[
              { label: 'Cashier', render: (r) => r.label },
              { label: 'Bills', align: 'right', render: (r) => r.bills },
              { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
            ]} />
          </Grid>
        </Grid>
        <ReportTable
          title="Bills"
          rows={s.sales.bills}
          empty="No bills on this day"
          columns={[
            { label: 'Time', nowrap: true, render: (r) => formatTime(r.sale_date) },
            { label: 'Bill', nowrap: true, render: (r) => <Link to={`/sales/${r.id}`}>{r.invoice_no}</Link> },
            { label: 'Customer', render: (r) => r.customer },
            { label: 'Cashier', render: (r) => r.cashier },
            { label: 'Pcs', align: 'right', render: (r) => r.pieces },
            { label: 'Discount', align: 'right', render: (r) => (r.discount ? formatMoney(r.discount) : '') },
            { label: 'Total', align: 'right', render: (r) => formatMoney(r.total) },
            { label: 'Paid', align: 'right', render: (r) => formatMoney(r.paid_amount) },
            { label: 'Balance', align: 'right', render: (r) => (r.balance ? formatMoney(r.balance) : '') },
            { label: 'Status', render: (r) => (r.status === 'cancelled'
              ? <Chip size="small" label="Cancelled" variant="outlined" />
              : <Chip size="small" variant="outlined" label={PAYMENT_STATUS[r.payment_status]?.label} color={PAYMENT_STATUS[r.payment_status]?.color} />) },
          ]}
          footer={['', 'Total', '', '', sales.pieces, formatMoney(sales.discount), formatMoney(sales.total), formatMoney(sales.paid), formatMoney(sales.on_credit), '']}
          onCsv={() => downloadCsv(file('day_bills'), [
            { label: 'Time', value: (r) => r.sale_date },
            { label: 'Bill', value: (r) => r.invoice_no },
            { label: 'Customer', value: (r) => r.customer },
            { label: 'Cashier', value: (r) => r.cashier },
            { label: 'Pieces', value: (r) => r.pieces },
            { label: 'Discount', value: (r) => r.discount },
            { label: 'Total', value: (r) => r.total },
            { label: 'Paid', value: (r) => r.paid_amount },
            { label: 'Balance', value: (r) => r.balance },
            { label: 'Status', value: (r) => (r.status === 'cancelled' ? 'cancelled' : r.payment_status) },
          ], s.sales.bills)}
        />
      </Section>

      {/* ---------- 2. Money received ---------- */}
      <Section no={2} title="Money received (income)">
        <KeyFigures items={[
          { label: 'Receipts', value: rc.count },
          { label: 'Total received', value: formatMoney(rc.total), strong: true },
          { label: "With today's bills", value: formatMoney(rc.with_todays_bills) },
          { label: 'Old bills / advances', value: formatMoney(rc.old_bills_and_advances) },
          ...s.receipts.by_method.map((m) => ({ label: method(m.label), value: formatMoney(m.amount), note: `${m.count} receipt(s)` })),
        ]} />
        <ReportTable
          title="Customer receipts"
          rows={s.receipts.list}
          empty="No money received on this day"
          columns={[
            { label: 'Time', nowrap: true, render: (r) => formatTime(r.payment_date) },
            { label: 'Receipt', nowrap: true, render: (r) => r.receipt_no },
            { label: 'Customer', render: (r) => r.customer },
            { label: 'For', render: (r) => (r.invoice_no ? `${r.invoice_no}${r.with_todays_bill ? '' : ' (old bill)'}` : 'Account / advance') },
            { label: 'Method', render: (r) => `${method(r.method)}${r.reference_no ? ` · ${r.reference_no}` : ''}` },
            { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
          ]}
          footer={['', 'Total', '', '', '', formatMoney(rc.total)]}
          onCsv={() => downloadCsv(file('day_receipts'), [
            { label: 'Time', value: (r) => r.payment_date },
            { label: 'Receipt', value: (r) => r.receipt_no },
            { label: 'Customer', value: (r) => r.customer },
            { label: 'Bill', value: (r) => r.invoice_no },
            { label: 'Method', value: (r) => method(r.method) },
            { label: 'Reference', value: (r) => r.reference_no },
            { label: 'Amount', value: (r) => r.amount },
          ], s.receipts.list)}
        />
        {s.cash.owner_entries.length > 0 && (
          <ReportTable
            title="Owner money, opening balances and transfers (not counted as income)"
            rows={s.cash.owner_entries}
            columns={[
              { label: 'Entry', nowrap: true, render: (r) => r.entry_no },
              { label: 'Type', render: (r) => CASH_ENTRY_TYPES[r.entry_type]?.label || r.entry_type },
              { label: 'Account', render: (r) => (['deposit', 'withdrawal'].includes(r.entry_type) ? '—' : ACCOUNTS[r.account]) },
              { label: 'Notes', render: (r) => r.notes || '—' },
              { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
            ]}
          />
        )}
      </Section>

      {/* ---------- 3. Purchases ---------- */}
      <Section no={3} title="Purchases & supplier payments">
        <KeyFigures items={[
          { label: 'Purchases', value: pu.count },
          { label: 'Pieces bought', value: pu.pieces },
          { label: 'Gold bought', value: g(pu.weight_g) },
          { label: 'Purchase total', value: formatMoney(pu.total), strong: true },
          { label: 'Still owed on these', value: formatMoney(pu.on_credit), color: pu.on_credit > 0 ? 'warning.main' : undefined },
          { label: 'Paid to suppliers', value: formatMoney(pu.supplier_payments), note: `${pu.supplier_payment_count} payment(s)` },
        ]} />
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, lg: 7 }}>
            <ReportTable
              title="Purchases"
              rows={s.purchases.list}
              empty="No purchases on this day"
              columns={[
                { label: 'No', nowrap: true, render: (r) => <Link to={`/purchases/${r.id}`}>{r.purchase_no}</Link> },
                { label: 'Supplier', render: (r) => <>{r.supplier}{r.supplier_invoice_no && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Inv {r.supplier_invoice_no}</Typography>}</> },
                { label: 'Pcs', align: 'right', render: (r) => r.pieces },
                { label: 'Weight', align: 'right', nowrap: true, render: (r) => g(r.total_weight_g) },
                { label: 'Total', align: 'right', render: (r) => formatMoney(r.total_amount) },
                { label: 'Balance', align: 'right', render: (r) => formatMoney(r.balance) },
              ]}
              footer={['Total', '', pu.pieces, g(pu.weight_g), formatMoney(pu.total), formatMoney(pu.on_credit)]}
            />
          </Grid>
          <Grid size={{ xs: 12, lg: 5 }}>
            <ReportTable
              title="Supplier payments"
              rows={s.purchases.supplier_payments}
              empty="No supplier payments"
              columns={[
                { label: 'No', nowrap: true, render: (r) => r.payment_no },
                { label: 'Supplier', render: (r) => r.supplier },
                { label: 'Method', render: (r) => method(r.method) },
                { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
              ]}
              footer={['Total', '', '', formatMoney(pu.supplier_payments)]}
            />
          </Grid>
        </Grid>
      </Section>

      {/* ---------- 4. Expenses ---------- */}
      <Section no={4} title="Shop expenses" note={`${ex.count} expense(s) · ${formatMoney(ex.total)}`}>
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, lg: 5 }}>
            <ReportTable title="By category" rows={s.expenses.by_category} empty="No expenses on this day" columns={[
              { label: 'Category', render: (r) => r.label },
              { label: 'Entries', align: 'right', render: (r) => r.count },
              { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
            ]} footer={['Total', ex.count, formatMoney(ex.total)]} />
          </Grid>
          <Grid size={{ xs: 12, lg: 7 }}>
            <ReportTable
              title="Expenses"
              rows={s.expenses.list}
              empty="No expenses on this day"
              columns={[
                { label: 'No', nowrap: true, render: (r) => r.expense_no },
                { label: 'Category', render: (r) => r.category },
                { label: 'Paid to', render: (r) => r.paid_to || '—' },
                { label: 'Method', render: (r) => method(r.method) },
                { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
              ]}
              onCsv={() => downloadCsv(file('day_expenses'), [
                { label: 'No', value: (r) => r.expense_no },
                { label: 'Category', value: (r) => r.category },
                { label: 'Paid to', value: (r) => r.paid_to },
                { label: 'Method', value: (r) => method(r.method) },
                { label: 'Amount', value: (r) => r.amount },
                { label: 'Notes', value: (r) => r.notes },
              ], s.expenses.list)}
            />
          </Grid>
        </Grid>
      </Section>

      {/* ---------- 5. Craftsmen ---------- */}
      <Section no={5} title="Craftsmen & workshop">
        <KeyFigures items={[
          { label: 'Jobs given out', value: cm.jobs_issued, note: `${g(cm.issued_g)} gold given` },
          { label: 'Jobs received back', value: cm.jobs_completed, note: `${g(cm.returned_g)} returned` },
          { label: 'Wastage', value: g(cm.wastage_g), note: cm.wastage_percent !== null ? `${cm.wastage_percent}% of gold given` : undefined, color: cm.wastage_g > 0 ? 'warning.main' : undefined },
          { label: 'Fees earned', value: formatMoney(cm.fees_earned), note: 'On jobs received today' },
          { label: 'Paid to craftsmen', value: formatMoney(cm.payments), note: `${cm.payment_count} payment(s)`, strong: true },
          { label: 'With craftsmen now', value: g(cm.gold_held_now_g), note: `${cm.open_jobs_now} open job(s) · fees due ${formatMoney(cm.cash_due_now)}` },
        ]} />
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, lg: 6 }}>
            <ReportTable title="Jobs given out" rows={s.craftsmen.issued} empty="No jobs given out" columns={[
              { label: 'Job', nowrap: true, render: (r) => r.job_no },
              { label: 'Craftsman', render: (r) => r.craftsman },
              { label: 'What', render: (r) => <>{r.category} · {r.karat}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{JOB_TYPES[r.job_type]}{r.description ? ` · ${r.description}` : ''}</Typography></> },
              { label: 'Gold given', align: 'right', nowrap: true, render: (r) => g(r.issued_weight_g) },
              { label: 'Status', render: (r) => <Chip size="small" variant="outlined" label={r.status} color={r.status === 'completed' ? 'success' : r.status === 'cancelled' ? 'default' : 'info'} /> },
            ]} />
          </Grid>
          <Grid size={{ xs: 12, lg: 6 }}>
            <ReportTable title="Jobs received back" rows={s.craftsmen.completed} empty="No jobs received back" columns={[
              { label: 'Job', nowrap: true, render: (r) => r.job_no },
              { label: 'Craftsman', render: (r) => <>{r.craftsman}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{r.category} · {r.karat}{r.item_code ? ` → ${r.item_code}` : ''}</Typography></> },
              { label: 'Given', align: 'right', nowrap: true, render: (r) => g(r.issued_weight_g) },
              { label: 'Returned', align: 'right', nowrap: true, render: (r) => g(r.returned_weight_g) },
              { label: 'Wastage', align: 'right', nowrap: true, render: (r) => g(r.wastage_g) },
              { label: 'Fee', align: 'right', render: (r) => formatMoney(r.craftsman_fee) },
            ]} footer={['Total', '', '', g(cm.returned_g), g(cm.wastage_g), formatMoney(cm.fees_earned)]} />
          </Grid>
          <Grid size={{ xs: 12, lg: 6 }}>
            <ReportTable title="Payments to craftsmen" rows={s.craftsmen.payments} empty="No craftsman payments" columns={[
              { label: 'No', nowrap: true, render: (r) => r.payment_no },
              { label: 'Craftsman', render: (r) => r.craftsman },
              { label: 'Job', render: (r) => r.job_no || '—' },
              { label: 'Method', render: (r) => method(r.method) },
              { label: 'Amount', align: 'right', render: (r) => formatMoney(r.amount) },
            ]} footer={['Total', '', '', '', formatMoney(cm.payments)]} />
          </Grid>
          {s.craftsmen.adjustments.length > 0 && (
            <Grid size={{ xs: 12, lg: 6 }}>
              <ReportTable title="Gold adjustments" rows={s.craftsmen.adjustments} columns={[
                { label: 'Craftsman', render: (r) => r.craftsman },
                { label: 'Type', render: (r) => GOLD_TXN[r.txn_type] || r.txn_type },
                { label: 'Karat', render: (r) => r.karat },
                { label: 'Weight', align: 'right', nowrap: true, render: (r) => g(r.weight_g) },
                { label: 'Notes', render: (r) => r.notes || r.job_no || '—' },
              ]} />
            </Grid>
          )}
        </Grid>
      </Section>

      {/* ---------- 6. Items & stock ---------- */}
      <Section no={6} title="Items & stock">
        <KeyFigures items={[
          { label: 'Pieces in', value: st.pieces_in, note: g(st.weight_in_g) },
          { label: 'Pieces out', value: st.pieces_out, note: g(st.weight_out_g) },
          { label: 'New items added', value: st.items_added },
          { label: 'In stock now', value: st.in_stock_now_pieces, note: g(st.in_stock_now_g), strong: true },
        ]} />
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, lg: 5 }}>
            <ReportTable title="Stock movements" rows={s.stock.by_type} empty="No stock moved on this day" columns={[
              { label: 'Type', render: (r) => MOVEMENT_TYPES[r.label] || r.label },
              { label: 'In', align: 'right', render: (r) => (r.pieces_in ? `${r.pieces_in} · ${g(r.weight_in_g)}` : '') },
              { label: 'Out', align: 'right', render: (r) => (r.pieces_out ? `${r.pieces_out} · ${g(r.weight_out_g)}` : '') },
            ]} footer={['Total', `${st.pieces_in} · ${g(st.weight_in_g)}`, `${st.pieces_out} · ${g(st.weight_out_g)}`]} />
          </Grid>
          <Grid size={{ xs: 12, lg: 7 }}>
            <ReportTable title="New items added" rows={s.stock.items_added} empty="No new items on this day" columns={[
              { label: 'Code', nowrap: true, render: (r) => r.item_code },
              { label: 'Item', render: (r) => <>{r.name}<Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{r.category} · {r.karat} · {SOURCES[r.source] || r.source}</Typography></> },
              { label: 'Weight', align: 'right', nowrap: true, render: (r) => g(r.net_weight_g) },
              { label: 'Qty', align: 'right', render: (r) => r.stock_qty },
              ...(s.stock.items_added.some((r) => 'cost_price' in r) ? [{ label: 'Cost', align: 'right', render: (r) => formatMoney(r.cost_price) }] : []),
            ]} />
          </Grid>
        </Grid>
      </Section>

      {/* ---------- 7. Cash & bank ---------- */}
      <Section no={7} title="Cash & bank">
        <Grid container spacing={2.5}>
          {['cash', 'bank'].map((acc) => {
            const a = s.cash.accounts[acc];
            const moves = s.cash.movements.filter((m) => m.account === acc);
            return (
              <Grid key={acc} size={{ xs: 12, lg: 6 }}>
                <Statement
                  title={ACCOUNTS[acc]}
                  rows={[
                    { label: 'Opening balance', value: formatMoney(a.opening), muted: true },
                    ...moves.map((m) => ({
                      label: `${m.direction > 0 ? '+' : '−'} ${MONEY_KINDS[m.kind]?.label || m.kind} (${m.count})`,
                      value: formatMoney(m.direction * m.amount),
                      indent: true,
                      color: m.direction > 0 ? 'success.main' : 'error.main',
                    })),
                    !moves.length && { label: 'No money moved', value: '', indent: true, muted: true },
                    { label: acc === 'cash' ? 'Expected cash in drawer' : 'Expected bank balance', value: formatMoney(a.closing), total: true, big: true },
                    acc === 'cash' && closing && { label: 'Cash counted', value: formatMoney(closing.counted_cash) },
                    acc === 'cash' && closing && { label: 'Short / over', value: diffText(closing.cash_difference), color: diffColor(closing.cash_difference) },
                  ]}
                />
              </Grid>
            );
          })}
        </Grid>
      </Section>

      {/* ---------- 8. Profit & loss ---------- */}
      {p && (
        <Section no={8} title="Profit & loss" note="Craftsman fees are already part of the cost of items they made">
          {p.lines_without_cost > 0 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {p.lines_without_cost} piece(s) sold have no cost price, so profit on them looks higher than it is.
            </Alert>
          )}
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, lg: 6 }}>
              <Statement
                title="Profit & loss statement"
                rows={[
                  { label: 'Sales at full price', value: formatMoney(sales.subtotal) },
                  { label: 'Less: discounts', value: formatMoney(-sales.discount), indent: true },
                  { label: 'Net sales (revenue)', value: formatMoney(p.revenue), total: true },
                  { label: 'Less: cost of pieces sold', value: formatMoney(-p.cost_of_sales), indent: true },
                  { label: `Gross profit (${pct(p.gross_margin_percent)})`, value: formatMoney(p.gross_profit), total: true, color: p.gross_profit < 0 ? 'error.main' : undefined },
                  ...s.expenses.by_category.map((e) => ({ label: `Less: ${e.label}`, value: formatMoney(-e.amount), indent: true })),
                  !s.expenses.by_category.length && { label: 'Less: shop expenses', value: formatMoney(0), indent: true },
                  {
                    label: `${p.net_profit >= 0 ? 'Net profit' : 'Net loss'} (${pct(p.net_margin_percent)})`,
                    value: formatMoney(p.net_profit), total: true, big: true, color: p.net_profit < 0 ? 'error.main' : 'success.main',
                  },
                ]}
              />
            </Grid>
            <Grid size={{ xs: 12, lg: 6 }}>
              <ReportTable title="Profit by category" rows={p.by_category} empty="No sales" columns={[
                { label: 'Category', render: (r) => r.label },
                { label: 'Pcs', align: 'right', render: (r) => r.pieces },
                { label: 'Revenue', align: 'right', render: (r) => formatMoney(r.revenue) },
                { label: 'Cost', align: 'right', render: (r) => formatMoney(r.cost) },
                { label: 'Profit', align: 'right', render: (r) => <Box component="span" sx={{ color: r.profit < 0 ? 'error.main' : undefined }}>{formatMoney(r.profit)}</Box> },
              ]} footer={['Total', sales.pieces, formatMoney(p.revenue), formatMoney(p.cost_of_sales), formatMoney(p.gross_profit)]} />
            </Grid>
          </Grid>
        </Section>
      )}
    </>
  );
}

export default function DayEndPage() {
  const { user, can } = useAuth();
  const isAdmin = !!user?.is_super_admin;
  const [date, setDate] = useState(todayYmd);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState(null); // 'close' | 'reopen'
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.get('/day-end', { params: { date } })
      .then((res) => active && setData(res.data))
      .catch((err) => active && setError(errorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [date]);

  useEffect(() => load(), [load, reloadKey]);

  const pick = (d) => { setDate(d); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const done = () => { setDialog(null); setReloadKey((k) => k + 1); };

  const closing = data?.date === date ? data.closing : null;
  const isClosed = closing?.status === 'closed';
  const canClose = data && data.date === date && !data.is_future && !isClosed && can('day_end.close');

  return (
    <>
      <style>{PRINT_CSS}</style>
      <PageHeader
        title="Day End"
        subtitle="Everything that happened in the shop on one day, and closing the day"
        actions={(
          <Box className="no-print" sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="outlined" sx={{ minWidth: 0, px: 1 }} aria-label="Previous day" onClick={() => setDate(shiftDay(date, -1))}><ChevronLeftIcon /></Button>
            <TextField type="date" size="small" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} sx={{ width: 165 }} />
            <Button variant="outlined" sx={{ minWidth: 0, px: 1 }} aria-label="Next day" onClick={() => setDate(shiftDay(date, 1))}><ChevronRightIcon /></Button>
            {date !== todayYmd() && <Button onClick={() => setDate(todayYmd())}>Today</Button>}
            <Button variant="outlined" startIcon={<PrintIcon />} onClick={() => window.print()} disabled={!data}>Print</Button>
            {canClose && <Button variant="contained" startIcon={<LockIcon />} onClick={() => setDialog('close')}>Close day</Button>}
            {isClosed && isAdmin && <Button variant="outlined" color="error" startIcon={<LockOpenIcon />} onClick={() => setDialog('reopen')}>Re-open</Button>}
          </Box>
        )}
      />
      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box id="day-end">
        <Typography sx={{ display: 'none', '@media print': { display: 'block' }, fontWeight: 700, fontSize: 22, mb: 1 }}>
          Day End · {formatDate(date)}{isClosed ? ' · CLOSED' : ''}
        </Typography>
        {data && (
          <>
            <StatusBanner data={data} isAdmin={isAdmin} onPick={pick} />
            <SnapshotCheck data={data} />
            <DayView data={data} />
          </>
        )}
      </Box>

      <Box className="no-print" sx={{ mt: 5 }}>
        <Typography component="h2" sx={{ fontWeight: 600, fontSize: 20, mb: 1.5 }}>History</Typography>
        <DayEndHistory reloadKey={reloadKey} onPick={pick} showProfit={can('reports.profit')} />
      </Box>

      {dialog === 'close' && data && (
        <CloseDayDialog date={data.date} cash={data.summary.cash.accounts.cash} bank={data.summary.cash.accounts.bank} onClose={() => setDialog(null)} onClosed={done} />
      )}
      {dialog === 'reopen' && closing && <ReopenDayDialog closing={closing} onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}
