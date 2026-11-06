import { SalesMarketingPageHeader } from "@/components/sales-marketing/SalesMarketingPageHeader";
import { ContentLibraryClient } from "@/components/sales-marketing/content/ContentLibraryClient";
import { contentPermissions } from "./content-permissions";

/** Sales & Marketing → Content Library (Phase 11). */
export default async function ContentLibraryPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const p = await contentPermissions();
  const initial = tab === "templates" || tab === "reviews" ? tab : "assets";
  return (
    <>
      <SalesMarketingPageHeader
        title="Content Library"
        description="Reusable images, logos, documents and videos, message templates approved for marketing, and the review queue. Saving or approving content never sends anything."
        breadcrumbs={[{ label: "Content Library" }]}
      />
      <ContentLibraryClient initialTab={initial} canCreate={p.create} />
    </>
  );
}
