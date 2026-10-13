import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { LEGAL_DOCUMENTS } from "@/lib/legalDocuments";

// Content is docs/legal/privacy-and-terms.md -- edit it there, never here.
export const metadata: Metadata = {
  title: "Privacy Policy · Sorrel",
};

export default function PrivacyPage() {
  return <LegalDocumentView doc={LEGAL_DOCUMENTS.privacy} />;
}
