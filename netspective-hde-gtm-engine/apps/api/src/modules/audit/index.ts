// Public entry point of the audit module. Other modules import only this file.
export { recordAudit } from "./writer.js";
export { AuditTamperError, runAuditMutation, type TamperContext } from "./tamper.js";
export { latestRetentionAnchor, verifyAuditChain } from "./verify.js";
export {
  DEFAULT_MINIMUM_RETENTION_MONTHS,
  dropAuditPeriod,
  dropExpiredAuditPeriods,
  RetentionRefusedError,
  type DroppedPeriod,
  type RetentionOptions,
} from "./retention.js";
export { registerAuditRoutes } from "./routes.js";
export { registerQuarantineRoutes } from "./quarantine-routes.js";
export { QuarantineService, type Decider, type QuarantineMeta } from "./quarantine-service.js";
export { createPhiGuardSink } from "./phi-sink.js";
