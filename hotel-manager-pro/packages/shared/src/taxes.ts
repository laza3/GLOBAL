/**
 * Calcul des montants d'un séjour (ou d'une ligne de facture) : hors taxe, remise, taxes, total.
 *
 * Tous les montants sont des entiers dans la plus petite unité de la devise ; AUCUN flottant n'est stocké, et les arrondis sont
 * réglés de façon à ce que « total = hors taxe − remise + taxes » soit exact au centime (contrainte de la base).
 *
 * Règles de taxe d'un établissement :
 *   - pourcentage EXCLU du tarif  : s'ajoute au tarif (tarif hors taxe) ;
 *   - pourcentage INCLUS au tarif : le tarif est TTC ; la taxe en est extraite (hors taxe = tarif × 10000 / (10000 + taux)) ;
 *   - fixe par personne et par nuit (taxe de séjour) : toujours ajoutée, non remisée.
 * La remise s'applique sur la même base que le tarif (TTC si le tarif est TTC) ; les taxes en pourcentage sont calculées APRÈS remise.
 */
export interface TaxRule {
  id: string;
  name: string;
  kind: 'percentage' | 'fixed_per_person_night';
  /** Points de base : 2000 = 20,00 %. */
  rateBps?: number | null;
  /** Montant fixe par personne et par nuit (plus petite unité). */
  fixedAmount?: number | null;
  inclusive: boolean;
}

export interface TaxLine { ruleId: string; name: string; amount: number; inclusive: boolean }

export interface StayTotals {
  /** Hors taxe, avant remise. */
  subtotal: number;
  /** Remise, exprimée hors taxe (cohérente avec `subtotal`). */
  discount: number;
  tax: number;
  total: number;
  taxes: TaxLine[];
}

const BPS = 10_000;

export function computeTotals(input: { rates: number[]; discount: number; personNights: number; rules: TaxRule[] }): StayTotals {
  const { rates, rules } = input;
  const gross = rates.reduce((s, r) => s + r, 0);
  const discount = Math.min(Math.max(input.discount, 0), gross);
  const afterDiscount = gross - discount; // sur la base du tarif (TTC si le tarif est TTC)

  const pct = rules.filter((r) => r.kind === 'percentage' && (r.rateBps ?? 0) > 0);
  const inclusive = pct.filter((r) => r.inclusive);
  const exclusive = pct.filter((r) => !r.inclusive);
  const incRate = inclusive.reduce((s, r) => s + (r.rateBps ?? 0), 0);

  // Hors taxe après remise : on retire les taxes incluses du tarif
  const netAfter = incRate > 0 ? Math.round((afterDiscount * BPS) / (BPS + incRate)) : afterDiscount;
  const subtotal = incRate > 0 ? Math.round((gross * BPS) / (BPS + incRate)) : gross;
  const discountNet = Math.max(subtotal - netAfter, 0);

  const taxes: TaxLine[] = [];
  // Taxes incluses : la part extraite du tarif, répartie au prorata des taux (le reste d'arrondi va à la dernière)
  const incTotal = afterDiscount - netAfter;
  let allocated = 0;
  inclusive.forEach((r, i) => {
    const amount = i === inclusive.length - 1 ? incTotal - allocated : Math.round((incTotal * (r.rateBps ?? 0)) / incRate);
    allocated += amount;
    taxes.push({ ruleId: r.id, name: r.name, amount, inclusive: true });
  });
  // Taxes en pourcentage ajoutées : sur le hors taxe après remise
  for (const r of exclusive) taxes.push({ ruleId: r.id, name: r.name, amount: Math.round((netAfter * (r.rateBps ?? 0)) / BPS), inclusive: false });
  // Taxe fixe par personne et par nuit
  for (const r of rules.filter((x) => x.kind === 'fixed_per_person_night' && (x.fixedAmount ?? 0) > 0)) {
    taxes.push({ ruleId: r.id, name: r.name, amount: (r.fixedAmount ?? 0) * Math.max(input.personNights, 0), inclusive: false });
  }

  // Seules les taxes AJOUTÉES (non incluses) augmentent le total ; les incluses sont déjà dans le tarif
  const tax = taxes.reduce((s, t) => s + t.amount, 0);
  const total = netAfter + taxes.filter((t) => !t.inclusive).reduce((s, t) => s + t.amount, 0) + (incTotal > 0 ? incTotal : 0);
  return { subtotal, discount: discountNet, tax, total, taxes };
}

/**
 * Répartit une remise sur les nuits au prorata de leur tarif (plus fort reste) : jamais plus que le tarif d'une nuit,
 * et la somme est exactement `min(remise, somme des tarifs)`. Chaque nuit porte ainsi sa part de remise (colonne `discount`).
 */
export function spreadDiscount(rates: number[], discount: number): number[] {
  const total = rates.reduce((s, r) => s + r, 0);
  const target = Math.min(Math.max(Math.round(discount), 0), total);
  if (total === 0 || target === 0) return rates.map(() => 0);
  const exact = rates.map((r) => (r * target) / total);
  const shares = exact.map((x, i) => Math.min(Math.floor(x), rates[i]!));
  let rest = target - shares.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    if (shares[i]! < rates[i]!) { shares[i]!++; rest--; }
  }
  // Reste éventuel (nuits saturées) : on complète où il reste de la place
  for (let i = 0; rest > 0 && i < shares.length; i++) {
    const room = rates[i]! - shares[i]!;
    const add = Math.min(room, rest);
    shares[i]! += add;
    rest -= add;
  }
  return shares;
}
