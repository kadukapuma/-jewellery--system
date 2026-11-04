import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import TagLabel from './TagLabel';

// Renders the tags off-screen and opens the browser print dialog.
// While printing, everything else on the page is hidden and each tag gets its own page
// sized to the label, so a label printer feeds one tag per label.
export default function PrintArea({ job, onDone }) {
  const { template, items, copies, shop_name: shopName } = job;

  useEffect(() => {
    const finish = () => onDone();
    window.addEventListener('afterprint', finish);
    // Give barcodes / QR codes a moment to draw before printing.
    const timer = setTimeout(() => window.print(), 400);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
    };
  }, [onDone]);

  const labels = items.flatMap((item) => Array.from({ length: copies }, (_, n) => ({ item, key: `${item.id}-${n}` })));

  return createPortal(
    <div className="tag-print-root">
      <style>{`
        .tag-print-root { position: fixed; left: -10000px; top: 0; }
        @media print {
          @page { size: ${template.width_mm}mm ${template.height_mm}mm; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          body > *:not(.tag-print-root) { display: none !important; }
          .tag-print-root { position: static; left: 0; }
          .tag-page { width: ${template.width_mm}mm; height: ${template.height_mm}mm; overflow: hidden; break-after: page; page-break-after: always; }
          .tag-page:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
      {labels.map(({ item, key }) => (
        <div className="tag-page" key={key}>
          <TagLabel template={template} item={item} shopName={shopName} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
