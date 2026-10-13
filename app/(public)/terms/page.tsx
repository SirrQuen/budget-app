import type { Metadata } from "next";
import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { LEGAL_DOCUMENTS } from "@/lib/legalDocuments";

// Content is docs/legal/privacy-and-terms.md -- edit it there, never here.
export const metadata: Metadata = {
  title: "Terms of Service · Sorrel",
};

export default function TermsPage() {
  return <LegalDocumentView doc={LEGAL_DOCUMENTS.terms} />;
}
