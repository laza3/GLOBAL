-- 0009 — Opérations : housekeeping, maintenance, restaurant, dépenses

CREATE TABLE hk_tasks (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id               uuid NOT NULL REFERENCES hotels (id),
  room_id                uuid NOT NULL,
  task_type              text NOT NULL DEFAULT 'checkout_clean' CHECK (task_type IN ('checkout_clean', 'stayover_clean', 'deep_clean', 'inspection')),
  status                 text NOT NULL DEFAULT 'to_clean' CHECK (status IN ('to_clean', 'in_progress', 'cleaned', 'inspected', 'maintenance')),
  priority               text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_membership_id uuid,
  due_at                 timestamptz,
  started_at             timestamptz,
  completed_at           timestamptz,
  inspected_by_membership_id uuid,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, room_id) REFERENCES rooms (hotel_id, id),
  FOREIGN KEY (hotel_id, assigned_membership_id) REFERENCES memberships (hotel_id, id),
  FOREIGN KEY (hotel_id, inspected_by_membership_id) REFERENCES memberships (hotel_id, id)
);
CREATE INDEX hk_tasks_open_idx ON hk_tasks (hotel_id, status, due_at);
CREATE INDEX hk_tasks_assignee_idx ON hk_tasks (hotel_id, assigned_membership_id) WHERE status IN ('to_clean', 'in_progress');

CREATE TABLE maintenance_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id                uuid NOT NULL REFERENCES hotels (id),
  room_id                 uuid,
  title                   text NOT NULL,
  description             text,
  priority                text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status                  text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'cancelled')),
  reported_by_membership_id uuid,
  assigned_membership_id  uuid,
  -- Bloc de chambre associé (room_allocations kind = 'block') : la chambre est indisponible jusqu'à résolution
  allocation_id           uuid,
  cost_amount             bigint CHECK (cost_amount IS NULL OR cost_amount >= 0),
  reported_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at             timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, room_id) REFERENCES rooms (hotel_id, id),
  FOREIGN KEY (hotel_id, reported_by_membership_id) REFERENCES memberships (hotel_id, id),
  FOREIGN KEY (hotel_id, assigned_membership_id) REFERENCES memberships (hotel_id, id),
  FOREIGN KEY (hotel_id, allocation_id) REFERENCES room_allocations (hotel_id, id) ON DELETE SET NULL (allocation_id),
  CONSTRAINT maintenance_resolved_has_date CHECK (status <> 'resolved' OR resolved_at IS NOT NULL)
);
CREATE INDEX maintenance_open_idx ON maintenance_requests (hotel_id, status, priority);

-- ---------------------------------------------------------------------------
-- Restaurant
-- ---------------------------------------------------------------------------
CREATE TABLE menu_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   uuid NOT NULL REFERENCES hotels (id),
  name       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (hotel_id, name),
  UNIQUE (hotel_id, id)
);

CREATE TABLE products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    uuid NOT NULL REFERENCES hotels (id),
  category_id uuid,
  name        text NOT NULL,
  description text,
  price       bigint NOT NULL CHECK (price >= 0),
  tax_rule_id uuid,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, category_id) REFERENCES menu_categories (hotel_id, id),
  FOREIGN KEY (hotel_id, tax_rule_id) REFERENCES tax_rules (hotel_id, id)
);

CREATE TABLE menus (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id   uuid NOT NULL REFERENCES hotels (id),
  name       text NOT NULL,
  description text,
  price      bigint NOT NULL CHECK (price >= 0),
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (hotel_id, id)
);

CREATE TABLE menu_items (
  hotel_id   uuid NOT NULL REFERENCES hotels (id),
  menu_id    uuid NOT NULL,
  product_id uuid NOT NULL,
  quantity   integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  PRIMARY KEY (menu_id, product_id),
  FOREIGN KEY (hotel_id, menu_id) REFERENCES menus (hotel_id, id) ON DELETE CASCADE,
  FOREIGN KEY (hotel_id, product_id) REFERENCES products (hotel_id, id)
);

CREATE TABLE dining_tables (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id uuid NOT NULL REFERENCES hotels (id),
  label    text NOT NULL,
  area     text,
  seats    integer NOT NULL DEFAULT 2 CHECK (seats > 0),
  status   text NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'occupied', 'reserved', 'cleaning')),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (hotel_id, label),
  UNIQUE (hotel_id, id)
);

