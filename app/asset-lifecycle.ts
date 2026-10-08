/** Site-only interpretation of Salesforce links; never writes Salesforce records. */
export type LifecycleCase = {
  Id: string;
  Status: string;
  FirstType__c: string | null;
  RecordType: { DeveloperName: string } | null;
  ClosedDate?: string | null;
  ClosedSuccess_Dt__c?: string | null;
  LastModifiedDate: string;
};
export type LinkedAsset = {
  Id: string;
  AccountId: string | null;
  Case__c?: string | null;
  Quantity: number | null;
  EachLineItem__r: { CaseLineItem__c: string | null } | null;
};
export type AssetEvent = { assetId: string; case: LifecycleCase };
export function lifecycleKind(row: LifecycleCase): "transferred" | "terminated" | null {
  if (row.RecordType?.DeveloperName === "BusinessInquiry" && row.FirstType__c === "명의변경" && row.Status === "종결(성공)") return "transferred";
  if (row.RecordType?.DeveloperName === "TerminationInquiry" && ["해지완료", "해지완료(미회수)"].includes(row.Status)) return "terminated";
  return null;
}
export function latestAssetEvents(events: AssetEvent[]) {
  const byAsset = new Map<string, { kind: "transferred" | "terminated"; at: string; caseId: string }>();
  for (const event of events) {
    const kind = lifecycleKind(event.case);
    if (!kind || !event.assetId) continue;
    const at = (kind === "transferred" ? event.case.ClosedSuccess_Dt__c : event.case.ClosedDate) || event.case.LastModifiedDate;
    const current = byAsset.get(event.assetId);
    if (!current || at > current.at || (at === current.at && event.case.Id > current.caseId))
      byAsset.set(event.assetId, { kind, at, caseId: event.case.Id });
  }
  return byAsset;
}
export function installationLifecycle(assets: LinkedAsset[], events: ReturnType<typeof latestAssetEvents>) {
  let transferred = 0, terminated = 0, linked = 0;
  for (const asset of new Map(assets.map(row => [row.Id, row])).values()) {
    const quantity = Math.max(1, Math.round(Number(asset.Quantity ?? 1)));
    linked += quantity;
    // Some legacy individual records point back to the asset created by that same case.
    if (events.get(asset.Id)?.caseId === asset.Case__c) continue;
    if (events.get(asset.Id)?.kind === "transferred") transferred += quantity;
    if (events.get(asset.Id)?.kind === "terminated") terminated += quantity;
  }
  return JSON.stringify({ transferred, terminated, linked });
}
export function assetLifecycleLabel(row: { assetLifecycle?: string | null; quantity: number }) {
  try {
    const data = JSON.parse(row.assetLifecycle || "{}");
    const label = (name: string, count: number) => count === row.quantity ? name : `${name} (${count}/${row.quantity})`;
    return [data.transferred > 0 ? label("명변됨", data.transferred) : "", data.terminated > 0 ? label("해지됨", data.terminated) : ""].filter(Boolean).join(" · ") || "-";
  } catch { return "-"; }
}
/** Reuse always takes precedence over both registered and manually entered cost. */
export function installationCostUnit(row: { isFromAsset?: boolean; unitCostSnapshot: number }) {
  return row.isFromAsset === true ? 0 : row.unitCostSnapshot;
}
