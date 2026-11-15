# DATABASE — Schéma SQLite local (v1)

Source de vérité : `apps/desktop/src/main/core/schema.ts` (migration `001_init`). **51 tables.** Les migrations sont appliquées automatiquement au démarrage (`schema_migrations`), chacune dans une transaction.

## Conventions
- **Identifiants** : UUID texte générés côté client (prêts pour la synchronisation, aucune collision entre appareils).
- **Montants** : `INTEGER` en unité mineure. **Quantités** : `INTEGER` en millièmes (`*_milli`). Taux de taxe/remise : points de base (`rate_bp`, 2000 = 20 %).
- **Dates** : ISO-8601 UTC (`at`, `created_at`). `business_date` = jour calendaire dans le fuseau de l'entreprise (regroupement des rapports).
- **Suppression** : logique (`deleted_at`) pour les données de référence (tombstone de synchronisation). **Jamais** de suppression physique des opérations financières.
- **PRAGMA** : `foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout=5000`.

## Domaines
| Domaine | Tables |
|---|---|
| Entreprise & organisation | `company`, `branches`, `warehouses`, `cash_registers` |
| Sécurité | `users`, `roles`, `role_permissions`, `user_sessions`, `audit_log` |
| Référentiels | `categories`, `brands`, `units`, `tax_rates`, `payment_methods`, `expense_categories` |
| Catalogue | `products`, `product_variants`, `barcodes`, `price_history` |
| Stock | `stock`, `stock_lots`, `stock_movements`, `stock_transfers(+_items)`, `inventories`, `inventory_lines` |
| Tiers | `customers`, `customer_ledger`, `suppliers`, `supplier_ledger` |
| Ventes | `sales`, `sale_items`, `payments`, `payment_allocations`, `invoices`, `sale_returns(+_items)`, `credit_notes`, `held_carts` |
| Achats | `purchases`, `purchase_items`, `goods_receipts(+_items)` |
| Caisse & finance | `cash_sessions`, `cash_movements`, `financial_accounts`, `financial_transactions`, `expenses` |
| Technique | `doc_sequences`, `outbox`, `sync_log`, `schema_migrations` |

## Intégrité & contraintes clés
- **Une seule session de caisse ouverte par caisse** : index unique partiel `uq_one_open_session (register_id) WHERE status='OPEN'`.
- **SKU unique** parmi les articles non supprimés ; **code-barres** = clé primaire de `barcodes`.
- `CHECK` sur les énumérations (type de mouvement, statut, mode de paiement, direction…), sur `amount > 0` pour `payments`/`expenses`, sur `rate_bp ∈ [0,10000]`.
- **Immuabilité (triggers)** : `UPDATE`/`DELETE` interdits (erreur `IMMUTABLE_RECORD`) sur `payments`, `payment_allocations`, `financial_transactions`, `stock_movements`, `cash_movements`, `customer_ledger`, `supplier_ledger`, `sale_returns`, `sale_return_items`, `credit_notes`, `invoices`, `goods_receipts(+_items)`, `price_history`, `audit_log`, `expenses`, `stock_transfers(+_items)`. `sales` et `sale_items` : colonnes d'identité/montants figées ; seuls `paid_total`, `returned_total`, `payment_status`, `note` (et `returned_milli`) restent modifiables.
- **Comptes tiers** : le solde n'est **jamais stocké** — c'est `SUM(amount)` du grand livre (`customer_ledger`, `supplier_ledger`) → pas de dérive possible.
- **Solde d'un compte financier** = `opening_balance + SUM(financial_transactions.amount)`.
- **Numérotation** : `doc_sequences(type, year)` incrémentée par `UPDATE … RETURNING` dans la transaction de création → sans trou ni doublon.

## Relations principales
```
company 1─1 (une base = une entreprise)
branches 1─n warehouses 1─n stock(variant)         cash_registers n─1 warehouses, n─1 financial_accounts
products 1─n product_variants 1─n barcodes ; product_variants 1─n stock/stock_lots/stock_movements
sales 1─n sale_items ; sales 1─n payments ; sales 1─n sale_returns 1─n sale_return_items ; sale_returns 1─1 credit_notes
customers 1─n customer_ledger ; suppliers 1─n supplier_ledger ; purchases 1─n purchase_items, goods_receipts
cash_sessions 1─n cash_movements ; payments ─(1 écriture)→ financial_transactions
```

## Règle « une écriture de trésorerie par flux »
`recordPayment()` insère **dans la même transaction** : la ligne `payments`, l'écriture `financial_transactions` (kind selon l'opération) et, pour les espèces, le `cash_movements` de la session ouverte. Impossible d'avoir l'un sans les autres.

## Trace de synchronisation (préparation)
`outbox(seq, op_id UNIQUE, entity, entity_id, op, payload, status, attempts, …)` : alimentée par les services lors de chaque mutation de donnée synchronisable (produits, clients, ventes, paiements, mouvements de stock, sessions…). Aujourd'hui `status='PENDING'` s'accumule (affiché dans l'en-tête, « Mode local »). Elle sera consommée par le moteur de sync (Phase 7).

## Correspondance PostgreSQL (phase API)
| SQLite local | PostgreSQL central |
|---|---|
| une base = une entreprise | `company_id` sur chaque table + RLS (`USING (company_id = current_setting('app.company_id')::uuid)`) |
| UUID texte | `uuid` |
| entiers (unité mineure / milli) | `bigint` |
| `outbox` | `sync_operation` (clé unique `(device_id, op_id)`) + `change_log` |
| Entités spec. non encore créées localement | `Tenant`, `PriceList`, `Notification`, `CreditNote`↔`Invoice` complet, `Permission` (catalogue) |

> Entités de la spécification **absentes du schéma local actuel** (volontairement, non utiles hors ligne mono-entreprise) : `Tenant`, `PriceList`, `Notification`. Les prix de détail/gros sont portés par `product_variants` (`price`, `wholesale_price`, `promo_*`) ; le catalogue de permissions est dans `@gp/shared`.
