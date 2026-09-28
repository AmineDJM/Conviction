import { FundPage } from "@/components/fund/fund-page";

export const metadata = { title: "IC members · Fund" };

/** Fund Brain citations link here as /fund/ic#<memberId>: the same workspace, opened on the IC tab so the anchor resolves. */
export default function FundIcPage() {
  return <FundPage tab="ic" />;
}
