import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const dealers = sqliteTable("dealers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  salesforceManagerValue: text("salesforce_manager_value"),
  advanceEnabled: integer("advance_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  flatCommissionEnabled: integer("flat_commission_enabled", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  vanSettlementEnabled: integer("van_settlement_enabled", {
    mode: "boolean",
  })
    .notNull()
    .default(true),
  settlementDirectionVisible: integer("settlement_direction_visible", {
    mode: "boolean",
  })
    .notNull()
    .default(true),
  installmentPendingEnabled: integer("installment_pending_enabled", {
    mode: "boolean",
  })
    .notNull()
    .default(true),
  mainSummaryCards: text("main_summary_cards"),
  settlementListColumns: text("settlement_list_columns"),
  merchantListColumns: text("merchant_list_columns"),
  merchantDetailFields: text("merchant_detail_fields"),
  merchantDetailBillingColumns: text("merchant_detail_billing_columns"),
  merchantDetailPayerColumns: text("merchant_detail_payer_columns"),
  merchantDetailInstallationColumns: text("merchant_detail_installation_columns"),
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const dealerRules = sqliteTable(
  "dealer_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealers.id),
    effectiveFrom: text("effective_from").notNull(),
    costShareRate: real("cost_share_rate").notNull(),
    profitShareRate: real("profit_share_rate").notNull(),
    vatSeparate: integer("vat_separate", { mode: "boolean" })
      .notNull()
      .default(true),
  },
  (table) => [
    index("idx_dealer_rules_dealer_effective").on(
      table.dealerId,
      table.effectiveFrom,
    ),
  ],
);

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  directCostAllowed: integer("direct_cost_allowed", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const productCosts = sqliteTable(
  "product_costs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    unitCost: integer("unit_cost").notNull(),
    condition: text("condition").notNull().default("신품"),
    effectiveFrom: text("effective_from").notNull(),
  },
  (table) => [
    index("idx_product_costs_product_effective").on(
      table.productId,
      table.effectiveFrom,
    ),
    index("idx_product_costs_product_condition_effective").on(
      table.productId,
      table.condition,
      table.effectiveFrom,
    ),
  ],
);

export const dealerProductCosts = sqliteTable(
  "dealer_product_costs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealers.id),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    unitCost: integer("unit_cost").notNull(),
    condition: text("condition").notNull().default("신품"),
    effectiveFrom: text("effective_from").notNull(),
  },
  (table) => [
    index("idx_dealer_product_costs_dealer_product_effective").on(
      table.dealerId,
      table.productId,
      table.effectiveFrom,
    ),
    index("idx_dealer_product_costs_dealer_product_condition_effective").on(
      table.dealerId,
      table.productId,
      table.condition,
      table.effectiveFrom,
    ),
  ],
);

export const dealerCategoryCosts = sqliteTable(
  "dealer_category_costs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealers.id),
    productCategory: text("product_category").notNull(),
    unitCost: integer("unit_cost").notNull(),
    condition: text("condition").notNull().default("신품"),
    effectiveFrom: text("effective_from").notNull(),
  },
  (table) => [
    index("idx_dealer_category_costs_dealer_category_effective").on(
      table.dealerId,
      table.productCategory,
      table.effectiveFrom,
    ),
    index("idx_dealer_category_costs_match").on(
      table.dealerId,
      table.productCategory,
      table.condition,
      table.effectiveFrom,
    ),
  ],
);

export const dealerCommissionRules = sqliteTable(
  "dealer_commission_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealers.id),
    targetType: text("target_type").notNull().default("productCategory"),
    productId: integer("product_id").references(() => products.id),
    productCategory: text("product_category").notNull(),
    condition: text("condition").notNull().default("신품"),
    rentalAmount: integer("rental_amount").notNull(),
    contractTermMonths: integer("contract_term_months").notNull().default(36),
    commissionAmount: integer("commission_amount").notNull(),
    effectiveFrom: text("effective_from").notNull(),
  },
  (table) => [
    index("idx_dealer_commission_rules_dealer_category_effective").on(
      table.dealerId,
      table.productCategory,
      table.effectiveFrom,
    ),
    index("idx_dealer_commission_rules_match").on(
      table.dealerId,
      table.targetType,
      table.productId,
      table.productCategory,
      table.condition,
      table.rentalAmount,
      table.effectiveFrom,
    ),
  ],
);

export const merchants = sqliteTable(
  "merchants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    businessNumber: text("business_number").notNull(),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealers.id),
    installDate: text("install_date").notNull(),
    accountStatus: text("account_status"),
    salesforceId: text("salesforce_id"),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => [
    index("idx_merchants_dealer_install").on(table.dealerId, table.installDate),
    uniqueIndex("idx_merchants_salesforce_id").on(table.salesforceId),
  ],
);

export const installations = sqliteTable(
  "installations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    merchantId: integer("merchant_id")
      .notNull()
      .references(() => merchants.id),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull(),
    unitCostSnapshot: integer("unit_cost_snapshot").notNull(),
    unitCostOverridden: integer("unit_cost_overridden", { mode: "boolean" })
      .notNull()
      .default(false),
    salesforceLineItemId: text("salesforce_line_item_id"),
    salesforceCaseId: text("salesforce_case_id"),
    salesforceCaseNumber: text("salesforce_case_number"),
    contractInstallAt: text("contract_install_at"),
    contractTermMonths: integer("contract_term_months").notNull().default(36),
    condition: text("condition").notNull().default("신품"),
    van: text("van"),
    transactionClassification: text("transaction_classification"),
    fixing: integer("fixing").notNull().default(0),
    incentive: integer("incentive").notNull().default(0),
    fixingPaymentStatus: text("fixing_payment_status"),
    fixingPaymentDate: text("fixing_payment_date"),
    incentivePaymentStatus: text("incentive_payment_status"),
    incentivePaymentDate: text("incentive_payment_date"),
    fixingSettlementMonth: text("fixing_settlement_month"),
    incentiveSettlementMonth: text("incentive_settlement_month"),
    salesAmount: integer("sales_amount").notNull().default(0),
    source: text("source").notNull().default("local"),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => [
    index("idx_installations_merchant").on(table.merchantId),
    uniqueIndex("idx_installations_salesforce_line_item_id").on(
      table.salesforceLineItemId,
    ),
  ],
);

