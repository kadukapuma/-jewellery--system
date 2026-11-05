import { Box, Button, ButtonBase, Card, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import { ink, stone } from '../../theme';
import { todayYmd } from '../../utils/payments';
import TablePager, { usePagedRows } from '../../components/TablePager';

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const PRESETS = [
  { key: 'today', label: 'Today', range: () => [todayYmd(), todayYmd()] },
  { key: '7d', label: '7 days', range: () => { const d = new Date(); d.setDate(d.getDate() - 6); return [ymd(d), todayYmd()]; } },
  { key: 'month', label: 'This month', range: () => { const d = new Date(); return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), todayYmd()]; } },
  { key: '30d', label: '30 days', range: () => { const d = new Date(); d.setDate(d.getDate() - 29); return [ymd(d), todayYmd()]; } },
  { key: 'year', label: 'This year', range: () => [`${new Date().getFullYear()}-01-01`, todayYmd()] },
];

// Pill presets + custom from/to dates, in one row above the report.
export function DateRangeBar({ range, onChange }) {
  const active = PRESETS.find((p) => { const [f, t] = p.range(); return f === range.from && t === range.to; })?.key;
  return (
    <Box className="no-print" sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 2.5 }}>
      <Box sx={{ display: 'flex', gap: 0.5, p: 0.5, bgcolor: stone[50], border: `1px solid ${stone[100]}`, borderRadius: 999, flexWrap: 'wrap' }}>
        {PRESETS.map((p) => (
          <ButtonBase key={p.key} onClick={() => { const [from, to] = p.range(); onChange({ from, to }); }}
            sx={{ px: 1.75, height: 34, borderRadius: 999, fontWeight: 600, fontSize: 13, bgcolor: active === p.key ? ink : 'transparent', color: active === p.key ? '#fff' : ink }}>
            {p.label}
          </ButtonBase>
        ))}
      </Box>
      <TextField label="From" type="date" value={range.from} onChange={(e) => e.target.value && onChange({ ...range, from: e.target.value })}
        sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true } }} />
      <TextField label="To" type="date" value={range.to} onChange={(e) => e.target.value && onChange({ ...range, to: e.target.value })}
        sx={{ width: 160 }} slotProps={{ inputLabel: { shrink: true } }} />
    </Box>
  );
}

export function CsvButton({ onClick }) {
  return <Button size="small" startIcon={<DownloadIcon />} onClick={onClick} className="no-print">CSV</Button>;
}

// A titled card holding a simple table. columns: [{ label, align?, render: (row) => node }]
// Paged on screen; every row still prints (rows off the current page are only hidden on screen).
export function ReportTable({ title, columns, rows, footer, onCsv, empty = 'Nothing in this period', maxHeight }) {
  const { pager } = usePagedRows(rows);
  const first = pager.page * pager.rowsPerPage;
  const offPage = (i) => i < first || i >= first + pager.rowsPerPage;
  return (
    <Card sx={{ mb: 2.5, breakInside: 'avoid' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, pt: 1.5, pb: 0.5 }}>
        <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>{title}</Typography>
        {onCsv && rows.length > 0 && <CsvButton onClick={onCsv} />}
      </Box>
      <TableContainer sx={{ maxHeight }}>
        <Table size="small" stickyHeader={!!maxHeight}>
          <TableHead>
            <TableRow>{columns.map((c) => <TableCell key={c.label} align={c.align}>{c.label}</TableCell>)}</TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.id ?? r.key ?? i} hover sx={offPage(i) ? { '@media screen': { display: 'none' } } : undefined}>
                {columns.map((c) => <TableCell key={c.label} align={c.align} sx={{ whiteSpace: c.nowrap ? 'nowrap' : undefined }}>{c.render(r)}</TableCell>)}
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow><TableCell colSpan={columns.length} align="center" sx={{ py: 3, color: 'text.secondary' }}>{empty}</TableCell></TableRow>
            )}
            {footer && rows.length > 0 && (
              <TableRow sx={{ '& td': { fontWeight: 700 } }}>
                {columns.map((c, i) => <TableCell key={c.label} align={c.align} sx={{ whiteSpace: 'nowrap' }}>{footer[i] ?? ''}</TableCell>)}
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {rows.length > 0 && <TablePager {...pager} />}
    </Card>
  );
}