CREATE TABLE orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id             uuid NOT NULL REFERENCES hotels (id),
  number               text NOT NULL,
  table_id             uuid,
  -- Imputation à la chambre : la commande devient une charge du folio (une seule fois, voir folio_charges_source_uq)
  folio_id             uuid,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'served', 'paid', 'posted_to_room', 'cancelled')),
  covers               integer NOT NULL DEFAULT 1 CHECK (covers > 0),
  currency             char(3) NOT NULL REFERENCES currencies (code),
  subtotal_amount      bigint NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  tax_amount           bigint NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount         bigint NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  opened_by_membership_id uuid,
  opened_at            timestamptz NOT NULL DEFAULT now(),
  closed_at            timestamptz,
  notes                text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hotel_id, number),
  UNIQUE (hotel_id, id),
  FOREIGN KEY (hotel_id, table_id) REFERENCES dining_tables (hotel_id, id),
  FOREIGN KEY (hotel_id, folio_id) REFERENCES folios (hotel_id, id),
  FOREIGN KEY (hotel_id, opened_by_membership_id) REFERENCES memberships (hotel_id, id),
  CONSTRAINT order_total_consistent CHECK (total_amount = subtotal_amount + tax_amount),
  CONSTRAINT order_posted_has_folio CHECK (status <> 'posted_to_room' OR folio_id IS NOT NULL)
);
CREATE INDEX orders_status_idx ON orders (hotel_id, status, opened_at DESC);

CREATE TABLE order_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id    uuid NOT NULL REFERENCES hotels (id),
  order_id    uuid NOT NULL,
  product_id  uuid,
  -- Nom et prix copiés : un changement de carte ne modifie pas les additions passées
  name        text NOT NULL,
  quantity    integer NOT NULL CHECK (quantity > 0),
  unit_price  bigint NOT NULL CHECK (unit_price >= 0),
  tax_amount  bigint NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  status      text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'served', 'cancelled')),
  notes       text,
  FOREIGN KEY (hotel_id, order_id) REFERENCES orders (hotel_id, id) ON DELETE CASCADE,
  FOREIGN KEY (hotel_id, product_id) REFERENCES products (hotel_id, id)
);
CREATE INDEX order_items_order_idx ON order_items (hotel_id, order_id);

ALTER TABLE payments
  ADD CONSTRAINT payments_order_fk FOREIGN KEY (hotel_id, order_id) REFERENCES orders (hotel_id, id);

-- ---------------------------------------------------------------------------
-- Dépenses
-- ---------------------------------------------------------------------------
CREATE TABLE expense_categories (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id  uuid NOT NULL REFERENCES hotels (id),
  name      text NOT NULL,
  -- « Charges » (fixes : loyer, salaires…) vs dépenses courantes
  kind      text NOT NULL DEFAULT 'expense' CHECK (kind IN ('expense', 'overhead')),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE (hotel_id, name),
  UNIQUE (hotel_id, id)
);

CREATE TABLE expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hotel_id      uuid NOT NULL REFERENCES hotels (id),
  category_id   uuid NOT NULL,
  description   text NOT NULL,
  supplier      text,
  amount        bigint NOT NULL CHECK (amount > 0),
  currency      char(3) NOT NULL REFERENCES currencies (code),
  incurred_on   date NOT NULL,
  -- Dépense enregistrée (due) vs réellement décaissée
  paid_on       date,
  method_code   text,
  receipt_file_id uuid,
  created_by_membership_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (hotel_id, category_id) REFERENCES expense_categories (hotel_id, id),
  FOREIGN KEY (hotel_id, method_code) REFERENCES payment_methods (hotel_id, code),
  FOREIGN KEY (hotel_id, receipt_file_id) REFERENCES files (hotel_id, id),
  FOREIGN KEY (hotel_id, created_by_membership_id) REFERENCES memberships (hotel_id, id)
);
CREATE INDEX expenses_date_idx ON expenses (hotel_id, incurred_on DESC);

SELECT meta.rls_tenant('hk_tasks');
SELECT meta.rls_tenant('maintenance_requests');
SELECT meta.rls_tenant('menu_categories');
SELECT meta.rls_tenant('products');
SELECT meta.rls_tenant('menus');
SELECT meta.rls_tenant('menu_items');
SELECT meta.rls_tenant('dining_tables');
SELECT meta.rls_tenant('orders', 'SELECT, INSERT, UPDATE');
SELECT meta.rls_tenant('order_items');
SELECT meta.rls_tenant('expense_categories');
SELECT meta.rls_tenant('expenses');

SELECT meta.attach_housekeeping_triggers();
