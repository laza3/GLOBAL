/** Formats : {YYYY} {YY} {MM} et {0000…} (rembourrage à zéro). Ex. « FAC-{YYYY}-{000000} ». */
export function formatDocNumber(pattern: string, seq: number, date = new Date()): string {
  return pattern
    .replace(/\{YYYY\}/g, String(date.getFullYear()))
    .replace(/\{YY\}/g, String(date.getFullYear()).slice(-2))
    .replace(/\{MM\}/g, String(date.getMonth() + 1).padStart(2, '0'))
    .replace(/\{(0+)\}/g, (_m, z: string) => String(seq).padStart(z.length, '0'));
}

export const DEFAULT_NUMBERING: Record<string, string> = {
  SALE: 'TK-{YYYY}-{000000}',
  INVOICE: 'FAC-{YYYY}-{000000}',
  RETURN: 'RET-{YYYY}-{00000}',
  CREDIT_NOTE: 'AV-{YYYY}-{00000}',
  PURCHASE: 'BC-{YYYY}-{00000}',
  RECEIPT: 'BR-{YYYY}-{00000}',
  EXPENSE: 'DEP-{YYYY}-{00000}',
  TRANSFER: 'TR-{YYYY}-{00000}',
  INVENTORY: 'INV-{YYYY}-{0000}',
};
