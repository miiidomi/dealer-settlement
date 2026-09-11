"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  ArrowLeftRight,
  ArrowUpRight,
  Boxes,
  Building2,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  CircleDollarSign,
  Coins,
  CreditCard,
  Download,
  FileSpreadsheet,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Cost,
  DashboardData,
  DEFAULT_MERCHANT_DETAIL_BILLING_COLUMNS,
  DEFAULT_MERCHANT_DETAIL_FIELDS,
  DEFAULT_MERCHANT_DETAIL_INSTALLATION_COLUMNS,
  DEFAULT_MERCHANT_DETAIL_PAYER_COLUMNS,
  MERCHANT_DETAIL_BILLING_COLUMNS,
  MERCHANT_DETAIL_FIELDS,
  MERCHANT_DETAIL_INSTALLATION_COLUMNS,
  MERCHANT_DETAIL_PAYER_COLUMNS,
  MERCHANT_LIST_COLUMNS,
  MerchantListColumnKey,
  MAIN_SUMMARY_CARDS,
  MainSummaryCardKey,
  SETTLEMENT_LIST_COLUMNS,
  SettlementListColumnKey,
  DealerCategoryCost,
  DealerProductCost,
  merchantDetailBillingColumnsFor,
  merchantDetailFieldsFor,
  merchantDetailInstallationColumnsFor,
  merchantListColumnsFor,
  merchantDetailPayerColumnsFor,
  mainSummaryCardsFor,
  monthsBetween,
  payerActiveInMonth,
  settlementListColumnsFor,
  won,
} from "./types";
import {
  installmentPending,
  installmentPendingBreakdown,
  installmentRevenue as eligibleInstallmentRevenue,
  installmentSettledRevenueForPeriod,
} from "./installment-settlement";

type ImportRow = {
  rowNumber: number;
  payerNumber: string;
  billingMonth: string;
  amount: number;
  paymentDate: string;
  referenceNumber?: string;
};

type VanImportRow = {
  rowNumber: number;
  settlementMonth: string;
  vanCompany: string;
  transactionCount: number;
  paymentAmount: number;
  vanFee: number;
};

type ProductCostImportRow = {
  rowNumber: number;
  productName: string;
  condition: string;
  unitCost: number;
  effectiveFrom: string;
};

type SalesforceProductOption = {
  id: string;
  name: string;
  family: string | null;
  condition: "신품" | "중고" | null;
};

type MerchantImportRow = {
  rowNumber: number;
  businessNumber: string;
  merchantName: string;
  installDate: string;
  payerNumber: string;
  productName: string;
  van: string;
  condition: string;
  transactionClassification: string;
  quantity: number;
  contractTermMonths: number;
  salesAmount: number;
  unitCost: number;
  unitCostProvided: boolean;
  costTotal: number;
  fixing: number;
  incentive: number;
  actualRevenue: number;
};

const MERCHANTS_PER_PAGE = 20;
const LIST_RETURN_STORAGE_KEY = "dealerSettlement:listReturnTo";

function updateSelectedIds<T extends number | string>(
  current: T[],
  ids: T[],
  checked: boolean,
) {
  if (checked) return [...new Set([...current, ...ids])];
  const removed = new Set(ids);
  return current.filter((id) => !removed.has(id));
}

function selectionState<T extends number | string>(
  selectedIds: T[],
  visibleIds: T[],
) {
  if (!visibleIds.length) return false;
  const selected = new Set(selectedIds);
  const count = visibleIds.filter((id) => selected.has(id)).length;
  return count === visibleIds.length
    ? true
    : count > 0
      ? ("indeterminate" as const)
      : false;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function InfoTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          tabIndex={0}
          className="inline-flex size-4 cursor-help items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#175cd3]"
        >
          <CircleHelp className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs leading-5">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/dashboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "저장하지 못했습니다.");
  return result;
}

async function readSpreadsheet(file: File) {
  try {
    const workbook = XLSX.read(await file.arrayBuffer(), {
      type: "array",
      cellDates: false,
    });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) throw new Error("Excel 시트가 없습니다.");
    return XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], {
      header: 1,
      defval: "",
      raw: true,
    });
  } catch {
    throw new Error(
      "Excel 파일을 읽지 못했습니다. 손상되지 않은 .xlsx 또는 .xls 파일인지 확인해주세요.",
    );
  }
}

function DeleteConfirmButton({
  title,
  description,
  onConfirm,
  disabled = false,
}: {
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-red-600"
          disabled={disabled}
        >
          <Trash2 /> 삭제
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "삭제하지 못했습니다.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "삭제 중…" : "삭제"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PageControls({
  page,
  totalPages,
  onChange,
  actions,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  actions?: React.ReactNode;
}) {
  if (totalPages <= 1 && !actions) return null;
  return (
    <div className="flex min-h-16 items-center justify-between gap-3 border-t px-4 py-3">
      {totalPages > 1 ? (
        <Pagination className="mx-0 w-auto justify-start">
          <PaginationContent>
            <PaginationItem>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => onChange(page - 1)}
              >
                이전
              </Button>
            </PaginationItem>
            <PaginationItem>
              <span className="px-3 text-sm text-slate-600">
                {page} / {totalPages}
              </span>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => onChange(page + 1)}
              >
                다음
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      ) : (
        <span />
      )}
      {actions}
    </div>
  );
}

