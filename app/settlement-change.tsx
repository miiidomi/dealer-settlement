"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SETTLEMENT_METRICS, settlementCalculationKey, type SettlementCheck } from "./settlement-snapshot";
import type { DashboardData, MonthlySettlementStatus } from "./types";
import { won } from "./types";

export function SettlementStatusBadge({ paid, check }: { paid?: boolean; check?: SettlementCheck }) {
  if (!paid) return <Badge variant="outline">미지급</Badge>;
  if (check?.state === "changed") return <Badge className="bg-amber-100 text-amber-900">지급완료 · 재확인 필요</Badge>;
  if (check?.state === "missing") return <Badge className="bg-slate-100 text-slate-600">지급완료 · 기준금액 미등록</Badge>;
  return <Badge className="bg-emerald-50 text-emerald-700">지급완료</Badge>;
}
const dateLabel = (date: string) => new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "short", timeStyle: "short", timeZone: "Asia/Seoul",
}).format(new Date(date));
const fieldValue = (field: string, value: string | number | boolean | null) => {
  if (value === null) return "-";
  if (typeof value === "number") {
    if (field.includes("분담율") || field.includes("배분율")) return `${value}%`;
    if (field === "수량" || field === "제품 ID") return String(value);
    return won(value);
  }
  return String(value);
};

export function SettlementChangeDialog({ check, status, admin, onSaved }: {
  check: SettlementCheck; status: MonthlySettlementStatus; admin: boolean;
  onSaved: (data: DashboardData) => void;
}) {
  const [open,setOpen] = useState(false), [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  async function acknowledge() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "acknowledgeSettlementChanges", dealerId: status.dealerId,
          settlementMonth: status.settlementMonth, expectedUpdatedAt: status.updatedAt,
          expectedCalculationKey: settlementCalculationKey(check.current) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "변경 확인을 저장하지 못했습니다.");
      onSaved(data); setOpen(false);
      toast.success(check.state === "missing" ? "현재 금액을 비교 기준으로 등록했습니다." : "변경 내역을 확인했습니다. 지급 시점 금액은 유지됩니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "변경 확인을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  const original = check.original;
  return <Dialog open={open} onOpenChange={value => { setOpen(value); setError(""); }}>
    <DialogTrigger asChild><Button variant="outline" size="sm" className="mt-2">
      {check.state === "missing" ? "기준금액 등록" : check.state === "changed" ? "변경 상세" : "저장 금액 비교"}
    </Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
      <DialogHeader><DialogTitle>{status.settlementMonth} 지급완료 정산 비교</DialogTitle>
        <DialogDescription>원가 수정 등으로 달라진 금액과 상세 내역을 확인합니다. 기존 지급완료 금액은 보관됩니다.</DialogDescription>
      </DialogHeader>
      <SettlementStatusBadge paid check={check} />
      {original ? <>
        <p className="text-sm text-slate-600">{original.kind === "legacy" ? "현재 금액으로 등록한 비교 기준" : "지급완료 시점"}: {dateLabel(original.capturedAt)}
          {check.comparison !== original && check.comparison ? ` · 마지막 변경 확인: ${dateLabel(check.comparison.capturedAt)}` : ""}</p>
        <div className="rounded-xl bg-slate-50 p-4 text-sm">
          {original.kind === "legacy" ? "등록 기준" : "지급완료 시점"} {won(original.totals.finalSettlement)} → 현재 {won(check.current.totals.finalSettlement)}
          <b className="ml-2">차액 {check.difference && check.difference > 0 ? "+" : ""}{won(check.difference ?? 0)}</b>
        </div>
        <Table><TableHeader><TableRow><TableHead>항목</TableHead><TableHead className="text-right">저장 금액</TableHead>
          <TableHead className="text-right">현재 금액</TableHead><TableHead className="text-right">차액</TableHead></TableRow></TableHeader>
          <TableBody>{Object.entries(SETTLEMENT_METRICS).map(([key,label]) => {
            const metric = key as keyof typeof SETTLEMENT_METRICS, difference = check.current.totals[metric] - original.totals[metric];
            return <TableRow key={key}><TableCell>{label}</TableCell><TableCell className="text-right">{won(original.totals[metric])}</TableCell>
              <TableCell className="text-right">{won(check.current.totals[metric])}</TableCell>
              <TableCell className={`text-right ${difference ? "font-bold text-amber-800" : "text-slate-400"}`}>{difference > 0 ? "+" : ""}{won(difference)}</TableCell></TableRow>;
          })}</TableBody></Table>
        {check.state === "changed" && check.comparison !== original && <p className="text-sm text-amber-800">마지막 변경 확인 이후에도 변경이 발생했습니다. 아래 표는 최초 저장 기준과 현재 내역의 비교입니다.</p>}
        {check.state === "changed" && check.comparison !== original && <div className="max-h-60 overflow-auto rounded-lg border border-amber-200">
          <h3 className="p-3 font-semibold">마지막 변경 확인 이후 변경</h3>
          <Table><TableHeader><TableRow><TableHead>가맹점 / 항목</TableHead><TableHead>변경 항목</TableHead><TableHead>마지막 확인 값</TableHead><TableHead>현재</TableHead></TableRow></TableHeader>
            <TableBody>{check.differences.map(row => <TableRow key={`${row.key}:${row.field}`}>
              <TableCell>{row.merchantName}<small className="block text-slate-500">{row.label}</small></TableCell><TableCell>{row.field}</TableCell>
              <TableCell>{fieldValue(row.field,row.before)}</TableCell><TableCell>{fieldValue(row.field,row.after)}</TableCell></TableRow>)}</TableBody>
          </Table>
        </div>}
        <h3 className="font-semibold">가맹점·항목별 변경</h3>
        <div className="max-h-80 overflow-auto rounded-lg border"><Table>
          <TableHeader><TableRow><TableHead>가맹점 / 항목</TableHead><TableHead>변경 항목</TableHead><TableHead>이전</TableHead><TableHead>현재</TableHead></TableRow></TableHeader>
          <TableBody>{check.originalDifferences.map(row => <TableRow key={`${row.key}:${row.field}`}>
            <TableCell>{row.merchantName}<small className="block text-slate-500">{row.label}</small></TableCell><TableCell>{row.field}</TableCell>
            <TableCell>{fieldValue(row.field,row.before)}</TableCell><TableCell>{fieldValue(row.field,row.after)}</TableCell></TableRow>)}
            {!check.originalDifferences.length && <TableRow><TableCell colSpan={4}>저장 기준과 상세 내역이 같습니다.</TableCell></TableRow>}
          </TableBody></Table></div>
      </> : <p className="rounded-xl bg-slate-50 p-4 text-sm">이 지급완료 건에는 당시 금액이 저장되어 있지 않습니다. 현재 금액 {won(check.current.totals.finalSettlement)}을 기준으로 등록하면 이후 변경을 감지할 수 있습니다. 과거 지급금액을 복원하는 기능은 아닙니다.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {admin && (check.state === "changed" || check.state === "missing") && <div className="grid gap-2 border-t pt-4">
        <p className="text-xs text-slate-500">{check.state === "missing" ? "현재 금액을 이후 비교 기준으로 저장합니다." : "확인 후 알림을 해제합니다. 최초 저장 금액과 차액은 계속 확인할 수 있고, 새로운 변경이 생기면 다시 표시됩니다."}</p>
        <Button disabled={busy} onClick={acknowledge}>{busy ? "저장 중..." : check.state === "missing" ? "현재 금액 기준 등록" : "변경 확인 완료"}</Button>
      </div>}
    </DialogContent>
  </Dialog>;
}
