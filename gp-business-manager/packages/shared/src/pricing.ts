import { allocate, mulQty, percentOf, roundDiv } from './money';

export interface CartLineInput {
  qtyMilli: number;
  /** prix unitaire en unité mineure (TTC si pricesIncludeTax, sinon HT) */
  unitPrice: number;
  /** remise ligne en pourcentage (points de base) — prioritaire sur discountAmount */
  discountBp?: number;
  /** remise ligne en montant */
  discountAmount?: number;
  taxRateBp: number;
}

export type CartDiscount = { type: 'percent'; bp: number } | { type: 'amount'; amount: number } | null;

export interface CartLineResult {
  gross: number;
  lineDiscount: number;
  cartDiscountShare: number;
  /** montant HT de la ligne */
  net: number;
  tax: number;
  /** montant TTC de la ligne */
  total: number;
}

export interface CartResult {
  lines: CartLineResult[];
  subtotal: number; // somme des montants bruts
  lineDiscountTotal: number;
  cartDiscountTotal: number;
  netTotal: number; // HT
  taxTotal: number;
  total: number; // TTC à payer
}

/**
 * Calcule un panier. Règles :
 *  1. brut = prix × quantité (arrondi) ;
 *  2. remise ligne (% ou montant, plafonnée au brut) ;
 *  3. remise globale répartie au prorata (plus fort reste) ;
 *  4. taxe calculée par ligne (incluse ou ajoutée selon `pricesIncludeTax`).
 */
export function computeCart(
  lines: CartLineInput[],
  opts: { pricesIncludeTax: boolean; cartDiscount?: CartDiscount },
): CartResult {
  const gross = lines.map((l) => mulQty(l.unitPrice, l.qtyMilli));
  const lineDisc = lines.map((l, i) => {
    const d = l.discountBp ? percentOf(gross[i], l.discountBp) : (l.discountAmount ?? 0);
    return Math.max(0, Math.min(d, gross[i]));
  });
  const afterLine = gross.map((g, i) => g - lineDisc[i]);
  const afterLineSum = afterLine.reduce((a, b) => a + b, 0);

  let cartDisc = 0;
  const cd = opts.cartDiscount;
  if (cd) cartDisc = cd.type === 'percent' ? percentOf(afterLineSum, cd.bp) : cd.amount;
  cartDisc = Math.max(0, Math.min(cartDisc, afterLineSum));
  const shares = allocate(cartDisc, afterLine);

  const results: CartLineResult[] = lines.map((l, i) => {
    const paid = afterLine[i] - shares[i]; // base de la ligne après remises
    let net: number, tax: number, total: number;
    if (opts.pricesIncludeTax) {
      total = paid;
      net = roundDiv(paid * 10000, 10000 + l.taxRateBp);
      tax = total - net;
    } else {
      net = paid;
      tax = percentOf(paid, l.taxRateBp);
      total = net + tax;
    }
    return { gross: gross[i], lineDiscount: lineDisc[i], cartDiscountShare: shares[i], net, tax, total };
  });

  const sum = (f: (r: CartLineResult) => number) => results.reduce((a, r) => a + f(r), 0);
  return {
    lines: results,
    subtotal: sum((r) => r.gross),
    lineDiscountTotal: sum((r) => r.lineDiscount),
    cartDiscountTotal: sum((r) => r.cartDiscountShare),
    netTotal: sum((r) => r.net),
    taxTotal: sum((r) => r.tax),
    total: sum((r) => r.total),
  };
}

export type PaymentKind = 'CASH' | 'CARD' | 'MOBILE' | 'BANK' | 'CHEQUE' | 'OTHER';

export interface PaymentInput {
  methodId: string;
  kind: PaymentKind;
  amount: number;
}
export interface PaymentSettled extends PaymentInput {
  /** montant réellement imputé sur la vente (hors rendu de monnaie) */
  applied: number;
  /** montant remis par le client */
  tendered: number;
}
export interface Settlement {
  payments: PaymentSettled[];
  paidTotal: number;
  change: number;
  creditAmount: number;
  status: 'PAID' | 'PARTIAL' | 'UNPAID';
}

/**
 * Règlement d'une vente : les paiements non-espèces sont imputés d'abord ; les espèces
 * couvrent le reste et génèrent un rendu de monnaie en cas de trop-perçu. Un trop-perçu
 * non-espèces est refusé. Le reste dû devient une créance (vente à crédit / partielle).
 */
export function settlePayments(total: number, payments: PaymentInput[]): Settlement {
  if (payments.some((p) => !Number.isInteger(p.amount) || p.amount <= 0)) {
    throw new Error('Montant de paiement invalide');
  }
  let remaining = total;
  const settled: PaymentSettled[] = [];
  for (const p of payments.filter((p) => p.kind !== 'CASH')) {
    if (p.amount > remaining) throw new Error('Paiement non-espèces supérieur au montant dû');
    settled.push({ ...p, applied: p.amount, tendered: p.amount });
    remaining -= p.amount;
  }
  let change = 0;
  for (const p of payments.filter((p) => p.kind === 'CASH')) {
    const applied = Math.min(p.amount, remaining);
    change += p.amount - applied;
    remaining -= applied;
    settled.push({ ...p, applied, tendered: p.amount });
  }
  const paidTotal = total - remaining;
  return {
    payments: settled.filter((p) => p.applied > 0),
    paidTotal,
    change,
    creditAmount: remaining,
    status: remaining === 0 ? 'PAID' : paidTotal > 0 ? 'PARTIAL' : 'UNPAID',
  };
}

/**
 * Part proratisée d'un montant pour un retour partiel, de façon cumulative : la somme
 * des retours successifs égale exactement le montant d'origine lorsque tout est retourné.
 */
export function proratedReturn(
  lineAmount: number,
  lineQtyMilli: number,
  alreadyReturnedMilli: number,
  returningMilli: number,
): number {
  const upTo = (q: number) => roundDiv(lineAmount * q, lineQtyMilli);
  return upTo(alreadyReturnedMilli + returningMilli) - upTo(alreadyReturnedMilli);
}
