import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardData, won } from "./types";
import { penaltySummary } from "./salesforce-settlement";

export function PenaltyTable({ rows, merchants, start, end }: {
  rows: DashboardData["cancellationPenalties"];
  merchants: DashboardData["merchants"];
  start: string;
  end: string;
}) {
  const summary = penaltySummary(rows, true, start, end);
  const merchantNames = new Map(merchants.map(row => [row.id, row.name]));
  const visible = rows.filter(row => row.amount > 0 &&
    ["해지완료", "해지완료(미회수)"].includes(row.status) &&
    (!row.paymentDate || (row.paymentDate.slice(0, 7) >= start && row.paymentDate.slice(0, 7) <= end)));
  return (
    <section className="panel overflow-hidden">
      <div className="panel-head"><div><h3>위약금 수익</h3><p>입금 월 기준 · 위약금 {won(summary.revenue)} · 딜러 정산 반영 {won(summary.dealerProfit)} (50%)</p></div></div>
      <div className="overflow-x-auto"><Table className="whitespace-nowrap">
        <TableHeader><TableRow><TableHead>가맹점</TableHead><TableHead>해지문의</TableHead><TableHead>상태</TableHead><TableHead>위약금 입금 일자</TableHead><TableHead>정산월</TableHead><TableHead className="text-right">위약금</TableHead><TableHead className="text-right">딜러 배분액 (50%)</TableHead><TableHead>정산 반영</TableHead></TableRow></TableHeader>
        <TableBody>
          {visible.map(row => <TableRow key={row.salesforceCaseId}>
            <TableCell>{merchantNames.get(row.merchantId) || "-"}</TableCell><TableCell>{row.caseNumber || "-"}</TableCell><TableCell>{row.status}</TableCell>
            <TableCell>{row.paymentDate || row.rawPaymentDate || "미입력"}</TableCell><TableCell>{row.paymentDate?.slice(0, 7) || "-"}</TableCell><TableCell className="text-right">{won(row.amount)}</TableCell>
            <TableCell className="text-right">{won(row.paymentDate ? Math.round(row.amount * 0.5) : 0)}</TableCell><TableCell>{row.paymentDate ? "반영" : "입금일 확인 필요 · 제외"}</TableCell>
          </TableRow>)}
          {!visible.length && <TableRow><TableCell colSpan={8} className="h-20 text-center text-slate-500">해당 기간의 위약금 내역이 없습니다.</TableCell></TableRow>}
        </TableBody>
      </Table></div>
    </section>
  );
}
