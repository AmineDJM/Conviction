import { Button, Empty } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="px-8 py-10">
      <Empty title="Company not found" action={<Button href="/">Back to deals</Button>}>
        It may have been deleted, or it belongs to another workspace.
      </Empty>
    </main>
  );
}
