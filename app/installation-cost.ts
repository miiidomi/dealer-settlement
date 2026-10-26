import { installationIsFromAsset } from "./asset-lifecycle";
import type { Installation, Product } from "./types";

/** Explicit installation input wins, including zero. Reused assets cost zero. */
export function resolveInstallationCost<T extends Pick<Installation, "unitCostSnapshot" | "unitCostOverridden" | "isFromAsset" | "isFromAssetOverride">>(
  row: T,
  product: Pick<Product, "directCostAllowed"> | undefined,
  registeredCost?: { unitCost: number },
) {
  if (installationIsFromAsset(row))
    return { ...row, unitCostSnapshot: 0, unitCostRegistered: true };
  if (row.unitCostOverridden)
    return { ...row, unitCostRegistered: true };
  // A catalogue default is not the merchant's explicit direct-cost input.
  if (product?.directCostAllowed)
    return registeredCost
      ? { ...row, unitCostSnapshot: registeredCost.unitCost, unitCostRegistered: true }
      : { ...row, unitCostSnapshot: 0, unitCostRegistered: false };
  return registeredCost
    ? { ...row, unitCostSnapshot: registeredCost.unitCost, unitCostRegistered: true }
    : { ...row, unitCostRegistered: row.unitCostSnapshot !== 0 };
}

export function missingDirectCost(
  row: Installation & { unitCostRegistered?: boolean },
  product: Pick<Product, "directCostAllowed"> | undefined,
) {
  return product?.directCostAllowed === true && !installationIsFromAsset(row) && !row.unitCostOverridden && row.unitCostRegistered !== true;
}
