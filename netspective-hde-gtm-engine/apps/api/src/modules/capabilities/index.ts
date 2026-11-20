// Public entry point of the capabilities module (feature 005). Other modules import only this file or
// react to its domain events.
export {
  CapabilityService,
  CapabilityChangeSchema,
  EvidenceInputSchema,
  ExampleInputSchema,
  PublicStatusSchema,
  placeholderAttributes,
  type CapabilityDetail,
  type CapabilitySummary,
} from "./service.js";
export { toPublicCapability, type PublicCapability } from "./projection.js";
export { registerCapabilityRoutes, type CapabilityRouteDeps } from "./routes.js";
