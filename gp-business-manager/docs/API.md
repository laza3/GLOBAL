# API interne — référence des endpoints

> Généré par `npm run docs:api -w @gp/desktop` depuis `apps/desktop/src/main/core/api.ts` (registre unique).
> 95 endpoints. Tous exigent une session authentifiée sauf `app.status`, `app.setup`, `auth.login`.

## Conventions

- **Transport** : IPC Electron `window.gp.call(method, params)` → enveloppe `{ ok: true, data } | { ok: false, error: { code, message, details? } }`.
- **Montants** : entiers en unité mineure (MGA : 1 Ar). **Quantités** : entiers en millièmes (`qtyMilli`: 1500 = 1,5).
- **Permissions** : vérifiées côté processus principal avant toute exécution. Un tableau signifie « l'une de ». Un refus est journalisé (`security.forbidden`).
- **Validation** : schéma Zod (les champs inconnus sont ignorés) ; un champ suffixé `?` est optionnel.
- **Codes d'erreur** : `UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`, `DUPLICATE`, `IMMUTABLE_RECORD`, `INSUFFICIENT_STOCK`, `NO_SESSION`, `CREDIT_LIMIT`, `OVER_RETURN`, `INSUFFICIENT_FUNDS`… (voir `AppError` dans `core/util.ts`).
- **Idempotence** : `sales.create` accepte un `id` fourni par le client ; rejouer le même `id` renvoie la vente existante (`duplicate: true`).
- **Cible REST** : ces mêmes noms/schémas deviendront les routes NestJS (`POST /sales`, …) lors de la phase API.

## auth

| Endpoint | Permission | Paramètres |
|---|---|---|
| `auth.me` | session | — |
| `auth.changePassword` | session | `oldPassword`, `newPassword` |

## company

| Endpoint | Permission | Paramètres |
|---|---|---|
| `company.get` | session | — |
| `company.update` | `settings.manage` | `name?`, `legalName?`, `taxId?`, `statNo?`, `address?`, `phone?`, `email?`, `logo?`, `currency?`, `locale?`, `timezone?`, `pricesIncludeTax?`, `allowNegativeStock?`, `maxCashierDiscountBp?`, `receiptFooter?`, `invoiceNotes?`, `numbering?` |

## org

| Endpoint | Permission | Paramètres |
|---|---|---|
| `org.branches` | session | — |
| `org.saveBranch` | `organization.manage` | `id?`, `name`, `code?`, `address?`, `phone?`, `active?` |
| `org.warehouses` | session | — |
| `org.saveWarehouse` | `organization.manage` | `id?`, `branchId`, `name`, `active?` |
| `org.registers` | session | — |
| `org.saveRegister` | `organization.manage` | `id?`, `branchId`, `warehouseId`, `name`, `active?` |

## ref

| Endpoint | Permission | Paramètres |
|---|---|---|
| `ref.paymentMethods` | session | `all?` |
| `ref.savePaymentMethod` | `settings.manage` | `id?`, `code`, `name`, `kind`, `accountId?`, `active?` |
| `ref.taxRates` | session | — |
| `ref.saveTaxRate` | `settings.manage` | `id?`, `name`, `rateBp`, `isDefault?` |
| `ref.units` | session | — |
| `ref.saveUnit` | `product.manage` | `code`, `name`, `allowDecimal?` |
| `ref.expenseCategories` | session | — |
| `ref.saveExpenseCategory` | `expense.manage` | `name` |
| `ref.permissions` | `role.manage` | — |

## users

| Endpoint | Permission | Paramètres |
|---|---|---|
| `users.list` | `user.manage` ou `cash.view_all` | — |
| `users.create` | `user.manage` | `username`, `displayName`, `password`, `roleId`, `branchId?`, `email?`, `phone?` |
| `users.update` | `user.manage` | `id`, `displayName?`, `roleId?`, `branchId?`, `email?`, `phone?`, `active?`, `password?` |

## roles

