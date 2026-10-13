// The donations upload calls the automatic emails' hook after its rows are saved (owner rule 2026-10-13: no receipt is emailed on
// upload unless the community switched on receipts for uploaded donations, Settings › Automatic emails; 0770).
export { onDonationsUploaded, type UploadReceiptsResult } from "@/lib/automatic-emails/hooks";
