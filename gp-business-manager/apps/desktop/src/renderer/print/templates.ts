import { money, qty, dateTime, dateOnly } from '../lib/format';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]!);

export interface PrintCompany { name: string; legalName?: string | null; taxId?: string | null; statNo?: string | null; address?: string | null; phone?: string | null; email?: string | null; logo?: string | null; receiptFooter?: string | null; invoiceNotes?: string | null }

/** Ticket de caisse 80 mm. */
export function receiptHtml(co: PrintCompany, s: any, tr: (k: string) => string): string {
  const lines = s.items.map((i: any) => `
    <tr><td colspan="3" class="n">${esc(i.name)}</td></tr>
    <tr><td>${qty(i.qtyMilli)} × ${money(i.unitPrice)}</td><td class="r">${i.discount + i.cartDiscountShare > 0 ? '−' + money(i.discount + i.cartDiscountShare) : ''}</td><td class="r b">${money(i.total)}</td></tr>`).join('');
  const pays = s.payments.filter((p: any) => p.direction === 'IN').map((p: any) => `<tr><td>${esc(p.methodName)}</td><td class="r">${money(p.tendered ?? p.amount)}</td></tr>`).join('');
  const due = s.total - s.returnedTotal - s.paidTotal;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:80mm auto;margin:0} body{width:72mm;margin:0 auto;padding:4mm 0;font:11px/1.35 'Segoe UI',Arial,sans-serif;color:#000}
    h1{font-size:15px;text-align:center;margin:0 0 2px} .c{text-align:center} .s{font-size:10px;color:#333} hr{border:0;border-top:1px dashed #000;margin:6px 0}
    table{width:100%;border-collapse:collapse} td{padding:1px 0;vertical-align:top} .r{text-align:right;white-space:nowrap} .b{font-weight:700} .n{padding-top:4px;font-weight:600}
    .tot td{font-size:13px;font-weight:700;padding-top:3px} img{max-width:40mm;max-height:18mm;display:block;margin:0 auto 4px}
  </style></head><body>
  ${co.logo ? `<img src="${co.logo}">` : ''}<h1>${esc(co.name)}</h1>
  <div class="c s">${[co.address, co.phone, co.taxId ? 'NIF ' + co.taxId : '', co.statNo ? 'STAT ' + co.statNo : ''].filter(Boolean).map(esc).join('<br>')}</div><hr>
  <div class="s">${tr('Ticket')} ${esc(s.number)}<br>${dateTime(s.createdAt)}<br>${tr('Caissier')} : ${esc(s.userName)}${s.customerName ? `<br>${tr('Client')} : ${esc(s.customerName)}` : ''}</div><hr>
  <table>${lines}</table><hr>
  <table>
    ${s.lineDiscountTotal + s.cartDiscountTotal > 0 ? `<tr><td>${tr('Remises')}</td><td class="r">−${money(s.lineDiscountTotal + s.cartDiscountTotal)}</td></tr>` : ''}
    ${s.taxTotal > 0 ? `<tr><td>${tr('Total HT')}</td><td class="r">${money(s.netTotal)}</td></tr><tr><td>${tr('Taxe')}</td><td class="r">${money(s.taxTotal)}</td></tr>` : ''}
    <tr class="tot"><td>${tr('TOTAL')}</td><td class="r">${money(s.total)}</td></tr>
  </table><hr>
  <table>${pays}${s.changeGiven > 0 ? `<tr><td>${tr('Rendu')}</td><td class="r b">${money(s.changeGiven)}</td></tr>` : ''}${due > 0 ? `<tr><td class="b">${tr('Reste dû')}</td><td class="r b">${money(due)}</td></tr>` : ''}</table>
  <hr><div class="c s">${esc(co.receiptFooter ?? '')}</div></body></html>`;
}

/** Facture A4. */
export function invoiceHtml(co: PrintCompany, s: any, inv: { number: string; issuedAt: string }, tr: (k: string) => string): string {
  const rows = s.items.map((i: any, n: number) => `<tr><td>${n + 1}</td><td>${esc(i.name)}<div class="sku">${esc(i.sku)}</div></td><td class="r">${qty(i.qtyMilli)}</td><td class="r">${money(i.unitPrice)}</td><td class="r">${i.taxRateBp ? i.taxRateBp / 100 + ' %' : '—'}</td><td class="r">${money(i.discount + i.cartDiscountShare)}</td><td class="r b">${money(i.total)}</td></tr>`).join('');
  const due = s.total - s.returnedTotal - s.paidTotal;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:14mm} body{font:12px/1.45 'Segoe UI',Arial,sans-serif;color:#1b2338;margin:0}
    .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px} .co h1{margin:0 0 4px;font-size:20px} .co div{color:#555}
    .doc{text-align:right} .doc h2{margin:0;font-size:26px;letter-spacing:.06em;color:#a0721d} .doc div{color:#555}
    .box{border:1px solid #e0ddd2;border-radius:8px;padding:10px 14px;margin-bottom:18px;width:48%} .box b{display:block;margin-bottom:3px}
    table{width:100%;border-collapse:collapse} th{background:#1b2038;color:#fff;text-align:left;padding:7px 8px;font-weight:600;font-size:11px}
    td{padding:7px 8px;border-bottom:1px solid #eeece5;vertical-align:top} .r{text-align:right;white-space:nowrap} .b{font-weight:700} .sku{color:#888;font-size:10px}
    .tot{margin:16px 0 0 auto;width:46%} .tot td{border:0;padding:3px 8px} .tot .g td{font-size:15px;font-weight:700;border-top:2px solid #1b2038;padding-top:8px}
    .paid{color:#047857;font-weight:700;border:2px solid #047857;display:inline-block;padding:2px 10px;border-radius:6px;transform:rotate(-6deg);margin-top:10px}
    .foot{margin-top:30px;color:#666;font-size:11px;border-top:1px solid #e0ddd2;padding-top:8px} img.logo{max-height:56px;margin-bottom:6px}
  </style></head><body>
  <div class="top"><div class="co">${co.logo ? `<img class="logo" src="${co.logo}">` : ''}<h1>${esc(co.legalName || co.name)}</h1>
    <div>${[co.address, co.phone, co.email].filter(Boolean).map(esc).join('<br>')}${co.taxId ? `<br>NIF : ${esc(co.taxId)}` : ''}${co.statNo ? ` · STAT : ${esc(co.statNo)}` : ''}</div></div>
    <div class="doc"><h2>${tr('FACTURE')}</h2><div><b>N° ${esc(inv.number)}</b><br>${tr('Date')} : ${dateOnly(inv.issuedAt)}<br>${tr('Vente')} : ${esc(s.number)}${s.dueDate ? `<br>${tr('Échéance')} : ${dateOnly(s.dueDate)}` : ''}</div></div></div>
  <div class="box"><b>${tr('Facturé à')}</b>${s.customerName ? `${esc(s.customerName)}${s.customerAddress ? '<br>' + esc(s.customerAddress) : ''}${s.customerPhone ? '<br>' + esc(s.customerPhone) : ''}${s.customerTaxId ? '<br>NIF : ' + esc(s.customerTaxId) : ''}` : tr('Client comptoir')}</div>
  <table><thead><tr><th>#</th><th>${tr('Désignation')}</th><th class="r">${tr('Qté')}</th><th class="r">${tr('P.U.')}</th><th class="r">${tr('Taxe')}</th><th class="r">${tr('Remise')}</th><th class="r">${tr('Total')}</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="tot">
    <tr><td>${tr('Total HT')}</td><td class="r">${money(s.netTotal)}</td></tr><tr><td>${tr('Taxe')}</td><td class="r">${money(s.taxTotal)}</td></tr>
    ${s.returnedTotal > 0 ? `<tr><td>${tr('Retours')}</td><td class="r">−${money(s.returnedTotal)}</td></tr>` : ''}
    <tr class="g"><td>${tr('TOTAL TTC')}</td><td class="r">${money(s.total - s.returnedTotal)}</td></tr>
    <tr><td>${tr('Réglé')}</td><td class="r">${money(s.paidTotal)}</td></tr>${due > 0 ? `<tr><td class="b">${tr('Reste à payer')}</td><td class="r b">${money(due)}</td></tr>` : ''}
  </table>
  ${due <= 0 ? `<div class="paid">${tr('ACQUITTÉE')}</div>` : ''}
  <div class="foot">${esc(co.invoiceNotes ?? '')}</div></body></html>`;
}
