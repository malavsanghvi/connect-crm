// The handler registry: one module per job kind (worker/src/handlers/<kind>.ts).
// storage.scan (0589) is registered but waits while virus scanning is off (the
// default) or clamd and the worker's Storage key are not set: the runner does
// not claim its jobs then (waitWhenNotConfigured), so they stay queued
// ("pending") exactly as before, and nothing invents a result.

import type { HandlerModule } from "../types";
import * as calendarImportFeed from "./calendar.import_feed";
import * as calendarRefreshFeeds from "./calendar.refresh_feeds";
import * as demoClear from "./demo.clear";
import * as demoLoad from "./demo.load";
import * as demoPing from "./demo.ping";
import * as eventsGenerateFlyer from "./events.generate_flyer";
import * as homeworkPublishNotify from "./homework.publish_notify";
import * as homeworkRemindersSweep from "./homework.reminders_sweep";
import * as importSuggestMapping from "./import.suggest_mapping";
import * as messagingDomainVerify from "./messaging.domain_verify";
import * as messagingSend from "./messaging.send";
import * as messagingTestSend from "./messaging.test_send";
import * as messagingWebhookEmail from "./messaging.webhook.email";
import * as messagingWebhookTwilio from "./messaging.webhook.twilio";
import * as nivaAnswer from "./niva.answer";
import * as nivaDiscoverSite from "./niva.discover_site";
import * as nivaImportPage from "./niva.import_page";
import * as nivaRetention from "./niva.retention";
import * as oauthExchange from "./oauth.exchange";
import * as platformPromote from "./platform.promote";
import * as platformSandboxExpiry from "./platform.sandbox_expiry";
import * as platformTestProvider from "./platform.test_provider";
import * as qboBringInHistory from "./qbo.bring_in_history";
import * as qboMatchSuggestAi from "./qbo.match_suggest_ai";
import * as qboPost from "./qbo.post";
import * as qboPullCustomersHistory from "./qbo.pull_customers_history";
import * as qboPullLists from "./qbo.pull_lists";
import * as qboRefreshToken from "./qbo.refresh_token";
import * as qboTestPost from "./qbo.test_post";
import * as paymentsRefund from "./payments.refund";
import * as paymentsReportsSweep from "./payments.reports_sweep";
import * as paymentsSyncPayouts from "./payments.sync_payouts";
import * as paymentsTestCharge from "./payments.test_charge";
import * as paymentsWebhookPaypal from "./payments.webhook.paypal";
import * as paymentsWebhookStripe from "./payments.webhook.stripe";
import * as photosImportAlbum from "./photos.import_album";
import * as storageRetention from "./storage.retention";
import * as surveysLaunchNotify from "./surveys.launch_notify";
import * as storageScan from "./storage.scan";
import * as storageScanSweep from "./storage.scan_sweep";

export const HANDLERS: HandlerModule[] = [
  demoPing,
  importSuggestMapping,
  eventsGenerateFlyer,
  oauthExchange,
  storageRetention,
  // o-platform
  platformPromote,
  platformSandboxExpiry,
  // o-platform-setup: the setup wizard's Test button
  platformTestProvider,
  // o-quickbooks
  qboPullLists,
  qboPost,
  qboTestPost,
  qboRefreshToken,
  // o-qbo-match
  qboPullCustomersHistory,
  qboMatchSuggestAi,
  qboBringInHistory,
  // o-messaging
  messagingSend,
  messagingTestSend,
  messagingDomainVerify,
  messagingWebhookEmail,
  messagingWebhookTwilio,
  // o-payments
  paymentsWebhookStripe,
  paymentsWebhookPaypal,
  paymentsRefund,
  paymentsTestCharge,
  paymentsSyncPayouts,
  // Payments plan PR 3: Zelle reports not seen at the bank within their window (0582)
  paymentsReportsSweep,
  // o-demo
  demoLoad,
  demoClear,
  // f-jsh-content: calendar subscriptions (ICS links)
  calendarImportFeed,
  calendarRefreshFeeds,
  // B14: Niva answering
  nivaAnswer,
  nivaImportPage,
  nivaRetention,
  // B20: list a website's pages from its sitemap (0576)
  nivaDiscoverSite,
  // Google Photos albums: bring a shared album's photos in as photos waiting for approval
  photosImportAlbum,
  // Homework (0587): tell the learners and the parents of children, each person once, in batches, whenever homework is published
  homeworkPublishNotify,
  // Homework (0588): every 15 minutes, remind the learners who have not handed in, the hours before it is due that the homework sets
  homeworkRemindersSweep,
  // Event feedback (0596): the survey push and its two reminders for each invited adult, in batches, each person once
  surveysLaunchNotify,
  // Virus scanning of uploads (0589): one file at a time with clamd, and the sweep that queues the backlog; both wait
  // in the queue while scanning is off (Platform › Setup), which is the default
  storageScan,
  storageScanSweep,
];
