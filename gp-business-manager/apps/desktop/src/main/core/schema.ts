/**
 * Schéma SQLite local (une base = une entreprise). Conventions :
 *  - identifiants UUID texte générés côté client (prêts pour la synchronisation) ;
 *  - montants en entiers (unité mineure), quantités en entiers (millièmes) ;
 *  - dates en ISO-8601 UTC ; `business_date` = jour calendaire dans le fuseau de l'entreprise ;
 *  - les opérations financières validées sont IMMUABLES (triggers ABORT sur UPDATE/DELETE).
 */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

const IMMUTABLE = (table: string) => `
CREATE TRIGGER trg_${table}_no_update BEFORE UPDATE ON ${table}
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RECORD: ${table} ne peut pas être modifié'); END;
CREATE TRIGGER trg_${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RECORD: ${table} ne peut pas être supprimé'); END;`;

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'init',
    sql: `
CREATE TABLE company (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, legal_name TEXT, tax_id TEXT, stat_no TEXT,
  address TEXT, phone TEXT, email TEXT, logo TEXT,
  currency TEXT NOT NULL DEFAULT 'MGA', locale TEXT NOT NULL DEFAULT 'fr', timezone TEXT NOT NULL DEFAULT 'Indian/Antananarivo',
  prices_include_tax INTEGER NOT NULL DEFAULT 1, allow_negative_stock INTEGER NOT NULL DEFAULT 0,
  max_cashier_discount_bp INTEGER NOT NULL DEFAULT 1000,
  receipt_footer TEXT, invoice_notes TEXT, numbering_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE branches (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT, address TEXT, phone TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE warehouses (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id), name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE financial_accounts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('CASH','BANK','MOBILE')),
  opening_balance INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE cash_registers (
  id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES branches(id), warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  account_id TEXT NOT NULL REFERENCES financial_accounts(id), name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CASH','CARD','MOBILE','BANK','CHEQUE','OTHER')),
  account_id TEXT REFERENCES financial_accounts(id), sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE roles (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, is_system INTEGER NOT NULL DEFAULT 0);
CREATE TABLE role_permissions (role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE, permission TEXT NOT NULL, PRIMARY KEY (role_id, permission));
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL, role_id TEXT NOT NULL REFERENCES roles(id), branch_id TEXT REFERENCES branches(id),
  email TEXT, phone TEXT, active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT, last_login_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), started_at TEXT NOT NULL, ended_at TEXT, device TEXT
);
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, user_id TEXT, username TEXT, action TEXT NOT NULL,
  entity TEXT, entity_id TEXT, details TEXT
);
CREATE INDEX idx_audit_at ON audit_log(at);

CREATE TABLE categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES categories(id),
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE brands (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE units (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, allow_decimal INTEGER NOT NULL DEFAULT 0);
CREATE TABLE tax_rates (id TEXT PRIMARY KEY, name TEXT NOT NULL, rate_bp INTEGER NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000), is_default INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  category_id TEXT REFERENCES categories(id), brand_id TEXT REFERENCES brands(id),
  unit_id TEXT REFERENCES units(id), tax_rate_id TEXT REFERENCES tax_rates(id),
  track_stock INTEGER NOT NULL DEFAULT 1, track_lots INTEGER NOT NULL DEFAULT 0, image TEXT,
  active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_products_name ON products(name);
CREATE TABLE product_variants (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), sku TEXT NOT NULL,
  name TEXT, size TEXT, color TEXT,
  cost_price INTEGER NOT NULL DEFAULT 0, price INTEGER NOT NULL DEFAULT 0, wholesale_price INTEGER,
  promo_price INTEGER, promo_start TEXT, promo_end TEXT,
  alert_qty_milli INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE UNIQUE INDEX uq_variant_sku ON product_variants(sku) WHERE deleted_at IS NULL;
CREATE INDEX idx_variant_product ON product_variants(product_id);
CREATE TABLE barcodes (code TEXT PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES product_variants(id));
CREATE INDEX idx_barcode_variant ON barcodes(variant_id);
CREATE TABLE price_history (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES product_variants(id), field TEXT NOT NULL,
  old_value INTEGER, new_value INTEGER, user_id TEXT, at TEXT NOT NULL
);
CREATE INDEX idx_price_history_variant ON price_history(variant_id, at);

CREATE TABLE stock (
  variant_id TEXT NOT NULL REFERENCES product_variants(id), warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  qty_milli INTEGER NOT NULL DEFAULT 0, avg_cost INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (variant_id, warehouse_id)
);
CREATE TABLE stock_lots (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES product_variants(id), warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  lot_no TEXT NOT NULL, expiry_date TEXT, qty_milli INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE (variant_id, warehouse_id, lot_no)
);
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES product_variants(id), warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  lot_id TEXT REFERENCES stock_lots(id),
  type TEXT NOT NULL CHECK (type IN ('IN','OUT','SALE','RETURN_IN','PURCHASE','PURCHASE_RETURN','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT','INVENTORY','LOSS','DAMAGED','OPENING')),
  qty_milli INTEGER NOT NULL, unit_cost INTEGER NOT NULL DEFAULT 0,
  ref_type TEXT, ref_id TEXT, reason TEXT, user_id TEXT, at TEXT NOT NULL
);
CREATE INDEX idx_move_variant ON stock_movements(variant_id, at);
CREATE INDEX idx_move_ref ON stock_movements(ref_type, ref_id);
CREATE TABLE stock_transfers (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, from_warehouse_id TEXT NOT NULL REFERENCES warehouses(id), to_warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  note TEXT, user_id TEXT, at TEXT NOT NULL
);
CREATE TABLE stock_transfer_items (transfer_id TEXT NOT NULL REFERENCES stock_transfers(id), variant_id TEXT NOT NULL REFERENCES product_variants(id), qty_milli INTEGER NOT NULL, PRIMARY KEY (transfer_id, variant_id));
CREATE TABLE inventories (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL CHECK (status IN ('OPEN','VALIDATED')), note TEXT, user_id TEXT, created_at TEXT NOT NULL, validated_at TEXT
);
CREATE TABLE inventory_lines (
  inventory_id TEXT NOT NULL REFERENCES inventories(id), variant_id TEXT NOT NULL REFERENCES product_variants(id),
  expected_milli INTEGER NOT NULL, counted_milli INTEGER, PRIMARY KEY (inventory_id, variant_id)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY, code TEXT, name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT, tax_id TEXT,
  price_tier TEXT NOT NULL DEFAULT 'RETAIL' CHECK (price_tier IN ('RETAIL','WHOLESALE')),
  credit_limit INTEGER NOT NULL DEFAULT 0, loyalty_points INTEGER NOT NULL DEFAULT 0, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX idx_customers_name ON customers(name);
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY, code TEXT, name TEXT NOT NULL, contact TEXT, phone TEXT, email TEXT, address TEXT, tax_id TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 0, notes TEXT, active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
-- Comptes tiers : solde = SUM(amount). Client : + = nous doit, − = avance. Fournisseur : + = nous lui devons.
CREATE TABLE customer_ledger (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id),
  kind TEXT NOT NULL CHECK (kind IN ('SALE_CREDIT','PAYMENT','ADVANCE','RETURN','ADJUSTMENT','ADVANCE_USED')),
  amount INTEGER NOT NULL, ref_type TEXT, ref_id TEXT, note TEXT, user_id TEXT, at TEXT NOT NULL
);
CREATE INDEX idx_cl_customer ON customer_ledger(customer_id, at);
CREATE TABLE supplier_ledger (
  id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  kind TEXT NOT NULL CHECK (kind IN ('PURCHASE','PAYMENT','RETURN','ADJUSTMENT')),
  amount INTEGER NOT NULL, ref_type TEXT, ref_id TEXT, due_date TEXT, note TEXT, user_id TEXT, at TEXT NOT NULL
);
CREATE INDEX idx_sl_supplier ON supplier_ledger(supplier_id, at);

CREATE TABLE cash_sessions (
  id TEXT PRIMARY KEY, register_id TEXT NOT NULL REFERENCES cash_registers(id), user_id TEXT NOT NULL REFERENCES users(id),
  opened_at TEXT NOT NULL, opening_float INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT, counted_cash INTEGER, expected_cash INTEGER, difference INTEGER, close_note TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED'))
);
CREATE UNIQUE INDEX uq_one_open_session ON cash_sessions(register_id) WHERE status = 'OPEN';
CREATE TABLE cash_movements (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES cash_sessions(id),
  type TEXT NOT NULL CHECK (type IN ('SALE','REFUND','EXPENSE','DEPOSIT','WITHDRAWAL','CUSTOMER_PAYMENT','SUPPLIER_PAYMENT')),
  amount INTEGER NOT NULL, ref_type TEXT, ref_id TEXT, note TEXT, user_id TEXT, at TEXT NOT NULL
);
CREATE INDEX idx_cm_session ON cash_movements(session_id);

CREATE TABLE sales (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, branch_id TEXT REFERENCES branches(id), register_id TEXT REFERENCES cash_registers(id),
  session_id TEXT REFERENCES cash_sessions(id), warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  customer_id TEXT REFERENCES customers(id), user_id TEXT NOT NULL REFERENCES users(id),
  price_tier TEXT NOT NULL DEFAULT 'RETAIL',
  subtotal INTEGER NOT NULL, line_discount_total INTEGER NOT NULL DEFAULT 0, cart_discount_total INTEGER NOT NULL DEFAULT 0,
  net_total INTEGER NOT NULL, tax_total INTEGER NOT NULL, total INTEGER NOT NULL,
  paid_total INTEGER NOT NULL DEFAULT 0, change_given INTEGER NOT NULL DEFAULT 0, returned_total INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('PAID','PARTIAL','UNPAID')),
  due_date TEXT, note TEXT, prices_include_tax INTEGER NOT NULL,
  created_at TEXT NOT NULL, business_date TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_sales_date ON sales(business_date);
CREATE INDEX idx_sales_customer ON sales(customer_id);
CREATE INDEX idx_sales_status ON sales(payment_status);
CREATE TABLE sale_items (
  id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), variant_id TEXT NOT NULL REFERENCES product_variants(id),
  name TEXT NOT NULL, sku TEXT NOT NULL, qty_milli INTEGER NOT NULL, unit_price INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0, cart_discount_share INTEGER NOT NULL DEFAULT 0,
  tax_rate_bp INTEGER NOT NULL DEFAULT 0, net INTEGER NOT NULL, tax INTEGER NOT NULL, total INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0, returned_milli INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_variant ON sale_items(variant_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY, direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  method_id TEXT NOT NULL REFERENCES payment_methods(id), account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  amount INTEGER NOT NULL CHECK (amount > 0), tendered INTEGER,
  sale_id TEXT REFERENCES sales(id), return_id TEXT, customer_id TEXT REFERENCES customers(id),
  supplier_id TEXT REFERENCES suppliers(id), purchase_id TEXT, session_id TEXT REFERENCES cash_sessions(id),
  reference TEXT, note TEXT, user_id TEXT, at TEXT NOT NULL, business_date TEXT NOT NULL
);
CREATE INDEX idx_payments_sale ON payments(sale_id);
CREATE INDEX idx_payments_date ON payments(business_date);
CREATE TABLE payment_allocations (
  payment_id TEXT NOT NULL REFERENCES payments(id), sale_id TEXT NOT NULL REFERENCES sales(id), amount INTEGER NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payment_id, sale_id)
);
CREATE TABLE invoices (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id),
  customer_id TEXT REFERENCES customers(id), issued_at TEXT NOT NULL, due_date TEXT, user_id TEXT
);
CREATE TABLE sale_returns (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, sale_id TEXT NOT NULL REFERENCES sales(id), session_id TEXT REFERENCES cash_sessions(id),
  net_total INTEGER NOT NULL, tax_total INTEGER NOT NULL, total INTEGER NOT NULL, cost_total INTEGER NOT NULL DEFAULT 0,
  refund_total INTEGER NOT NULL DEFAULT 0, receivable_reduction INTEGER NOT NULL DEFAULT 0, restock INTEGER NOT NULL DEFAULT 1,
  reason TEXT, user_id TEXT, at TEXT NOT NULL, business_date TEXT NOT NULL
);
CREATE TABLE sale_return_items (
  return_id TEXT NOT NULL REFERENCES sale_returns(id), sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  qty_milli INTEGER NOT NULL, net INTEGER NOT NULL, tax INTEGER NOT NULL, total INTEGER NOT NULL, cost INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (return_id, sale_item_id)
);
CREATE TABLE credit_notes (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, return_id TEXT NOT NULL REFERENCES sale_returns(id),
  customer_id TEXT REFERENCES customers(id), amount INTEGER NOT NULL, at TEXT NOT NULL
);
CREATE TABLE held_carts (
  id TEXT PRIMARY KEY, label TEXT, user_id TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE purchases (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL CHECK (status IN ('ORDERED','PARTIAL','RECEIVED','CANCELLED')),
  supplier_ref TEXT, expected_date TEXT, due_date TEXT, shipping_cost INTEGER NOT NULL DEFAULT 0, note TEXT,
  net_total INTEGER NOT NULL DEFAULT 0, tax_total INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
  received_total INTEGER NOT NULL DEFAULT 0, paid_total INTEGER NOT NULL DEFAULT 0,
  user_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE purchase_items (
  id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES purchases(id), variant_id TEXT NOT NULL REFERENCES product_variants(id),
  qty_milli INTEGER NOT NULL, received_milli INTEGER NOT NULL DEFAULT 0, unit_cost INTEGER NOT NULL, tax_rate_bp INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE goods_receipts (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, purchase_id TEXT NOT NULL REFERENCES purchases(id),
  net_total INTEGER NOT NULL, tax_total INTEGER NOT NULL, total INTEGER NOT NULL, note TEXT, user_id TEXT, at TEXT NOT NULL
);
CREATE TABLE goods_receipt_items (
  receipt_id TEXT NOT NULL REFERENCES goods_receipts(id), purchase_item_id TEXT NOT NULL REFERENCES purchase_items(id),
  qty_milli INTEGER NOT NULL, unit_cost INTEGER NOT NULL, landed_unit_cost INTEGER NOT NULL, lot_no TEXT, expiry_date TEXT,
  PRIMARY KEY (receipt_id, purchase_item_id)
);

CREATE TABLE expense_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE expenses (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, category_id TEXT REFERENCES expense_categories(id),
  account_id TEXT NOT NULL REFERENCES financial_accounts(id), session_id TEXT REFERENCES cash_sessions(id),
  amount INTEGER NOT NULL CHECK (amount > 0), description TEXT NOT NULL, beneficiary TEXT, reference TEXT,
  user_id TEXT, at TEXT NOT NULL, business_date TEXT NOT NULL
);
CREATE INDEX idx_expenses_date ON expenses(business_date);
CREATE TABLE financial_transactions (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES financial_accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('SALE_RECEIPT','CUSTOMER_PAYMENT','CUSTOMER_ADVANCE','REFUND','EXPENSE','SUPPLIER_PAYMENT','CAPITAL_CONTRIBUTION','OWNER_WITHDRAWAL','TRANSFER_IN','TRANSFER_OUT','ADJUSTMENT')),
  amount INTEGER NOT NULL, ref_type TEXT, ref_id TEXT, transfer_id TEXT, note TEXT, user_id TEXT, at TEXT NOT NULL, business_date TEXT NOT NULL
);
CREATE INDEX idx_ft_account ON financial_transactions(account_id, at);
CREATE INDEX idx_ft_date ON financial_transactions(business_date, kind);

CREATE TABLE doc_sequences (type TEXT NOT NULL, year INTEGER NOT NULL, next_value INTEGER NOT NULL, PRIMARY KEY (type, year));

-- Outbox : chaque mutation de données synchronisables y laisse une trace (consommée par le futur moteur de synchronisation).
CREATE TABLE outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL UNIQUE, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('INSERT','UPDATE','DELETE')), payload TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','CONFLICT')),
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, sent_at TEXT
);
CREATE INDEX idx_outbox_status ON outbox(status, seq);
CREATE TABLE sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL);

${['sale_items', 'payments', 'payment_allocations', 'stock_movements', 'cash_movements', 'financial_transactions', 'customer_ledger', 'supplier_ledger', 'sale_returns', 'sale_return_items', 'credit_notes', 'invoices', 'goods_receipts', 'goods_receipt_items', 'price_history', 'audit_log', 'expenses', 'stock_transfers', 'stock_transfer_items'].map(IMMUTABLE).join('\n')}

-- sale_items : seule la quantité déjà retournée peut évoluer (retours).
DROP TRIGGER trg_sale_items_no_update;
CREATE TRIGGER trg_sale_items_no_update BEFORE UPDATE OF sale_id, variant_id, name, sku, qty_milli, unit_price, discount, cart_discount_share, tax_rate_bp, net, tax, total, unit_cost ON sale_items
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RECORD: sale_items ne peut pas être modifié'); END;

-- sales : les montants et l'identité de la vente sont figés ; seuls paid_total, returned_total, payment_status, note restent mutables.
CREATE TRIGGER trg_sales_immutable BEFORE UPDATE OF number, branch_id, register_id, session_id, warehouse_id, customer_id, user_id, subtotal, line_discount_total, cart_discount_total, net_total, tax_total, total, created_at, business_date ON sales
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RECORD: les montants d''une vente validée ne peuvent pas être modifiés'); END;
CREATE TRIGGER trg_sales_no_delete BEFORE DELETE ON sales
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_RECORD: une vente validée ne peut pas être supprimée'); END;
`,
  },
];