| Endpoint | Permission | Paramètres |
|---|---|---|
| `roles.list` | `role.manage` ou `user.manage` | — |
| `roles.save` | `role.manage` | `id?`, `name`, `permissions` |
| `roles.delete` | `role.manage` | `id` |

## audit

| Endpoint | Permission | Paramètres |
|---|---|---|
| `audit.list` | `audit.view` | `limit?`, `action?` |

## catalog

| Endpoint | Permission | Paramètres |
|---|---|---|
| `catalog.categories` | session | — |
| `catalog.saveCategory` | `product.manage` | `id?`, `name`, `parentId?`, `active?` |
| `catalog.deleteCategory` | `product.manage` | `id` |
| `catalog.brands` | session | — |
| `catalog.saveBrand` | `product.manage` | `id?`, `name` |
| `catalog.deleteBrand` | `product.manage` | `id` |

## products

| Endpoint | Permission | Paramètres |
|---|---|---|
| `products.list` | `product.view` | `q?`, `categoryId?`, `brandId?`, `active?`, `limit?`, `offset?` |
| `products.get` | `product.view` | `id` |
| `products.save` | `product.manage` | `id?`, `name`, `description?`, `categoryId?`, `brandId?`, `unitId?`, `taxRateId?`, `trackStock?`, `trackLots?`, `image?`, `active?`, `variants` |
| `products.delete` | `product.manage` | `id` |

## sellable

| Endpoint | Permission | Paramètres |
|---|---|---|
| `sellable.search` | `sale.create` ou `product.view` | `q?`, `warehouseId?`, `tier?`, `categoryId?`, `limit?` |
| `sellable.byCode` | `sale.create` ou `product.view` | `code`, `warehouseId?`, `tier?` |

## stock

| Endpoint | Permission | Paramètres |
|---|---|---|
| `stock.levels` | `stock.view` | `warehouseId?`, `q?`, `lowOnly?`, `categoryId?`, `limit?`, `offset?` |
| `stock.movements` | `stock.view` | `variantId?`, `warehouseId?`, `type?`, `from?`, `to?`, `limit?` |
| `stock.adjust` | `stock.adjust` | `warehouseId`, `variantId`, `type`, `qtyMilli`, `reason?`, `unitCost?`, `lotNo?`, `expiryDate?` |
| `stock.transfer` | `stock.transfer` | `fromWarehouseId`, `toWarehouseId`, `items`, `note?` |
| `stock.transfers` | `stock.view` | — |
| `stock.valuation` | `stock.view` | `warehouseId?` |
| `stock.expiring` | `stock.view` | `days?` |

## inventory

| Endpoint | Permission | Paramètres |
|---|---|---|
| `inventory.create` | `inventory.manage` | `warehouseId`, `categoryId?`, `note?` |
| `inventory.list` | `inventory.manage` | — |
| `inventory.get` | `inventory.manage` | `id` |
| `inventory.count` | `inventory.manage` | `inventoryId`, `variantId`, `countedMilli` |
| `inventory.validate` | `inventory.manage` | `id` |

## customers

| Endpoint | Permission | Paramètres |
|---|---|---|
| `customers.list` | `customer.view` ou `sale.create` | `q?`, `withDebt?`, `limit?` |
| `customers.get` | `customer.view` | `id` |
| `customers.save` | `customer.manage` | `id?`, `name`, `code?`, `phone?`, `email?`, `address?`, `taxId?`, `priceTier?`, `creditLimit?`, `notes?`, `active?` |
| `customers.delete` | `customer.manage` | `id` |
| `customers.receivePayment` | `customer.manage` ou `finance.manage` | `customerId`, `methodId`, `amount`, `note?` |

## suppliers

| Endpoint | Permission | Paramètres |
|---|---|---|
| `suppliers.list` | `supplier.view` | `q?` |
| `suppliers.get` | `supplier.view` | `id` |
| `suppliers.save` | `supplier.manage` | `id?`, `name`, `code?`, `contact?`, `phone?`, `email?`, `address?`, `taxId?`, `paymentTermsDays?`, `notes?`, `active?` |
| `suppliers.delete` | `supplier.manage` | `id` |
| `suppliers.pay` | `finance.manage` ou `purchase.manage` | `supplierId`, `methodId`, `amount`, `purchaseId?`, `note?` |

