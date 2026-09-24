// The handler registry: one module per job kind (worker/src/handlers/<kind>.ts).
// storage.scan is deliberately absent: no malware scanner has been chosen, so
// scan jobs stay queued ("pending") instead of getting an invented result.

import type { HandlerModule } from "../types";
import * as demoPing from "./demo.ping";
import * as importSuggestMapping from "./import.suggest_mapping";
import * as oauthExchange from "./oauth.exchange";
import * as platformPromote from "./platform.promote";
import * as platformSandboxExpiry from "./platform.sandbox_expiry";
import * as storageRetention from "./storage.retention";

export const HANDLERS: HandlerModule[] = [demoPing, importSuggestMapping, oauthExchange, platformPromote, platformSandboxExpiry, storageRetention];
