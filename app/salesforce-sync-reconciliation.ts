// Keep the complete Salesforce result, rather than just locally importable rows,
// as the authority for presence. A missing product name must not erase a row.
export const obsoleteInstallationsSql = `DELETE FROM installations
  WHERE source = 'salesforce'
    AND salesforce_line_item_id IS NOT NULL
    AND merchant_id IN (SELECT id FROM merchants WHERE dealer_id = ?)
    AND COALESCE(last_synced_at, '') <= ?
    AND NOT EXISTS (
      SELECT 1 FROM json_each(?) AS current_item
      WHERE current_item.value = installations.salesforce_line_item_id
    )`;

export function validateSalesforcePage(page: unknown): asserts page is {
  records: { Id: string }[];
  done: boolean;
  nextRecordsUrl?: string;
} {
  const value = page as { records?: unknown; done?: unknown; nextRecordsUrl?: unknown } | null;
  if (!value || !Array.isArray(value.records) || typeof value.done !== 'boolean'
    || value.records.some(row => !row || typeof row.Id !== 'string' || !row.Id)
    || (!value.done && (typeof value.nextRecordsUrl !== 'string'
      || !/^\/services\/data\/v\d+\.\d+\/query\//.test(value.nextRecordsUrl)))) {
    throw new Error('Salesforce 조회 결과가 완전하지 않아 동기화를 중단했습니다. 다시 시도해주세요.');
  }
}
