import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

export const FIELD_LABELS = {
  shop_name: 'Shop name',
  barcode: 'Barcode',
  item_code: 'Item code',
  name: 'Item name',
  category: 'Category',
  karat: 'Karat',
  net_weight_g: 'Net weight',
  wastage_g: 'Wastage',
};

export const SAMPLE_ITEM = {
  barcode: 'JW000123',
  item_code: 'RNG-0123',
  name: 'Ladies ring',
  category_name: 'Rings',
  karat_name: '22K',
  net_weight_g: 7,
  wastage_g: 1,
};

function Barcode({ value }) {
  const ref = useRef(null);
  useEffect(() => {
    const svg = ref.current;
    JsBarcode(svg, value, { format: 'CODE128', displayValue: false, margin: 0, height: 40, width: 2 });
    // Let the bars stretch to the box; widths stay proportional so it still scans.
    const w = svg.getAttribute('width');
    const h = svg.getAttribute('height');
    svg.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
  }, [value]);
  return <svg ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

function Qr({ value }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let active = true;
    QRCode.toString(value, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then((s) => active && setSvg(s));
    return () => { active = false; };
  }, [value]);
  return <div style={{ height: '100%', aspectRatio: '1', lineHeight: 0 }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function textLines(fields, item) {
  const has = (f) => fields.includes(f);
  const lines = [];
  if (has('item_code')) lines.push({ text: item.item_code, bold: true });
  if (has('name')) lines.push({ text: item.name });
  if (has('category')) lines.push({ text: item.category_name });
  const kw = [has('karat') && item.karat_name, has('net_weight_g') && `${Number(item.net_weight_g).toFixed(3)}g`].filter(Boolean).join('  ');
  if (kw) lines.push({ text: kw, bold: true });
  if (has('wastage_g') && Number(item.wastage_g) > 0) lines.push({ text: `W ${Number(item.wastage_g).toFixed(3)}g` });
  return lines;
}

// One physical tag, sized in millimetres. Wide tags (jewellery "dumbbell" tags) put the
// barcode on one half and the text on the other; squarer labels stack them.
export default function TagLabel({ template, item, shopName }) {
  const { width_mm: w, height_mm: h, fields, barcode_type } = template;
  const wide = w / h >= 3;
  const showCode = fields.includes('barcode');
  const showShop = fields.includes('shop_name');
  const lines = textLines(fields, item);
  const textCount = lines.length + (showShop && !wide ? 1 : 0);
  const textHeight = wide ? h : h * (showCode ? 0.45 : 1);
  const font = Math.min(2.6, Math.max(1.2, (textHeight - 1) / (Math.max(textCount, 1) * 1.2)));

  const text = (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0, minWidth: 0, overflow: 'hidden' }}>
      {!wide && showShop && <div style={{ fontSize: `${font}mm`, fontWeight: 700, lineHeight: 1.15, whiteSpace: 'nowrap' }}>{shopName}</div>}
      {lines.map((l, i) => (
        <div key={i} style={{ fontSize: `${font}mm`, fontWeight: l.bold ? 700 : 400, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {l.text}
        </div>
      ))}
    </div>
  );

  const code = showCode && (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: 0, height: '100%' }}>
      {wide && showShop && <div style={{ fontSize: `${Math.min(font, 2)}mm`, fontWeight: 700, lineHeight: 1.1, whiteSpace: 'nowrap' }}>{shopName}</div>}
      <div style={{ flex: 1, width: barcode_type === 'QR' ? 'auto' : '100%', minHeight: 0, display: 'flex', justifyContent: 'center', padding: '0.3mm 0' }}>
        {barcode_type === 'QR' ? <Qr value={item.barcode} /> : <Barcode value={item.barcode} />}
      </div>
      {barcode_type !== 'QR' && <div style={{ fontSize: `${Math.min(font, 1.8)}mm`, lineHeight: 1, letterSpacing: '0.2mm' }}>{item.barcode}</div>}
    </div>
  );

  return (
    <div
      className="tag-label"
      style={{
        width: `${w}mm`,
        height: `${h}mm`,
        boxSizing: 'border-box',
        padding: '0.8mm 1.2mm',
        background: '#fff',
        color: '#000',
        fontFamily: 'Arial, Helvetica, sans-serif',
        display: 'grid',
        gridTemplateColumns: wide ? (showCode ? '1fr 1fr' : '1fr') : '1fr',
        gridTemplateRows: wide ? '1fr' : showCode ? '45% 55%' : '1fr',
        columnGap: '2mm',
        overflow: 'hidden',
      }}
    >
      {wide ? <>{code}{text}</> : <>{text}{code}</>}
    </div>
  );
}
