import { FundPage } from "@/components/fund/fund-page";

export const metadata = { title: "Fund" };

export default async function Fund({ searchParams }: { searchParams: Promise<{ welcome?: string; tab?: string }> }) {
  const { welcome, tab } = await searchParams;
  return <FundPage tab={tab} welcome={welcome === "1"} />;
}
