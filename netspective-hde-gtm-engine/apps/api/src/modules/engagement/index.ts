// Public entry point of the engagement module (feature 006). Other modules import only this file or react
// to its domain events.
export { NoticeService, NoticeInputSchema, type NoticeView } from "./notice.js";
export { ConsentLookup, recordConsent } from "./consent.js";
export { PriorLookup } from "./prior.js";
export { DeliveryService, DOWNLOAD_PATH, type DeliverySettings } from "./delivery.js";
export {
  RequestService,
  PublicRequestSchema,
  type IntakeValidator,
  type Receipt,
  type RequestSettings,
} from "./requests.js";
export { registerPublicRoutes, type PublicRouteDeps } from "./public-routes.js";
export { FORMS, FORM_SLUGS, FORM_ORG_TYPES, isFormSlug, type FormSlug } from "./public-forms.js";
export { signFormToken, checkFormToken, honeypotFilled } from "./abuse.js";
export { registerEngagementRoutes, type EngagementRouteDeps } from "./routes.js";
