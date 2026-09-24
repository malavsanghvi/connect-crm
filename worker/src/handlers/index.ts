// The handler registry: one module per job kind (worker/src/handlers/<kind>.ts).
// storage.scan is deliberately absent: no malware scanner has been chosen, so
// scan jobs stay queued ("pending") instead of getting an invented result.

import type { HandlerModule } from "../types";
import * as demoPing from "./demo.ping";
import * as importSuggestMapping from "./import.suggest_mapping";
import * as messagingDomainVerify from "./messaging.domain_verify";
import * as messagingSend from "./messaging.send";
import * as messagingTestSend from "./messaging.test_send";
import * as messagingWebhookEmail from "./messaging.webhook.email";
import * as messagingWebhookTwilio from "./messaging.webhook.twilio";
import * as oauthExchange from "./oauth.exchange";
import * as storageRetention from "./storage.retention";

export const HANDLERS: HandlerModule[] = [
  demoPing,
  importSuggestMapping,
  oauthExchange,
  storageRetention,
  // o-messaging
  messagingSend,
  messagingTestSend,
  messagingDomainVerify,
  messagingWebhookEmail,
  messagingWebhookTwilio,
];