## purchases

| Endpoint | Permission | Paramètres |
|---|---|---|
| `purchases.list` | `purchase.view` | `supplierId?`, `status?` |
| `purchases.get` | `purchase.view` | `id` |
| `purchases.create` | `purchase.manage` | `supplierId`, `warehouseId`, `items`, `supplierRef?`, `expectedDate?`, `dueDate?`, `shippingCost?`, `note?` |
| `purchases.receive` | `purchase.manage` | `purchaseId`, `items`, `note?` |
| `purchases.cancel` | `purchase.manage` | `id` |
| `purchases.returnToSupplier` | `purchase.manage` | `supplierId`, `warehouseId`, `items`, `reason?` |

## finance

| Endpoint | Permission | Paramètres |
|---|---|---|
| `finance.payables` | `finance.view` ou `purchase.view` | — |
| `finance.receivables` | `finance.view` ou `customer.view` | — |
| `finance.accounts` | `finance.view` ou `sale.create` | — |
| `finance.saveAccount` | `finance.manage` | `id?`, `name`, `type`, `openingBalance?`, `active?` |
| `finance.transactions` | `finance.view` | `accountId?`, `kind?`, `from?`, `to?`, `limit?` |
| `finance.expenses` | `finance.view` | `from?`, `to?`, `categoryId?` |
| `finance.createExpense` | `expense.manage` | `categoryId?`, `accountId`, `amount`, `description`, `beneficiary?`, `reference?`, `date?` |
| `finance.ownerMovement` | `finance.manage` | `accountId`, `kind`, `amount`, `note?` |
| `finance.transfer` | `finance.manage` | `fromAccountId`, `toAccountId`, `amount`, `note?` |
| `finance.cashflow` | `finance.view` | `from?`, `to?` |

## sales

| Endpoint | Permission | Paramètres |
|---|---|---|
| `sales.create` | `sale.create` | `id?`, `registerId`, `customerId?`, `items`, `cartDiscount?`, `payments`, `advanceUsed?`, `dueDate?`, `note?` |
| `sales.list` | `sale.view` | `from?`, `to?`, `customerId?`, `userId?`, `status?`, `q?`, `registerId?`, `limit?`, `offset?` |
| `sales.get` | `sale.view` | `id` |
| `sales.return` | `sale.return` | `saleId`, `items`, `refundMode?`, `refundMethodId?`, `restock?`, `reason?` |
| `sales.invoice` | `sale.view` | `saleId` |

## held

| Endpoint | Permission | Paramètres |
|---|---|---|
| `held.list` | `sale.create` | — |
| `held.save` | `sale.create` | `label?`, `payload` |
| `held.resume` | `sale.create` | `id` |
| `held.discard` | `sale.create` | `id` |

## cash

| Endpoint | Permission | Paramètres |
|---|---|---|
| `cash.open` | `cash.session` | `registerId`, `openingFloat` |
| `cash.close` | `cash.session` | `sessionId`, `countedCash`, `note?` |
| `cash.current` | `cash.session` ou `sale.create` | `registerId?` |
| `cash.summary` | `cash.session` | `sessionId` |
| `cash.sessions` | `cash.session` | `registerId?`, `limit?` |
| `cash.inOut` | `cash.session` | `sessionId`, `direction`, `amount`, `note` |

## dashboard

| Endpoint | Permission | Paramètres |
|---|---|---|
| `dashboard.get` | `dashboard.view` | `from?`, `to?`, `registerId?`, `userId?` |

## reports

| Endpoint | Permission | Paramètres |
|---|---|---|
| `reports.types` | session | — |
| `reports.run` | `report.view` ou `finance.view` | `type`, `from?`, `to?`, `userId?` |

## sync

| Endpoint | Permission | Paramètres |
|---|---|---|
| `sync.status` | session | — |

