// The handler registry: one module per job kind (worker/src/handlers/<kind>.ts).
// storage.scan is deliberately absent: no malware scanner has been chosen, so
// scan jobs stay queued ("pending") instead of getting an invented result.

import type { HandlerModule } from "../types";
import * as demoPing from "./demo.ping";
import * as importSuggestMapping from "./import.suggest_mapping";
import * as oauthExchange from "./oauth.exchange";
import * as platformPromote from "./platform.promote";
import * as platformSandboxExpiry from "./platform.sandbox_expiry";
import * as qboBringInHistory from "./qbo.bring_in_history";
import * as qboMatchSuggestAi from "./qbo.match_suggest_ai";
import * as qboPost from "./qbo.post";
import * as qboPullCustomersHistory from "./qbo.pull_customers_history";
import * as qboPullLists from "./qbo.pull_lists";
import * as qboRefreshToken from "./qbo.refresh_token";
import * as qboTestPost from "./qbo.test_post";
import * as storageRetention from "./storage.retention";

export const HANDLERS: HandlerModule[] = [
  demoPing,
  importSuggestMapping,
  oauthExchange,
  storageRetention,
  // o-platform
  platformPromote,
  platformSandboxExpiry,
  // o-quickbooks
  qboPullLists,
  qboPost,
  qboTestPost,
  qboRefreshToken,
  // o-qbo-match
  qboPullCustomersHistory,
  qboMatchSuggestAi,
  qboBringInHistory,
];
