import { FundPage } from "@/components/fund/fund-page";

export const metadata = { title: "Meetings · Fund" };

/** Fund Brain citations link here as /fund/meetings#<meetingId>: the same workspace, opened on the Meetings tab so the anchor resolves. */
export default function FundMeetingsPage() {
  return <FundPage tab="meetings" />;
}
