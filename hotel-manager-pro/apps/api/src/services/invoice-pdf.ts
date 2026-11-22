import { currencyDigits } from '@hmp/shared';
import PDFDocument from 'pdfkit';

export interface InvoicePdfData {
  kind: 'invoice' | 'credit_note';
  number: string;
  status: 'issued' | 'void';
  currency: string;
  issuedAt: Date;
  dueAt: Date | null;
  timezone: string;
  hotel: { name: string; legalName?: string | null; taxId?: string | null; address?: string | null; city?: string | null; phone?: string | null; email?: string | null };
  guest: { name: string; email?: string | null; phone?: string | null; address?: string | null; city?: string | null; country?: string | null };
  reference: string | null;
  creditedInvoiceNumber: string | null;
  lines: Array<{ description: string; quantity: number; unitAmount: number; amount: number; taxAmount: number }>;
  subtotal: number;
  tax: number;
  total: number;
  paid: number | null;
  header: string | null;
  footer: string | null;
  voidReason?: string | null;
}

/** Montant lisible dans la police standard du PDF (pas d'espace insécable fine : elle n'existe pas dans WinAnsi). */
export function pdfMoney(minor: number, currency: string): string {
  const d = currencyDigits(currency);
  const abs = Math.abs(minor) / 10 ** d;
  const [int = '0', dec] = abs.toFixed(d).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${minor < 0 ? '-' : ''}${grouped}${dec ? `,${dec}` : ''} ${currency === 'MGA' ? 'Ar' : currency}`;
}

const fmtDate = (d: Date, tz: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d).replace(/ | /g, ' ');

/** Facture ou avoir au format A4, générée à la demande à partir des données FIGÉES de la facture. */
export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `${data.kind === 'credit_note' ? 'Avoir' : 'Facture'} ${data.number}`, Producer: 'Hotel Manager Pro' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 48;
    const W = doc.page.width - 2 * L;
    const ink = '#1d2433';
    const mute = '#5b667a';

    // Émetteur
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(16).text(data.hotel.name, L, 48, { width: W * 0.6 });
    doc.font('Helvetica').fontSize(9).fillColor(mute);
    const hotelLines = [data.hotel.legalName, [data.hotel.address, data.hotel.city].filter(Boolean).join(', '), [data.hotel.phone, data.hotel.email].filter(Boolean).join(' · '), data.hotel.taxId ? `NIF / identifiant fiscal : ${data.hotel.taxId}` : null].filter(Boolean) as string[];
    for (const l of hotelLines) doc.text(l, { width: W * 0.6 });

    // Titre et numéro
    const title = data.kind === 'credit_note' ? 'AVOIR' : 'FACTURE';
    doc.font('Helvetica-Bold').fontSize(20).fillColor(ink).text(title, L + W * 0.6, 48, { width: W * 0.4, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(mute).text(`N° ${data.number}`, { width: W * 0.4, align: 'right', continued: false });
    doc.text(`Date : ${fmtDate(data.issuedAt, data.timezone)}`, { width: W * 0.4, align: 'right' });
    if (data.dueAt) doc.text(`Échéance : ${fmtDate(data.dueAt, data.timezone)}`, { width: W * 0.4, align: 'right' });
    if (data.reference) doc.text(`Réservation : ${data.reference}`, { width: W * 0.4, align: 'right' });
    if (data.creditedInvoiceNumber) doc.text(`Avoir sur la facture ${data.creditedInvoiceNumber}`, { width: W * 0.4, align: 'right' });
    if (data.status === 'void') doc.fillColor('#b3261e').font('Helvetica-Bold').text('ANNULÉE', { width: W * 0.4, align: 'right' });

    // Client
    doc.moveDown(2);
    let y = Math.max(doc.y, 150);
    doc.fillColor(mute).font('Helvetica').fontSize(8).text('FACTURÉ À', L, y);
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(11).text(data.guest.name, L, y + 12);
    doc.font('Helvetica').fontSize(9).fillColor(mute);
    for (const l of [data.guest.address, [data.guest.city, data.guest.country].filter(Boolean).join(', '), data.guest.email, data.guest.phone].filter(Boolean) as string[]) doc.text(l, L);
    if (data.header) { doc.moveDown(0.8); doc.fillColor(ink).fontSize(9).text(data.header, L, doc.y, { width: W }); }

    // Lignes
    y = doc.y + 18;
    const cols = { desc: L, qty: L + W * 0.52, unit: L + W * 0.6, tax: L + W * 0.78, amt: L + W * 0.88 };
    const colW = { desc: W * 0.5, qty: W * 0.06, unit: W * 0.16, tax: W * 0.09, amt: W * 0.12 };
    doc.rect(L, y, W, 20).fill('#eef1f6');
    doc.fillColor(ink).font('Helvetica-Bold').fontSize(8.5);
    doc.text('Désignation', cols.desc + 6, y + 6, { width: colW.desc });
    doc.text('Qté', cols.qty, y + 6, { width: colW.qty, align: 'right' });
    doc.text('Prix unitaire', cols.unit, y + 6, { width: colW.unit, align: 'right' });
    doc.text('Taxe', cols.tax, y + 6, { width: colW.tax, align: 'right' });
    doc.text('Montant HT', cols.amt, y + 6, { width: colW.amt, align: 'right' });
    y += 26;
    doc.font('Helvetica').fontSize(9).fillColor(ink);
    for (const l of data.lines) {
      const h = Math.max(doc.heightOfString(l.description, { width: colW.desc - 6 }), 12) + 8;
      if (y + h > doc.page.height - 160) { doc.addPage(); y = 60; }
      doc.fillColor(ink).text(l.description, cols.desc + 6, y, { width: colW.desc - 6 });
      doc.text(String(Number(l.quantity)), cols.qty, y, { width: colW.qty, align: 'right' });
      doc.text(pdfMoney(l.unitAmount, data.currency), cols.unit, y, { width: colW.unit, align: 'right' });
      doc.text(l.taxAmount ? pdfMoney(l.taxAmount, data.currency) : '—', cols.tax, y, { width: colW.tax, align: 'right' });
      doc.text(pdfMoney(l.amount, data.currency), cols.amt, y, { width: colW.amt, align: 'right' });
      y += h;
      doc.moveTo(L, y - 3).lineTo(L + W, y - 3).strokeColor('#dde2ec').lineWidth(0.5).stroke();
    }

    // Totaux
    if (y > doc.page.height - 180) { doc.addPage(); y = 60; }
    y += 10;
    const tx = L + W * 0.55;
    const tw = W * 0.45;
    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9.5).fillColor(ink);
      doc.text(label, tx, y, { width: tw * 0.55 });
      doc.text(value, tx + tw * 0.4, y, { width: tw * 0.6, align: 'right' });
      y += bold ? 20 : 15;
    };
    row('Total hors taxe', pdfMoney(data.subtotal, data.currency));
    row('Taxes', pdfMoney(data.tax, data.currency));
    doc.moveTo(tx, y).lineTo(L + W, y).strokeColor(ink).lineWidth(0.8).stroke();
    y += 6;
    row(data.kind === 'credit_note' ? 'Total de l\'avoir' : 'Total à payer', pdfMoney(data.total, data.currency), true);
    if (data.paid !== null && data.kind === 'invoice') {
      row('Déjà réglé', pdfMoney(data.paid, data.currency));
      row('Reste à payer', pdfMoney(Math.max(data.total - data.paid, 0), data.currency), true);
    }
    if (data.voidReason) { doc.fillColor('#b3261e').fontSize(9).text(`Annulée : ${data.voidReason}`, L, y + 6, { width: W }); }

    if (data.footer) doc.fillColor(mute).font('Helvetica').fontSize(8.5).text(data.footer, L, doc.page.height - 90, { width: W, align: 'center' });
    doc.end();
  });
}
