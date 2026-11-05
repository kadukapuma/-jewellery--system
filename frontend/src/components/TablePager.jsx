import { useState } from 'react';
import { TablePagination } from '@mui/material';

export const PAGE_SIZES = [10, 25, 50, 100];

// Client-side paging for tables whose rows are already loaded.
// const { pageRows, pager } = usePagedRows(rows); … map pageRows … <TablePager {...pager} />
export function usePagedRows(rows, initialSize = 25) {
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(initialSize);
  const list = rows || [];
  // When filtering shrinks the list, stay on the last page that still has rows.
  const current = Math.min(page, Math.max(0, Math.ceil(list.length / size) - 1));
  return {
    pageRows: list.slice(current * size, current * size + size),
    pager: {
      count: list.length,
      page: current,
      rowsPerPage: size,
      onPageChange: (e, p) => setPage(p),
      onRowsPerPageChange: (e) => { setSize(Number(e.target.value)); setPage(0); },
    },
  };
}

export default function TablePager(props) {
  return <TablePagination component="div" rowsPerPageOptions={PAGE_SIZES} className="no-print" {...props} />;
}
