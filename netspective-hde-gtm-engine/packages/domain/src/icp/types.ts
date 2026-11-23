// ICP vocabulary (feature 002 slice built in feature 006, research R-02).

export const ICP_KEYS = ["icp1", "icp2"] as const;
export type IcpKey = (typeof ICP_KEYS)[number];

export const FIT_STATUSES = ["strong", "possible", "weak", "excluded", "unknown"] as const;
export type FitStatus = (typeof FIT_STATUSES)[number];
