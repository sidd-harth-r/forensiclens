import { FileText, Sparkles } from "lucide-react";
import type { RetrievalMode, RetrievalResultItem } from "@/types/retrieval";
import { cn } from "@/lib/utils";

type ChannelState = "matched" | "unmatched" | "not-run";

/**
 * Shows which retrieval channels returned a hit. Derived strictly from the
 * presence of lexicalRank / semanticRank in the API response, and from the
 * retrieval mode (a channel that did not run is shown as "not run").
 */
export function MatchChannels({
  item,
  mode,
  className,
}: {
  item: RetrievalResultItem;
  mode?: RetrievalMode;
  className?: string;
}) {
  const lexical: ChannelState =
    mode === "SEMANTIC_ONLY" ? "not-run" : item.lexicalRank != null ? "matched" : "unmatched";
  const semantic: ChannelState =
    mode === "KEYWORD_ONLY" ? "not-run" : item.semanticRank != null ? "matched" : "unmatched";

  const chip = (s: ChannelState) =>
    cn(
      "inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-2xs font-medium",
      s === "matched" && "border-accent/40 bg-accent-subtle text-accent-text",
      s === "unmatched" && "border-border text-text-muted",
      s === "not-run" && "border-dashed border-border text-text-disabled"
    );
  const describe = (name: string, s: ChannelState, rank?: number | null) =>
    s === "matched" ? `${name} match, rank ${rank}` : s === "unmatched" ? `No ${name.toLowerCase()} match` : `${name} channel not run in this mode`;

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className={chip(lexical)} title={describe("Lexical", lexical, item.lexicalRank)}>
        <FileText className="h-3 w-3" aria-hidden="true" />
        Lexical{lexical === "matched" && <span className="font-mono">#{item.lexicalRank}</span>}
        <span className="sr-only">: {describe("Lexical", lexical, item.lexicalRank)}</span>
      </span>
      <span className={chip(semantic)} title={describe("Semantic", semantic, item.semanticRank)}>
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        Semantic{semantic === "matched" && <span className="font-mono">#{item.semanticRank}</span>}
        <span className="sr-only">: {describe("Semantic", semantic, item.semanticRank)}</span>
      </span>
    </span>
  );
}
