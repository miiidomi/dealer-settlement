"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Boxes,
  CalendarRange,
  CheckCircle2,
  CircleDollarSign,
  Plus,
  ReceiptText,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  DashboardData,
  MerchantDetailBillingColumnKey,
  MerchantDetailFieldKey,
  MerchantDetailInstallationColumnKey,
  MerchantDetailPayerColumnKey,
  merchantDetailBillingColumnsFor,
  merchantDetailFieldsFor,
  merchantDetailInstallationColumnsFor,
  merchantDetailPayerColumnsFor,
  monthsBetween,
  payerActiveInMonth,
  purchaseLabels,
  won,
} from "../../types";
import { installmentRevenue as eligibleInstallmentRevenue } from "../../installment-settlement";

const LIST_RETURN_STORAGE_KEY = "dealerSettlement:listReturnTo";

type SalesforceProductOption = {
  id: string;
  name: string;
  family: string | null;
  condition: "신품" | "중고" | null;
};

function normalizeProductName(value: unknown) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function initialDetailParam(name: string) {
  if (typeof window === "undefined") return "";
  const current = new URLSearchParams(window.location.search).get(name);
  if (current) return current;
  const stored = window.sessionStorage.getItem(LIST_RETURN_STORAGE_KEY);
  if (!stored?.startsWith("/")) return "";
  try {
    return new URL(stored, window.location.origin).searchParams.get(name) ?? "";
  } catch {
    return "";
  }
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

function PaymentStatus({
  status,
  date,
}: {
  status: string | null;
  date: string | null;
}) {
  if (status === "미입금")
    return (
      <div className="space-y-1">
        <Badge className="bg-red-50 text-red-700">미입금</Badge>
        <div className="text-xs text-slate-500">입금일자: {date || "-"}</div>
      </div>
    );
  if (status === "입금완료")
    return (
      <div className="space-y-1">
        <Badge className="bg-emerald-50 text-emerald-700">입금완료</Badge>
        <div className="text-xs text-slate-500">입금일자: {date || "-"}</div>
      </div>
    );
  return <span className="text-xs text-slate-400">미확인</span>;
}

async function post(body: Record<string, unknown>) {
  const response = await fetch("/api/dashboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "저장하지 못했습니다.");
  return result as DashboardData;
}

function DeleteConfirmButton({
  title,
  description,
  onConfirm,
}: {
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Trash2 className="size-4" />
          삭제
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void onConfirm()}
            >
              삭제
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PayerDialog({
  merchantId,
  onSaved,
}: {
  merchantId: number;
  onSaved: (data: DashboardData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("rental");
  const currentMonth = new Date().toISOString().slice(0, 7);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "createPayerAccount",
          merchantId,
          ...form,
          billingType: type,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onSaved(result);
      setOpen(false);
      toast.success("납부자번호가 추가되었습니다.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "저장하지 못했습니다.",
      );
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          납부자번호 추가
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>납부자번호 추가</DialogTitle>
            <DialogDescription>
              한 가맹점에 여러 번호를 등록할 수 있습니다. 월 청구금액은 VAT 별도
              공급가액으로 입력합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="납부자번호">
              <Input name="payerNumber" required />
            </Field>
            <Field label="구분명">
              <Input name="label" placeholder="예: POS 임대" />
            </Field>
            <Field label="월 청구 공급가액">
              <Input name="monthlyCharge" type="number" min="0" required />
            </Field>
            <Field label="청구 유형">
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="h-10 rounded-md border bg-white px-3"
              >
                <option value="rental">임대</option>
                <option value="purchase">일시불 구매</option>
                <option value="installment">할부 구매</option>
              </select>
            </Field>
            {type === "installment" && (
              <Field label="할부 개월">
                <Input
                  name="installmentMonths"
                  type="number"
                  min="1"
                  required
                />
              </Field>
            )}
            <Field label="청구 시작월">
              <Input
                name="startMonth"
                type="month"
                defaultValue={currentMonth}
                required
              />
            </Field>
            <Field label="청구 종료월">
              <Input name="endMonth" type="month" />
            </Field>
          </div>
          <DialogFooter>
            <Button>납부자번호 저장</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InstallationCostDialog({
  productId,
  productName,
  condition,
  installDate,
  dealers,
  defaultDealerId,
  onSaved,
}: {
  productId: number;
  productName: string;
  condition: string;
  installDate: string;
  dealers: DashboardData["dealers"];
  defaultDealerId: number;
  onSaved: (data: DashboardData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedDealerId, setSelectedDealerId] = useState(
    String(defaultDealerId),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: selectedDealerId ? "saveDealerProductCost" : "createCost",
          productId,
          condition,
          dealerIds: selectedDealerId ? [Number(selectedDealerId)] : [],
          ...Object.fromEntries(new FormData(event.currentTarget)),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onSaved(result);
      setOpen(false);
      toast.success("제품 원가를 등록하고 설치 건에 반영했습니다.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "제품 원가를 등록하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setSelectedDealerId(String(defaultDealerId));
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          원가 등록
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>설치 제품 원가 등록</DialogTitle>
            <DialogDescription>
              적용 딜러를 선택해 저장하면 해당 딜러의 같은 제품·상태 설치
              건에 적용일 기준으로 원가가 자동 반영됩니다.
            </DialogDescription>
          </DialogHeader>
          <Field label="제품">
            <Input value={productName} disabled />
          </Field>
          <Field label="제품 상태">
            <Input value={condition} disabled />
          </Field>
          <Field label="적용 딜러">
            <select
              value={selectedDealerId}
              onChange={(event) => setSelectedDealerId(event.target.value)}
              className="h-10 rounded-md border bg-white px-3"
            >
              <option value="">전체 딜러 공통</option>
              {dealers
                .filter((dealer) => dealer.active)
                .map((dealer) => (
                  <option key={dealer.id} value={dealer.id}>
                    {dealer.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="원가 공급가액">
            <Input name="unitCost" type="number" min="0" required />
          </Field>
          <Field label="적용 시작일">
            <Input
              name="effectiveFrom"
              type="date"
              defaultValue={installDate}
              required
            />
          </Field>
          <DialogFooter>
            <Button disabled={busy}>
              {busy ? "저장 중…" : "원가 등록"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InstallationDialog({
  merchantId,
  defaultInstallDate,
  products,
  onSaved,
  installation,
}: {
  merchantId: number;
  defaultInstallDate: string;
  products: DashboardData["products"];
  onSaved: (data: DashboardData) => void;
  installation?: DashboardData["installations"][number];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [classification, setClassification] = useState(
    installation?.transactionClassification ?? "구매",
  );
  const [selectedProductId, setSelectedProductId] = useState(
    installation?.productId ? String(installation.productId) : "",
  );
  const [selectedCondition, setSelectedCondition] = useState(
    installation?.condition ?? "신품",
  );
  const [productQuery, setProductQuery] = useState("");
  const [productOptions, setProductOptions] = useState<
    SalesforceProductOption[]
  >([]);
  const [selectedSalesforceProduct, setSelectedSalesforceProduct] =
    useState<SalesforceProductOption | null>(null);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [productSearchError, setProductSearchError] = useState("");
  const selectedProduct = products.find(
    (product) => String(product.id) === selectedProductId,
  );
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
  function chooseSalesforceProduct(product: SalesforceProductOption) {
    setSelectedSalesforceProduct(product);
    setProductQuery(product.name);
    setProductOptions([]);
    setProductSearchError("");
    if (product.condition) setSelectedCondition(product.condition);
    const localProduct = products.find(
      (item) =>
        item.active &&
        normalizeProductName(item.name) === normalizeProductName(product.name),
    );
    setSelectedProductId(localProduct ? String(localProduct.id) : "");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!installation && !selectedSalesforceProduct) {
      toast.error("Salesforce 제품을 검색해 선택해주세요.");
      return;
    }
    setBusy(true);
    const form = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await post({
        action: installation ? "updateInstallation" : "createInstallation",
        merchantId,
        installationId: installation?.id,
        productId: selectedProductId || undefined,
        productName: selectedSalesforceProduct?.name,
        productFamily: selectedSalesforceProduct?.family,
        ...form,
        transactionClassification: classification,
      });
      onSaved(result);
      setOpen(false);
      toast.success(
        installation
          ? "설치 제품이 수정되었습니다."
          : "설치 제품이 추가되었습니다.",
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
        if (nextOpen) {
          setClassification(installation?.transactionClassification ?? "구매");
          setSelectedCondition(installation?.condition ?? "신품");
          setSelectedProductId(
            installation?.productId ? String(installation.productId) : "",
          );
          setProductQuery("");
          setProductOptions([]);
          setSelectedSalesforceProduct(null);
          setProductSearchError("");
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        {installation ? (
          <Button type="button" variant="ghost" size="sm">
            수정
          </Button>
        ) : (
          <Button type="button">
            <Plus />
            설치 제품 추가
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>
              {installation ? "설치 제품 수정" : "설치 제품 직접 추가"}
            </DialogTitle>
            <DialogDescription>
              등록된 제품과 설치일을 선택하면 해당 날짜의 제품 원가가 자동으로
              연결됩니다. 금액은 VAT 별도 공급가액으로 입력합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="설치일자">
              <Input
                name="installDate"
                type="date"
                defaultValue={
                  installation?.contractInstallAt?.slice(0, 10) ||
                  defaultInstallDate
                }
                required
              />
            </Field>
            <Field label="제품">
              {installation ? (
                <select
                  name="productId"
                  value={selectedProductId}
                  onChange={(event) => setSelectedProductId(event.target.value)}
                  className="h-10 rounded-md border bg-white px-3"
                  required
                >
                  <option value="" disabled>
                    제품 선택
                  </option>
                  {products
                    .filter((product) => product.active)
                    .map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                </select>
              ) : selectedSalesforceProduct ? (
                <div className="flex gap-2">
                  <Input
                    value={`${selectedSalesforceProduct.name} · ${selectedSalesforceProduct.condition || "유형 미지정"}`}
                    disabled
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSelectedSalesforceProduct(null);
                      setSelectedProductId("");
                      setProductQuery("");
                      setSelectedCondition("신품");
                    }}
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
                  {productOptions.length > 0 ? (
                    <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border bg-white p-1">
                      {productOptions.map((product) => (
                        <button
                          type="button"
                          key={product.id}
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                          onClick={() => chooseSalesforceProduct(product)}
                        >
                          <span className="font-medium">{product.name}</span>
                          <span className="flex items-center gap-2 text-xs text-slate-500">
                            <Badge variant="outline">
                              {product.condition || "유형 미지정"}
                            </Badge>
                            {product.family || "제품군 미지정"}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <p
                    className={`mt-1 text-xs ${productSearchError ? "text-red-600" : "text-slate-500"}`}
                  >
                    {productSearchError || "제품명을 입력하고 검색해주세요."}
                  </p>
                </>
              )}
            </Field>
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
            <Field label="약정개월">
              <Input
                name="contractTermMonths"
                type="number"
                min="1"
                defaultValue={installation?.contractTermMonths ?? 36}
                required
              />
            </Field>
            <Field label="거래구분">
              <select
                name="transactionClassification"
                value={classification}
                onChange={(event) => setClassification(event.target.value)}
                className="h-10 rounded-md border bg-white px-3"
              >
                <option value="구매">구매</option>
                <option value="할부구매">할부구매</option>
                <option value="임대">임대</option>
                <option value="무상">무상</option>
              </select>
            </Field>
            <Field label="VAN">
              <Input
                name="van"
                placeholder="예: KIS"
                defaultValue={installation?.van ?? ""}
              />
            </Field>
            <Field label="수량">
              <Input
                name="quantity"
                type="number"
                min="1"
                defaultValue={installation?.quantity ?? "1"}
                required
              />
            </Field>
            <Field label="판매 공급가액 (단가)">
              <Input
                name="salesAmount"
                type="number"
                min="0"
                defaultValue={installation?.salesAmount ?? "0"}
                required
              />
            </Field>
            {selectedProduct?.directCostAllowed ? (
              <Field label="원가 공급가액 (직접 입력)">
                <Input
                  name="unitCost"
                  type="number"
                  min="0"
                  defaultValue={
                    installation?.unitCostOverridden
                      ? installation.unitCostSnapshot
                      : ""
                  }
                  placeholder="비워두면 제품 원가 자동 적용"
                />
              </Field>
            ) : null}
            {classification === "할부구매" ? (
              <>
                <Field label="대금책정">
                  <Input
                    name="fixing"
                    type="number"
                    min="0"
                    defaultValue={installation?.fixing ?? "0"}
                    required
                  />
                </Field>
                <Field label="영업수수료">
                  <Input
                    name="incentive"
                    type="number"
                    min="0"
                    defaultValue={installation?.incentive ?? "0"}
                    required
                  />
                </Field>
                <Field label="대금책정 입금상태">
                  <select name="fixingPaymentStatus" defaultValue={installation?.fixingPaymentStatus ?? "미확인"} className="h-10 rounded-md border bg-white px-3">
                    <option value="미확인">미확인(기존 데이터 유지)</option>
                    <option value="미입금">미입금</option>
                    <option value="입금완료">입금완료</option>
                  </select>
                </Field>
                <Field label="대금책정 입금일자">
                  <Input name="fixingPaymentDate" type="date" defaultValue={installation?.fixingPaymentDate ?? ""} />
                </Field>
                <Field label="영업수수료 입금상태">
                  <select name="incentivePaymentStatus" defaultValue={installation?.incentivePaymentStatus ?? "미확인"} className="h-10 rounded-md border bg-white px-3">
                    <option value="미확인">미확인(기존 데이터 유지)</option>
                    <option value="미입금">미입금</option>
                    <option value="입금완료">입금완료</option>
                  </select>
                </Field>
                <Field label="영업수수료 입금일자">
                  <Input name="incentivePaymentDate" type="date" defaultValue={installation?.incentivePaymentDate ?? ""} />
                </Field>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              disabled={
                busy ||
                (installation
                  ? !selectedProductId
                  : !selectedSalesforceProduct)
              }
            >
              {busy ? "저장 중..." : installation ? "수정사항 저장" : "설치 제품 저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function MerchantDetail({ merchantId }: { merchantId: number }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [returnTo] = useState(() => {
    if (typeof window === "undefined") return "/";
    const candidate = new URLSearchParams(window.location.search).get(
      "returnTo",
    ) ?? window.sessionStorage.getItem(LIST_RETURN_STORAGE_KEY);
    return candidate?.startsWith("/") && !candidate.startsWith("//")
      ? candidate
      : "/";
  });
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentYear = currentMonth.slice(0, 4);
  const initialMode = initialDetailParam("rangeMode");
  const initialMonth = initialDetailParam("month");
  const initialYear = initialDetailParam("year");
  const initialStart =
    initialDetailParam("customStart") || initialDetailParam("start");
  const initialEnd =
    initialDetailParam("customEnd") || initialDetailParam("end");
  const [rangeMode, setRangeMode] = useState(
    ["month", "year", "custom"].includes(initialMode)
      ? initialMode
      : "month",
  );
  const [month, setMonth] = useState(
    /^\d{4}-(0[1-9]|1[0-2])$/.test(initialMonth)
      ? initialMonth
      : currentMonth,
  );
  const [year, setYear] = useState(/^\d{4}$/.test(initialYear) ? initialYear : currentYear);
  const [start, setStart] = useState(
    /^\d{4}-(0[1-9]|1[0-2])$/.test(initialStart)
      ? initialStart
      : `${currentYear}-01`,
  );
  const [end, setEnd] = useState(
    /^\d{4}-(0[1-9]|1[0-2])$/.test(initialEnd)
      ? initialEnd
      : `${currentYear}-12`,
  );
  useEffect(() => {
    fetch("/api/dashboard")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        return result;
      })
      .then(setData)
      .catch((reason) => setError(reason.message));
  }, []);
  const range =
    rangeMode === "month"
      ? { start: month, end: month, label: month }
      : rangeMode === "year"
        ? { start: `${year}-01`, end: `${year}-12`, label: `${year}년` }
        : { start, end, label: `${start} ~ ${end}` };
  const summary = useMemo(() => {
    if (!data) return null;
    const merchant = data.merchants.find((row) => row.id === merchantId);
    if (!merchant) return null;
    const months = monthsBetween(range.start, range.end);
    const payers = data.payerAccounts.filter(
      (row) =>
        row.merchantId === merchantId && row.billingType !== "installment",
    );
    const payerIds = new Set(payers.map((payer) => payer.id));
    const payments = data.payments.filter(
      (row) =>
        row.merchantId === merchantId &&
        payerIds.has(row.payerAccountId) &&
        row.paymentDate.slice(0, 7) >= range.start &&
        row.paymentDate.slice(0, 7) <= range.end,
    );
    const allInstallations = data.installations.filter(
      (row) => row.merchantId === merchantId,
    );
    const installations = allInstallations.filter((item) => {
      const installMonth = (item.contractInstallAt || "").slice(0, 7);
      return installMonth >= range.start && installMonth <= range.end;
    });
    const billingPayments = data.payments.filter(
      (row) =>
        row.merchantId === merchantId &&
        payerIds.has(row.payerAccountId) &&
        row.billingMonth >= range.start &&
        row.billingMonth <= range.end,
    );
    const expected = payers.reduce(
      (sum, payer) =>
        sum +
        months.filter((m) => payerActiveInMonth(payer, m)).length *
          payer.monthlyCharge,
      0,
    );
    const paid = payments.reduce(
      (sum, payment) => sum + payment.supplyAmount,
      0,
    );
    const vat = payments.reduce((sum, payment) => sum + payment.vatAmount, 0);
    const installmentRevenue = installations
      .filter((item) => item.transactionClassification === "할부구매")
      .reduce((sum, item) => sum + eligibleInstallmentRevenue(item), 0);
    const purchaseRevenue = installations
      .filter((item) => item.transactionClassification === "구매")
      .reduce((sum, item) => sum + item.unitCostSnapshot * item.quantity, 0);
    const installationCost = installations.reduce(
      (sum, item) => sum + item.unitCostSnapshot * item.quantity,
      0,
    );
    return {
      merchant,
      months,
      payers,
      payments,
      billingPayments,
      allInstallations,
      installations,
      expected,
      paid,
      vat,
      installmentRevenue,
      purchaseRevenue,
      installationCost,
      due: Math.max(
        0,
        expected -
          billingPayments.reduce((sum, payment) => sum + payment.supplyAmount, 0),
      ),
    };
  }, [data, merchantId, range.start, range.end]);
  if (error || (data && !summary))
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <div className="rounded-2xl border bg-white p-8 text-center">
          <XCircle className="mx-auto text-red-500" />
          <h1 className="mt-4 text-xl font-bold">가맹점을 볼 수 없습니다</h1>
          <p className="mt-2 text-sm text-slate-500">
            {error || "접근 권한이 없거나 존재하지 않는 가맹점입니다."}
          </p>
          <Button asChild className="mt-5">
            <a href={returnTo}>목록으로</a>
          </Button>
        </div>
      </main>
    );
  if (!data || !summary)
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7fb]">
        <div className="size-9 animate-spin rounded-full border-4 border-blue-100 border-t-[#175cd3]" />
      </main>
    );
  const productName = (id: number) =>
    data.products.find((row) => row.id === id)?.name ?? "-";
  const productAllowsDirectCost = (id: number) =>
    Boolean(data.products.find((row) => row.id === id)?.directCostAllowed);
  const dealer = data.dealers.find((row) => row.id === summary.merchant.dealerId);
  const detailFields = merchantDetailFieldsFor(dealer);
  const hasDetailField = (key: MerchantDetailFieldKey) =>
    detailFields.includes(key);
  const billingColumns = merchantDetailBillingColumnsFor(dealer);
  const hasBillingColumn = (key: MerchantDetailBillingColumnKey) =>
    billingColumns.includes(key);
  const payerColumns = merchantDetailPayerColumnsFor(dealer);
  const hasPayerColumn = (key: MerchantDetailPayerColumnKey) =>
    payerColumns.includes(key);
  const installationColumns = merchantDetailInstallationColumnsFor(dealer);
  const hasInstallationColumn = (key: MerchantDetailInstallationColumnKey) =>
    installationColumns.includes(key);
  const usesBillingTab =
    hasDetailField("billingTab") && billingColumns.length > 0;
  const usesPayerTab = hasDetailField("payerTab") && payerColumns.length > 0;
  const usesInstallationTab =
    hasDetailField("installationTab") && installationColumns.length > 0;
  const visibleTabs = [
    usesInstallationTab ? "installations" : null,
    usesBillingTab ? "billing" : null,
    usesPayerTab ? "payers" : null,
  ].filter((value): value is string => Boolean(value));
  const vans = [
    ...new Set(
      summary.allInstallations.flatMap((item) =>
        (item.van || "")
          .split(/[;,]/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ),
  ];
  const firstInstallDate =
    summary.allInstallations
      .map((item) => (item.contractInstallAt || "").slice(0, 10))
      .filter(Boolean)
      .sort()[0] || summary.merchant.installDate;
  return (
    <main className="min-h-screen bg-[#f4f7fb] text-slate-950">
      <Toaster position="top-center" richColors />
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between px-5 py-4 lg:px-8">
          <a
            href={returnTo}
            className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-[#175cd3]"
          >
            <ArrowLeft className="size-4" />
            정산 목록
          </a>
          {data.access.role !== "viewer" ? (
            <div className="flex flex-wrap gap-2">
              <PayerDialog merchantId={merchantId} onSaved={setData} />
              <InstallationDialog
                merchantId={merchantId}
                defaultInstallDate={summary.merchant.installDate}
                products={data.products}
                onSaved={setData}
              />
            </div>
          ) : null}
        </div>
      </header>
      <div className="mx-auto max-w-[1320px] px-5 py-7 lg:px-8">
        <section className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="mb-2 flex flex-wrap gap-2">
              <Badge className="bg-blue-50 text-[#175cd3]">
                {dealer?.name}
              </Badge>
              <Badge variant="outline">VAT 별도</Badge>
              {hasDetailField("accountStatus") &&
                summary.merchant.accountStatus && (
                <Badge variant="outline">
                  사업장 상태 · {summary.merchant.accountStatus}
                </Badge>
              )}
              {hasDetailField("vanBadges") && vans.map((van) => (
                <Badge variant="secondary" key={van}>
                  VAN {van}
                </Badge>
              ))}
            </div>
            <h1 className="text-3xl font-bold">{summary.merchant.name}</h1>
            {(hasDetailField("businessNumber") ||
              hasDetailField("firstInstallDate")) && (
              <p className="mt-2 text-sm text-slate-500">
                {hasDetailField("businessNumber") &&
                  `사업자번호 ${summary.merchant.businessNumber}`}
                {hasDetailField("businessNumber") &&
                  hasDetailField("firstInstallDate") &&
                  " · "}
                {hasDetailField("firstInstallDate") &&
                  `최초 설치일 ${firstInstallDate || "미입력"}`}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={rangeMode} onValueChange={setRangeMode}>
              <SelectTrigger className="h-11 rounded-xl bg-white">
                <CalendarRange />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">월별</SelectItem>
                <SelectItem value="year">연도별</SelectItem>
                <SelectItem value="custom">기간 설정</SelectItem>
              </SelectContent>
            </Select>
            {rangeMode === "month" && (
              <Input
                className="h-11 w-40 bg-white"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
            )}{" "}
            {rangeMode === "year" && (
              <Input
                className="h-11 w-28 bg-white"
                value={year}
                onChange={(e) =>
                  setYear(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
              />
            )}{" "}
            {rangeMode === "custom" && (
              <>
                <Input
                  className="h-11 w-40 bg-white"
                  type="month"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
                <Input
                  className="h-11 w-40 bg-white"
                  type="month"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </>
            )}
          </div>
        </section>
        {[
          "expectedSummary",
          "paidSummary",
          "dueSummary",
          "productRevenueSummary",
          "installationCostSummary",
        ].some((key) => detailFields.includes(key as MerchantDetailFieldKey)) && (
          <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {hasDetailField("expectedSummary") && (
              <article className="summary-card summary-blue">
                <ReceiptText />
                <p className="mt-4 text-sm text-slate-500">예정 청구액</p>
                <b className="mt-1 block text-2xl">{won(summary.expected)}</b>
              </article>
            )}
            {hasDetailField("paidSummary") && (
              <article className="summary-card summary-green">
                <CheckCircle2 />
                <p className="mt-4 text-sm text-slate-500">납부 공급가액</p>
                <b className="mt-1 block text-2xl">{won(summary.paid)}</b>
              </article>
            )}
            {hasDetailField("dueSummary") && (
              <article className="summary-card summary-orange">
                <XCircle />
                <p className="mt-4 text-sm text-slate-500">미납액</p>
                <b className="mt-1 block text-2xl">{won(summary.due)}</b>
              </article>
            )}
            {hasDetailField("productRevenueSummary") && (
              <article className="summary-card summary-cyan">
                <CircleDollarSign />
                <p className="mt-4 text-sm text-slate-500">제품 수익</p>
                <b className="mt-1 block text-2xl">
                  {won(summary.purchaseRevenue + summary.installmentRevenue)}
                </b>
                <small className="text-slate-500">
                  구매수익 + 할부구매수익
                </small>
              </article>
            )}
            {hasDetailField("installationCostSummary") && (
              <article className="summary-card summary-cyan">
                <Boxes />
                <p className="mt-4 text-sm text-slate-500">
                  기간 설치 원가 합계
                </p>
                <b className="mt-1 block text-2xl">
                  {won(summary.installationCost)}
                </b>
              </article>
            )}
          </section>
        )}
        {visibleTabs.length > 0 && (
        <Tabs defaultValue={visibleTabs[0]}>
          <TabsList className="mb-5 h-auto rounded-xl border bg-white p-1">
            {usesInstallationTab && (
              <TabsTrigger value="installations">설치 제품</TabsTrigger>
            )}
            {usesBillingTab && (
              <TabsTrigger value="billing">월별 납부 현황</TabsTrigger>
            )}
            {usesPayerTab && (
              <TabsTrigger value="payers">납부자번호</TabsTrigger>
            )}
          </TabsList>
          {usesBillingTab && (
          <TabsContent value="billing">
            <section className="panel overflow-hidden">
              <div className="panel-head">
                <div>
                  <h3>납부 현황</h3>
                  <p>{range.label} · 납부자번호별 청구와 납입내역</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {hasBillingColumn("billingMonth") && (
                        <TableHead>청구월</TableHead>
                      )}
                      {hasBillingColumn("payerNumber") && (
                        <TableHead>납부자번호</TableHead>
                      )}
                      {hasBillingColumn("label") && <TableHead>구분</TableHead>}
                      {hasBillingColumn("expectedAmount") && (
                        <TableHead className="text-right">
                          예정 공급가액
                        </TableHead>
                      )}
                      {hasBillingColumn("paidAmount") && (
                        <TableHead className="text-right">
                          납부 공급가액
                        </TableHead>
                      )}
                      {hasBillingColumn("vat") && (
                        <TableHead className="text-right">VAT</TableHead>
                      )}
                      {hasBillingColumn("paymentDate") && (
                        <TableHead>납부일자</TableHead>
                      )}
                      {hasBillingColumn("status") && <TableHead>상태</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.months.flatMap((m) =>
                      summary.payers
                        .filter((p) => payerActiveInMonth(p, m))
                        .map((payer) => {
                          const paidRows = summary.payments.filter(
                            (p) =>
                              p.payerAccountId === payer.id &&
                              p.billingMonth === m,
                          );
                          const paid = paidRows.reduce(
                            (sum, p) => sum + p.supplyAmount,
                            0,
                          );
                          const billedPaid = summary.billingPayments
                            .filter(
                              (p) =>
                                p.payerAccountId === payer.id &&
                                p.billingMonth === m,
                            )
                            .reduce((sum, p) => sum + p.supplyAmount, 0);
                          const vat = paidRows.reduce(
                            (sum, p) => sum + p.vatAmount,
                            0,
                          );
                          const due = Math.max(0, payer.monthlyCharge - billedPaid);
                          return (
                            <TableRow key={`${m}-${payer.id}`}>
                              {hasBillingColumn("billingMonth") && (
                                <TableCell>{m}</TableCell>
                              )}
                              {hasBillingColumn("payerNumber") && (
                                <TableCell className="font-mono font-semibold">
                                  {payer.payerNumber}
                                </TableCell>
                              )}
                              {hasBillingColumn("label") && (
                                <TableCell>
                                  {payer.label ||
                                    purchaseLabels[payer.billingType]}
                                </TableCell>
                              )}
                              {hasBillingColumn("expectedAmount") && (
                                <TableCell className="text-right">
                                  {won(payer.monthlyCharge)}
                                </TableCell>
                              )}
                              {hasBillingColumn("paidAmount") && (
                                <TableCell className="text-right text-emerald-700">
                                  {won(paid)}
                                </TableCell>
                              )}
                              {hasBillingColumn("vat") && (
                                <TableCell className="text-right text-slate-500">
                                  {won(vat)}
                                </TableCell>
                              )}
                              {hasBillingColumn("paymentDate") && (
                                <TableCell>
                                  {paidRows
                                    .map((p) => p.paymentDate)
                                    .join(", ") || "-"}
                                </TableCell>
                              )}
                              {hasBillingColumn("status") && (
                                <TableCell>
                                  {due === 0 ? (
                                    <Badge className="bg-emerald-50 text-emerald-700">
                                      완납
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
                            </TableRow>
                          );
                        }),
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>
          </TabsContent>
          )}
          {usesPayerTab && (
          <TabsContent value="payers">
            <section className="panel overflow-hidden">
              <div className="panel-head">
                <div>
                  <h3>등록된 납부자번호</h3>
                  <p>사업자번호 하나에 여러 납부자번호를 연결할 수 있습니다.</p>
                </div>
                {data.access.role !== "viewer" && (
                  <PayerDialog merchantId={merchantId} onSaved={setData} />
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    {hasPayerColumn("payerNumber") && (
                      <TableHead>납부자번호</TableHead>
                    )}
                    {hasPayerColumn("label") && <TableHead>구분명</TableHead>}
                    {hasPayerColumn("billingType") && (
                      <TableHead>청구 유형</TableHead>
                    )}
                    {hasPayerColumn("monthlyCharge") && (
                      <TableHead className="text-right">월 공급가액</TableHead>
                    )}
                    {hasPayerColumn("billingPeriod") && (
                      <TableHead>청구 기간</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.payers.map((payer) => (
                    <TableRow key={payer.id}>
                      {hasPayerColumn("payerNumber") && (
                        <TableCell className="font-mono font-bold">
                          {payer.payerNumber}
                        </TableCell>
                      )}
                      {hasPayerColumn("label") && (
                        <TableCell>{payer.label || "-"}</TableCell>
                      )}
                      {hasPayerColumn("billingType") && (
                        <TableCell>
                          {purchaseLabels[payer.billingType]}
                          {payer.installmentMonths
                            ? ` ${payer.installmentMonths}개월`
                            : ""}
                        </TableCell>
                      )}
                      {hasPayerColumn("monthlyCharge") && (
                        <TableCell className="text-right font-semibold">
                          {won(payer.monthlyCharge)}
                        </TableCell>
                      )}
                      {hasPayerColumn("billingPeriod") && (
                        <TableCell>
                          {payer.startMonth} ~ {payer.endMonth || "계속"}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          </TabsContent>
          )}
          {usesInstallationTab && (
          <TabsContent value="installations">
            <section className="panel overflow-hidden">
              <div className="panel-head">
                <div>
                  <h3>설치 제품과 원가</h3>
                  <p>
                    {range.label}에 설치된 Salesforce 문의제품과 설치일 당시
                    VAT 별도 원가를 표시합니다.
                  </p>
                </div>
                {data.access.role !== "viewer" ? (
                  <InstallationDialog
                    merchantId={merchantId}
                    defaultInstallDate={summary.merchant.installDate}
                    products={data.products}
                    onSaved={setData}
                  />
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {hasInstallationColumn("installDate") && (
                        <TableHead>설치일</TableHead>
                      )}
                      {hasInstallationColumn("caseNumber") && (
                        <TableHead>문의번호</TableHead>
                      )}
                      {hasInstallationColumn("productName") && (
                        <TableHead>모델명</TableHead>
                      )}
                      {hasInstallationColumn("van") && <TableHead>VAN</TableHead>}
                      {hasInstallationColumn("condition") && (
                        <TableHead>유형</TableHead>
                      )}
                      {hasInstallationColumn("contractTermMonths") && (
                        <TableHead>약정</TableHead>
                      )}
                      {hasInstallationColumn("transactionClassification") && (
                        <TableHead>거래구분</TableHead>
                      )}
                      {hasInstallationColumn("quantity") && (
                        <TableHead className="text-right">수량</TableHead>
                      )}
                      {hasInstallationColumn("salesAmount") && (
                        <TableHead className="text-right">
                          판매 공급가액
                        </TableHead>
                      )}
                      {hasInstallationColumn("unitCost") && (
                        <TableHead className="text-right">원가 단가</TableHead>
                      )}
                      {hasInstallationColumn("costTotal") && (
                        <TableHead className="text-right">원가 합계</TableHead>
                      )}
                      {hasInstallationColumn("fixing") && (
                        <TableHead className="text-right">대금책정</TableHead>
                      )}
                      <TableHead>대금책정 입금</TableHead>
                      {hasInstallationColumn("incentive") && (
                        <TableHead className="text-right">영업수수료</TableHead>
                      )}
                      <TableHead>영업수수료 입금</TableHead>
                      {hasInstallationColumn("actualRevenue") && (
                        <TableHead className="text-right">실제수익</TableHead>
                      )}
                      {data.access.role !== "viewer" ? (
                        <TableHead className="text-right"></TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.installations.map((item) => (
                      <TableRow key={item.id}>
                        {hasInstallationColumn("installDate") && (
                          <TableCell className="whitespace-nowrap">
                            {(item.contractInstallAt || "").slice(0, 10) ||
                              "미입력"}
                          </TableCell>
                        )}
                        {hasInstallationColumn("caseNumber") && (
                          <TableCell className="whitespace-nowrap font-mono text-sm">
                            {item.salesforceCaseNumber || "-"}
                          </TableCell>
                        )}
                        {hasInstallationColumn("productName") && (
                          <TableCell className="font-semibold">
                            {productName(item.productId)}
                          </TableCell>
                        )}
                        {hasInstallationColumn("van") && (
                          <TableCell>{item.van || "-"}</TableCell>
                        )}
                        {hasInstallationColumn("condition") && (
                          <TableCell>
                            <Badge variant="outline">{item.condition}</Badge>
                          </TableCell>
                        )}
                        {hasInstallationColumn("contractTermMonths") && (
                          <TableCell className="whitespace-nowrap">
                            {item.contractTermMonths}개월
                          </TableCell>
                        )}
                        {hasInstallationColumn("transactionClassification") && (
                          <TableCell>
                            {item.transactionClassification || "-"}
                          </TableCell>
                        )}
                        {hasInstallationColumn("quantity") && (
                          <TableCell className="text-right">
                            {item.quantity}
                          </TableCell>
                        )}
                        {hasInstallationColumn("salesAmount") && (
                          <TableCell className="text-right">
                            {item.salesAmount ? won(item.salesAmount) : "-"}
                          </TableCell>
                        )}
                        {hasInstallationColumn("unitCost") && (
                          <TableCell className="text-right">
                            {item.unitCostRegistered ? (
                              <>
                                {won(item.unitCostSnapshot)}
                                {item.unitCostOverridden &&
                                productAllowsDirectCost(item.productId) ? (
                                  <div className="mt-1">
                                    <Badge variant="outline">직접 입력</Badge>
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-red-600">
                                  원가 미등록
                                </span>
                                {data.access.role === "admin" ? (
                                  <InstallationCostDialog
                                    productId={item.productId}
                                    productName={productName(item.productId)}
                                    condition={item.condition}
                                    installDate={
                                      item.contractInstallAt?.slice(0, 10) || ""
                                    }
                                    dealers={data.dealers}
                                    defaultDealerId={summary.merchant.dealerId}
                                    onSaved={setData}
                                  />
                                ) : null}
                              </div>
                            )}
                          </TableCell>
                        )}
                        {hasInstallationColumn("costTotal") && (
                          <TableCell className="text-right font-bold">
                            {won(item.unitCostSnapshot * item.quantity)}
                          </TableCell>
                        )}
                        {hasInstallationColumn("fixing") && (
                          <TableCell className="text-right">
                            {item.transactionClassification === "할부구매"
                              ? won(item.fixing)
                              : "-"}
                          </TableCell>
                        )}
                        <TableCell>
                          {item.transactionClassification === "할부구매" ? (
                            <PaymentStatus
                              status={item.fixingPaymentStatus}
                              date={item.fixingPaymentDate}
                            />
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        {hasInstallationColumn("incentive") && (
                          <TableCell className="text-right">
                            {item.transactionClassification === "할부구매"
                              ? won(item.incentive)
                              : "-"}
                          </TableCell>
                        )}
                        <TableCell>
                          {item.transactionClassification === "할부구매" ? (
                            <PaymentStatus
                              status={item.incentivePaymentStatus}
                              date={item.incentivePaymentDate}
                            />
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        {hasInstallationColumn("actualRevenue") && (
                          <TableCell className="text-right font-bold text-blue-700">
                            {item.transactionClassification === "구매"
                              ? won(item.unitCostSnapshot * item.quantity)
                              : item.transactionClassification === "할부구매"
                                ? won(eligibleInstallmentRevenue(item))
                                : "-"}
                          </TableCell>
                        )}
                        {data.access.role !== "viewer" ? (
                          <TableCell className="whitespace-nowrap text-right">
                            <InstallationDialog
                              merchantId={merchantId}
                              defaultInstallDate={
                                summary.merchant.installDate
                              }
                              products={data.products}
                              installation={item}
                              onSaved={setData}
                            />
                            <DeleteConfirmButton
                              title="설치 제품을 삭제할까요?"
                              description={`${productName(item.productId)} ${item.condition} ${item.quantity}대 설치 내역이 삭제됩니다. Salesforce에서 다시 동기화되는 제품이면 다음 동기화 때 다시 등록될 수 있습니다.`}
                              onConfirm={async () => {
                                const result = await post({
                                  action: "deleteInstallation",
                                  installationId: item.id,
                                });
                                setData(result);
                                toast.success("설치 제품을 삭제했습니다.");
                              }}
                            />
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </TabsContent>
          )}
        </Tabs>
        )}
      </div>
    </main>
  );
}