export const billings = sqliteTable(
  "billings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    merchantId: integer("merchant_id")
      .notNull()
      .references(() => merchants.id),
    billingMonth: text("billing_month").notNull(),
    billingAmount: integer("billing_amount").notNull().default(0),
    rentalRevenue: integer("rental_revenue").notNull().default(0),
    cancellationRevenue: integer("cancellation_revenue").notNull().default(0),
    otherRevenue: integer("other_revenue").notNull().default(0),
    purchaseType: text("purchase_type", {
      enum: ["rental", "purchase", "installment"],
    }).notNull(),
    installmentMonths: integer("installment_months"),
  },
  (table) => [
    index("idx_billings_merchant_month").on(
      table.merchantId,
      table.billingMonth,
    ),
  ],
);

export const dealerMembers = sqliteTable(
  "dealer_members",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "dealer"] }).notNull(),
    dealerId: integer("dealer_id").references(() => dealers.id),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    uniqueIndex("idx_dealer_members_user").on(table.userId),
    index("idx_dealer_members_dealer").on(table.dealerId),
  ],
);

export const advancePayments = sqliteTable(
  "advance_payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealers.id),
    paymentDate: text("payment_date").notNull(),
    settlementMonth: text("settlement_month"),
    amount: integer("amount").notNull(),
    memo: text("memo"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_advance_payments_dealer_date").on(
      table.dealerId,
      table.paymentDate,
    ),
    index("idx_advance_payments_dealer_settlement_month").on(
      table.dealerId,
      table.settlementMonth,
    ),
  ],
);

export const monthlySettlementStatuses = sqliteTable(
  "monthly_settlement_statuses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealers.id),
    settlementMonth: text("settlement_month").notNull(),
    settlementDate: text("settlement_date"),
    paid: integer("paid", { mode: "boolean" }).notNull().default(false),
    taxInvoiceIssuedAt: text("tax_invoice_issued_at"),
    memo: text("memo"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_monthly_settlement_statuses_dealer_month").on(
      table.dealerId,
      table.settlementMonth,
    ),
    index("idx_monthly_settlement_statuses_dealer").on(table.dealerId),
  ],
);

export const vanSettlements = sqliteTable(
  "van_settlements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealerId: integer("dealer_id")
      .notNull()
      .references(() => dealers.id),
    settlementMonth: text("settlement_month").notNull(),
    vanCompany: text("van_company").notNull(),
    transactionCount: integer("transaction_count").notNull().default(0),
    paymentAmount: integer("payment_amount").notNull().default(0),
    vanFee: integer("van_fee").notNull().default(0),
    sourceFile: text("source_file"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_van_settlements_dealer_month_company").on(
      table.dealerId,
      table.settlementMonth,
      table.vanCompany,
    ),
    index("idx_van_settlements_dealer_month").on(
      table.dealerId,
      table.settlementMonth,
    ),
  ],
);

export const payerAccounts = sqliteTable(
  "payer_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    merchantId: integer("merchant_id")
      .notNull()
      .references(() => merchants.id),
    payerNumber: text("payer_number").notNull(),
    label: text("label"),
    monthlyCharge: integer("monthly_charge").notNull().default(0),
    billingType: text("billing_type", {
      enum: ["rental", "purchase", "installment"],
    })
      .notNull()
      .default("rental"),
    installmentMonths: integer("installment_months"),
    startMonth: text("start_month").notNull(),
    endMonth: text("end_month"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (table) => [
    uniqueIndex("idx_payer_accounts_number").on(table.payerNumber),
    index("idx_payer_accounts_merchant").on(table.merchantId),
  ],
);

export const paymentImports = sqliteTable(
  "payment_imports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealerId: integer("dealer_id").references(() => dealers.id),
    fileName: text("file_name").notNull(),
    importedBy: text("imported_by").notNull(),
    totalRows: integer("total_rows").notNull(),
    matchedRows: integer("matched_rows").notNull(),
    unmatchedRows: integer("unmatched_rows").notNull(),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_payment_imports_dealer_created").on(
      table.dealerId,
      table.createdAt,
    ),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    payerAccountId: integer("payer_account_id")
      .notNull()
      .references(() => payerAccounts.id),
    merchantId: integer("merchant_id")
      .notNull()
      .references(() => merchants.id),
    billingMonth: text("billing_month").notNull(),
    paymentDate: text("payment_date").notNull(),
    grossAmount: integer("gross_amount").notNull(),
    supplyAmount: integer("supply_amount").notNull(),
    vatAmount: integer("vat_amount").notNull(),
    sourceFile: text("source_file").notNull(),
    externalKey: text("external_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_payments_merchant_month").on(
      table.merchantId,
      table.billingMonth,
    ),
    index("idx_payments_payer_date").on(
      table.payerAccountId,
      table.paymentDate,
    ),
    uniqueIndex("idx_payments_external_key").on(table.externalKey),
  ],
);