function SalesforceSyncButton({
  dealerId,
  onSaved,
}: {
  dealerId: number;
  onSaved: (data: DashboardData) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function sync() {
    setBusy(true);
    try {
      const response = await fetch("/api/salesforce/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dealerId }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Salesforce 동기화에 실패했습니다.");
      const dashboardResponse = await fetch("/api/dashboard");
      const dashboard = await dashboardResponse.json();
      if (!dashboardResponse.ok)
        throw new Error(dashboard.error ?? "화면을 새로고침하지 못했습니다.");
      onSaved(dashboard);
      toast.success(
        `Salesforce 동기화 완료 · 가맹점 ${result.accounts}곳, 문의제품 ${result.lineItems}건, 납부자번호 ${result.payerAccounts}건${result.undated ? ` · 설치일 미입력 ${result.undated}건` : ""}${result.unpriced ? ` · 원가 미등록 ${result.unpriced}건` : ""}${result.cmsWarning ? ` · ${result.cmsWarning}` : ""}`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Salesforce 동기화에 실패했습니다.",
        { duration: 7000 },
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      onClick={sync}
      disabled={busy}
      className="h-11 rounded-xl bg-[#175cd3] px-5 hover:bg-[#124ba8]"
    >
      <RefreshCw className={busy ? "animate-spin" : ""} />
      {busy ? "동기화 중…" : "Salesforce 동기화"}
    </Button>
  );
}

function toDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed)
      return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 8)
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toISOString().slice(0, 10);
}
function toMonth(value: unknown) {
  if (value instanceof Date)
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  const text = String(value ?? "").trim();
  const separated = text.match(/^(\d{4})\s*(?:년|[-./])\s*(\d{1,2})\s*월?$/);
  if (separated) {
    const month = Number(separated[2]);
    if (month >= 1 && month <= 12)
      return `${separated[1]}-${String(month).padStart(2, "0")}`;
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length === 6) {
    const month = Number(digits.slice(4, 6));
    if (month >= 1 && month <= 12)
      return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
  }
  return "";
}
function norm(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[\s_-]/g, "");
}
function searchKey(value: unknown) {
  return norm(value).toLowerCase();
}
function initialParam(name: string) {
  if (typeof window === "undefined") return "";
  const current = new URLSearchParams(window.location.search).get(name);
  if (current) return current;
  const stored = window.sessionStorage.getItem(LIST_RETURN_STORAGE_KEY);
  if (!stored?.startsWith("/?")) return "";
  return new URLSearchParams(stored.slice(2)).get(name) ?? "";
}
function initialPositiveInt(name: string, fallback: number) {
  const value = Number(initialParam(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
function normalizeProductName(value: unknown) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function toNumber(value: unknown) {
  const normalized = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
function dayBefore(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function normalizeTransactionClassification(value: unknown) {
  const normalized = norm(value);
  if (["구매", "일시불", "일시불구매"].includes(normalized)) return "구매";
  if (["할부", "할부구매"].includes(normalized)) return "할부구매";
  if (["임대", "렌탈"].includes(normalized)) return "임대";
  if (["무상", "무료"].includes(normalized)) return "무상";
  return String(value ?? "").trim();
}

type ProductCostTableRow = {
  product: DashboardData["products"][number];
  cost: Cost | null;
  dealerCost: DealerProductCost | null;
  scopeDealerId: number | null;
  endDate: string | null;
};

type ProductCostRef = `cost:${number}` | `dealer:${number}`;

function productCostRows(data: DashboardData): ProductCostTableRow[] {
  return data.products.flatMap((product) => {
    const currentByCondition = <T extends Cost | DealerProductCost>(
      costs: T[],
    ) =>
      [
        ...new Set(
          costs.map((cost) => String(cost.condition || "신품").trim() || "신품"),
        ),
      ].flatMap((condition) => {
        const current = costs
          .filter(
            (cost) =>
              (String(cost.condition || "신품").trim() || "신품") ===
              condition,
          )
          .sort(
            (a, b) =>
              String(b.effectiveFrom ?? "").localeCompare(
                String(a.effectiveFrom ?? ""),
              ) ||
              b.id - a.id,
          )[0];
        return current ? [current] : [];
      });
    const commonRows = currentByCondition(
      data.costs.filter((cost) => cost.productId === product.id),
    ).map((cost) => ({
      product,
      cost: cost as Cost,
      dealerCost: null,
      scopeDealerId: null,
      endDate: null,
    }));
    const dealerRows = [
      ...new Set(
        data.dealerProductCosts
          .filter((cost) => cost.productId === product.id)
          .map((cost) => cost.dealerId),
      ),
    ].flatMap((dealerId) =>
      currentByCondition(
        data.dealerProductCosts.filter(
          (cost) => cost.productId === product.id && cost.dealerId === dealerId,
        ),
      ).map((dealerCost) => ({
        product,
        cost: null,
        dealerCost: dealerCost as DealerProductCost,
        scopeDealerId: dealerId,
        endDate: null,
      })),
    );
    if (!commonRows.length && !dealerRows.length && product.directCostAllowed)
      return [
        {
          product,
          cost: null,
          dealerCost: null,
          scopeDealerId: null,
          endDate: null,
        },
      ];
    return [...commonRows, ...dealerRows];
  });
}

function rowCost(row: ProductCostTableRow) {
  return row.dealerCost ?? row.cost;
}

function productCostRef(row: ProductCostTableRow): ProductCostRef | null {
  if (row.dealerCost) return `dealer:${row.dealerCost.id}`;
  if (row.cost) return `cost:${row.cost.id}`;
  return null;
}

function productCostRefIds(refs: ProductCostRef[]) {
  return {
    costIds: refs
      .filter((ref) => ref.startsWith("cost:"))
      .map((ref) => Number(ref.slice("cost:".length))),
    dealerProductCostIds: refs
      .filter((ref) => ref.startsWith("dealer:"))
      .map((ref) => Number(ref.slice("dealer:".length))),
  };
}

function productCostHistoryRows(
  data: DashboardData,
  productId: number,
  scopeDealerId: number | null,
): ProductCostTableRow[] {
  const product = data.products.find((row) => row.id === productId);
  if (!product) return [];
  const costs =
    scopeDealerId === null
      ? data.costs.filter((cost) => cost.productId === productId)
      : data.dealerProductCosts.filter(
          (cost) =>
            cost.productId === productId && cost.dealerId === scopeDealerId,
        );
  const currentIds = new Set(
    productCostRows(data)
      .filter(
        (row) =>
          row.product.id === productId && row.scopeDealerId === scopeDealerId,
      )
      .flatMap((row) => {
        const cost = rowCost(row);
        return cost ? [cost.id] : [];
      }),
  );
  return [
    ...new Set(
      costs.map((cost) => String(cost.condition || "신품").trim() || "신품"),
    ),
  ]
    .flatMap((condition) => {
      const ascending = costs
        .filter(
          (cost) =>
            (String(cost.condition || "신품").trim() || "신품") === condition,
        )
        .sort(
          (a, b) =>
            String(a.effectiveFrom ?? "").localeCompare(
              String(b.effectiveFrom ?? ""),
            ) ||
            a.id - b.id,
        );
      return ascending.map((cost, index) => ({
        product,
        cost: scopeDealerId === null ? (cost as Cost) : null,
        dealerCost: scopeDealerId === null ? null : (cost as DealerProductCost),
        scopeDealerId,
        endDate: ascending[index + 1]
          ? dayBefore(ascending[index + 1].effectiveFrom)
          : null,
      }));
    })
    .filter((row) => {
      const cost = rowCost(row);
      return cost && !currentIds.has(cost.id);
    })
    .sort((a, b) => {
      const left = rowCost(a);
      const right = rowCost(b);
      const byDate = String(right?.effectiveFrom ?? "").localeCompare(
        String(left?.effectiveFrom ?? ""),
      );
      return byDate || (right?.id ?? 0) - (left?.id ?? 0);
    });
}

function dealerCostScopeLabel(
  data: DashboardData,
  scopeDealerId: number | null,
) {
  if (scopeDealerId === null) return "전체 딜러";
  return (
    data.dealers.find((dealer) => dealer.id === scopeDealerId)?.name ??
    "알 수 없는 딜러"
  );
}

function downloadProductCosts(data: DashboardData) {
  const rows = productCostRows(data).map((row) => {
    const cost = rowCost(row);
    return {
      제품명: row.product.name,
      "적용 딜러": dealerCostScopeLabel(data, row.scopeDealerId),
      "제품 상태": cost?.condition ?? "신품",
      "원가 공급가액": cost?.unitCost ?? "",
      적용일: cost?.effectiveFrom ?? "",
    };
  });
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 30 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
  ];
  worksheet["!autofilter"] = { ref: `A1:E${Math.max(2, rows.length + 1)}` };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "제품 원가");
  XLSX.writeFile(
    workbook,
    `제품원가_${new Date().toISOString().slice(0, 10)}.xlsx`,
  );
}

function downloadMerchantTemplate() {
  const headers = [
    "사업자번호",
    "가맹점명",
    "설치일자",
    "납부자번호",
    "모델명",
    "VAN",
    "유형",
    "거래구분",
    "수량",
    "약정개월",
    "판매 단가",
    "원가 단가",
    "원가 합계",
    "대금책정",
    "영업수수료",
    "실제수익",
  ];
  const worksheet = XLSX.utils.aoa_to_sheet([
    headers,
    [
      "123-45-67890",
      "예시가맹점",
      "2026-09-01",
      "P000001",
      "POS 본체",
      "KIS",
      "신품",
      "구매",
      1,
      36,
      1500000,
      1200000,
      { f: "I2*L2" },
      0,
      0,
      { f: 'IF(H2="구매",I2*K2,IF(H2="할부구매",N2+O2,0))' },
    ],
  ]);
  worksheet["!cols"] = [
    { wch: 16 },
    { wch: 22 },
    { wch: 14 },
    { wch: 18 },
    { wch: 24 },
    { wch: 12 },
    { wch: 10 },
    { wch: 14 },
    { wch: 8 },
    { wch: 12 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
  ];
  worksheet["!autofilter"] = { ref: "A1:P2" };
  const guide = XLSX.utils.aoa_to_sheet([
    ["작성 안내"],
    ["가맹점에 설치 제품이 여러 개면 사업자번호·가맹점 정보를 반복하고, 제품별 설치일자를 각 행에 입력합니다."],
    ["설치일자는 YYYY-MM-DD, 유형은 신품/중고, 거래구분은 구매/할부구매/임대/무상 형식으로 입력합니다. 약정개월을 비우면 36개월로 등록됩니다."],
    ["원가 합계와 실제수익은 확인용 자동 계산 열이며, 업로드 계산에는 원본 단가·수량·대금책정·영업수수료를 사용합니다."],
    ["납부자번호가 필요 없는 구매·할부구매·무상은 납부자번호를 비워둘 수 있습니다."],
    ["사업자번호와 납부자번호는 앞자리 0이 사라지지 않도록 텍스트 형식으로 입력합니다."],
  ]);
  guide["!cols"] = [{ wch: 110 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "가맹점 등록");
  XLSX.utils.book_append_sheet(workbook, guide, "작성 안내");
  XLSX.writeFile(workbook, "가맹점_수동등록_예시양식.xlsx");
}

function ImportDialog({
  data,
  onSaved,
}: {
  data: DashboardData;
  onSaved: (data: DashboardData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [includesVat, setIncludesVat] = useState(true);
  const [busy, setBusy] = useState(false);
  const payerSet = useMemo(
    () => new Set(data.payerAccounts.map((payer) => norm(payer.payerNumber))),
    [data],
  );
  const matched = rows.filter((row) => payerSet.has(norm(row.payerNumber)));
  const unmatched = rows.filter((row) => !payerSet.has(norm(row.payerNumber)));
  async function readFile(next: File) {
    setFile(next);
    setBusy(true);
    try {
      const sheet = await readSpreadsheet(next);
      const normalized = sheet.map((row) => row.map(norm));
      const headerIndex = normalized.findIndex(
        (row) =>
          row.some((cell) => cell === "청구회차" || cell === "납부자번호") &&
          row.some(
            (cell) =>
              cell === "청구월차" || cell === "납부월" || cell === "청구월",
          ) &&
          row.some((cell) => cell === "납입금액" || cell === "납부금액") &&
          row.some(
            (cell) =>
              cell === "납입일자" || cell === "납부일자" || cell === "납부일",
          ),
      );
      if (headerIndex < 0)
        throw new Error(
          "청구회차, 청구월차, 납입금액, 납입일자 열을 찾지 못했습니다.",
        );
      const headers = normalized[headerIndex];
      const indexOf = (...names: string[]) =>
        headers.findIndex((header) => names.includes(header));
      const payerIdx = indexOf(
        "청구회차",
        "납부자번호",
        "납부번호",
        "고객번호",
      );
      const monthIdx = indexOf("청구월차", "납부월", "청구월");
      const amountIdx = indexOf("납입금액", "납부금액", "입금액", "결제금액");
      const dateIdx = indexOf(
        "납입일자",
        "납부일자",
        "납부일",
        "입금일자",
        "입금일",
      );
      const refIdx = indexOf("거래번호", "납부ID", "납부아이디");
      const parsed = sheet
        .slice(headerIndex + 1)
        .map((row, index) => ({
          rowNumber: headerIndex + index + 2,
          payerNumber: String(row[payerIdx] ?? ""),
          billingMonth: toMonth(row[monthIdx]),
          amount: Number(String(row[amountIdx] ?? "0").replaceAll(",", "")),
          paymentDate: toDate(row[dateIdx]),
          referenceNumber: refIdx >= 0 ? String(row[refIdx] ?? "") : undefined,
        }))
        .filter((row) => row.payerNumber || row.amount || row.paymentDate);
      if (!parsed.length) throw new Error("등록할 납부내역이 없습니다.");
      setRows(parsed);
      toast.success(`${parsed.length}개 행을 읽었습니다.`);
    } catch (error) {
      setRows([]);
      toast.error(
        error instanceof Error ? error.message : "파일을 읽지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function applyImport() {
    if (!file || !rows.length) return;
    setBusy(true);
    try {
      const result = await post({
        action: "importPayments",
        fileName: file.name,
        amountIncludesVat: includesVat,
        rows,
      });
      onSaved(result.data);
      const failed = result.importResult.unmatched.length;
      toast.success(
        `${result.importResult.imported}건 등록 완료${failed ? ` · 미매핑 ${failed}건` : ""}`,
      );
      if (!failed) setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "납부내역을 등록하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 rounded-xl bg-white">
          <Upload />
          납부내역 Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <div className="grid gap-5">
          <DialogHeader>
            <DialogTitle>전체 가맹점 납부내역 등록</DialogTitle>
            <DialogDescription>
              Excel의 납부자번호를 가맹점에 자동 매핑합니다. 등록되지 않은
              번호는 반영하지 않습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/60 p-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <FileSpreadsheet className="size-9 text-[#175cd3]" />
              <div>
                <p className="font-semibold">납부내역 Excel 선택</p>
                <p className="mt-1 text-xs text-slate-500">
                  필수 열: 청구회차 · 청구월차 · 납입금액 · 납입일자
                </p>
              </div>
              <Input
                className="max-w-sm bg-white"
                type="file"
                accept=".xlsx,.xls"
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.files?.[0];
                  if (next) readFile(next);
                }}
              />
            </div>
          </div>
          <label className="flex items-start gap-3 rounded-xl border p-4">
            <Checkbox
              checked={includesVat}
              onCheckedChange={(value) => setIncludesVat(value === true)}
            />
            <span>
              <b className="block text-sm">Excel 납부금액은 VAT 포함 금액</b>
              <small className="text-slate-500">
                체크하면 공급가액과 VAT를 자동 분리하고, 정산에는 공급가액만
                사용합니다.
              </small>
            </span>
          </label>
          {rows.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="mini-stat">
                  <span>전체</span>
                  <b>{rows.length}건</b>
                </div>
                <div className="mini-stat text-emerald-700">
                  <span>매핑 성공</span>
                  <b>{matched.length}건</b>
                </div>
                <div className="mini-stat text-red-700">
                  <span>확인 필요</span>
                  <b>{unmatched.length}건</b>
                </div>
              </div>
              <div className="max-h-72 overflow-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>행</TableHead>
                      <TableHead>납부자번호</TableHead>
                      <TableHead>청구월</TableHead>
                      <TableHead>납부일자</TableHead>
                      <TableHead className="text-right">납부금액</TableHead>
                      <TableHead>매핑</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 100).map((row) => {
                      const ok = payerSet.has(norm(row.payerNumber));
                      return (
                        <TableRow key={row.rowNumber}>
                          <TableCell>{row.rowNumber}</TableCell>
                          <TableCell className="font-mono">
                            {row.payerNumber}
                          </TableCell>
                          <TableCell>{row.billingMonth}</TableCell>
                          <TableCell>{row.paymentDate}</TableCell>
                          <TableCell className="text-right">
                            {won(row.amount)}
                          </TableCell>
                          <TableCell>
                            {ok ? (
                              <Badge className="bg-emerald-50 text-emerald-700">
                                <CheckCircle2 />
                                일치
                              </Badge>
                            ) : (
                              <Badge className="bg-red-50 text-red-700">
                                <XCircle />
                                미매핑
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
          <DialogFooter>
            <Button disabled={busy || !matched.length} onClick={applyImport}>
              {busy ? "처리 중…" : `${matched.length}건 납입내역 등록`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VanSettlementDialog({
  dealerId,
  defaultMonth,
  onSaved,
  settlement,
}: {
  dealerId: number;
  defaultMonth: string;
  onSaved: (data: DashboardData) => void;
  settlement?: DashboardData["vanSettlements"][number];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await post({
        action: "saveVanSettlement",
        dealerId,
        vanSettlementId: settlement?.id,
        ...Object.fromEntries(new FormData(event.currentTarget)),
      });
      onSaved(result);
      setOpen(false);
      toast.success(
        settlement ? "VAN 실적을 수정했습니다." : "VAN 실적을 등록했습니다.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "VAN 실적을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={settlement ? "ghost" : "outline"}
          size={settlement ? "sm" : "default"}
          className={settlement ? undefined : "rounded-xl"}
        >
          {settlement ? (
            "수정"
          ) : (
            <>
              <Plus /> VAN 실적 등록
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>
              {settlement ? "VAN 실적 수정" : "월별 VAN 실적 등록"}
            </DialogTitle>
            <DialogDescription>
              결제 건수와 금액을 입력하면 객단가를 자동 계산하며, VAN피는 총
              수익에 포함됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="정산월">
              <Input
                name="settlementMonth"
                type="month"
                defaultValue={settlement?.settlementMonth ?? defaultMonth}
                required
              />
            </Field>
            <Field label="VAN사">
              <Input
                name="vanCompany"
                defaultValue={settlement?.vanCompany}
                placeholder="예: KIS, NICE"
                required
              />
            </Field>
            <Field label="결제 건수">
              <Input
                name="transactionCount"
                type="number"
                min="0"
                step="1"
                defaultValue={settlement?.transactionCount ?? 0}
                required
              />
            </Field>
            <Field label="결제금액">
              <Input
                name="paymentAmount"
                type="number"
                min="0"
                step="1"
                defaultValue={settlement?.paymentAmount ?? 0}
                required
              />
            </Field>
          </div>
          <Field label="VAN피">
            <Input
              name="vanFee"
              type="number"
              min="0"
              step="1"
              defaultValue={settlement?.vanFee ?? 0}
              required
            />
          </Field>
          <DialogFooter>
            <Button disabled={busy}>{busy ? "저장 중…" : "저장"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VanImportDialog({
  dealerId,
  onSaved,
}: {
  dealerId: number;
  onSaved: (data: DashboardData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<VanImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  async function readFile(next: File) {
    setFile(next);
    setBusy(true);
    try {
      const sheet = await readSpreadsheet(next);
      const normalized = sheet.map((row) => row.map(norm));
      const aliases = {
        month: ["정산월", "기준월", "월"],
        company: ["VAN사", "밴사", "VAN", "밴"],
        count: ["건수", "결제건수", "승인건수", "거래건수"],
        amount: ["결제금액", "승인금액", "거래금액"],
        fee: ["VAN피", "밴피", "VAN수익", "밴수익"],
      };
      const headerIndex = normalized.findIndex((row) =>
        Object.values(aliases).every((names) =>
          row.some((cell) => names.includes(cell)),
        ),
      );
      if (headerIndex < 0)
        throw new Error(
          "정산월, VAN사, 건수, 결제금액, VAN피 열을 찾지 못했습니다.",
        );
      const headers = normalized[headerIndex];
      const indexOf = (names: string[]) =>
        headers.findIndex((header) => names.includes(header));
      const monthIdx = indexOf(aliases.month);
      const companyIdx = indexOf(aliases.company);
      const countIdx = indexOf(aliases.count);
      const amountIdx = indexOf(aliases.amount);
      const feeIdx = indexOf(aliases.fee);
      const parsed = sheet
        .slice(headerIndex + 1)
        .map((row, index) => ({
          rowNumber: headerIndex + index + 2,
          settlementMonth: toMonth(row[monthIdx]),
          vanCompany: String(row[companyIdx] ?? "").trim(),
          transactionCount: Math.round(toNumber(row[countIdx])),
          paymentAmount: Math.round(toNumber(row[amountIdx])),
          vanFee: Math.round(toNumber(row[feeIdx])),
        }))
        .filter(
          (row) =>
            row.settlementMonth ||
            row.vanCompany ||
            row.transactionCount ||
            row.paymentAmount ||
            row.vanFee,
        );
      if (!parsed.length) throw new Error("등록할 VAN 실적이 없습니다.");
      setRows(parsed);
      toast.success(`${parsed.length}개 행을 읽었습니다.`);
    } catch (error) {
      setRows([]);
      toast.error(
        error instanceof Error ? error.message : "파일을 읽지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function applyImport() {
    if (!file || !rows.length) return;
    setBusy(true);
    try {
      const result = await post({
        action: "importVanSettlements",
        dealerId,
        fileName: file.name,
        rows,
      });
      onSaved(result.data);
      setOpen(false);
      toast.success(`${result.importResult.total}건의 VAN 실적을 반영했습니다.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "VAN 실적을 등록하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-xl">
          <Upload /> VAN Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <div className="grid gap-5">
          <DialogHeader>
            <DialogTitle>VAN 실적 Excel 등록</DialogTitle>
            <DialogDescription>
              동일한 딜러·정산월·VAN사가 이미 있으면 Excel 값으로 갱신합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/60 p-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <FileSpreadsheet className="size-9 text-[#175cd3]" />
              <div>
                <p className="font-semibold">VAN 실적 Excel 선택</p>
                <p className="mt-1 text-xs text-slate-500">
                  필수 열: 정산월 · VAN사 · 건수 · 결제금액 · VAN피
                </p>
              </div>
              <Input
                className="max-w-sm bg-white"
                type="file"
                accept=".xlsx,.xls"
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.files?.[0];
                  if (next) readFile(next);
                }}
              />
            </div>
          </div>
          {rows.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>행</TableHead>
                    <TableHead>정산월</TableHead>
                    <TableHead>VAN사</TableHead>
                    <TableHead className="text-right">건수</TableHead>
                    <TableHead className="text-right">결제금액</TableHead>
                    <TableHead className="text-right">VAN피</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 100).map((row) => (
                    <TableRow key={row.rowNumber}>
                      <TableCell>{row.rowNumber}</TableCell>
                      <TableCell>{row.settlementMonth || "확인 필요"}</TableCell>
                      <TableCell>{row.vanCompany || "확인 필요"}</TableCell>
                      <TableCell className="text-right">
                        {row.transactionCount.toLocaleString("ko-KR")}건
                      </TableCell>
                      <TableCell className="text-right">
                        {won(row.paymentAmount)}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-emerald-700">
                        {won(row.vanFee)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button disabled={busy || !rows.length} onClick={applyImport}>
              {busy ? "처리 중…" : `${rows.length}건 VAN 실적 등록`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProductCostImportDialog({
  data,
  onSaved,
}: {
  data: DashboardData;
  onSaved: (data: DashboardData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ProductCostImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const productNames = useMemo(
    () =>
      new Set(
        data.products.map((product) => normalizeProductName(product.name)),
      ),
    [data.products],
  );
  const issueFor = (row: ProductCostImportRow) => {
    if (!normalizeProductName(row.productName)) return "제품명 확인";
    if (!["신품", "중고"].includes(row.condition)) return "상태 확인";
    if (!Number.isFinite(row.unitCost) || row.unitCost < 0) return "원가 확인";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.effectiveFrom)) return "적용일 확인";
    return "";
  };
  const invalidRows = rows.filter((row) => issueFor(row));

  async function readFile(file: File) {
    setBusy(true);
    try {
      const sheet = await readSpreadsheet(file);
      const normalized = sheet.map((row) => row.map(norm));
      const headerIndex = normalized.findIndex(
        (row) =>
          row.includes("제품명") &&
          row.includes("제품상태") &&
          row.includes("원가공급가액") &&
          row.includes("적용일"),
      );
      if (headerIndex < 0)
        throw new Error(
          "제품명, 제품 상태, 원가 공급가액, 적용일 열을 찾지 못했습니다.",
        );
      const headers = normalized[headerIndex];
      const indexOf = (...names: string[]) =>
        headers.findIndex((header) => names.includes(header));
      const productIdx = indexOf("제품명", "모델명", "제품");
      const conditionIdx = indexOf("제품상태", "유형", "상태");
      const costIdx = indexOf("원가공급가액", "제품원가", "원가", "단가");
      const dateIdx = indexOf("적용일", "적용시작일", "시작일");
      const parsed = sheet
        .slice(headerIndex + 1)
        .map((row, index) => ({
          rowNumber: headerIndex + index + 2,
          productName: normalizeProductName(row[productIdx]),
          condition: String(row[conditionIdx] ?? "신품").trim() || "신품",
          unitCost: toNumber(row[costIdx]),
          effectiveFrom: toDate(row[dateIdx]),
        }))
        .filter((row) => row.unitCost > 0 || row.effectiveFrom);
      if (!parsed.length) throw new Error("등록할 제품 원가가 없습니다.");
      setRows(parsed);
      toast.success(`${parsed.length}개 원가 행을 읽었습니다.`);
    } catch (error) {
      setRows([]);
      toast.error(
        error instanceof Error ? error.message : "파일을 읽지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!rows.length || invalidRows.length) return;
    setBusy(true);
    try {
      const result = await post({ action: "importProductCosts", rows });
      onSaved(result.data);
      setOpen(false);
      setRows([]);
      toast.success(
        `${result.importResult.total}건의 제품 원가를 반영했습니다.${result.importResult.productsAdded ? ` 새 제품 ${result.importResult.productsAdded}개를 함께 등록했습니다.` : ""}`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "제품 원가를 등록하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-xl">
          <Upload /> Excel 업로드
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <div className="grid gap-5">
          <DialogHeader>
            <DialogTitle>제품 원가 Excel 업로드</DialogTitle>
            <DialogDescription>
              원가와 적용일을 입력한 뒤 업로드하세요. 현재 목록에 없는 제품은
              새 제품으로 등록되며, 같은 제품·상태·적용일은 새 값으로
              갱신됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/60 p-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <FileSpreadsheet className="size-9 text-[#175cd3]" />
              <p className="text-sm font-semibold">
                필수 열: 제품명 · 제품 상태 · 원가 공급가액 · 적용일
              </p>
              <Input
                className="max-w-sm bg-white"
                type="file"
                accept=".xlsx,.xls"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) readFile(file);
                }}
              />
            </div>
          </div>
          {rows.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>행</TableHead>
                    <TableHead>제품명</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>적용일</TableHead>
                    <TableHead className="text-right">원가</TableHead>
                    <TableHead>확인</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 100).map((row) => {
                    const issue = issueFor(row);
                    const isNewProduct =
                      !issue &&
                      !productNames.has(normalizeProductName(row.productName));
                    return (
                      <TableRow key={row.rowNumber}>
                        <TableCell>{row.rowNumber}</TableCell>
                        <TableCell>{row.productName || "-"}</TableCell>
                        <TableCell>{row.condition || "-"}</TableCell>
                        <TableCell>{row.effectiveFrom || "-"}</TableCell>
                        <TableCell className="text-right">
                          {won(row.unitCost)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              issue
                                ? "bg-red-50 text-red-700"
                                : isNewProduct
                                  ? "bg-blue-50 text-blue-700"
                                  : "bg-emerald-50 text-emerald-700"
                            }
                          >
                            {issue || (isNewProduct ? "새 제품 등록" : "등록 가능")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={busy || !rows.length || invalidRows.length > 0}
              onClick={applyImport}
            >
              {busy ? "처리 중…" : `${rows.length}건 원가 반영`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MerchantImportDialog({
  dealerId,
  onSaved,
}: {
  dealerId: number;
  onSaved: (data: DashboardData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<MerchantImportRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const invalidRows = rows.filter(
    (row) =>
      !norm(row.businessNumber) ||
      !row.merchantName ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.installDate) ||
      !row.productName ||
      !["구매", "할부구매", "임대", "무상"].includes(
        row.transactionClassification,
      ) ||
      row.quantity < 1 ||
      row.contractTermMonths < 1 ||
      [row.salesAmount, row.unitCost, row.fixing, row.incentive].some(
        (value) => !Number.isFinite(value) || value < 0,
      ),
  );

  async function readFile(next: File) {
    setFile(next);
    setBusy(true);
    try {
      const sheet = await readSpreadsheet(next);
      const normalized = sheet.map((row) => row.map(norm));
      const headerIndex = normalized.findIndex(
        (row) =>
          row.includes("사업자번호") &&
          row.includes("가맹점명") &&
          (row.includes("설치일자") || row.includes("설치일")) &&
          (row.includes("모델명") || row.includes("제품명")),
      );
      if (headerIndex < 0)
        throw new Error(
          "사업자번호, 가맹점명, 설치일자, 모델명 열을 찾지 못했습니다. 예시 양식을 이용해주세요.",
        );
      const headers = normalized[headerIndex];
      const indexOf = (...names: string[]) =>
        headers.findIndex((header) => names.includes(header));
      const indexes = {
        businessNumber: indexOf("사업자번호"),
        merchantName: indexOf("가맹점명", "상호명"),
        installDate: indexOf("설치일자", "설치일"),
        payerNumber: indexOf("납부자번호"),
        productName: indexOf("모델명", "제품명"),
        van: indexOf("VAN", "밴", "VAN사"),
        condition: indexOf("유형", "제품상태", "상태"),
        classification: indexOf("거래구분"),
        quantity: indexOf("수량"),
        contractTermMonths: indexOf("약정개월", "약정", "계약개월"),
        salesAmount: indexOf(
          "판매단가",
          "판매금액",
          "임대료판매단가",
          "임대료",
        ),
        unitCost: indexOf("원가단가", "원가공급가액"),
        costTotal: indexOf("원가합계"),
        fixing: indexOf("대금책정"),
        incentive: indexOf("영업수수료"),
        actualRevenue: indexOf("실제수익"),
      };
      const valueAt = (row: unknown[], index: number) =>
        index >= 0 ? row[index] : "";
      const parsed = sheet
        .slice(headerIndex + 1)
        .map((row, index) => {
          const quantity = Math.round(toNumber(valueAt(row, indexes.quantity)));
          const parsedContractTerm = Math.round(
            toNumber(valueAt(row, indexes.contractTermMonths)),
          );
          const salesAmount = toNumber(valueAt(row, indexes.salesAmount));
          const rawUnitCost = valueAt(row, indexes.unitCost);
          const unitCost = toNumber(rawUnitCost);
          const fixing = toNumber(valueAt(row, indexes.fixing));
          const incentive = toNumber(valueAt(row, indexes.incentive));
          const classification = normalizeTransactionClassification(
            valueAt(row, indexes.classification),
          );
          return {
            rowNumber: headerIndex + index + 2,
            businessNumber: String(
              valueAt(row, indexes.businessNumber),
            ).trim(),
            merchantName: String(valueAt(row, indexes.merchantName)).trim(),
            installDate: toDate(valueAt(row, indexes.installDate)),
            payerNumber: String(valueAt(row, indexes.payerNumber)).trim(),
            productName: String(valueAt(row, indexes.productName)).trim(),
            van: String(valueAt(row, indexes.van)).trim(),
            condition:
              String(valueAt(row, indexes.condition)).trim() || "신품",
            transactionClassification: classification,
            quantity,
            contractTermMonths: parsedContractTerm > 0 ? parsedContractTerm : 36,
            salesAmount,
            unitCost,
            unitCostProvided:
              rawUnitCost !== null &&
              rawUnitCost !== undefined &&
              String(rawUnitCost).trim() !== "",
            costTotal:
              toNumber(valueAt(row, indexes.costTotal)) || quantity * unitCost,
            fixing,
            incentive,
            actualRevenue:
              toNumber(valueAt(row, indexes.actualRevenue)) ||
              (classification === "구매"
                ? quantity * salesAmount
                : classification === "할부구매"
                  ? fixing + incentive
                  : 0),
          };
        })
        .filter(
          (row) =>
            row.businessNumber || row.merchantName || row.productName,
        );
      if (!parsed.length) throw new Error("등록할 가맹점 행이 없습니다.");
      setRows(parsed);
      toast.success(`${parsed.length}개 설치 제품 행을 읽었습니다.`);
    } catch (error) {
      setRows([]);
      toast.error(
        error instanceof Error ? error.message : "파일을 읽지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!file || !rows.length || invalidRows.length) return;
    setBusy(true);
    try {
      const result = await post({
        action: "importMerchants",
        dealerId,
        fileName: file.name,
        rows,
      });
      onSaved(result.data);
      setOpen(false);
      setRows([]);
      toast.success(
        `가맹점 ${result.importResult.merchants}곳 · 설치제품 ${result.importResult.installations}건을 반영했습니다.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "가맹점을 등록하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-11 rounded-xl bg-white">
          <Upload /> 가맹점 Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <div className="grid gap-5">
          <DialogHeader>
            <DialogTitle>수동 가맹점 Excel 등록</DialogTitle>
            <DialogDescription>
              Salesforce에 없는 가맹점도 등록할 수 있지만, 모델명과 제품군은
              Salesforce Product2를 기준으로 확인합니다. 동일한 사업자번호·제품
              행은 다시 올리면 갱신됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col justify-between gap-3 rounded-xl border bg-slate-50 p-4 sm:flex-row sm:items-center">
            <div>
              <b className="text-sm">먼저 예시 양식을 내려받아 작성하세요.</b>
              <p className="mt-1 text-xs text-slate-500">
                제품이 여러 개면 같은 가맹점 정보를 반복하고, 각 행에 해당
                제품의 설치일자를 입력합니다.
              </p>
            </div>
            <Button variant="outline" onClick={downloadMerchantTemplate}>
              <Download /> 예시 양식 다운로드
            </Button>
          </div>
          <div className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/60 p-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <FileSpreadsheet className="size-9 text-[#175cd3]" />
              <p className="text-xs text-slate-600">
                사업자번호 · 가맹점명 · 설치일자 · 납부자번호 · 설치제품 상세
              </p>
              <Input
                className="max-w-sm bg-white"
                type="file"
                accept=".xlsx,.xls"
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.files?.[0];
                  if (next) readFile(next);
                }}
              />
            </div>
          </div>
          {rows.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="mini-stat">
                  <span>전체</span>
                  <b>{rows.length}건</b>
                </div>
                <div className="mini-stat text-emerald-700">
                  <span>등록 가능</span>
                  <b>{rows.length - invalidRows.length}건</b>
                </div>
                <div className="mini-stat text-red-700">
                  <span>확인 필요</span>
                  <b>{invalidRows.length}건</b>
                </div>
              </div>
              <div className="max-h-80 overflow-auto rounded-xl border">
                <Table className="whitespace-nowrap">
                  <TableHeader>
                    <TableRow>
                      <TableHead>행</TableHead>
                      <TableHead>사업자번호</TableHead>
                      <TableHead>가맹점명</TableHead>
                      <TableHead>설치일</TableHead>
                      <TableHead>모델명</TableHead>
                      <TableHead>VAN</TableHead>
                      <TableHead>유형</TableHead>
                      <TableHead>거래구분</TableHead>
                      <TableHead className="text-right">수량</TableHead>
                      <TableHead className="text-right">약정</TableHead>
                      <TableHead className="text-right">판매 단가</TableHead>
                      <TableHead className="text-right">원가 단가</TableHead>
                      <TableHead className="text-right">실제수익</TableHead>
                      <TableHead>확인</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 100).map((row) => {
                      const invalid = invalidRows.includes(row);
                      return (
                        <TableRow key={row.rowNumber}>
                          <TableCell>{row.rowNumber}</TableCell>
                          <TableCell>{row.businessNumber || "-"}</TableCell>
                          <TableCell>{row.merchantName || "-"}</TableCell>
                          <TableCell>{row.installDate || "-"}</TableCell>
                          <TableCell>{row.productName || "-"}</TableCell>
                          <TableCell>{row.van || "-"}</TableCell>
                          <TableCell>{row.condition || "-"}</TableCell>
                          <TableCell>
                            {row.transactionClassification || "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.quantity}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.contractTermMonths}개월
                          </TableCell>
                          <TableCell className="text-right">
                            {won(row.salesAmount)}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.unitCostProvided
                              ? won(row.unitCost)
                              : "제품/제품군 원가 적용"}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-blue-700">
                            {won(row.actualRevenue)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={
                                invalid
                                  ? "bg-red-50 text-red-700"
                                  : "bg-emerald-50 text-emerald-700"
                              }
                            >
                              {invalid ? "확인 필요" : "등록 가능"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
          <DialogFooter>
            <Button
              disabled={busy || !rows.length || invalidRows.length > 0}
              onClick={applyImport}
            >
              {busy ? "처리 중…" : `${rows.length}건 등록`}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CostDialog({
  data,
  onSaved,
  cost,
  defaultProductId,
}: {
  data: DashboardData;
  onSaved: (data: DashboardData) => void;
  cost?: Cost;
  defaultProductId?: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [productOptions, setProductOptions] = useState<
    SalesforceProductOption[]
  >([]);
  const [selectedProduct, setSelectedProduct] =
    useState<SalesforceProductOption | null>(null);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [productSearchError, setProductSearchError] = useState("");
  const [selectedDealerIds, setSelectedDealerIds] = useState<number[]>([]);
  const [selectedCondition, setSelectedCondition] = useState(
    cost?.condition ?? "신품",
  );
  const product = data.products.find(
    (row) => row.id === (cost?.productId ?? defaultProductId),
  );
  const requiresProductSearch = !cost && !defaultProductId;
  function resetProductSearch() {
    setProductQuery("");
    setProductOptions([]);
    setSelectedProduct(null);
    setProductSearchError("");
    if (!cost) setSelectedCondition("신품");
  }
  async function searchSalesforceProducts() {
    const query = productQuery.trim();
    if (!query) {
      setProductOptions([]);
      setProductSearchError("제품명을 입력해주세요.");
      return;
    }
    setSearchingProducts(true);
    setProductSearchError("");
    try {
      const response = await fetch(
        `/api/salesforce/products?q=${encodeURIComponent(query)}`,
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Salesforce 제품을 검색하지 못했습니다.");
      setProductOptions(result.products ?? []);
      if (!(result.products ?? []).length)
        setProductSearchError("검색 결과가 없습니다.");
    } catch (error) {
      setProductOptions([]);
      setProductSearchError(
        error instanceof Error
          ? error.message
          : "Salesforce 제품을 검색하지 못했습니다.",
      );
    } finally {
      setSearchingProducts(false);
    }
  }
  function toggleDealer(dealerId: number, checked: boolean) {
    setSelectedDealerIds((current) =>
      checked
        ? [...new Set([...current, dealerId])]
        : current.filter((id) => id !== dealerId),
    );
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (requiresProductSearch && !selectedProduct) {
      toast.error("Salesforce 제품을 검색해 선택해주세요.");
      return;
    }
    setBusy(true);
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const dealerIds = cost ? [] : selectedDealerIds;
      const result = await post({
        action: cost
          ? "updateCost"
          : dealerIds.length
            ? "saveDealerProductCost"
            : "createCost",
        costId: cost?.id,
        productName: selectedProduct?.name,
        productFamily: selectedProduct?.family,
        dealerIds,
        ...values,
      });
      onSaved(result);
      setOpen(false);
      if (requiresProductSearch) {
        resetProductSearch();
        setSelectedDealerIds([]);
      }
      toast.success(
        cost ? "기존 원가 이력이 수정되었습니다." : "새 원가가 저장되었습니다.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setSelectedCondition(cost?.condition ?? "신품");
        setOpen(nextOpen);
        if (!nextOpen && requiresProductSearch) {
          resetProductSearch();
          setSelectedDealerIds([]);
        }
      }}
    >
      <DialogTrigger asChild>
        {cost ? (
          <Button variant="ghost" size="sm">
            수정
          </Button>
        ) : (
          <Button variant="outline" className="rounded-xl">
            <Plus />새 원가 등록
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>
              {cost ? "기존 원가 수정" : "새 원가 등록"}
            </DialogTitle>
            <DialogDescription>
              모든 금액은 VAT 별도입니다. 모델명과 신품·중고 구분별로 적용기간을
              관리하며, 저장하면 해당 기간의 기존 설치 원가도 자동으로 다시
              계산됩니다.
            </DialogDescription>
          </DialogHeader>
          {product ? (
            <>
              <input type="hidden" name="productId" value={product.id} />
              <Field label="제품">
                <Input value={product.name} disabled />
              </Field>
            </>
          ) : (
            <Field label="제품">
              {selectedProduct ? (
                <div className="flex gap-2">
                  <Input value={selectedProduct.name} disabled />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetProductSearch}
                  >
                    다시 검색
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input
                      value={productQuery}
                      onChange={(event) => {
                        setProductQuery(event.target.value);
                        setProductSearchError("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void searchSalesforceProducts();
                        }
                      }}
                      placeholder="Salesforce Product2 제품명 검색"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={searchingProducts}
                      onClick={searchSalesforceProducts}
                    >
                      {searchingProducts ? "검색 중..." : "검색"}
                    </Button>
                  </div>
                  {productOptions.length > 0 && (
                    <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border bg-white p-1">
                      {productOptions.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                          onClick={() => {
                            setSelectedProduct(item);
                            setProductQuery(item.name);
                            setProductOptions([]);
                            setProductSearchError("");
                            if (item.condition)
                              setSelectedCondition(item.condition);
                          }}
                        >
                          <span className="font-medium">{item.name}</span>
                          <span className="flex items-center gap-2 text-xs text-slate-500">
                            <Badge variant="outline">
                              {item.condition || "유형 미지정"}
                            </Badge>
                            {item.family || "제품군 미지정"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {productSearchError ? (
                <p className="text-xs text-red-600">{productSearchError}</p>
              ) : selectedProduct ? (
                <p className="text-xs text-blue-700">
                  선택됨: {selectedProduct.name}
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  제품명을 입력하고 Enter를 눌러 검색해주세요.
                </p>
              )}
            </Field>
          )}
          {!cost && (
            <Field label="적용 딜러">
              <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={selectedDealerIds.length === 0}
                    onCheckedChange={() => setSelectedDealerIds([])}
                  />
                  전체 딜러 공통
                </label>
                {data.dealers.map((dealer) => (
                  <label
                    className="flex items-center gap-2 text-sm"
                    key={dealer.id}
                  >
                    <Checkbox
                      checked={selectedDealerIds.includes(dealer.id)}
                      onCheckedChange={(checked) =>
                        toggleDealer(dealer.id, checked === true)
                      }
                    />
                    {dealer.name}
                  </label>
                ))}
              </div>
            </Field>
          )}
          <Field label="제품 상태">
            <select
              name="condition"
              value={selectedCondition}
              onChange={(event) => setSelectedCondition(event.target.value)}
              className="h-10 rounded-md border bg-white px-3"
            >
              <option value="신품">신품</option>
              <option value="중고">중고</option>
            </select>
          </Field>
          <Field label="공급가액">
            <Input
              name="unitCost"
              type="number"
              min="0"
              defaultValue={cost?.unitCost}
              required
            />
          </Field>
          <Field label="적용 시작일">
            <Input
              name="effectiveFrom"
              type="date"
              defaultValue={cost?.effectiveFrom}
              required
            />
          </Field>
          <DialogFooter>
            <Button disabled={busy}>
              {busy
                ? cost
                  ? "저장 중..."
                  : "등록 중..."
                : cost
                  ? "수정사항 저장"
                  : "원가 등록"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProductCostBulkDealerDialog({
  data,
  selectedRefs,
  onSaved,
  onClear,
}: {
  data: DashboardData;
  selectedRefs: ProductCostRef[];
  onSaved: (data: DashboardData) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedDealerIds, setSelectedDealerIds] = useState<number[]>([]);

  function toggleDealer(dealerId: number, checked: boolean) {
    setSelectedDealerIds((current) =>
      checked
        ? [...new Set([...current, dealerId])]
        : current.filter((id) => id !== dealerId),
    );
  }

  async function applyDealerScope() {
    if (busy || !selectedRefs.length) return;
    setBusy(true);
    try {
      const ids = productCostRefIds(selectedRefs);
      const result = await post({
        action: "updateProductCostDealers",
        ...ids,
        dealerIds: selectedDealerIds,
      });
      onSaved(result);
      onClear();
      setSelectedDealerIds([]);
      setOpen(false);
      toast.success("선택한 원가의 적용 딜러를 수정했습니다.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "적용 딜러를 수정하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setSelectedDealerIds([]);
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!selectedRefs.length}>
          적용 딜러 수정
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>선택 원가 적용 딜러 수정</DialogTitle>
          <DialogDescription>
            선택한 제품원가 {selectedRefs.length}건의 적용 범위를 이력까지
            함께 변경합니다.
          </DialogDescription>
        </DialogHeader>
        <Field label="적용 딜러">
          <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={selectedDealerIds.length === 0}
                onCheckedChange={() => setSelectedDealerIds([])}
              />
              전체 딜러 공통
            </label>
            {data.dealers.map((dealer) => (
              <label className="flex items-center gap-2 text-sm" key={dealer.id}>
                <Checkbox
                  checked={selectedDealerIds.includes(dealer.id)}
                  onCheckedChange={(checked) =>
                    toggleDealer(dealer.id, checked === true)
                  }
                />
                {dealer.name}
              </label>
            ))}
          </div>
        </Field>
        <DialogFooter>
          <Button disabled={busy} onClick={applyDealerScope}>
            {busy ? "저장 중..." : "적용 딜러 저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductCostEditDialog({
  data,
  product,
  cost,
  dealerCost,
  onSaved,
  triggerLabel = "수정",
}: {
  data: DashboardData;
  product: DashboardData["products"][number];
  cost?: Cost | null;
  dealerCost?: DealerProductCost | null;
  onSaved: (data: DashboardData) => void;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const editableCost = dealerCost ?? cost;
  const [directCostAllowed, setDirectCostAllowed] = useState(
    product.directCostAllowed,
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await post({
        action: "updateProductAndCost",
        productId: product.id,
        costId: cost?.id,
        dealerProductCostId: dealerCost?.id,
        directCostAllowed,
        ...Object.fromEntries(new FormData(event.currentTarget)),
      });
      onSaved(result);
      setOpen(false);
      toast.success("제품과 원가 정보가 수정되었습니다.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setDirectCostAllowed(product.directCostAllowed);
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>
              {editableCost ? "제품 및 원가 수정" : "제품 수정"}
            </DialogTitle>
            <DialogDescription>
              제품 정보와 선택한 원가의 적용 기준을 함께 수정합니다. 저장하면
              해당 제품이 설치된 가맹점의 설치 원가도 다시 계산됩니다.
            </DialogDescription>
          </DialogHeader>
          <Field label="제품명">
            <Input name="name" defaultValue={product.name} required />
          </Field>
          <Field label="분류">
            <Input name="category" defaultValue={product.category} />
          </Field>
          <Field label="상태">
            <select
              name="active"
              defaultValue={String(product.active)}
              className="h-10 rounded-md border bg-white px-3"
            >
              <option value="true">활성</option>
              <option value="false">비활성</option>
            </select>
          </Field>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
            <Checkbox
              checked={directCostAllowed}
              onCheckedChange={(checked) =>
                setDirectCostAllowed(checked === true)
              }
            />
            <span>
              <span className="block font-semibold">
                가맹점별 원가 직접 입력 가능
              </span>
              <span className="text-xs text-slate-500">
                체크한 제품만 가맹점 상세 설치 제품에서 직접 원가 입력 칸이
                보입니다.
              </span>
            </span>
          </label>
          {editableCost ? (
            <>
              <Field label="적용 딜러">
                <select
                  name="dealerId"
                  defaultValue={dealerCost?.dealerId ?? ""}
                  className="h-10 rounded-md border bg-white px-3"
                >
                  <option value="">전체 딜러</option>
                  {data.dealers.map((dealer) => (
                    <option value={dealer.id} key={dealer.id}>
                      {dealer.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="제품 상태">
                <select
                  name="condition"
                  defaultValue={editableCost.condition}
                  className="h-10 rounded-md border bg-white px-3"
                >
                  <option value="신품">신품</option>
                  <option value="중고">중고</option>
                </select>
              </Field>
              <Field label="공급가액">
                <Input
                  name="unitCost"
                  type="number"
                  min="0"
                  defaultValue={editableCost.unitCost}
                  required
                />
              </Field>
              <Field label="적용 시작일">
                <Input
                  name="effectiveFrom"
                  type="date"
                  defaultValue={editableCost.effectiveFrom}
                  required
                />
              </Field>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
              등록된 현재 원가가 없습니다. 원가 금액은 새 원가 등록에서 추가할 수
              있습니다.
            </div>
          )}
          <DialogFooter>
            <Button disabled={busy}>
              {busy ? "저장 중..." : "수정사항 저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CategoryCostDialog({
  data,
  onSaved,
  categoryCost,
}: {
  data: DashboardData;
  onSaved: (data: DashboardData) => void;
  categoryCost?: DealerCategoryCost;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [salesforceFamilies, setSalesforceFamilies] = useState<string[]>([]);
  const [familyLoadError, setFamilyLoadError] = useState("");
  const [selectedDealerIds, setSelectedDealerIds] = useState<number[]>([]);
  const productCategories = [
    ...new Set(
      data.products
        .map((product) => product.category.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const categoryOptions = (
    salesforceFamilies.length ? salesforceFamilies : productCategories
  ).filter(Boolean);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/salesforce/products?families=1", {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error ?? "Salesforce 제품군을 불러오지 못했습니다.");
        setSalesforceFamilies(
          [...new Set((result.families ?? []) as string[])].sort((a, b) =>
            a.localeCompare(b),
          ),
        );
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setFamilyLoadError(
          error instanceof Error
            ? error.message
            : "Salesforce 제품군을 불러오지 못했습니다.",
        );
      });
    return () => controller.abort();
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!categoryCost && !selectedDealerIds.length) {
      toast.error("적용할 딜러를 하나 이상 선택해주세요.");
      return;
    }
    setBusy(true);
    try {
      const form = event.currentTarget;
      const result = await post({
        action: "saveDealerCategoryCost",
        dealerCategoryCostId: categoryCost?.id,
        dealerIds: categoryCost ? [] : selectedDealerIds,
        ...Object.fromEntries(new FormData(form)),
      });
      onSaved(result);
      setOpen(false);
      if (!categoryCost) {
        form.reset();
        setSelectedDealerIds([]);
      }
      toast.success(
        categoryCost
          ? "제품군 원가를 수정했습니다."
          : "제품군 원가를 등록했습니다.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "제품군 원가를 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setFamilyLoadError("");
        if (!nextOpen && !categoryCost) setSelectedDealerIds([]);
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant={categoryCost ? "ghost" : "outline"}
          size={categoryCost ? "sm" : "default"}
          className={categoryCost ? undefined : "rounded-xl"}
        >
          {categoryCost ? "수정" : "제품군 원가 등록"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {categoryCost ? "제품군 원가 수정" : "딜러별 제품군 원가 등록"}
            </DialogTitle>
            <DialogDescription>
              모든 금액은 VAT 별도입니다. 특정 딜러의 제품군 단위 원가로
              등록되며, 저장하면 해당 제품군의 기존 설치 원가도 다시 계산됩니다.
            </DialogDescription>
          </DialogHeader>
          {categoryCost ? (
            <Field label="적용 딜러">
              <select
                name="dealerId"
                defaultValue={categoryCost.dealerId}
                className="h-10 rounded-md border bg-white px-3"
                required
              >
                {data.dealers.map((dealer) => (
                  <option value={dealer.id} key={dealer.id}>
                    {dealer.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="적용 딜러">
              <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
                {data.dealers.map((dealer) => (
                  <label
                    className="flex items-center gap-2 text-sm"
                    key={dealer.id}
                  >
                    <Checkbox
                      checked={selectedDealerIds.includes(dealer.id)}
                      onCheckedChange={(checked) =>
                        setSelectedDealerIds((current) =>
                          checked === true
                            ? [...new Set([...current, dealer.id])]
                            : current.filter((id) => id !== dealer.id),
                        )
                      }
                    />
                    {dealer.name}
                  </label>
                ))}
              </div>
            </Field>
          )}
          <Field label="제품군">
            <select
              name="productCategory"
              defaultValue={categoryCost?.productCategory ?? ""}
              className="h-10 rounded-md border bg-white px-3"
              required
            >
              <option value="">제품군 선택</option>
              {categoryOptions.map((category) => (
                <option value={category} key={category}>
                  {category}
                </option>
              ))}
              {categoryCost?.productCategory &&
                !categoryOptions.includes(categoryCost.productCategory) && (
                  <option value={categoryCost.productCategory}>
                    {categoryCost.productCategory}
                  </option>
                )}
            </select>
            {familyLoadError ? (
              <p className="mt-1 text-xs text-orange-600">
                Salesforce 제품군을 불러오지 못해 저장된 제품군을 표시합니다.
              </p>
            ) : null}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="제품 상태">
              <select
                name="condition"
                defaultValue={categoryCost?.condition ?? "신품"}
                className="h-10 rounded-md border bg-white px-3"
              >
                <option value="신품">신품</option>
                <option value="중고">중고</option>
              </select>
            </Field>
            <Field label="원가 공급가액">
              <Input
                name="unitCost"
                type="number"
                min="0"
                defaultValue={categoryCost?.unitCost}
                required
              />
            </Field>
            <Field label="적용 시작일">
              <Input
                name="effectiveFrom"
                type="date"
                defaultValue={categoryCost?.effectiveFrom}
                required
              />
            </Field>
          </div>
          <DialogFooter>
            <Button disabled={busy}>
              {busy
                ? categoryCost
                  ? "저장 중..."
                  : "등록 중..."
                : categoryCost
                  ? "수정사항 저장"
                  : "제품군 원가 등록"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProductCostHistoryDialog({
  data,
  product,
  scopeDealerId,
  onSaved,
}: {
  data: DashboardData;
  product: DashboardData["products"][number];
  scopeDealerId: number | null;
  onSaved: (data: DashboardData) => void;
}) {
  const rows = productCostHistoryRows(data, product.id, scopeDealerId);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          원가 이력
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {product.name} 원가 이력 · {dealerCostScopeLabel(data, scopeDealerId)}
          </DialogTitle>
          <DialogDescription>
            현재 적용 중인 원가는 원가관리 목록에 표시되며, 이전 원가만 이곳에서
            확인하고 수정합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>제품 상태</TableHead>
                <TableHead>적용기간</TableHead>
                <TableHead className="text-right">원가 공급가액</TableHead>
                {data.access.role === "admin" && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const cost = rowCost(row);
                return cost ? (
                  <TableRow key={`${row.scopeDealerId ?? "all"}-${cost.id}`}>
                    <TableCell>
                      <Badge variant="outline">{cost.condition}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{cost.effectiveFrom}</span>
                      <span className="mx-2 text-slate-400">~</span>
                      <span>{row.endDate ?? "현재"}</span>
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      {won(cost.unitCost)}
                    </TableCell>
                    {data.access.role === "admin" && (
                      <TableCell className="text-right">
                        <ProductCostEditDialog
                          data={data}
                          product={product}
                          cost={row.cost}
                          dealerCost={row.dealerCost}
                          onSaved={onSaved}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ) : null;
              })}
              {!rows.length && (
                <TableRow>
                  <TableCell
                    colSpan={data.access.role === "admin" ? 4 : 3}
                    className="h-24 text-center text-slate-500"
                  >
                    이전 원가 이력이 없습니다.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MemberDialog({
  data,
  onSaved,
}: {
  data: DashboardData;
  onSaved: (data: DashboardData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await post({
        action: "createDealerMember",
        ...Object.fromEntries(new FormData(event.currentTarget)),
      });
      onSaved(result);
      setOpen(false);
      toast.success("딜러 로그인 이메일이 연결되었습니다.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "연결하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus />
          딜러 계정 연결
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>딜러 로그인 계정 연결</DialogTitle>
            <DialogDescription>
              연결된 사용자는 해당 딜러의 데이터만 조회할 수 있습니다.
            </DialogDescription>
          </DialogHeader>
          <Field label="딜러">
            <select
              name="dealerId"
              className="h-10 rounded-md border bg-white px-3"
            >
              {data.dealers.map((dealer) => (
                <option value={dealer.id} key={dealer.id}>
                  {dealer.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ChatGPT 로그인 이메일">
            <Input
              name="email"
              type="email"
              required
              placeholder="dealer@example.com"
            />
          </Field>
          <DialogFooter>
            <Button disabled={busy}>
              {busy ? "연결 중..." : "계정 연결"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DealerDialog({
  data,
  onSaved,
  dealerId,
}: {
  data: DashboardData;
  onSaved: (data: DashboardData) => void;
  dealerId?: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [advanceEnabled, setAdvanceEnabled] = useState(
    data.dealers.find((row) => row.id === dealerId)?.advanceEnabled ?? false,
  );
  const [flatCommissionEnabled, setFlatCommissionEnabled] = useState(
    data.dealers.find((row) => row.id === dealerId)?.flatCommissionEnabled ??
      false,
  );
  const [vanSettlementEnabled, setVanSettlementEnabled] = useState(
    data.dealers.find((row) => row.id === dealerId)?.vanSettlementEnabled ??
      true,
  );
  const [settlementDirectionVisible, setSettlementDirectionVisible] = useState(
    data.dealers.find((row) => row.id === dealerId)
      ?.settlementDirectionVisible ?? true,
  );
  const [installmentPendingEnabled, setInstallmentPendingEnabled] = useState(
    data.dealers.find((row) => row.id === dealerId)?.installmentPendingEnabled ?? true,
  );
  const [settlementColumns, setSettlementColumns] = useState(
    settlementListColumnsFor(data.dealers.find((row) => row.id === dealerId)),
  );
  const [merchantListColumns, setMerchantListColumns] = useState(
    merchantListColumnsFor(data.dealers.find((row) => row.id === dealerId)),
  );
  const [mainSummaryCards, setMainSummaryCards] = useState(
    mainSummaryCardsFor(data.dealers.find((row) => row.id === dealerId)),
  );
  const [merchantDetailFields, setMerchantDetailFields] = useState(
    DEFAULT_MERCHANT_DETAIL_FIELDS,
  );
  const [merchantBillingColumns, setMerchantBillingColumns] = useState(
    DEFAULT_MERCHANT_DETAIL_BILLING_COLUMNS,
  );
  const [merchantPayerColumns, setMerchantPayerColumns] = useState(
    DEFAULT_MERCHANT_DETAIL_PAYER_COLUMNS,
  );
  const [merchantInstallationColumns, setMerchantInstallationColumns] =
    useState(DEFAULT_MERCHANT_DETAIL_INSTALLATION_COLUMNS);
  const [active, setActive] = useState(
    data.dealers.find((row) => row.id === dealerId)?.active ?? true,
  );
  const dealer = data.dealers.find((row) => row.id === dealerId);
  const toggleKey = <T extends string>(
    current: T[],
    key: T,
    checked: boolean,
  ) =>
    checked
      ? [...new Set([...current, key])]
      : current.filter((item) => item !== key);
  const setDetailTabEnabled = (
    key: "billingTab" | "payerTab" | "installationTab",
    checked: boolean,
  ) =>
    setMerchantDetailFields((current) => toggleKey(current, key, checked));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await post({
        action: "saveDealer",
        dealerId,
        advanceEnabled,
        flatCommissionEnabled,
        vanSettlementEnabled,
        settlementDirectionVisible,
        installmentPendingEnabled,
        mainSummaryCards,
        settlementListColumns: settlementColumns,
        merchantListColumns,
        merchantDetailFields,
        merchantDetailBillingColumns: merchantBillingColumns,
        merchantDetailPayerColumns: merchantPayerColumns,
        merchantDetailInstallationColumns: merchantInstallationColumns,
        active,
        ...Object.fromEntries(new FormData(event.currentTarget)),
      });
      onSaved(result);
      setOpen(false);
      toast.success(
        dealer ? "딜러 설정을 수정했습니다." : "새 딜러를 등록했습니다.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "딜러를 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setAdvanceEnabled(dealer?.advanceEnabled ?? false);
          setFlatCommissionEnabled(dealer?.flatCommissionEnabled ?? false);
          setVanSettlementEnabled(dealer?.vanSettlementEnabled ?? true);
          setSettlementDirectionVisible(
            dealer?.settlementDirectionVisible ?? true,
          );
          setInstallmentPendingEnabled(dealer?.installmentPendingEnabled ?? true);
          setMainSummaryCards(mainSummaryCardsFor(dealer));
          setSettlementColumns(settlementListColumnsFor(dealer));
          setMerchantListColumns(merchantListColumnsFor(dealer));
          setMerchantDetailFields(merchantDetailFieldsFor(dealer));
          setMerchantBillingColumns(merchantDetailBillingColumnsFor(dealer));
          setMerchantPayerColumns(merchantDetailPayerColumnsFor(dealer));
          setMerchantInstallationColumns(
            merchantDetailInstallationColumnsFor(dealer),
          );
          setActive(dealer?.active ?? true);
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant={dealer ? "ghost" : "outline"}
          size={dealer ? "sm" : "default"}
        >
          {dealer ? (
            "설정"
          ) : (
            <>
              <Plus />새 딜러
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>
              {dealer ? `${dealer.name} 설정` : "새 딜러 등록"}
            </DialogTitle>
            <DialogDescription>
              Salesforce의 ManagingFranchise__c 값과 정산 기능을 딜러별로
              설정합니다.
            </DialogDescription>
          </DialogHeader>
          <Field label="딜러 이름">
            <Input
              name="name"
              defaultValue={dealer?.name}
              required
              placeholder="이정수"
            />
          </Field>
          <Field label="Salesforce 딜러 매칭값">
            <Input
              name="salesforceManagerValue"
              defaultValue={dealer?.salesforceManagerValue ?? dealer?.name}
              required
              placeholder="ManagingFranchise__c 값"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="정산 은행명">
              <Input
                name="bankName"
                defaultValue={dealer?.bankName ?? ""}
                placeholder="예: 국민은행"
              />
            </Field>
            <Field label="정산 계좌번호">
              <Input
                name="bankAccountNumber"
                defaultValue={dealer?.bankAccountNumber ?? ""}
                placeholder="계좌번호"
              />
            </Field>
          </div>
          {!dealer && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="정산 적용일">
                <Input
                  name="effectiveFrom"
                  type="date"
                  defaultValue="2000-01-01"
                  required
                />
              </Field>
              <Field label="원가 부담률(%)">
                <Input
                  name="costShareRate"
                  type="number"
                  defaultValue="50"
                  min="0"
                  max="100"
                  required
                />
              </Field>
              <Field label="수익 배분률(%)">
                <Input
                  name="profitShareRate"
                  type="number"
                  defaultValue="50"
                  min="0"
                  max="100"
                  required
                />
              </Field>
            </div>
          )}
          <label className="flex items-start gap-3 rounded-xl border p-4">
            <Checkbox
              checked={advanceEnabled}
              onCheckedChange={(value) => setAdvanceEnabled(value === true)}
            />
            <span>
              <b className="block text-sm">선지급 사용</b>
              <small className="text-slate-500">
                선지급액을 딜러 최종 정산액에서 차감합니다.
              </small>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border p-4">
            <Checkbox
              checked={installmentPendingEnabled}
              onCheckedChange={(value) => setInstallmentPendingEnabled(value === true)}
            />
            <span>
              <b className="block text-sm">할부구매 입금대기 사용</b>
              <small className="text-slate-500">
                명시적으로 미입금인 할부구매 항목이 있을 때만 입금대기 카드를 표시합니다.
              </small>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border p-4">
            <Checkbox
              checked={flatCommissionEnabled}
              onCheckedChange={(value) =>
                setFlatCommissionEnabled(value === true)
              }
            />
            <span>
              <b className="block text-sm">정액 수당 사용</b>
              <small className="text-slate-500">
                체크한 딜러는 수익 배분률 대신 딜러별 수당표를 우선 적용합니다.
              </small>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border p-4">
            <Checkbox
              checked={vanSettlementEnabled}
              onCheckedChange={(value) => setVanSettlementEnabled(value === true)}
            />
            <span>
              <b className="block text-sm">VAN 실적 사용</b>
              <small className="text-slate-500">
                월별 VAN사 실적 화면과 VAN피 수익 계산을 사용합니다.
              </small>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border p-4">
            <Checkbox
              checked={settlementDirectionVisible}
              onCheckedChange={(value) =>
                setSettlementDirectionVisible(value === true)
              }
            />
            <span>
              <b className="block text-sm">정산 방향 표시</b>
              <small className="text-slate-500">
                최종 정산서와 정산정보 표에 신신→딜러, 딜러→신신 방향을
                표시합니다.
              </small>
            </span>
          </label>
          <div className="grid gap-3 rounded-xl border p-4">
            <div>
              <b className="block text-sm">메인 요약 카드 노출 항목</b>
              <small className="text-slate-500">
                정산 화면 상단에 보이는 금액 카드를 딜러별로 선택합니다.
              </small>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {MAIN_SUMMARY_CARDS.map((card) => {
                const disabled =
                  (card.key === "advanceDeduction" && !advanceEnabled) ||
                  (card.key === "vanFeeRevenue" && !vanSettlementEnabled);
                return (
                  <label
                    className="flex items-center gap-2 text-sm"
                    key={card.key}
                  >
                    <Checkbox
                      checked={!disabled && mainSummaryCards.includes(card.key)}
                      disabled={disabled}
                      onCheckedChange={(value) =>
                        setMainSummaryCards((current) =>
                          toggleKey(
                            current,
                            card.key as MainSummaryCardKey,
                            value === true,
                          ),
                        )
                      }
                    />
                    {card.label}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3 rounded-xl border p-4">
            <div>
              <b className="block text-sm">가맹점별 납부·정산 현황 노출 항목</b>
              <small className="text-slate-500">
                가맹점명은 상세 이동을 위해 항상 표시됩니다.
              </small>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {SETTLEMENT_LIST_COLUMNS.map((column) => (
                <label className="flex items-center gap-2 text-sm" key={column.key}>
                  <Checkbox
                    checked={settlementColumns.includes(column.key)}
                    onCheckedChange={(value) =>
                      setSettlementColumns((current) =>
                        toggleKey(current, column.key, value === true),
                      )
                    }
                  />
                  {column.label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 rounded-xl border p-4">
            <div>
              <b className="block text-sm">가맹점 및 납부자번호 리스트 노출 항목</b>
              <small className="text-slate-500">
                가맹점명은 상세 이동을 위해 항상 표시됩니다.
              </small>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {MERCHANT_LIST_COLUMNS.map((column) => (
                <label
                  className="flex items-center gap-2 text-sm"
                  key={column.key}
                >
                  <Checkbox
                    checked={merchantListColumns.includes(column.key)}
                    onCheckedChange={(value) =>
                      setMerchantListColumns((current) =>
                        toggleKey(
                          current,
                          column.key as MerchantListColumnKey,
                          value === true,
                        ),
                      )
                    }
                  />
                  {column.label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-4 rounded-xl border p-4">
            <div>
              <b className="block text-sm">가맹점 세부사항 노출 항목</b>
              <small className="text-slate-500">
                딜러별로 상세페이지의 요약, 탭, 컬럼을 선택합니다.
              </small>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <b className="mb-3 block text-xs text-slate-600">
                상단·요약 항목
              </b>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MERCHANT_DETAIL_FIELDS.filter(
                (field) =>
                  !["billingTab", "payerTab", "installationTab"].includes(
                    field.key,
                  ),
              ).map((field) => (
                <label
                  className="flex min-h-9 items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm"
                  key={field.key}
                >
                  <Checkbox
                    checked={merchantDetailFields.includes(field.key)}
                    onCheckedChange={(value) =>
                      setMerchantDetailFields((current) =>
                        toggleKey(current, field.key, value === true),
                      )
                    }
                  />
                  {field.label}
                </label>
              ))}
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border p-4">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <Checkbox
                    checked={
                      merchantDetailFields.includes("billingTab") &&
                      merchantBillingColumns.length > 0
                    }
                    onCheckedChange={(value) => {
                      const checked = value === true;
                      setDetailTabEnabled("billingTab", checked);
                      setMerchantBillingColumns(
                        checked ? DEFAULT_MERCHANT_DETAIL_BILLING_COLUMNS : [],
                      );
                    }}
                  />
                  월별 납부 현황 사용
                </label>
                <b className="mb-2 mt-4 block text-xs text-slate-500">
                  월별 납부 현황 컬럼
                </b>
                <div className="grid gap-2 sm:grid-cols-2">
                  {MERCHANT_DETAIL_BILLING_COLUMNS.map((column) => (
                  <label
                    className="flex min-h-9 items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                    key={column.key}
                  >
                    <Checkbox
                      checked={merchantBillingColumns.includes(column.key)}
                      onCheckedChange={(value) =>
                        {
                          const checked = value === true;
                          if (checked) setDetailTabEnabled("billingTab", true);
                          setMerchantBillingColumns((current) =>
                            toggleKey(current, column.key, checked),
                          );
                        }
                      }
                    />
                    {column.label}
                  </label>
                ))}
                </div>
              </div>
              <div className="rounded-xl border p-4">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <Checkbox
                    checked={
                      merchantDetailFields.includes("payerTab") &&
                      merchantPayerColumns.length > 0
                    }
                    onCheckedChange={(value) => {
                      const checked = value === true;
                      setDetailTabEnabled("payerTab", checked);
                      setMerchantPayerColumns(
                        checked ? DEFAULT_MERCHANT_DETAIL_PAYER_COLUMNS : [],
                      );
                    }}
                  />
                  납부자번호 사용
                </label>
                <b className="mb-2 mt-4 block text-xs text-slate-500">
                  납부자번호 컬럼
                </b>
                <div className="grid gap-2 sm:grid-cols-2">
                  {MERCHANT_DETAIL_PAYER_COLUMNS.map((column) => (
                  <label
                    className="flex min-h-9 items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                    key={column.key}
                  >
                    <Checkbox
                      checked={merchantPayerColumns.includes(column.key)}
                      onCheckedChange={(value) =>
                        {
                          const checked = value === true;
                          if (checked) setDetailTabEnabled("payerTab", true);
                          setMerchantPayerColumns((current) =>
                            toggleKey(current, column.key, checked),
                          );
                        }
                      }
                    />
                    {column.label}
                  </label>
                ))}
                </div>
              </div>
            </div>
            <div className="rounded-xl border p-4">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <Checkbox
                    checked={
                      merchantDetailFields.includes("installationTab") &&
                      merchantInstallationColumns.length > 0
                    }
                    onCheckedChange={(value) => {
                      const checked = value === true;
                      setDetailTabEnabled("installationTab", checked);
                      setMerchantInstallationColumns(
                        checked
                          ? DEFAULT_MERCHANT_DETAIL_INSTALLATION_COLUMNS
                          : [],
                      );
                    }}
                  />
                  설치 제품 사용
                </label>
                <b className="mb-2 mt-4 block text-xs text-slate-500">
                  설치 제품 컬럼
                </b>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {MERCHANT_DETAIL_INSTALLATION_COLUMNS.map((column) => (
                  <label
                    className="flex min-h-9 items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                    key={column.key}
                  >
                    <Checkbox
                      checked={merchantInstallationColumns.includes(column.key)}
                      onCheckedChange={(value) =>
                        {
                          const checked = value === true;
                          if (checked)
                            setDetailTabEnabled("installationTab", true);
                          setMerchantInstallationColumns((current) =>
                            toggleKey(current, column.key, checked),
                          );
                        }
                      }
                    />
                    {column.label}
                  </label>
                ))}
                </div>
            </div>
          </div>
          {dealer && (
            <label className="flex items-start gap-3 rounded-xl border p-4">
              <Checkbox
                checked={active}
                onCheckedChange={(value) => setActive(value === true)}
              />
              <span>
                <b className="block text-sm">활성 딜러</b>
                <small className="text-slate-500">
                  비활성화하면 Salesforce 동기화 대상에서 제외됩니다.
                </small>
              </span>
            </label>
          )}
          <DialogFooter>
            <Button disabled={busy}>{busy ? "저장 중..." : "저장"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RuleDialog({
  dealerId,
  onSaved,
}: {
  dealerId: number;
  onSaved: (data: DashboardData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await post({
        action: "createRule",
        dealerId,
        ...Object.fromEntries(new FormData(event.currentTarget)),
      });
      onSaved(result);
      setOpen(false);
      toast.success("새 정산율 적용기간을 등록했습니다.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "정산율을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          정산율 추가
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>정산율 적용기간 추가</DialogTitle>
            <DialogDescription>
              적용일 이전 건은 기존 정산율을 유지합니다.
            </DialogDescription>
          </DialogHeader>
          <Field label="적용 시작일">
            <Input name="effectiveFrom" type="date" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="원가 부담률(%)">
              <Input
                name="costShareRate"
                type="number"
                min="0"
                max="100"
                defaultValue="50"
                required
              />
            </Field>
            <Field label="수익 배분률(%)">
              <Input
                name="profitShareRate"
                type="number"
                min="0"
                max="100"
                defaultValue="50"
                required
              />
            </Field>
          </div>
          <DialogFooter>
            <Button disabled={busy}>
              {busy ? "등록 중..." : "정산율 등록"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CommissionRuleEditDialog({
  rule,
  categoryOptions,
  products,
  onSaved,
}: {
  rule: DashboardData["dealerCommissionRules"][number];
  categoryOptions: string[];
  products: DashboardData["products"];
  onSaved: (data: DashboardData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [targetType, setTargetType] = useState(
    rule.targetType === "product" ? "product" : "productCategory",
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const result = await post({
        action: "updateDealerCommissionRule",
        dealerCommissionRuleId: rule.id,
        ...values,
      });
      onSaved(result);
      setOpen(false);
      toast.success("딜러 정액 수당을 수정했습니다.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "딜러 정액 수당을 수정하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil /> 수정
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>정액 수당 수정</DialogTitle>
            <DialogDescription>
              제품군 또는 제품을 선택한 뒤 상태·임대료·약정·수당과 적용 시작일을 수정합니다.
            </DialogDescription>
          </DialogHeader>
          <Field label="수당 적용 대상">
            <select
              name="targetType"
              value={targetType}
              onChange={(event) => setTargetType(event.target.value)}
              className="h-10 rounded-md border bg-white px-3"
            >
              <option value="productCategory">제품군</option>
              <option value="product">제품</option>
            </select>
          </Field>
          {targetType === "productCategory" ? (
            <Field label="제품군">
              <select
                name="productCategory"
                defaultValue={rule.productCategory}
                className="h-10 rounded-md border bg-white px-3"
                required
              >
                {categoryOptions.map((category) => (
                  <option value={category} key={category}>
                    {category}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="제품">
              <select
                name="productId"
                defaultValue={rule.productId ? String(rule.productId) : ""}
                className="h-10 rounded-md border bg-white px-3"
                required
              >
                <option value="">제품 선택</option>
                {products
                  .filter((product) => product.active || product.id === rule.productId)
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((product) => (
                    <option value={product.id} key={product.id}>
                      {product.name}{product.category ? ` · ${product.category}` : ""}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="제품 상태">
              <select
                name="condition"
                defaultValue={rule.condition}
                className="h-10 rounded-md border bg-white px-3"
              >
                <option value="신품">신품</option>
                <option value="중고">중고</option>
              </select>
            </Field>
            <Field label="임대료(VAT 별도)">
              <Input
                name="rentalAmount"
                type="number"
                min="0"
                defaultValue={rule.rentalAmount}
                required
              />
            </Field>
            <Field label="약정개월">
              <Input
                name="contractTermMonths"
                type="number"
                min="1"
                defaultValue={rule.contractTermMonths}
                required
              />
            </Field>
            <Field label="수당(VAT 별도)">
              <Input
                name="commissionAmount"
                type="number"
                min="0"
                defaultValue={rule.commissionAmount}
                required
              />
            </Field>
            <Field label="적용 시작일">
              <Input
                name="effectiveFrom"
                type="date"
                defaultValue={rule.effectiveFrom}
                required
              />
            </Field>
          </div>
          <DialogFooter>
            <Button disabled={busy}>
              {busy ? "저장 중..." : "수정사항 저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DealerSettlementSettingsDialog({
  data,
  dealerId,
  onSaved,
}: {
  data: DashboardData;
  dealerId: number;
  onSaved: (data: DashboardData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [commissionSaving, setCommissionSaving] = useState(false);
  const [commissionTargetType, setCommissionTargetType] = useState<
    "productCategory" | "product"
  >("productCategory");
  const [salesforceFamilies, setSalesforceFamilies] = useState<string[]>([]);
  const [familyLoadError, setFamilyLoadError] = useState("");
  const dealer = data.dealers.find((row) => row.id === dealerId);
  const commissionRules = data.dealerCommissionRules
    .filter((row) => row.dealerId === dealerId)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const commissionRuleRows = commissionRules.map((rule) => {
    const successor = commissionRules
      .filter(
        (candidate) =>
          (candidate.targetType === rule.targetType ||
            (candidate.targetType !== "product" && rule.targetType !== "product")) &&
          (rule.targetType === "product"
            ? candidate.productId === rule.productId
            : candidate.productCategory === rule.productCategory) &&
          candidate.condition === rule.condition &&
          candidate.rentalAmount === rule.rentalAmount &&
          candidate.contractTermMonths === rule.contractTermMonths &&
          candidate.effectiveFrom > rule.effectiveFrom,
      )
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0];
    return {
      rule,
      endDate: successor ? dayBefore(successor.effectiveFrom) : null,
    };
  });
  const productCategories = [
    ...new Set(
      data.products
        .map((product) => product.category.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const commissionCategoryOptions = (
    salesforceFamilies.length ? salesforceFamilies : productCategories
  ).filter(Boolean);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/salesforce/products?families=1", {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error ?? "Salesforce 제품군을 불러오지 못했습니다.");
        setSalesforceFamilies(
          [...new Set((result.families ?? []) as string[])].sort((a, b) =>
            a.localeCompare(b),
          ),
        );
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setFamilyLoadError(
          error instanceof Error
            ? error.message
            : "Salesforce 제품군을 불러오지 못했습니다.",
        );
      });
    return () => controller.abort();
  }, [open]);
  async function submitCommissionRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (commissionSaving) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    setCommissionSaving(true);
    try {
      const result = await post({
        action: "saveDealerCommissionRule",
        dealerId,
        ...values,
      });
      onSaved(result);
      form.reset();
      setCommissionTargetType("productCategory");
      toast.success("딜러 정액 수당을 등록했습니다.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "딜러 정액 수당을 저장하지 못했습니다.",
      );
    } finally {
      setCommissionSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setFamilyLoadError("");
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          정산 설정
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden p-4 sm:p-6 lg:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{dealer?.name ?? "딜러"} 정산 설정</DialogTitle>
          <DialogDescription>
            특정 딜러에만 적용할 정액 수당표를 관리합니다. 원가는 제품 원가
            관리에서 적용 딜러를 선택해 등록합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[70vh] gap-5 overflow-y-auto overflow-x-hidden pr-1">
          <section className="grid min-w-0 gap-3">
            <div>
              <h4 className="font-semibold">정액 수당표</h4>
              <p className="mt-1 text-xs text-slate-500">
                딜러 설정에서 정액 수당 사용을 켠 딜러에게 적용됩니다.
              </p>
            </div>
            <form
              onSubmit={submitCommissionRule}
              className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
            >
              <Field label="수당 적용 대상">
                <select
                  name="targetType"
                  value={commissionTargetType}
                  onChange={(event) =>
                    setCommissionTargetType(
                      event.target.value as "productCategory" | "product",
                    )
                  }
                  className="h-10 rounded-md border bg-white px-3"
                >
                  <option value="productCategory">제품군</option>
                  <option value="product">제품</option>
                </select>
              </Field>
              {commissionTargetType === "productCategory" ? (
                <Field label="제품군">
                  <select
                    name="productCategory"
                    className="h-10 rounded-md border bg-white px-3"
                    required
                  >
                    <option value="">제품군 선택</option>
                    {commissionCategoryOptions.map((category) => (
                      <option value={category} key={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  {familyLoadError ? (
                    <p className="mt-1 text-xs text-orange-600">
                      Salesforce 제품군을 불러오지 못해 저장된 제품군을 표시합니다.
                    </p>
                  ) : null}
                </Field>
              ) : (
                <Field label="제품">
                  <select
                    name="productId"
                    className="h-10 rounded-md border bg-white px-3"
                    required
                  >
                    <option value="">제품 선택</option>
                    {data.products
                      .filter((product) => product.active)
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((product) => (
                        <option value={product.id} key={product.id}>
                          {product.name}{product.category ? ` · ${product.category}` : ""}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="제품 상태">
                  <select
                    name="condition"
                    defaultValue="신품"
                    className="h-10 rounded-md border bg-white px-3"
                  >
                    <option value="신품">신품</option>
                    <option value="중고">중고</option>
                  </select>
                </Field>
                <Field label="임대료(VAT 별도)">
                  <Input
                    name="rentalAmount"
                    type="number"
                    min="0"
                    required
                  />
                </Field>
                <Field label="약정개월">
                  <Input
                    name="contractTermMonths"
                    type="number"
                    min="1"
                    defaultValue="36"
                    required
                  />
                </Field>
                <Field label="수당(VAT 별도)">
                  <Input
                    name="commissionAmount"
                    type="number"
                    min="0"
                    required
                  />
                </Field>
                <Field label="적용 시작일">
                  <Input name="effectiveFrom" type="date" required />
                </Field>
              </div>
              <Button disabled={commissionSaving}>
                {commissionSaving ? "등록 중..." : "수당 등록"}
              </Button>
            </form>
            <div className="overflow-x-auto rounded-xl border">
              <Table className="min-w-[1080px] table-fixed whitespace-nowrap">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[220px]">적용 대상</TableHead>
                    <TableHead className="w-[90px]">제품 상태</TableHead>
                    <TableHead className="w-[190px]">적용 기간</TableHead>
                    <TableHead className="w-[110px]">적용 상태</TableHead>
                    <TableHead className="w-[160px] text-right">
                      임대료(VAT 별도)
                    </TableHead>
                    <TableHead className="w-[90px]">약정</TableHead>
                    <TableHead className="w-[160px] text-right">
                      수당(VAT 별도)
                    </TableHead>
                    <TableHead className="w-[210px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissionRuleRows.map(({ rule, endDate }) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium">
                        <div>
                          <Badge variant="outline" className="mr-2">
                            {rule.targetType === "product" ? "제품" : "제품군"}
                          </Badge>
                          {rule.targetType === "product"
                            ? data.products.find((product) => product.id === rule.productId)?.name ??
                              rule.productCategory
                            : rule.productCategory}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{rule.condition}</Badge>
                      </TableCell>
                      <TableCell>
                        <div>{rule.effectiveFrom}</div>
                        <div className="text-xs text-slate-500">
                          ~ {endDate ?? "현재"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            endDate
                              ? "bg-slate-100 text-slate-600"
                              : "bg-emerald-50 text-emerald-700"
                          }
                        >
                          {endDate ? "종료됨" : "현재 적용"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {won(rule.rentalAmount)}
                      </TableCell>
                      <TableCell>{rule.contractTermMonths}개월</TableCell>
                      <TableCell className="text-right font-semibold">
                        {won(rule.commissionAmount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <CommissionRuleEditDialog
                          rule={rule}
                          categoryOptions={commissionCategoryOptions}
                          products={data.products}
                          onSaved={onSaved}
                        />
                        <DeleteConfirmButton
                          title="정액 수당을 삭제할까요?"
                          description="삭제하면 이 조건의 설치 제품은 다른 수당표 또는 기존 정산율 기준으로 계산됩니다."
                          onConfirm={async () => {
                            const result = await post({
                              action: "deleteDealerCommissionRule",
                              dealerCommissionRuleId: rule.id,
                            });
                            onSaved(result);
                            toast.success("정액 수당을 삭제했습니다.");
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                  {!commissionRules.length && (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="h-20 text-center text-slate-500"
                      >
                        등록된 정액 수당이 없습니다.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AdvanceDialog({
  dealerId,
  defaultMonth,
  onSaved,
  advance,
}: {
  dealerId: number;
  defaultMonth: string;
  onSaved: (data: DashboardData) => void;
  advance?: DashboardData["advancePayments"][number];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await post({
        action: "saveAdvancePayment",
        dealerId,
        advancePaymentId: advance?.id,
        ...Object.fromEntries(new FormData(event.currentTarget)),
      });
      onSaved(result);
      setOpen(false);
      toast.success(
        advance ? "선지급 내역을 수정했습니다." : "선지급 내역을 등록했습니다.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "선지급 내역을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={advance ? "ghost" : "outline"}
          size={advance ? "sm" : "default"}
        >
          {advance ? (
            "수정"
          ) : (
            <>
              <Plus />
              선지급 등록
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{advance ? "선지급 수정" : "선지급 등록"}</DialogTitle>
            <DialogDescription>
              실제 지급일과 별개로 선택한 정산월의 최종 정산액에서 차감됩니다.
            </DialogDescription>
          </DialogHeader>
          <Field label="정산월">
            <Input
              name="settlementMonth"
              type="month"
              defaultValue={advance?.settlementMonth ?? defaultMonth}
              required
            />
          </Field>
          <Field label="선지급일">
            <Input
              name="paymentDate"
              type="date"
              defaultValue={advance?.paymentDate}
              required
            />
          </Field>
          <Field label="선지급 금액">
            <Input
              name="amount"
              type="number"
              min="1"
              defaultValue={advance?.amount}
              required
            />
          </Field>
          <Field label="메모">
            <Input
              name="memo"
              defaultValue={advance?.memo ?? ""}
              placeholder="예: 1차 선지급"
            />
          </Field>
          <DialogFooter>
            <Button disabled={busy}>{busy ? "저장 중..." : "저장"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MonthlySettlementStatusDialog({
  dealerId,
  settlementMonth,
  status,
  onSaved,
}: {
  dealerId: number;
  settlementMonth: string;
  status?: DashboardData["monthlySettlementStatuses"][number];
  onSaved: (data: DashboardData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState(status?.paid ?? false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await post({
        action: "saveMonthlySettlementStatus",
        dealerId,
        settlementMonth,
        paid,
        ...Object.fromEntries(new FormData(event.currentTarget)),
      });
      onSaved(result);
      setOpen(false);
      toast.success("월별 정산 정보를 저장했습니다.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "월별 정산 정보를 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setPaid(status?.paid ?? false);
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-xl bg-white">
          <CalendarRange />
          정산 정보
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{settlementMonth} 정산 정보</DialogTitle>
            <DialogDescription>
              월별 정산일자, 지급 여부와 세금계산서 발행일자를 기록합니다.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="settlementMonth" value={settlementMonth} />
          <Field label="정산일자">
            <Input
              name="settlementDate"
              type="date"
              defaultValue={status?.settlementDate ?? ""}
            />
          </Field>
          <label className="flex items-start gap-3 rounded-xl border p-4">
            <Checkbox
              checked={paid}
              onCheckedChange={(value) => setPaid(value === true)}
            />
            <span>
              <b className="block text-sm">지급 완료</b>
              <small className="text-slate-500">
                체크하면 해당 월 정산이 지급 완료로 표시됩니다.
              </small>
            </span>
          </label>
          <Field label="세금계산서 발행일자">
            <Input
              name="taxInvoiceIssuedAt"
              type="date"
              defaultValue={status?.taxInvoiceIssuedAt ?? ""}
            />
          </Field>
          <Field label="메모">
            <Input
              name="memo"
              defaultValue={status?.memo ?? ""}
              placeholder="예: 지급 보류 사유, 확인 메모"
            />
          </Field>
          <DialogFooter>
            <Button disabled={busy}>{busy ? "저장 중..." : "저장"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InstallmentPendingDialog({
  open,
  onOpenChange,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: Array<{
    lineItemKey: string;
    salesforceLineItemId: string | null;
    dealerName: string;
    merchantName: string;
    businessNumber: string;
    contractInstallAt: string | null;
    productName: string;
    fixing: number;
    fixingPaymentStatus: string | null;
    fixingPaymentDate: string | null;
    incentive: number;
    incentivePaymentStatus: string | null;
    incentivePaymentDate: string | null;
    totalPending: number;
  }>;
}) {
  const statusBadge = (status: string | null) =>
    status === "미입금" ? (
      <Badge className="bg-red-50 text-red-700">미입금</Badge>
    ) : status === "입금완료" ? (
      <Badge className="bg-emerald-50 text-emerald-700">입금완료</Badge>
    ) : (
      <span className="text-xs text-slate-400">미확인</span>
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-hidden p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle>할부구매 입금대기 상세</DialogTitle>
          <DialogDescription>
            귀속월은 설치월이며, 대금책정과 영업수수료를 독립적으로 표시합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border">
          <Table className="w-full table-fixed text-[11px] [&_td]:px-2 [&_th]:px-2 [&_td]:py-2 [&_th]:py-2">
            <TableHeader>
              <TableRow>
                <TableHead>딜러</TableHead><TableHead>가맹점</TableHead><TableHead>사업자번호</TableHead>
                <TableHead>CaseLineItem Id</TableHead>
                <TableHead>설치일자</TableHead><TableHead>귀속월</TableHead><TableHead>설치제품</TableHead>
                <TableHead>대금책정</TableHead><TableHead>대금책정 상태</TableHead><TableHead>입금일자</TableHead>
                <TableHead>영업수수료</TableHead><TableHead>영업수수료 상태</TableHead><TableHead>입금일자</TableHead>
                <TableHead>총 입금대기</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.lineItemKey}>
                  <TableCell>{row.dealerName}</TableCell><TableCell className="font-semibold">{row.merchantName}</TableCell>
                  <TableCell>{row.businessNumber}</TableCell><TableCell className="font-mono text-[10px]">{row.salesforceLineItemId || "-"}</TableCell><TableCell>{row.contractInstallAt?.slice(0, 10) || "-"}</TableCell>
                  <TableCell>{row.contractInstallAt?.slice(0, 7) || "-"}</TableCell><TableCell>{row.productName}</TableCell>
                  <TableCell className="text-right">{won(row.fixing)}</TableCell><TableCell>{statusBadge(row.fixingPaymentStatus)}</TableCell><TableCell>{row.fixingPaymentDate || "-"}</TableCell>
                  <TableCell className="text-right">{won(row.incentive)}</TableCell><TableCell>{statusBadge(row.incentivePaymentStatus)}</TableCell><TableCell>{row.incentivePaymentDate || "-"}</TableCell>
                  <TableCell className="text-right font-bold text-red-700">{won(row.totalPending)}</TableCell>
                </TableRow>
              ))}
              {!rows.length && <TableRow><TableCell colSpan={14} className="h-24 text-center text-slate-500">현재 입금대기 항목이 없습니다.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SettlementApp() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [dealerId, setDealerId] = useState<number | null>(null);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentYear = currentMonth.slice(0, 4);
  const [rangeMode, setRangeMode] = useState(() =>
    ["month", "year", "custom"].includes(initialParam("rangeMode"))
      ? initialParam("rangeMode")
      : "month",
  );
  const [year, setYear] = useState(() =>
    /^\d{4}$/.test(initialParam("year")) ? initialParam("year") : currentYear,
  );
  const [month, setMonth] = useState(() =>
    /^\d{4}-(0[1-9]|1[0-2])$/.test(initialParam("month"))
      ? initialParam("month")
      : currentMonth,
  );
  const [customStart, setCustomStart] = useState(() =>
    /^\d{4}-(0[1-9]|1[0-2])$/.test(initialParam("customStart"))
      ? initialParam("customStart")
      : `${currentYear}-01`,
  );
  const [customEnd, setCustomEnd] = useState(() =>
    /^\d{4}-(0[1-9]|1[0-2])$/.test(initialParam("customEnd"))
      ? initialParam("customEnd")
      : `${currentYear}-12`,
  );
  const [settlementMerchantPage, setSettlementMerchantPage] = useState(() =>
    initialPositiveInt("settlementPage", 1),
  );
  const [merchantPage, setMerchantPage] = useState(() =>
    initialPositiveInt("merchantPage", 1),
  );
  const [merchantSearch, setMerchantSearch] = useState(() =>
    initialParam("merchantSearch"),
  );
  const [costSearch, setCostSearch] = useState(() =>
    initialParam("costSearch"),
  );
  const [activeTab, setActiveTab] = useState(() =>
    [
      "settlement",
      "settlementInfo",
      "merchants",
      "payments",
      "costs",
      "dealers",
      "members",
    ].includes(initialParam("tab"))
      ? initialParam("tab")
      : "settlement",
  );
  const [installmentPendingOpen, setInstallmentPendingOpen] = useState(false);
  const [selectedMerchantIds, setSelectedMerchantIds] = useState<number[]>([]);
  const [selectedVanSettlementIds, setSelectedVanSettlementIds] = useState<
    number[]
  >([]);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<number[]>([]);
  const [selectedCostRefs, setSelectedCostRefs] = useState<ProductCostRef[]>([]);
  const clearPeriodSelections = () => {
    setSelectedVanSettlementIds([]);
    setSelectedPaymentIds([]);
  };
  const listStatePath = useMemo(() => {
    const params = new URLSearchParams();
    params.set("tab", activeTab);
    params.set("rangeMode", rangeMode);
    params.set("year", year);
    params.set("month", month);
    params.set("customStart", customStart);
    params.set("customEnd", customEnd);
    params.set("settlementPage", String(settlementMerchantPage));
    params.set("merchantPage", String(merchantPage));
    if (dealerId !== null) params.set("dealerId", String(dealerId));
    if (merchantSearch) params.set("merchantSearch", merchantSearch);
    if (costSearch) params.set("costSearch", costSearch);
    return `/?${params.toString()}`;
  }, [
    activeTab,
    costSearch,
    customEnd,
    customStart,
    dealerId,
    merchantPage,
    merchantSearch,
    month,
    rangeMode,
    settlementMerchantPage,
    year,
  ]);
  useEffect(() => {
    fetch("/api/dashboard")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        return result;
      })
      .then((result: DashboardData) => {
        setData(result);
        const initialDealerId = Number(initialParam("dealerId"));
        setDealerId(
          result.access.role === "dealer"
            ? result.access.dealerId
            : result.dealers.some((dealer) => dealer.id === initialDealerId)
              ? initialDealerId
              : (result.dealers[0]?.id ?? null),
        );
      })
      .catch((reason) => setError(reason.message));
  }, []);
  useEffect(() => {
    if (typeof window === "undefined" || !data || dealerId === null) return;
    window.history.replaceState(null, "", listStatePath);
    window.sessionStorage.setItem(LIST_RETURN_STORAGE_KEY, listStatePath);
  }, [data, dealerId, listStatePath]);
  const range =
    rangeMode === "month"
      ? { start: month, end: month, label: month.replace("-", "년 ") + "월" }
      : rangeMode === "year"
        ? { start: `${year}-01`, end: `${year}-12`, label: `${year}년` }
        : {
            start: customStart,
            end: customEnd,
            label: `${customStart} ~ ${customEnd}`,
          };
  const calculations = useMemo(() => {
    if (!data || dealerId === null) return null;
    const dealerMerchants = data.merchants.filter(
      (merchant) => merchant.dealerId === dealerId,
    );
    const merchantIds = new Set(dealerMerchants.map((merchant) => merchant.id));
    const payers = data.payerAccounts.filter((payer) =>
      merchantIds.has(payer.merchantId),
    );
    const billingPayers = payers.filter(
      (payer) => payer.billingType !== "installment",
    );
    const payerById = new Map(payers.map((payer) => [payer.id, payer]));
    const productById = new Map(
      data.products.map((product) => [product.id, product]),
    );
    const selectedDealer = data.dealers.find((dealer) => dealer.id === dealerId);
    const usesFlatCommission =
      selectedDealer?.flatCommissionEnabled === true;
    const usesVanSettlement = selectedDealer?.vanSettlementEnabled !== false;
    const ruleFor = (date: string) =>
      data.rules
        .filter(
          (rule) =>
            rule.dealerId === dealerId &&
            rule.effectiveFrom.slice(0, 7) <= date.slice(0, 7),
        )
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    const rentalAmountFor = (
      installation: DashboardData["installations"][number],
      fallbackMonth: string,
    ) => {
      if (installation.salesAmount > 0) return installation.salesAmount;
      const installMonth =
        (installation.contractInstallAt || fallbackMonth).slice(0, 7) ||
        fallbackMonth;
      const payer = billingPayers.find(
        (item) =>
          item.merchantId === installation.merchantId &&
            payerActiveInMonth(item, installMonth),
      );
      return payer ? payer.monthlyCharge : 0;
    };
    const commissionRuleFor = (
      installation: DashboardData["installations"][number],
      fallbackMonth: string,
    ) => {
      const installedAt = (installation.contractInstallAt || fallbackMonth).slice(
        0,
        10,
      );
      const rentalAmount = rentalAmountFor(installation, fallbackMonth);
      const productCategory = productById.get(installation.productId)?.category;
      return data.dealerCommissionRules
        .filter(
          (rule) =>
            rule.dealerId === dealerId &&
            (rule.targetType === "product"
              ? rule.productId === installation.productId
              : rule.productCategory === productCategory) &&
            rule.condition === installation.condition &&
            rule.rentalAmount === rentalAmount &&
            rule.contractTermMonths === installation.contractTermMonths &&
            rule.effectiveFrom <= installedAt,
        )
        .sort(
          (a, b) =>
            Number(b.targetType === "product") - Number(a.targetType === "product") ||
            b.effectiveFrom.localeCompare(a.effectiveFrom),
        )[0];
    };
    const metricsFor = (start: string, end: string) => {
      const months = monthsBetween(start, end);
      const rangePayments = data.payments.filter(
        (payment) =>
          merchantIds.has(payment.merchantId) &&
          payment.paymentDate.slice(0, 7) >= start &&
          payment.paymentDate.slice(0, 7) <= end,
      );
      const billingRangePayments = data.payments.filter(
        (payment) =>
          merchantIds.has(payment.merchantId) &&
          payment.billingMonth >= start &&
          payment.billingMonth <= end,
      );
      const settlementPayments = rangePayments.filter(
        (payment) =>
          payerById.get(payment.payerAccountId)?.billingType !== "installment",
      );
      const billingSettlementPayments = billingRangePayments.filter(
        (payment) =>
          payerById.get(payment.payerAccountId)?.billingType !== "installment",
      );
      const rangeInstallations = data.installations.filter((item) => {
        const installMonth = (item.contractInstallAt || "").slice(0, 7);
        return (
          merchantIds.has(item.merchantId) &&
          installMonth >= start &&
          installMonth <= end
        );
      });
      const rangeAdvances = data.advancePayments.filter(
        (item) =>
          item.dealerId === dealerId &&
          item.settlementMonth >= start &&
          item.settlementMonth <= end,
      );
      const rangeVanSettlements = usesVanSettlement
        ? data.vanSettlements.filter(
            (item) =>
              item.dealerId === dealerId &&
              item.settlementMonth >= start &&
              item.settlementMonth <= end,
          )
        : [];
      const expected = billingPayers.reduce(
        (sum, payer) =>
          sum +
          months.filter((monthValue) => payerActiveInMonth(payer, monthValue))
            .length *
            payer.monthlyCharge,
        0,
      );
      const paid = settlementPayments.reduce(
        (sum, payment) => sum + payment.supplyAmount,
        0,
      );
      const vat = settlementPayments.reduce(
        (sum, payment) => sum + payment.vatAmount,
        0,
      );
      const billedPaid = billingSettlementPayments.reduce(
        (sum, payment) => sum + payment.supplyAmount,
        0,
      );
      const paymentRevenue = paid;
      const cost = rangeInstallations.reduce(
        (sum, item) => sum + item.quantity * item.unitCostSnapshot,
        0,
      );
      const installmentRevenue = rangeInstallations
        .filter((item) => item.transactionClassification === "할부구매")
        .reduce((sum, item) => sum + eligibleInstallmentRevenue(item), 0);
      const settledCarryoverRevenue = data.installations
        .filter(
          (item) =>
            merchantIds.has(item.merchantId) &&
            item.transactionClassification === "할부구매",
        )
        .reduce(
          (sum, item) =>
            sum + installmentSettledRevenueForPeriod(item, start, end),
          0,
        );
      const totalInstallmentRevenue = installmentRevenue + settledCarryoverRevenue;
      const installmentPendingSummary = installmentPendingBreakdown(
        rangeInstallations.filter(
          (item) => item.transactionClassification === "할부구매",
        ),
      );
      const purchaseRevenue = rangeInstallations
        .filter((item) => item.transactionClassification === "구매")
        .reduce((sum, item) => sum + item.unitCostSnapshot * item.quantity, 0);
      const vanFeeRevenue = rangeVanSettlements.reduce(
        (sum, item) => sum + item.vanFee,
        0,
      );
      const revenue =
        paymentRevenue + purchaseRevenue + totalInstallmentRevenue + vanFeeRevenue;
      const dealerCost = rangeInstallations.reduce((sum, item) => {
        if (usesFlatCommission)
          return item.transactionClassification === "구매"
            ? sum + item.quantity * item.unitCostSnapshot
            : sum;
        const rule = ruleFor(
          item.contractInstallAt || end,
        );
        return (
          sum +
          Math.round(
            (item.quantity *
              item.unitCostSnapshot *
              (rule?.costShareRate ?? 0)) /
              100,
          )
        );
      }, 0);
      const flatCommissionRevenue = usesFlatCommission
        ? rangeInstallations
            .filter(
              (item) =>
                !["구매", "할부구매", "무상"].includes(
                  item.transactionClassification ?? "",
                ),
            )
            .reduce((sum, item) => {
              const rule = commissionRuleFor(item, end);
              return sum + (rule?.commissionAmount ?? 0) * item.quantity;
            }, 0)
        : 0;
      const dealerProfitFromPayments = usesFlatCommission
        ? flatCommissionRevenue
        : settlementPayments.reduce(
            (sum, payment) =>
              sum +
              Math.round(
                  (payment.supplyAmount *
                  (ruleFor(payment.paymentDate)?.profitShareRate ?? 0)) /
                  100,
              ),
            0,
          );
      const dealerProfitFromInstallments = rangeInstallations
        .filter((item) => item.transactionClassification === "할부구매")
        .reduce((sum, item) => {
          if (usesFlatCommission) return sum;
          return (
            sum +
              Math.round(
                (eligibleInstallmentRevenue(item) *
                  (ruleFor(item.contractInstallAt || end)
                    ?.profitShareRate ?? 0)) /
                  100,
              )
          );
        }, 0);
      const dealerProfitFromSettledCarryover = data.installations
        .filter(
          (item) =>
            merchantIds.has(item.merchantId) &&
            item.transactionClassification === "할부구매" &&
            !rangeInstallations.some((candidate) => candidate.id === item.id),
        )
        .reduce((sum, item) => {
          const revenue = installmentSettledRevenueForPeriod(item, start, end);
          return sum + Math.round((revenue * (ruleFor(item.contractInstallAt || end)?.profitShareRate ?? 0)) / 100);
        }, 0);
      const dealerProfitFromPurchases = rangeInstallations
        .filter((item) => item.transactionClassification === "구매")
        .reduce((sum, item) => {
          if (usesFlatCommission) return sum;
          return (
            sum +
            Math.round(
              ((item.unitCostSnapshot * item.quantity) *
                (ruleFor(item.contractInstallAt || end)
                  ?.profitShareRate ?? 0)) /
                100,
            )
          );
        }, 0);
      const dealerProfitFromVanFees = rangeVanSettlements.reduce(
        (sum, item) =>
          usesFlatCommission
            ? sum
            : sum +
              Math.round(
                (item.vanFee *
                  (ruleFor(item.settlementMonth)?.profitShareRate ?? 0)) /
                  100,
              ),
        0,
      );
      const dealerProfit =
        dealerProfitFromPayments +
        dealerProfitFromPurchases +
        dealerProfitFromInstallments +
        dealerProfitFromSettledCarryover +
        dealerProfitFromVanFees;
      const advance = rangeAdvances.reduce((sum, item) => sum + item.amount, 0);
      const settlementSupply = dealerProfit - dealerCost;
      const settlementVat = Math.round(settlementSupply * 0.1);
      const settlementWithVat = settlementSupply + settlementVat;
      const finalSettlement = settlementWithVat - advance;
      return {
        months,
        rangePayments: settlementPayments,
        billingRangePayments: billingSettlementPayments,
        rangeInstallations,
        rangeAdvances,
        rangeVanSettlements,
        usesVanSettlement,
        expected,
        paid,
        billedPaid,
        vat,
        cost,
        paymentRevenue,
        purchaseRevenue,
        installmentRevenue: totalInstallmentRevenue,
        settledCarryoverRevenue,
        installmentPending: installmentPendingSummary,
        vanFeeRevenue,
        flatCommissionRevenue,
        revenue,
        dealerCost,
        dealerProfit,
        advance,
        settlementSupply,
        settlementVat,
        settlementWithVat,
        finalSettlement,
      };
    };
    const current = metricsFor(range.start, range.end);
    const targetYear = Number(range.start.slice(0, 4));
    const years = [
      ...data.payments
        .filter((item) => merchantIds.has(item.merchantId))
        .map((item) => Number(item.paymentDate.slice(0, 4))),
      ...data.installations
        .filter((item) => merchantIds.has(item.merchantId))
        .map((item) =>
          Number(
            (item.contractInstallAt || "").slice(0, 4),
          ),
        ),
      ...data.advancePayments
        .filter((item) => item.dealerId === dealerId)
        .map((item) => Number(item.settlementMonth.slice(0, 4))),
      ...(usesVanSettlement
        ? data.vanSettlements
            .filter((item) => item.dealerId === dealerId)
            .map((item) => Number(item.settlementMonth.slice(0, 4)))
        : []),
    ].filter(Number.isFinite);
    let carryover = 0;
    const firstYear = years.length ? Math.min(...years) : targetYear;
    for (let priorYear = firstYear; priorYear < targetYear; priorYear += 1)
      carryover = Math.min(
        0,
        carryover +
          metricsFor(`${priorYear}-01`, `${priorYear}-12`).finalSettlement,
      );
    const monthDetails = current.months.map((monthValue) => ({
      month: monthValue,
      ...metricsFor(monthValue, monthValue),
    }));
    // The settlement tab's merchant status is installation-period based.
    // A merchant with only historical/active billing data but no product
    // installed in the selected period should not appear in this list.
    const settlementMerchantIds = new Set(
      current.rangeInstallations.map((item) => item.merchantId),
    );
    const settlementMerchants = dealerMerchants.filter((merchant) =>
      settlementMerchantIds.has(merchant.id),
    );
    const appliedCarryover = rangeMode === "year" ? carryover : 0;
    const finalSettlement = current.finalSettlement + appliedCarryover;
    return {
      ...current,
      dealerMerchants,
      settlementMerchants,
      payers: billingPayers,
      unpaid: Math.max(0, current.expected - current.billedPaid),
      carryover: appliedCarryover,
      finalSettlement,
      monthDetails,
    };
  }, [data, dealerId, range.start, range.end, rangeMode]);
  if (error)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl border bg-white p-8 text-center">
          <ShieldCheck className="mx-auto mb-4 text-red-500" />
          <h1 className="text-xl font-bold">접근할 수 없습니다</h1>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
        </div>
      </main>
    );
  if (!data || !calculations)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7fb]">
        <div className="size-9 animate-spin rounded-full border-4 border-blue-100 border-t-[#175cd3]" />
      </main>
    );
  const merchantName = (id: number) =>
    data.merchants.find((row) => row.id === id)?.name ?? "-";
  const productName = (id: number) =>
    data.products.find((row) => row.id === id)?.name ?? "-";
  const pendingInstallmentRows = calculations.rangeInstallations
    .filter((item) => item.transactionClassification === "할부구매" && installmentPending(item) > 0)
    .map((item) => {
      const merchant = data.merchants.find((row) => row.id === item.merchantId);
      const dealer = merchant ? data.dealers.find((row) => row.id === merchant.dealerId) : null;
      return {
        lineItemKey: item.salesforceLineItemId || `local:${item.id}`,
        salesforceLineItemId: item.salesforceLineItemId,
        dealerName: dealer?.name ?? "-",
        merchantName: merchant?.name ?? "-",
        businessNumber: merchant?.businessNumber ?? "-",
        contractInstallAt: item.contractInstallAt,
        productName: productName(item.productId),
        fixing: item.fixing,
        fixingPaymentStatus: item.fixingPaymentStatus,
        fixingPaymentDate: item.fixingPaymentDate,
        incentive: item.incentive,
        incentivePaymentStatus: item.incentivePaymentStatus,
        incentivePaymentDate: item.incentivePaymentDate,
        totalPending: installmentPending(item),
      };
    })
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.lineItemKey === row.lineItemKey) === index);
  const dealer = data.dealers.find((row) => row.id === dealerId);
  const mainSummaryCards = mainSummaryCardsFor(dealer);
  const hasMainSummaryCard = (key: MainSummaryCardKey) =>
    mainSummaryCards.includes(key);
  const settlementColumns = settlementListColumnsFor(dealer);
  const hasSettlementColumn = (key: SettlementListColumnKey) =>
    settlementColumns.includes(key);
  const merchantListColumns = merchantListColumnsFor(dealer);
  const hasMerchantListColumn = (key: MerchantListColumnKey) =>
    merchantListColumns.includes(key);
  const productById = new Map(data.products.map((product) => [product.id, product]));
  const ruleForDate = (date: string) =>
    data.rules
      .filter(
        (rule) =>
          rule.dealerId === dealerId &&
          rule.effectiveFrom.slice(0, 7) <= date.slice(0, 7),
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const commissionRuleForInstallation = (
    installation: DashboardData["installations"][number],
  ) => {
    const installedAt = (installation.contractInstallAt || range.end).slice(0, 10);
    const productCategory = productById.get(installation.productId)?.category;
    return data.dealerCommissionRules
      .filter(
        (rule) =>
          rule.dealerId === dealerId &&
          (rule.targetType === "product"
            ? rule.productId === installation.productId
            : rule.productCategory === productCategory) &&
          rule.condition === installation.condition &&
          rule.rentalAmount === installation.salesAmount &&
          rule.contractTermMonths === installation.contractTermMonths &&
          rule.effectiveFrom <= installedAt,
      )
      .sort(
        (a, b) =>
          Number(b.targetType === "product") - Number(a.targetType === "product") ||
          b.effectiveFrom.localeCompare(a.effectiveFrom),
      )[0];
  };
  const settlementStatusFor = (monthValue: string) =>
    data.monthlySettlementStatuses.find(
      (item) =>
        item.dealerId === dealerId && item.settlementMonth === monthValue,
    );
  const currentSettlementStatus =
    rangeMode === "month" ? settlementStatusFor(range.start) : undefined;
  const settlementTransferDirection = (amount: number) =>
    amount > 0 ? "신신 → 딜러" : amount < 0 ? "딜러 → 신신" : "정산 없음";
  const settlementSummaryLabel = (amount: number) => {
    const direction = settlementTransferDirection(amount);
    if (!dealer?.flatCommissionEnabled) return direction;
    if (amount > 0) return `수당 지급 · ${direction}`;
    if (amount < 0) return `원가 청구 · ${direction}`;
    return direction;
  };
  const settlementDirection = settlementSummaryLabel(
    calculations.finalSettlement,
  );
  const showSettlementDirection = dealer?.settlementDirectionVisible !== false;
  const profitSettlementLabel = dealer?.flatCommissionEnabled
    ? "수당 지급액"
    : "정산 반영 수익";
  const costSettlementLabel = dealer?.flatCommissionEnabled
    ? "구매 원가 청구액"
    : "딜러 원가 부담";
  const finalSettlementLabel = dealer?.flatCommissionEnabled
    ? "최종 수당 정산"
    : "최종 정산";
  const hideReferenceMetrics = dealer?.flatCommissionEnabled === true;
  const purchaseRevenueLabel = dealer?.flatCommissionEnabled
    ? "구매 원가 청구액"
    : "구매수익";
  const merchantMatchesSearch = (
    merchant: (typeof data.merchants)[number],
  ) => {
    const query = searchKey(merchantSearch);
    if (!query) return true;
    const installations = data.installations.filter(
      (item) => item.merchantId === merchant.id,
    );
    const vans = installations.map((item) => item.van ?? "");
    const installedProducts = installations.map((item) =>
      productName(item.productId),
    );
    const transactionClassifications = installations.map(
      (item) => item.transactionClassification ?? "",
    );
    return [
      merchant.name,
      merchant.businessNumber,
      merchant.installDate,
      merchant.accountStatus,
      ...vans,
      ...installedProducts,
      ...transactionClassifications,
    ]
      .map(searchKey)
      .some((value) => value.includes(query));
  };
  const searchedSettlementMerchants =
    calculations.settlementMerchants.filter(merchantMatchesSearch);
  const settlementMerchantPages = Math.max(
    1,
    Math.ceil(searchedSettlementMerchants.length / MERCHANTS_PER_PAGE),
  );
  const safeSettlementMerchantPage = Math.min(
    settlementMerchantPage,
    settlementMerchantPages,
  );
  const settlementMerchantRows = searchedSettlementMerchants.slice(
    (safeSettlementMerchantPage - 1) * MERCHANTS_PER_PAGE,
    safeSettlementMerchantPage * MERCHANTS_PER_PAGE,
  );
  const managedMerchants = data.merchants.filter(
    (merchant) => merchant.dealerId === dealerId,
  );
  const searchedManagedMerchants = managedMerchants.filter(
    merchantMatchesSearch,
  );
  const merchantPages = Math.max(
    1,
    Math.ceil(searchedManagedMerchants.length / MERCHANTS_PER_PAGE),
  );
  const safeMerchantPage = Math.min(merchantPage, merchantPages);
  const managedMerchantRows = searchedManagedMerchants.slice(
    (safeMerchantPage - 1) * MERCHANTS_PER_PAGE,
    safeMerchantPage * MERCHANTS_PER_PAGE,
  );
  const selectedMerchantIdSet = new Set(selectedMerchantIds);
  const selectedOnPage = managedMerchantRows.filter((merchant) =>
    selectedMerchantIdSet.has(merchant.id),
  );
  const allOnPageSelected =
    managedMerchantRows.length > 0 &&
    selectedOnPage.length === managedMerchantRows.length;
  const visibleVanSettlementIds = calculations.rangeVanSettlements.map(
    (item) => item.id,
  );
  const visiblePaymentIds = calculations.rangePayments.map((item) => item.id);
  const costTableRows = productCostRows(data);
  const searchedCostTableRows = costTableRows.filter(
    (row) => {
      const { product, endDate } = row;
      const cost = rowCost(row);
      const query = searchKey(costSearch);
      if (!query) return true;
      return [
        product.name,
        dealerCostScopeLabel(data, row.scopeDealerId),
        cost?.condition ?? "신품",
        cost?.effectiveFrom ?? "",
        endDate ?? "현재",
        cost?.unitCost ?? "",
        cost ? "등록" : "원가미등록",
      ]
        .map(searchKey)
        .some((value) => value.includes(query));
    },
  );
  const visibleCostRefs = searchedCostTableRows.flatMap((row) => {
    const ref = productCostRef(row);
    return ref ? [ref] : [];
  });
  const searchedCategoryCostRows = data.dealerCategoryCosts.filter((row) => {
    const query = searchKey(costSearch);
    if (!query) return true;
    return [
      dealerCostScopeLabel(data, row.dealerId),
      row.productCategory,
      row.condition,
      row.effectiveFrom,
      row.unitCost,
    ]
      .map(searchKey)
      .some((value) => value.includes(query));
  });
  const vansFor = (
    merchantId: number,
    sourceInstallations = data.installations,
  ) => [
    ...new Set(
      sourceInstallations
        .filter((item) => item.merchantId === merchantId)
        .flatMap((item) =>
          (item.van || "")
            .split(/[;,]/)
            .map((value) => value.trim())
            .filter(Boolean),
        ),
    ),
  ];
  const merchantDetailPath = (merchantId: number) => {
    const returnTo = listStatePath;
    if (typeof window !== "undefined")
      window.sessionStorage.setItem(LIST_RETURN_STORAGE_KEY, returnTo);
    const params = new URLSearchParams({
      returnTo,
      rangeMode,
      year,
      month,
      customStart,
      customEnd,
    });
    return `/merchants/${merchantId}?${params.toString()}`;
  };
  async function toggleProductDirectCost(
    product: DashboardData["products"][number],
    checked: boolean,
  ) {
    try {
      const result = await post({
        action: "updateProduct",
        productId: product.id,
        name: product.name,
        category: product.category,
        active: product.active,
        directCostAllowed: checked,
      });
      setData(result);
      toast.success(
        checked
          ? "직접 입력 가능 품목으로 표시했습니다."
          : "직접 입력 가능 표시를 해제했습니다.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "제품 설정을 저장하지 못했습니다.",
      );
    }
  }
  return (
    <TooltipProvider>
      <main className="min-h-screen bg-[#f4f7fb] text-slate-950">
      <Toaster position="top-center" richColors />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-3 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-[#175cd3] text-white">
              <Coins className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold">딜러 정산 관리</h1>
              <p className="text-xs text-slate-500">
                {data.access.role === "admin"
                  ? "관리자"
                  : data.access.role === "viewer"
                    ? "읽기 전용"
                    : dealer?.name} ·{" "}
                {data.access.email}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {data.access.role === "admin" && dealerId !== null && (
              <SalesforceSyncButton dealerId={dealerId} onSaved={setData} />
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-[1480px] px-5 py-6 lg:px-8 lg:py-8">
        <section className="mb-6 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
          <div>
            <div className="mb-2 flex gap-2">
              <Badge className="bg-blue-50 text-[#175cd3]">
                최종 정산 VAT 포함
              </Badge>
              <Badge variant="outline">{range.label}</Badge>
            </div>
            <h2 className="text-2xl font-bold sm:text-3xl">
              {dealer?.name} 정산 현황
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              공급가액 정산에 VAT를 반영한 뒤 선지급금을 차감합니다.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={rangeMode}
              onValueChange={(value) => {
                setRangeMode(value);
                setSettlementMerchantPage(1);
                clearPeriodSelections();
              }}
            >
              <SelectTrigger className="h-11 rounded-xl bg-white">
                <CalendarRange />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="year">연도별</SelectItem>
                <SelectItem value="month">월별</SelectItem>
                <SelectItem value="custom">기간 설정</SelectItem>
              </SelectContent>
            </Select>
            {rangeMode === "year" && (
              <Input
                className="h-11 w-28 rounded-xl bg-white"
                value={year}
                onChange={(e) => {
                  setYear(e.target.value.replace(/\D/g, "").slice(0, 4));
                  setSettlementMerchantPage(1);
                  clearPeriodSelections();
                }}
              />
            )}{" "}
            {rangeMode === "month" && (
              <Input
                className="h-11 w-40 rounded-xl bg-white"
                type="month"
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  setSettlementMerchantPage(1);
                  clearPeriodSelections();
                }}
              />
            )}{" "}
            {rangeMode === "custom" && (
              <>
                <Input
                  className="h-11 w-40 rounded-xl bg-white"
                  type="month"
                  value={customStart}
                  onChange={(e) => {
                    setCustomStart(e.target.value);
                    setSettlementMerchantPage(1);
                    clearPeriodSelections();
                  }}
                />
                <ArrowLeftRight className="size-4 text-slate-400" />
                <Input
                  className="h-11 w-40 rounded-xl bg-white"
                  type="month"
                  value={customEnd}
                  onChange={(e) => {
                    setCustomEnd(e.target.value);
                    setSettlementMerchantPage(1);
                    clearPeriodSelections();
                  }}
                />
              </>
            )}{" "}
            {data.access.role !== "dealer" && (
              <Select
                value={String(dealerId)}
                onValueChange={(value) => {
                  setDealerId(Number(value));
                  setSettlementMerchantPage(1);
                  setMerchantPage(1);
                  setMerchantSearch("");
                  setCostSearch("");
                  setSelectedMerchantIds([]);
                  clearPeriodSelections();
                }}
              >
                <SelectTrigger className="h-11 min-w-48 rounded-xl bg-white">
                  <Building2 />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.dealers.map((item) => (
                    <SelectItem value={String(item.id)} key={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </section>
        <section className="mb-6 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
          {[
            {
              key: "expectedBilling",
              label: "예정 청구액",
              value: calculations.expected,
              note: "VAT 별도",
              icon: ReceiptText,
              tone: "blue",
            },
            {
              key: "paidAmount",
              label: "실제 납부액",
              value: calculations.paid,
              note: `납입일자 기준 · VAT ${won(calculations.vat)} 별도`,
              icon: CheckCircle2,
              tone: "green",
            },
            ...(calculations.usesVanSettlement
              ? [
                  {
                    key: "vanFeeRevenue",
                    label: dealer?.flatCommissionEnabled
                      ? "VAN피 수익(참고)"
                      : "VAN피 수익",
                    value: calculations.vanFeeRevenue,
                    note: "월별 VAN사 실적 합계",
                    icon: CreditCard,
                    tone: "blue",
                  },
                ]
              : []),
            {
              key: "installationCost",
              label: dealer?.flatCommissionEnabled
                ? "설치 원가(참고)"
                : "설치 원가",
              value: calculations.cost,
              note: "모델·상태·설치일 원가",
              icon: Boxes,
              tone: "cyan",
            },
            {
              key: "totalRevenue",
              label: dealer?.flatCommissionEnabled ? "총 수익(참고)" : "총 수익",
              value: calculations.revenue,
              note: calculations.usesVanSettlement
                ? "납입 + 구매 + 할부구매 + VAN피"
                : "납입 + 구매 + 할부구매",
              icon: ArrowUpRight,
              tone: "green",
            },
            {
              key: "advanceDeduction",
              label: "선지급 차감",
              value: calculations.advance,
              note: "신신 선지급액",
              icon: Coins,
              tone: "orange",
            },
            {
              key: "finalSettlement",
              label: finalSettlementLabel,
              value: calculations.finalSettlement,
              note: showSettlementDirection ? settlementDirection : undefined,
              topNote:
                rangeMode === "year"
                  ? `전년도 이월 ${calculations.carryover < 0 ? "-" : ""}${won(Math.abs(calculations.carryover))}`
                  : undefined,
              icon: CircleDollarSign,
              tone: "navy",
            },
          ]
            .filter(
              (card) =>
                !hideReferenceMetrics ||
                ![
                  "vanFeeRevenue",
                  "installationCost",
                  "totalRevenue",
                ].includes(card.key),
            )
            .filter((card) => hasMainSummaryCard(card.key as MainSummaryCardKey))
            .map((card) => (
            <article
              key={card.label}
              className={`summary-card summary-${card.tone}`}
            >
              <div className="flex justify-between">
                <p className="text-sm font-medium text-slate-600">
                  {card.label}
                </p>
                <card.icon className="size-5" />
              </div>
              {card.topNote && (
                <p className="mt-3 text-xs font-medium text-slate-500">
                  {card.topNote}
                </p>
              )}
              <p className="mt-5 text-xl font-extrabold">{won(card.value)}</p>
              {card.vat !== undefined && (
                <div className="mt-2 space-y-1 border-t border-current/10 pt-2 text-xs text-slate-500">
                  <p>VAT {won(card.vat)}</p>
                  <p className="font-semibold text-slate-700">
                    VAT 포함 {won(card.totalWithVat ?? card.value)}
                  </p>
                </div>
              )}
              {card.note && (
                <p className="mt-1 text-xs text-slate-500">{card.note}</p>
              )}
            </article>
          ))}
        </section>
        {dealer?.installmentPendingEnabled !== false && calculations.installmentPending.totalCount > 0 && <button
          type="button"
          onClick={() => setInstallmentPendingOpen(true)}
          className="mb-6 w-full rounded-2xl border border-red-100 bg-red-50/70 p-5 text-left transition hover:border-red-200 hover:bg-red-50"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-1 text-sm font-semibold text-red-800">
                할부구매 입금대기
                <InfoTooltip label="할부구매 입금대기 기준 안내">
                  귀속월은 제품 설치일자의 월입니다. 대금책정과 영업수수료는
                  각각 실제 입금상태를 확인해 정산 가능 여부를 판단합니다.
                  입금일이 귀속월 이후라면 입금된 달의 정산에 과거 귀속월
                  이월분으로 반영되며, 귀속월 자체는 변경되지 않습니다.
                </InfoTooltip>
              </p>
              <p className="mt-1 text-xs text-red-700/70">설치월 귀속 기준 · 금액이 있는 명시적 미입금 항목만 집계</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-extrabold text-red-800">{won(calculations.installmentPending.totalAmount)}</p>
              <p className="text-xs text-red-700">전체 {calculations.installmentPending.totalCount}건</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl bg-white/80 px-3 py-2 text-red-800">대금책정 {calculations.installmentPending.fixingCount}건 · {won(calculations.installmentPending.fixingAmount)}</div>
            <div className="rounded-xl bg-white/80 px-3 py-2 text-red-800">영업수수료 {calculations.installmentPending.incentiveCount}건 · {won(calculations.installmentPending.incentiveAmount)}</div>
          </div>
        </button>}
        {dealer?.installmentPendingEnabled !== false && calculations.installmentPending.totalCount > 0 && <InstallmentPendingDialog
          open={installmentPendingOpen}
          onOpenChange={setInstallmentPendingOpen}
          rows={pendingInstallmentRows}
        />}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl border bg-white p-1 sm:w-fit">
              <TabsTrigger value="settlement">정산</TabsTrigger>
              <TabsTrigger value="settlementInfo">정산정보</TabsTrigger>
              <TabsTrigger value="merchants">가맹점·납부자번호</TabsTrigger>
              <TabsTrigger value="payments">납입내역</TabsTrigger>
            </TabsList>
            {data.access.role === "admin" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="ml-auto rounded-xl bg-white">
                    <Settings2 /> 설정
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem
                    onClick={() => setActiveTab("costs")}
                    onSelect={() => setActiveTab("costs")}
                  >
                    <Boxes /> 제품 원가
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setActiveTab("dealers")}
                    onSelect={() => setActiveTab("dealers")}
                  >
                    <Building2 /> 딜러 관리
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setActiveTab("members")}
                    onSelect={() => setActiveTab("members")}
                  >
                    <ShieldCheck /> 딜러 권한
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <TabsContent
            value="settlement"
            className="space-y-5"
          >
            {rangeMode === "year" && (
              <section className="panel overflow-hidden">
                <div className="panel-head">
                  <div>
                    <h3>{year}년 월별 정산 내역</h3>
                    <p>
                      {dealer?.flatCommissionEnabled
                        ? "총 수익은 참고용이며, 월 정산액은 수당 지급액과 구매 원가 청구액·선지급을 반영한 금액입니다."
                        : "총 수익은 수익 배분률 적용 전 금액이며, 월 정산액은 수익 배분과 원가 부담·선지급을 반영한 금액입니다."}
                    </p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <Table className="whitespace-nowrap">
                    <TableHeader>
                      <TableRow>
                        <TableHead>월</TableHead>
                        <TableHead>정산일자</TableHead>
                        <TableHead>지급여부</TableHead>
                        <TableHead>세금계산서</TableHead>
                        {!hideReferenceMetrics && (
                          <>
                            <TableHead className="text-right">
                              일반 납입 수익
                            </TableHead>
                            <TableHead className="text-right">구매수익</TableHead>
                            <TableHead className="text-right">
                              할부구매수익
                            </TableHead>
                            {calculations.usesVanSettlement && (
                              <TableHead className="text-right">
                                VAN피 수익
                              </TableHead>
                            )}
                            <TableHead className="text-right">총 수익</TableHead>
                          </>
                        )}
                        <TableHead className="text-right">
                          {profitSettlementLabel}
                        </TableHead>
                        {!hideReferenceMetrics && (
                          <TableHead className="text-right">제품 원가</TableHead>
                        )}
                        <TableHead className="text-right">
                          {costSettlementLabel}
                        </TableHead>
                        {dealer?.advanceEnabled && (
                          <TableHead className="text-right">선지급</TableHead>
                        )}
                        <TableHead className="text-right">
                          {dealer?.flatCommissionEnabled
                            ? "월 최종 수당 정산액(VAT 포함)"
                            : "월 최종 정산액(VAT 포함)"}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                <TableBody>
                      {calculations.monthDetails.map((item) => {
                        const status = settlementStatusFor(item.month);
                        return (
                        <TableRow key={item.month}>
                          <TableCell className="font-semibold">
                            {Number(item.month.slice(5))}월
                          </TableCell>
                          <TableCell>{status?.settlementDate ?? "-"}</TableCell>
                          <TableCell>
                            {status?.paid ? (
                              <Badge className="bg-emerald-50 text-emerald-700">
                                지급완료
                              </Badge>
                            ) : (
                              <Badge variant="outline">미지급</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {status?.taxInvoiceIssuedAt ?? "-"}
                          </TableCell>
                          {!hideReferenceMetrics && (
                            <>
                              <TableCell className="text-right">
                                {won(item.paymentRevenue)}
                              </TableCell>
                              <TableCell className="text-right">
                                {won(item.purchaseRevenue)}
                              </TableCell>
                              <TableCell className="text-right">
                                {won(item.installmentRevenue)}
                              </TableCell>
                              {calculations.usesVanSettlement && (
                                <TableCell className="text-right">
                                  {won(item.vanFeeRevenue)}
                                </TableCell>
                              )}
                              <TableCell className="text-right font-semibold text-emerald-700">
                                {won(item.revenue)}
                              </TableCell>
                            </>
                          )}
                          <TableCell className="text-right">
                            {won(item.dealerProfit)}
                          </TableCell>
                          {!hideReferenceMetrics && (
                            <TableCell className="text-right">
                              {won(item.cost)}
                            </TableCell>
                          )}
                          <TableCell className="text-right">
                            {won(item.dealerCost)}
                          </TableCell>
                          {dealer?.advanceEnabled && (
                            <TableCell className="text-right">
                              {won(item.advance)}
                            </TableCell>
                          )}
                          <TableCell
                            className={`text-right font-bold ${
                              item.finalSettlement < 0
                                ? "text-red-700"
                                : "text-blue-700"
                            }`}
                          >
                            {won(item.finalSettlement)}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                      <TableRow className="bg-slate-50 font-bold">
                        <TableCell>연간 합계</TableCell>
                        <TableCell colSpan={3}></TableCell>
                        {!hideReferenceMetrics && (
                          <>
                            <TableCell className="text-right">
                              {won(calculations.paymentRevenue)}
                            </TableCell>
                            <TableCell className="text-right">
                              {won(calculations.purchaseRevenue)}
                            </TableCell>
                            <TableCell className="text-right">
                              {won(calculations.installmentRevenue)}
                            </TableCell>
                            {calculations.usesVanSettlement && (
                              <TableCell className="text-right">
                                {won(calculations.vanFeeRevenue)}
                              </TableCell>
                            )}
                            <TableCell className="text-right text-emerald-700">
                              {won(calculations.revenue)}
                            </TableCell>
                          </>
                        )}
                        <TableCell className="text-right">
                          {won(calculations.dealerProfit)}
                        </TableCell>
                        {!hideReferenceMetrics && (
                          <TableCell className="text-right">
                            {won(calculations.cost)}
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          {won(calculations.dealerCost)}
                        </TableCell>
                        {dealer?.advanceEnabled && (
                          <TableCell className="text-right">
                            {won(calculations.advance)}
                          </TableCell>
                        )}
                        <TableCell
                          className={`text-right ${
                            calculations.finalSettlement < 0
                              ? "text-red-700"
                              : "text-blue-700"
                          }`}
                        >
                          {won(calculations.finalSettlement)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </section>
            )}
            {calculations.usesVanSettlement && (
            <section className="panel overflow-hidden">
              <div className="panel-head">
                <div>
                  <h3>월별 VAN사 실적</h3>
                  <p>
                    결제 건수·결제금액으로 객단가를 계산하고, VAN피를 총 수익에
                    반영합니다.
                  </p>
                </div>
                {data.access.role === "admin" && dealerId !== null && (
                  <div className="flex flex-wrap gap-2">
                    <VanImportDialog dealerId={dealerId} onSaved={setData} />
                    <VanSettlementDialog
                      dealerId={dealerId}
                      defaultMonth={range.start}
                      onSaved={setData}
                    />
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {data.access.role === "admin" && (
                        <TableHead className="w-12">
                          <Checkbox
                            aria-label="현재 기간 VAN 실적 전체 선택"
                            checked={selectionState(
                              selectedVanSettlementIds,
                              visibleVanSettlementIds,
                            )}
                            onCheckedChange={(checked) =>
                              setSelectedVanSettlementIds((current) =>
                                updateSelectedIds(
                                  current,
                                  visibleVanSettlementIds,
                                  checked === true,
                                ),
                              )
                            }
                          />
                        </TableHead>
                      )}
                      <TableHead>정산월</TableHead>
                      <TableHead>VAN사</TableHead>
                      <TableHead className="text-right">결제 건수</TableHead>
                      <TableHead className="text-right">결제금액</TableHead>
                      <TableHead className="text-right">객단가</TableHead>
                      <TableHead className="text-right">VAN피</TableHead>
                      {data.access.role === "admin" && <TableHead />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calculations.rangeVanSettlements.map((item) => (
                      <TableRow key={item.id}>
                        {data.access.role === "admin" && (
                          <TableCell>
                            <Checkbox
                              aria-label={`${item.settlementMonth} ${item.vanCompany} VAN 실적 선택`}
                              checked={selectedVanSettlementIds.includes(item.id)}
                              onCheckedChange={(checked) =>
                                setSelectedVanSettlementIds((current) =>
                                  updateSelectedIds(
                                    current,
                                    [item.id],
                                    checked === true,
                                  ),
                                )
                              }
                            />
                          </TableCell>
                        )}
                        <TableCell>{item.settlementMonth}</TableCell>
                        <TableCell className="font-semibold">
                          {item.vanCompany}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.transactionCount.toLocaleString("ko-KR")}건
                        </TableCell>
                        <TableCell className="text-right">
                          {won(item.paymentAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {won(
                            item.transactionCount
                              ? item.paymentAmount / item.transactionCount
                              : 0,
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-emerald-700">
                          {won(item.vanFee)}
                        </TableCell>
                        {data.access.role === "admin" && dealerId !== null && (
                          <TableCell>
                            <VanSettlementDialog
                              dealerId={dealerId}
                              defaultMonth={range.start}
                              onSaved={setData}
                              settlement={item}
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {!calculations.rangeVanSettlements.length && (
                      <TableRow>
                        <TableCell
                          colSpan={data.access.role === "admin" ? 8 : 6}
                          className="h-24 text-center text-slate-500"
                        >
                          선택한 기간에 등록된 VAN 실적이 없습니다.
                        </TableCell>
                      </TableRow>
                    )}
                    {calculations.rangeVanSettlements.length > 0 && (
                      <TableRow className="bg-slate-50 font-semibold">
                        <TableCell
                          colSpan={data.access.role === "admin" ? 3 : 2}
                        >
                          합계
                        </TableCell>
                        <TableCell className="text-right">
                          {calculations.rangeVanSettlements
                            .reduce((sum, item) => sum + item.transactionCount, 0)
                            .toLocaleString("ko-KR")}
                          건
                        </TableCell>
                        <TableCell className="text-right">
                          {won(
                            calculations.rangeVanSettlements.reduce(
                              (sum, item) => sum + item.paymentAmount,
                              0,
                            ),
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {won(
                            calculations.rangeVanSettlements.reduce(
                              (sum, item) => sum + item.transactionCount,
                              0,
                            )
                              ? calculations.rangeVanSettlements.reduce(
                                  (sum, item) => sum + item.paymentAmount,
                                  0,
                                ) /
                                  calculations.rangeVanSettlements.reduce(
                                    (sum, item) => sum + item.transactionCount,
                                    0,
                                  )
                              : 0,
                          )}
                        </TableCell>
                        <TableCell className="text-right text-emerald-700">
                          {won(calculations.vanFeeRevenue)}
                        </TableCell>
                        {data.access.role === "admin" && <TableCell />}
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {data.access.role === "admin" && (
                <PageControls
                  page={1}
                  totalPages={1}
                  onChange={() => undefined}
                  actions={
                    <DeleteConfirmButton
                      disabled={!selectedVanSettlementIds.length}
                      title={`선택한 VAN 실적 ${selectedVanSettlementIds.length}건을 삭제할까요?`}
                      description="선택한 VAN 실적이 삭제되며 해당 기간의 총 수익과 최종 정산 금액도 다시 계산됩니다."
                      onConfirm={async () => {
                        const result = await post({
                          action: "deleteVanSettlements",
                          vanSettlementIds: selectedVanSettlementIds,
                        });
                        setData(result);
                        setSelectedVanSettlementIds([]);
                        toast.success("선택한 VAN 실적을 삭제했습니다.");
                      }}
                    />
                  }
                />
              )}
            </section>
            )}
            <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
              <section className="panel overflow-hidden">
              <div className="panel-head">
                <div>
                  <h3>가맹점별 납부·정산 현황</h3>
                  <p>행을 선택하면 가맹점 세부페이지로 이동합니다.</p>
                </div>
              </div>
              <div className="border-t border-slate-100 px-5 py-3">
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={merchantSearch}
                    onChange={(event) => {
                      setMerchantSearch(event.target.value);
                      setSettlementMerchantPage(1);
                      setMerchantPage(1);
                    }}
                    placeholder="가맹점명, 사업자번호, 설치제품 검색"
                    className="h-10 rounded-xl pl-9"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>가맹점</TableHead>
                      {hasSettlementColumn("installDate") && (
                        <TableHead>최초 설치일</TableHead>
                      )}
                      {hasSettlementColumn("van") && <TableHead>VAN</TableHead>}
                      {hasSettlementColumn("productQuantity") && (
                        <TableHead className="text-right">제품 수량</TableHead>
                      )}
                      {hasSettlementColumn("rentalSalesAmount") && (
                        <TableHead className="text-right">
                          임대료 판매단가
                        </TableHead>
                      )}
                      {hasSettlementColumn("installationCost") && (
                        <TableHead className="text-right">설치 원가</TableHead>
                      )}
                      {hasSettlementColumn("expectedBilling") && (
                        <TableHead className="text-right">예정 청구액</TableHead>
                      )}
                      {hasSettlementColumn("paidAmount") && (
                        <TableHead className="text-right">실제 납부액</TableHead>
                      )}
                      {hasSettlementColumn("purchaseRevenue") && (
                        <TableHead className="text-right">
                          {purchaseRevenueLabel}
                        </TableHead>
                      )}
                      {hasSettlementColumn("installmentRevenue") && (
                        <TableHead className="text-right">할부구매수익</TableHead>
                      )}
                      {hasSettlementColumn("settlementAmount") && (
                        <TableHead className="text-right">정산금액</TableHead>
                      )}
                      {hasSettlementColumn("paymentStatus") && (
                        <TableHead>납부 상태</TableHead>
                      )}
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {settlementMerchantRows.map((merchant) => {
                      const payers = calculations.payers.filter(
                        (payer) => payer.merchantId === merchant.id,
                      );
                      const expected = payers.reduce(
                        (sum, payer) =>
                          sum +
                          calculations.months.filter((m) =>
                            payerActiveInMonth(payer, m),
                          ).length *
                            payer.monthlyCharge,
                        0,
                      );
                      const paid = calculations.rangePayments
                        .filter((payment) => payment.merchantId === merchant.id)
                        .reduce(
                          (sum, payment) => sum + payment.supplyAmount,
                          0,
                        );
                      const billedPaid = calculations.billingRangePayments
                        .filter((payment) => payment.merchantId === merchant.id)
                        .reduce(
                          (sum, payment) => sum + payment.supplyAmount,
                          0,
                        );
                      const due = Math.max(0, expected - billedPaid);
                      const merchantInstallations =
                        calculations.rangeInstallations.filter(
                          (item) => item.merchantId === merchant.id,
                        );
                      const merchantCarryoverInstallations = data.installations.filter(
                        (item) =>
                          item.merchantId === merchant.id &&
                          item.transactionClassification === "할부구매",
                      );
                      const merchantCarryoverRevenue = merchantCarryoverInstallations.reduce(
                        (sum, item) => sum + installmentSettledRevenueForPeriod(item, range.start, range.end),
                        0,
                      );
                      const productQuantity = merchantInstallations.reduce(
                        (sum, item) => sum + item.quantity,
                        0,
                      );
                      const rentalSalesAmount = merchantInstallations
                        .filter(
                          (item) => item.transactionClassification === "임대",
                        )
                        .reduce(
                          (sum, item) => sum + item.salesAmount * item.quantity,
                          0,
                        );
                      const installmentRevenue = merchantInstallations
                        .filter(
                          (item) =>
                            item.transactionClassification === "할부구매",
                        )
                        .reduce((sum, item) => sum + eligibleInstallmentRevenue(item), 0) + merchantCarryoverRevenue;
                      const purchaseRevenue = merchantInstallations
                        .filter(
                          (item) => item.transactionClassification === "구매",
                        )
                        .reduce(
                          (sum, item) =>
                            sum + item.unitCostSnapshot * item.quantity,
                          0,
                        );
                      const installationCost = merchantInstallations.reduce(
                          (sum, item) =>
                            sum + item.unitCostSnapshot * item.quantity,
                          0,
                        );
                      const dealerCostAmount = merchantInstallations.reduce(
                        (sum, item) => {
                          const itemCost = item.unitCostSnapshot * item.quantity;
                          if (dealer?.flatCommissionEnabled)
                            return item.transactionClassification === "구매"
                              ? sum + itemCost
                              : sum;
                          return (
                            sum +
                            Math.round(
                              (itemCost *
                                (ruleForDate(item.contractInstallAt || range.end)
                                  ?.costShareRate ?? 0)) /
                                100,
                            )
                          );
                        },
                        0,
                      );
                      const dealerPaymentProfit = dealer?.flatCommissionEnabled
                        ? 0
                        : calculations.rangePayments
                            .filter(
                              (payment) => payment.merchantId === merchant.id,
                            )
                            .reduce(
                              (sum, payment) =>
                                sum +
                                Math.round(
                                  (payment.supplyAmount *
                                    (ruleForDate(payment.paymentDate)
                                      ?.profitShareRate ?? 0)) /
                                    100,
                                ),
                              0,
                            );
                      const dealerProductProfit = dealer?.flatCommissionEnabled
                        ? merchantInstallations
                            .filter(
                              (item) =>
                                !["구매", "할부구매", "무상"].includes(
                                  item.transactionClassification ?? "",
                                ),
                            )
                            .reduce(
                              (sum, item) =>
                                sum +
                                (commissionRuleForInstallation(item)
                                  ?.commissionAmount ?? 0) *
                                  item.quantity,
                              0,
                            )
                        : merchantInstallations.reduce((sum, item) => {
                            const rule = ruleForDate(
                              item.contractInstallAt || range.end,
                            );
                            if (item.transactionClassification === "구매")
                              return (
                                sum +
                                Math.round(
                                  (item.unitCostSnapshot *
                                    item.quantity *
                                    (rule?.profitShareRate ?? 0)) /
                                    100,
                                )
                              );
                            if (item.transactionClassification === "할부구매")
                              return (
                                sum +
                                Math.round(
                                  (eligibleInstallmentRevenue(item) *
                                    (rule?.profitShareRate ?? 0)) /
                                    100,
                                )
                              );
                            return sum;
                          }, 0) + merchantCarryoverInstallations.reduce((sum, item) => {
                            const revenue = installmentSettledRevenueForPeriod(item, range.start, range.end);
                            const rule = ruleForDate(item.contractInstallAt || range.end);
                            return sum + Math.round((revenue * (rule?.profitShareRate ?? 0)) / 100);
                          }, 0);
                      const settlementAmount =
                        dealerPaymentProfit + dealerProductProfit - dealerCostAmount;
                      const missingCostCount = merchantInstallations.filter(
                        (item) => !item.unitCostRegistered,
                      ).length;
                      const hasProductOnlyRevenue = merchantInstallations.some(
                        (item) =>
                          ["구매", "할부구매"].includes(
                            item.transactionClassification ?? "",
                          ),
                      );
                      return (
                        <TableRow
                          key={merchant.id}
                          className="cursor-pointer hover:bg-blue-50/50"
                          onClick={() =>
                            (location.href = merchantDetailPath(merchant.id))
                          }
                        >
                          <TableCell>
                            <b>{merchant.name}</b>
                            <div className="text-xs text-slate-500">
                              {merchant.businessNumber}
                            </div>
                          </TableCell>
                          {hasSettlementColumn("installDate") && (
                            <TableCell>
                              {merchant.installDate || "미입력"}
                            </TableCell>
                          )}
                          {hasSettlementColumn("van") && (
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {vansFor(merchant.id, calculations.rangeInstallations).map((van) => (
                                  <Badge variant="outline" key={van}>
                                    {van}
                                  </Badge>
                                ))}
                                {!vansFor(merchant.id, calculations.rangeInstallations).length && "-"}
                              </div>
                            </TableCell>
                          )}
                          {hasSettlementColumn("productQuantity") && (
                            <TableCell className="text-right">
                              {productQuantity.toLocaleString("ko-KR")}대
                            </TableCell>
                          )}
                          {hasSettlementColumn("rentalSalesAmount") && (
                            <TableCell className="text-right">
                              {rentalSalesAmount ? won(rentalSalesAmount) : "-"}
                            </TableCell>
                          )}
                          {hasSettlementColumn("installationCost") && (
                            <TableCell className="text-right font-semibold">
                              {won(installationCost)}
                              {missingCostCount > 0 ? (
                                <div className="mt-1">
                                  <Badge className="bg-red-50 text-red-700">
                                    원가 미등록 {missingCostCount}건
                                  </Badge>
                                </div>
                              ) : null}
                            </TableCell>
                          )}
                          {hasSettlementColumn("expectedBilling") && (
                            <TableCell className="text-right">
                              {won(expected)}
                            </TableCell>
                          )}
                          {hasSettlementColumn("paidAmount") && (
                            <TableCell className="text-right font-semibold text-emerald-700">
                              {won(paid)}
                            </TableCell>
                          )}
                          {hasSettlementColumn("purchaseRevenue") && (
                            <TableCell className="text-right font-semibold text-blue-700">
                              {won(purchaseRevenue)}
                            </TableCell>
                          )}
                          {hasSettlementColumn("installmentRevenue") && (
                            <TableCell className="text-right font-semibold text-blue-700">
                              {won(installmentRevenue)}
                            </TableCell>
                          )}
                          {hasSettlementColumn("settlementAmount") && (
                            <TableCell
                              className={`text-right font-bold ${
                                settlementAmount < 0
                                  ? "text-red-700"
                                  : "text-blue-700"
                              }`}
                            >
                              {won(settlementAmount)}
                            </TableCell>
                          )}
                          {hasSettlementColumn("paymentStatus") && (
                            <TableCell>
                              {expected === 0 && hasProductOnlyRevenue ? (
                                <Badge variant="secondary">납부대상 없음</Badge>
                              ) : due === 0 && expected > 0 ? (
                                <Badge className="bg-emerald-50 text-emerald-700">
                                  납부완료
                                </Badge>
                              ) : paid > 0 ? (
                                <Badge className="bg-orange-50 text-orange-700">
                                  일부납부
                                </Badge>
                              ) : (
                                <Badge className="bg-red-50 text-red-700">
                                  미납
                                </Badge>
                              )}
                            </TableCell>
                          )}
                          <TableCell>
                            <ChevronRight className="size-4 text-slate-400" />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!settlementMerchantRows.length && (
                      <TableRow>
                        <TableCell
                          colSpan={settlementColumns.length + 2}
                          className="h-24 text-center text-slate-500"
                        >
                          검색 결과에 맞는 가맹점이 없습니다.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <PageControls
                page={safeSettlementMerchantPage}
                totalPages={settlementMerchantPages}
                onChange={setSettlementMerchantPage}
              />
              </section>
              <aside className="panel p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold">기간 정산 계산서</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {range.label} · VAT 포함 후 선지급 차감
                  </p>
                </div>
                {data.access.role === "admin" &&
                dealerId !== null &&
                rangeMode === "month" ? (
                  <MonthlySettlementStatusDialog
                    dealerId={dealerId}
                    settlementMonth={range.start}
                    status={currentSettlementStatus}
                    onSaved={setData}
                  />
                ) : (
                  <ReceiptText className="text-[#175cd3]" />
                )}
              </div>
              {rangeMode === "month" && (
                <div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span>정산일자</span>
                    <b>{currentSettlementStatus?.settlementDate ?? "-"}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>지급여부</span>
                    <b>
                      {currentSettlementStatus?.paid ? "지급완료" : "미지급"}
                    </b>
                  </div>
                  <div className="flex justify-between">
                    <span>세금계산서</span>
                    <b>{currentSettlementStatus?.taxInvoiceIssuedAt ?? "-"}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>정산 계좌</span>
                    <b>
                      {dealer?.bankName || dealer?.bankAccountNumber
                        ? `${dealer.bankName ?? "-"} ${dealer.bankAccountNumber ?? "-"}`
                        : "-"}
                    </b>
                  </div>
                </div>
              )}
              <div className="mt-6 space-y-3 border-b pb-5 text-sm">
                {!hideReferenceMetrics && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-500">일반 납입 수익</span>
                      <b>{won(calculations.paymentRevenue)}</b>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">구매수익</span>
                      <b>{won(calculations.purchaseRevenue)}</b>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">할부구매수익</span>
                      <b>{won(calculations.installmentRevenue)}</b>
                    </div>
                    {calculations.usesVanSettlement && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">VAN피 수익</span>
                        <b>{won(calculations.vanFeeRevenue)}</b>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-slate-500">총 수익</span>
                      <b>{won(calculations.revenue)}</b>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">{profitSettlementLabel}</span>
                  <b className="text-emerald-700">
                    +{won(calculations.dealerProfit)}
                  </b>
                </div>
              </div>
              <div className="space-y-3 border-b py-5 text-sm">
                {!hideReferenceMetrics && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">설치 원가</span>
                    <b>{won(calculations.cost)}</b>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500">{costSettlementLabel}</span>
                  <b className="text-orange-700">
                    -{won(calculations.dealerCost)}
                  </b>
                </div>
              </div>
              <div className="mt-5 rounded-2xl bg-[#0f2747] p-5 text-white">
                <p className="text-xs text-blue-200">최종 정산 계산</p>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between text-blue-100">
                    <span>정산 공급가액</span>
                    <b>{won(calculations.settlementSupply)}</b>
                  </div>
                  <div className="flex justify-between text-blue-100">
                    <span>VAT</span>
                    <b>{won(calculations.settlementVat)}</b>
                  </div>
                  <div className="flex justify-between">
                    <span>VAT 포함 정산액</span>
                    <b>{won(calculations.settlementWithVat)}</b>
                  </div>
                  {rangeMode === "year" && (
                    <div className="flex justify-between text-blue-100">
                      <span>전년도 이월</span>
                      <b>
                        {calculations.carryover < 0
                          ? `-${won(Math.abs(calculations.carryover))}`
                          : won(0)}
                      </b>
                    </div>
                  )}
                  {dealer?.advanceEnabled && (
                    <div className="flex justify-between text-orange-200">
                      <span>선지급 차감</span>
                      <b>-{won(calculations.advance)}</b>
                    </div>
                  )}
                </div>
                <div className="mt-4 border-t border-white/15 pt-4">
                  <p className="text-xs text-blue-200">
                    {finalSettlementLabel}
                    {showSettlementDirection ? ` · ${settlementDirection}` : ""}
                  </p>
                  <p className="mt-2 text-3xl font-extrabold">
                    {won(calculations.finalSettlement)}
                  </p>
                </div>
              </div>
              </aside>
            </div>
          </TabsContent>
          <TabsContent value="settlementInfo">
            <section className="panel overflow-hidden">
              <div className="panel-head">
                <div>
                  <h3>정산정보 모아보기</h3>
                  <p>
                    {dealer?.name} · {range.label} · 납입 수익은 납입일자
                    기준으로 집계합니다.
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table className="whitespace-nowrap">
                  <TableHeader>
                    <TableRow>
                      <TableHead>정산월</TableHead>
                      <TableHead>정산일자</TableHead>
                      <TableHead>지급여부</TableHead>
                      <TableHead>세금계산서</TableHead>
                      <TableHead>정산 계좌</TableHead>
                      {showSettlementDirection && (
                        <TableHead>정산 방향</TableHead>
                      )}
                      {!hideReferenceMetrics && (
                        <>
                          <TableHead className="text-right">납입 수익</TableHead>
                          <TableHead className="text-right">제품 수익</TableHead>
                          {calculations.usesVanSettlement && (
                            <TableHead className="text-right">VAN피</TableHead>
                          )}
                        </>
                      )}
                      <TableHead className="text-right">
                        {costSettlementLabel}
                      </TableHead>
                      <TableHead className="text-right">정산 공급가액</TableHead>
                      <TableHead className="text-right">VAT</TableHead>
                      <TableHead className="text-right">VAT 포함 정산액</TableHead>
                      {dealer?.advanceEnabled && (
                        <TableHead className="text-right">선지급</TableHead>
                      )}
                      <TableHead className="text-right">
                        최종 {finalSettlementLabel}
                      </TableHead>
                      {data.access.role === "admin" && <TableHead />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calculations.monthDetails.map((item) => {
                      const status = settlementStatusFor(item.month);
                      const itemDirection = settlementSummaryLabel(
                        item.finalSettlement,
                      );
                      return (
                        <TableRow key={item.month}>
                          <TableCell className="font-semibold">
                            {item.month}
                          </TableCell>
                          <TableCell>{status?.settlementDate ?? "-"}</TableCell>
                          <TableCell>
                            {status?.paid ? (
                              <Badge className="bg-emerald-50 text-emerald-700">
                                지급완료
                              </Badge>
                            ) : (
                              <Badge variant="outline">미지급</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {status?.taxInvoiceIssuedAt ?? "-"}
                          </TableCell>
                          <TableCell>
                            {dealer?.bankName || dealer?.bankAccountNumber
                              ? `${dealer.bankName ?? "-"} ${dealer.bankAccountNumber ?? "-"}`
                              : "-"}
                          </TableCell>
                          {showSettlementDirection && (
                            <TableCell>{itemDirection}</TableCell>
                          )}
                          {!hideReferenceMetrics && (
                            <>
                              <TableCell className="text-right">
                                {won(item.paymentRevenue)}
                              </TableCell>
                              <TableCell className="text-right">
                                {won(item.purchaseRevenue + item.installmentRevenue)}
                              </TableCell>
                              {calculations.usesVanSettlement && (
                                <TableCell className="text-right">
                                  {won(item.vanFeeRevenue)}
                                </TableCell>
                              )}
                            </>
                          )}
                          <TableCell className="text-right">
                            {won(item.dealerCost)}
                          </TableCell>
                          <TableCell className="text-right">
                            {won(item.settlementSupply)}
                          </TableCell>
                          <TableCell className="text-right">
                            {won(item.settlementVat)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {won(item.settlementWithVat)}
                          </TableCell>
                          {dealer?.advanceEnabled && (
                            <TableCell className="text-right">
                              {won(item.advance)}
                            </TableCell>
                          )}
                          <TableCell
                            className={`text-right font-bold ${
                              item.finalSettlement < 0
                                ? "text-red-700"
                                : "text-blue-700"
                            }`}
                          >
                            {won(item.finalSettlement)}
                          </TableCell>
                          {data.access.role === "admin" && dealerId !== null && (
                            <TableCell className="text-right">
                              <MonthlySettlementStatusDialog
                                dealerId={dealerId}
                                settlementMonth={item.month}
                                status={status}
                                onSaved={setData}
                              />
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </section>
          </TabsContent>
          <TabsContent value="merchants">
            <section className="panel overflow-hidden">
              <div className="panel-head">
                <div>
                  <h3>가맹점 및 납부자번호</h3>
                  <p>
                    Salesforce 가맹점·문의제품과 여러 납부자번호를 함께
                    관리합니다. 할부구매 제품에는 납부자번호가 필요하지
                    않습니다.
                  </p>
                </div>
                {data.access.role === "admin" && dealerId !== null && (
                  <div className="flex flex-wrap gap-2">
                    <MerchantImportDialog
                      dealerId={dealerId}
                      onSaved={setData}
                    />
                  </div>
                )}
              </div>
              <div className="border-t border-slate-100 px-5 py-3">
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={merchantSearch}
                    onChange={(event) => {
                      setMerchantSearch(event.target.value);
                      setMerchantPage(1);
                      setSettlementMerchantPage(1);
                    }}
                    placeholder="가맹점명, 사업자번호, 설치제품 검색"
                    className="h-10 rounded-xl pl-9"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {data.access.role === "admin" && (
                        <TableHead className="w-12">
                          <Checkbox
                            aria-label="현재 페이지 가맹점 전체 선택"
                            checked={
                              allOnPageSelected
                                ? true
                                : selectedOnPage.length > 0
                                  ? "indeterminate"
                                  : false
                            }
                            onCheckedChange={(checked) => {
                              const pageIds = managedMerchantRows.map(
                                (merchant) => merchant.id,
                              );
                              setSelectedMerchantIds((current) =>
                                checked === true
                                  ? [...new Set([...current, ...pageIds])]
                                  : current.filter((id) => !pageIds.includes(id)),
                              );
                            }}
                          />
                        </TableHead>
                      )}
                      <TableHead>가맹점</TableHead>
                      {hasMerchantListColumn("van") && <TableHead>VAN</TableHead>}
                      {hasMerchantListColumn("transactionClassification") && (
                        <TableHead>거래구분</TableHead>
                      )}
                      {hasMerchantListColumn("installDate") && (
                        <TableHead>최초 설치일</TableHead>
                      )}
                      {hasMerchantListColumn("accountStatus") && (
                        <TableHead>사업장 상태</TableHead>
                      )}
                      {hasMerchantListColumn("installedProducts") && (
                        <TableHead>설치 제품</TableHead>
                      )}
                      {hasMerchantListColumn("installationCost") && (
                        <TableHead className="text-right">설치 원가</TableHead>
                      )}
                      {hasMerchantListColumn("monthlyCharge") && (
                        <TableHead className="text-right">월 청구액</TableHead>
                      )}
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {managedMerchantRows.map((merchant) => {
                        const payers = data.payerAccounts.filter(
                          (p) => p.merchantId === merchant.id,
                        );
                        const items = data.installations.filter(
                          (i) => i.merchantId === merchant.id,
                        );
                        const vans = vansFor(merchant.id);
                        const classifications = [
                          ...new Set(
                            items
                              .map((item) => item.transactionClassification)
                              .filter(
                                (value): value is string =>
                                  typeof value === "string" &&
                                  value.trim().length > 0,
                              ),
                          ),
                        ];
                        const itemSummary = items
                          .map(
                            (item) =>
                              `${productName(item.productId)} ${item.condition} ${item.quantity}대${item.salesAmount ? ` · 공급가액 ${won(item.salesAmount)}` : ""}`,
                          )
                          .join(", ");
                        const installationCost = items.reduce(
                          (sum, item) =>
                            sum + item.unitCostSnapshot * item.quantity,
                          0,
                        );
                        const missingCostCount = items.filter(
                          (item) => !item.unitCostRegistered,
                        ).length;
                        return (
                          <TableRow
                            key={merchant.id}
                            className="cursor-pointer"
                            onClick={() =>
                              (location.href = merchantDetailPath(merchant.id))
                            }
                          >
                            {data.access.role === "admin" && (
                              <TableCell
                                onClick={(event) => event.stopPropagation()}
                              >
                                <Checkbox
                                  aria-label={`${merchant.name} 선택`}
                                  checked={selectedMerchantIdSet.has(merchant.id)}
                                  onCheckedChange={(checked) =>
                                    setSelectedMerchantIds((current) =>
                                      checked === true
                                        ? [...new Set([...current, merchant.id])]
                                        : current.filter(
                                            (id) => id !== merchant.id,
                                          ),
                                    )
                                  }
                                />
                              </TableCell>
                            )}
                            <TableCell>
                              <b>{merchant.name}</b>
                              <div className="text-xs text-slate-500">
                                {merchant.businessNumber}
                              </div>
                            </TableCell>
                            {hasMerchantListColumn("van") && (
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {vans.map((van) => (
                                    <Badge variant="outline" key={van}>
                                      {van}
                                    </Badge>
                                  ))}
                                  {!vans.length && "-"}
                                </div>
                              </TableCell>
                            )}
                            {hasMerchantListColumn("transactionClassification") && (
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {classifications.map((classification) => (
                                    <Badge
                                      variant="outline"
                                      key={classification}
                                    >
                                      {classification}
                                    </Badge>
                                  ))}
                                  {!classifications.length && "-"}
                                </div>
                              </TableCell>
                            )}
                            {hasMerchantListColumn("installDate") && (
                              <TableCell>
                                {merchant.installDate || "미입력"}
                              </TableCell>
                            )}
                            {hasMerchantListColumn("accountStatus") && (
                              <TableCell>
                                {merchant.accountStatus ? (
                                  <Badge variant="outline">
                                    {merchant.accountStatus}
                                  </Badge>
                                ) : (
                                  "-"
                                )}
                              </TableCell>
                            )}
                            {hasMerchantListColumn("installedProducts") && (
                              <TableCell>
                                <div
                                  className="max-w-[320px] truncate"
                                  title={itemSummary}
                                >
                                  {itemSummary || "-"}
                                </div>
                              </TableCell>
                            )}
                            {hasMerchantListColumn("installationCost") && (
                              <TableCell className="text-right font-semibold">
                                {won(installationCost)}
                                {missingCostCount > 0 ? (
                                  <div className="mt-1">
                                    <Badge className="bg-red-50 text-red-700">
                                      원가 미등록 {missingCostCount}건
                                    </Badge>
                                  </div>
                                ) : null}
                              </TableCell>
                            )}
                            {hasMerchantListColumn("monthlyCharge") && (
                              <TableCell className="text-right font-semibold">
                                {won(
                                  payers.reduce(
                                    (sum, p) => sum + p.monthlyCharge,
                                    0,
                                  ),
                                )}
                              </TableCell>
                            )}
                            <TableCell className="whitespace-nowrap">
                              <div
                                className="flex items-center justify-end gap-1"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`${merchant.name} 상세 보기`}
                                  onClick={() =>
                                    (location.href = merchantDetailPath(merchant.id))
                                  }
                                >
                                  <ChevronRight className="size-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    {!managedMerchantRows.length && (
                      <TableRow>
                        <TableCell
                          colSpan={data.access.role === "admin" ? 9 : 8}
                          className="h-24 text-center text-slate-500"
                        >
                          검색 결과에 맞는 가맹점이 없습니다.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <PageControls
                page={safeMerchantPage}
                totalPages={merchantPages}
                onChange={setMerchantPage}
                actions={
                  data.access.role === "admin" ? (
                    <DeleteConfirmButton
                      disabled={!selectedMerchantIds.length}
                      title={`선택한 가맹점 ${selectedMerchantIds.length}곳을 삭제할까요?`}
                      description="선택한 가맹점의 설치 제품, 납부자번호, 납입내역과 정산 내역도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다."
                      onConfirm={async () => {
                        const result = await post({
                          action: "deleteMerchants",
                          merchantIds: selectedMerchantIds,
                        });
                        setData(result);
                        setSelectedMerchantIds([]);
                        toast.success("선택한 가맹점을 삭제했습니다.");
                      }}
                    />
                  ) : undefined
                }
              />
            </section>
          </TabsContent>
          <TabsContent value="payments">
            <section className="panel overflow-hidden">
              <div className="panel-head">
                <div>
                  <h3>Excel 등록 납입내역</h3>
                  <p>
                    청구월은 미납·완납 처리에, 납입일자는 정산월 계산에
                    사용합니다.
                  </p>
                </div>
                {data.access.role !== "viewer" && (
                  <ImportDialog data={data} onSaved={setData} />
                )}
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {data.access.role === "admin" && (
                        <TableHead className="w-12">
                          <Checkbox
                            aria-label="현재 기간 납입 내역 전체 선택"
                            checked={selectionState(
                              selectedPaymentIds,
                              visiblePaymentIds,
                            )}
                            onCheckedChange={(checked) =>
                              setSelectedPaymentIds((current) =>
                                updateSelectedIds(
                                  current,
                                  visiblePaymentIds,
                                  checked === true,
                                ),
                              )
                            }
                          />
                        </TableHead>
                      )}
                      <TableHead>청구월</TableHead>
                      <TableHead>납부일자</TableHead>
                      <TableHead>가맹점</TableHead>
                      <TableHead>납부자번호</TableHead>
                      <TableHead className="text-right">납부금액</TableHead>
                      <TableHead className="text-right">공급가액</TableHead>
                      <TableHead className="text-right">VAT</TableHead>
                      <TableHead>파일</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calculations.rangePayments.map((payment) => {
                      const payer = data.payerAccounts.find(
                        (p) => p.id === payment.payerAccountId,
                      );
                      return (
                        <TableRow key={payment.id}>
                          {data.access.role === "admin" && (
                            <TableCell>
                              <Checkbox
                                aria-label={`${payment.billingMonth} ${merchantName(payment.merchantId)} 납입 내역 선택`}
                                checked={selectedPaymentIds.includes(payment.id)}
                                onCheckedChange={(checked) =>
                                  setSelectedPaymentIds((current) =>
                                    updateSelectedIds(
                                      current,
                                      [payment.id],
                                      checked === true,
                                    ),
                                  )
                                }
                              />
                            </TableCell>
                          )}
                          <TableCell>{payment.billingMonth}</TableCell>
                          <TableCell>{payment.paymentDate}</TableCell>
                          <TableCell className="font-semibold">
                            {merchantName(payment.merchantId)}
                          </TableCell>
                          <TableCell className="font-mono">
                            {payer?.payerNumber}
                          </TableCell>
                          <TableCell className="text-right">
                            {won(payment.grossAmount)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {won(payment.supplyAmount)}
                          </TableCell>
                          <TableCell className="text-right text-slate-500">
                            {won(payment.vatAmount)}
                          </TableCell>
                          <TableCell className="max-w-36 truncate text-xs text-slate-500">
                            {payment.sourceFile}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {data.access.role === "admin" && (
                <PageControls
                  page={1}
                  totalPages={1}
                  onChange={() => undefined}
                  actions={
                    <DeleteConfirmButton
                      disabled={!selectedPaymentIds.length}
                      title={`선택한 납입 내역 ${selectedPaymentIds.length}건을 삭제할까요?`}
                      description="선택한 납입 내역이 삭제되며 실제 납부액과 정산 금액도 다시 계산됩니다."
                      onConfirm={async () => {
                        const result = await post({
                          action: "deletePayments",
                          paymentIds: selectedPaymentIds,
                        });
                        setData(result);
                        setSelectedPaymentIds([]);
                        toast.success("선택한 납입 내역을 삭제했습니다.");
                      }}
                    />
                  }
                />
              )}
            </section>
          </TabsContent>
          {activeTab === "costs" && data.access.role === "admin" && (
            <section className="panel overflow-hidden">
              <div className="panel-head">
                <div>
                  <h3>제품 원가 이력</h3>
                  <p>
                    모델명·신품/중고별 적용기간과 VAT 별도 원가를 관리합니다.
                  </p>
                </div>
                {data.access.role === "admin" && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => downloadProductCosts(data)}
                    >
                      <Download /> Excel 다운로드
                    </Button>
                    <ProductCostImportDialog data={data} onSaved={setData} />
                    <CostDialog data={data} onSaved={setData} />
                    <CategoryCostDialog data={data} onSaved={setData} />
                  </div>
                )}
              </div>
              <div className="border-t border-slate-100 px-5 py-3">
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={costSearch}
                    onChange={(event) => setCostSearch(event.target.value)}
                    placeholder="제품명, 상태, 적용일, 원가 검색"
                    className="h-10 rounded-xl pl-9"
                  />
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {data.access.role === "admin" && (
                        <TableHead className="w-12">
                          <Checkbox
                            aria-label="등록된 제품원가 전체 선택"
                            checked={selectionState(
                              selectedCostRefs,
                              visibleCostRefs,
                            )}
                            onCheckedChange={(checked) =>
                              setSelectedCostRefs((current) =>
                                updateSelectedIds(
                                  current,
                                  visibleCostRefs,
                                  checked === true,
                                ),
                              )
                            }
                          />
                        </TableHead>
                      )}
                      <TableHead>제품</TableHead>
                      <TableHead>적용 딜러</TableHead>
                      <TableHead>제품 상태</TableHead>
                      <TableHead>적용기간</TableHead>
                      <TableHead className="text-right">
                        원가 공급가액
                      </TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          직접 입력
                          <InfoTooltip label="직접 입력 원가 안내">
                            가맹점별로 같은 제품·상태라도 실제 원가가 다른
                            경우에만 선택합니다. 선택한 설치 건에는 제품
                            원가표 대신 해당 가맹점에 입력한 원가가 적용됩니다.
                          </InfoTooltip>
                        </span>
                      </TableHead>
                      <TableHead>상태</TableHead>
                      {data.access.role === "admin" && <TableHead></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searchedCostTableRows.map((row) => {
                      const { product, cost, dealerCost, endDate } = row;
                      const displayCost = rowCost(row);
                      const selectionRef = productCostRef(row);
                      return (
                      <TableRow
                        key={
                          displayCost
                            ? `${row.scopeDealerId ?? "all"}-${displayCost.id}`
                            : `product-${product.id}`
                        }
                      >
                        {data.access.role === "admin" && (
                          <TableCell>
                            {selectionRef && displayCost ? (
                              <Checkbox
                                aria-label={`${product.name} ${displayCost.condition} ${displayCost.effectiveFrom} 원가 선택`}
                                checked={selectedCostRefs.includes(selectionRef)}
                                onCheckedChange={(checked) =>
                                  setSelectedCostRefs((current) =>
                                    updateSelectedIds(
                                      current,
                                      [selectionRef],
                                      checked === true,
                                    ),
                                  )
                                }
                              />
                            ) : null}
                          </TableCell>
                        )}
                        <TableCell className="font-semibold">
                          {product.name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {dealerCostScopeLabel(data, row.scopeDealerId)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {displayCost?.condition ?? "신품"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {displayCost ? (
                            <>
                              <span className="font-medium">
                                {displayCost.effectiveFrom}
                              </span>
                              <span className="mx-2 text-slate-400">~</span>
                              <span>{endDate ?? "현재"}</span>
                            </>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className="text-right font-bold">
                          {displayCost ? won(displayCost.unitCost) : "-"}
                        </TableCell>
                        <TableCell>
                          {data.access.role === "admin" ? (
                            <Checkbox
                              aria-label={`${product.name} 직접 입력 가능 여부`}
                              checked={product.directCostAllowed}
                              onCheckedChange={(checked) =>
                                toggleProductDirectCost(product, checked === true)
                              }
                            />
                          ) : product.directCostAllowed ? (
                            <Badge variant="outline">가능</Badge>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>
                          {!displayCost ? (
                            <Badge className="bg-red-50 text-red-700">
                              원가 미등록
                            </Badge>
                          ) : (
                            <Badge className="bg-blue-50 text-[#175cd3]">
                              현재 원가
                            </Badge>
                          )}
                        </TableCell>
                        {data.access.role === "admin" && (
                          <TableCell className="text-right">
                            <ProductCostHistoryDialog
                              data={data}
                              product={product}
                              scopeDealerId={row.scopeDealerId}
                              onSaved={setData}
                            />
                            <ProductCostEditDialog
                              data={data}
                              product={product}
                              cost={cost ?? undefined}
                              dealerCost={dealerCost ?? undefined}
                              onSaved={setData}
                            />
                          </TableCell>
                        )}
                      </TableRow>
                      );
                    })}
                    {!searchedCostTableRows.length && (
                      <TableRow>
                        <TableCell
                          colSpan={data.access.role === "admin" ? 9 : 8}
                          className="h-24 text-center text-slate-500"
                        >
                          검색 결과에 맞는 제품 원가가 없습니다.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {data.access.role === "admin" && (
                <PageControls
                  page={1}
                  totalPages={1}
                  onChange={() => undefined}
                  actions={
                    <div className="flex flex-wrap justify-end gap-2">
                      <ProductCostBulkDealerDialog
                        data={data}
                        selectedRefs={selectedCostRefs}
                        onSaved={setData}
                        onClear={() => setSelectedCostRefs([])}
                      />
                      <DeleteConfirmButton
                        disabled={!selectedCostRefs.length}
                        title={`선택한 제품원가 ${selectedCostRefs.length}건을 삭제할까요?`}
                        description="선택한 원가 이력이 삭제되며 해당 제품의 기존 설치 원가도 남아 있는 적용기간을 기준으로 다시 계산됩니다."
                        onConfirm={async () => {
                          const ids = productCostRefIds(selectedCostRefs);
                          const result = await post({
                            action: "deleteProductCosts",
                            ...ids,
                          });
                          setData(result);
                          setSelectedCostRefs([]);
                          toast.success("선택한 제품원가를 삭제했습니다.");
                        }}
                      />
                    </div>
                  }
                />
              )}
              <div className="border-t border-slate-100 px-5 py-4">
                <div className="mb-3">
                  <h4 className="font-semibold">딜러별 제품군 원가</h4>
                  <p className="mt-1 text-xs text-slate-500">
                    특정 딜러에게 제품군 단위로 적용되는 VAT 별도 원가입니다.
                    제품별 딜러 원가가 있으면 제품별 원가가 먼저 적용됩니다.
                  </p>
                </div>
                <div className="overflow-x-auto rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>적용 딜러</TableHead>
                        <TableHead>제품군</TableHead>
                        <TableHead>제품 상태</TableHead>
                        <TableHead>적용 시작일</TableHead>
                        <TableHead className="text-right">
                          원가 공급가액
                        </TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {searchedCategoryCostRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <Badge variant="outline">
                              {dealerCostScopeLabel(data, row.dealerId)}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-semibold">
                            {row.productCategory}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{row.condition}</Badge>
                          </TableCell>
                          <TableCell>{row.effectiveFrom}</TableCell>
                          <TableCell className="text-right font-bold">
                            {won(row.unitCost)}
                          </TableCell>
                          <TableCell className="text-right">
                            <CategoryCostDialog
                              data={data}
                              categoryCost={row}
                              onSaved={setData}
                            />
                            <DeleteConfirmButton
                              title="제품군 원가를 삭제할까요?"
                              description="삭제하면 해당 딜러의 제품군 설치 원가는 남아 있는 제품별/공통 원가 기준으로 다시 계산됩니다."
                              onConfirm={async () => {
                                const result = await post({
                                  action: "deleteDealerCategoryCost",
                                  dealerCategoryCostId: row.id,
                                });
                                setData(result);
                                toast.success("제품군 원가를 삭제했습니다.");
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                      {!searchedCategoryCostRows.length && (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="h-20 text-center text-slate-500"
                          >
                            등록된 딜러별 제품군 원가가 없습니다.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </section>
          )}
          {activeTab === "dealers" && data.access.role === "admin" && (
            <div className="grid gap-5">
              <section className="panel overflow-hidden">
                <div className="panel-head">
                  <div>
                    <h3>딜러 목록 및 Salesforce 설정</h3>
                    <p>
                      딜러 이름에 대응하는 Account.ManagingFranchise__c 값과
                      기간별 정산율을 관리합니다.
                    </p>
                  </div>
                  <DealerDialog data={data} onSaved={setData} />
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>딜러</TableHead>
                        <TableHead>Salesforce 매칭값</TableHead>
                        <TableHead>정산 계좌</TableHead>
                        <TableHead>선지급</TableHead>
                        <TableHead>정산 방식</TableHead>
                        <TableHead>VAN 실적</TableHead>
                        <TableHead>최근 적용일</TableHead>
                        <TableHead className="text-right">
                          원가 부담률
                        </TableHead>
                        <TableHead className="text-right">
                          수익 배분률
                        </TableHead>
                        <TableHead>상태</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.dealers.map((item) => {
                        const rule = data.rules
                          .filter((row) => row.dealerId === item.id)
                          .sort((a, b) =>
                            b.effectiveFrom.localeCompare(a.effectiveFrom),
                          )[0];
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="font-semibold">
                              {item.name}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {item.salesforceManagerValue || item.name}
                            </TableCell>
                            <TableCell>
                              {item.bankName || item.bankAccountNumber ? (
                                <>
                                  <b>{item.bankName || "-"}</b>
                                  <div className="text-xs text-slate-500">
                                    {item.bankAccountNumber || "-"}
                                  </div>
                                </>
                              ) : (
                                "-"
                              )}
                            </TableCell>
                            <TableCell>
                              {item.advanceEnabled ? (
                                <Badge className="bg-blue-50 text-[#175cd3]">
                                  사용
                                </Badge>
                              ) : (
                                <Badge variant="outline">미사용</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {item.flatCommissionEnabled ? (
                                <Badge className="bg-sky-50 text-sky-700">
                                  정액 수당
                                </Badge>
                              ) : (
                                <Badge variant="outline">정산율</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {item.vanSettlementEnabled ? (
                                <Badge className="bg-blue-50 text-[#175cd3]">
                                  사용
                                </Badge>
                              ) : (
                                <Badge variant="outline">미사용</Badge>
                              )}
                            </TableCell>
                            <TableCell>{rule?.effectiveFrom || "-"}</TableCell>
                            <TableCell className="text-right">
                              {rule ? `${rule.costShareRate}%` : "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              {rule ? `${rule.profitShareRate}%` : "-"}
                            </TableCell>
                            <TableCell>
                              {item.active ? (
                                <Badge className="bg-emerald-50 text-emerald-700">
                                  활성
                                </Badge>
                              ) : (
                                <Badge variant="outline">비활성</Badge>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right">
                              <DealerDialog
                                data={data}
                                dealerId={item.id}
                                onSaved={setData}
                              />
                              <DealerSettlementSettingsDialog
                                data={data}
                                dealerId={item.id}
                                onSaved={setData}
                              />
                              <RuleDialog
                                dealerId={item.id}
                                onSaved={setData}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </section>
              {dealer?.advanceEnabled && dealerId !== null && (
                <section className="panel overflow-hidden">
                  <div className="panel-head">
                    <div>
                      <h3>{dealer.name} 선지급 내역</h3>
                      <p>
                        딜러에게 미리 지급한 금액은 해당 기간 정산에서
                        마이너스로 차감됩니다.
                      </p>
                    </div>
                    <AdvanceDialog
                      dealerId={dealerId}
                      defaultMonth={range.start}
                      onSaved={setData}
                    />
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>정산월</TableHead>
                          <TableHead>지급일자</TableHead>
                          <TableHead>메모</TableHead>
                          <TableHead className="text-right">선지급액</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.advancePayments
                          .filter((item) => item.dealerId === dealerId)
                          .map((item) => (
                            <TableRow key={item.id}>
                              <TableCell>{item.settlementMonth}</TableCell>
                              <TableCell>{item.paymentDate}</TableCell>
                              <TableCell>{item.memo || "-"}</TableCell>
                              <TableCell className="text-right font-bold text-orange-700">
                                -{won(item.amount)}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right">
                                <AdvanceDialog
                                  dealerId={dealerId}
                                  defaultMonth={range.start}
                                  advance={item}
                                  onSaved={setData}
                                />
                                <DeleteConfirmButton
                                  title="선지급 내역을 삭제할까요?"
                                  description={`${item.settlementMonth} 정산월의 ${item.paymentDate} 지급 선지급 ${won(item.amount)} 내역이 삭제되며 정산 계산에서도 제외됩니다.`}
                                  onConfirm={async () => {
                                    const result = await post({
                                      action: "deleteAdvancePayment",
                                      advancePaymentId: item.id,
                                    });
                                    setData(result);
                                    toast.success("선지급 내역을 삭제했습니다.");
                                  }}
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}
            </div>
          )}
          {activeTab === "members" && data.access.role === "admin" && (
            <div>
              <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
                <div className="panel overflow-hidden">
                  <div className="panel-head">
                    <div>
                      <h3>딜러별 접근 계정</h3>
                      <p>로그인 이메일과 딜러를 1:1로 연결합니다.</p>
                    </div>
                    <MemberDialog data={data} onSaved={setData} />
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>이메일</TableHead>
                        <TableHead>권한</TableHead>
                        <TableHead>연결 딜러</TableHead>
                        <TableHead>상태</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.members.map((member) => (
                        <TableRow key={member.id}>
                          <TableCell className="font-medium">
                            {member.email}
                          </TableCell>
                          <TableCell>
                            {member.role === "admin" ? "관리자" : "딜러"}
                          </TableCell>
                          <TableCell>
                            {member.role === "admin"
                              ? "전체"
                              : data.dealers.find(
                                  (d) => d.id === member.dealerId,
                                )?.name}
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-emerald-50 text-emerald-700">
                              사용 중
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <aside className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
                  <ShieldCheck className="text-[#175cd3]" />
                  <h3 className="mt-4 font-bold">딜러 데이터 분리</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    딜러 계정은 화면뿐 아니라 서버 조회와 저장에서도 연결된
                    딜러의 가맹점·납입·정산 데이터만 접근합니다.
                  </p>
                </aside>
              </section>
            </div>
          )}
        </Tabs>
      </div>
      </main>
    </TooltipProvider>
  );
}
