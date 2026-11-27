// Public entry point of the icp module (feature 002 slice built in feature 006). Other modules import
// only this file or react to its domain events.
export { IcpService, type FitSummary } from "./assessments.js";
export { evidenceFor, type EvidenceRecord } from "./evidence.js";
