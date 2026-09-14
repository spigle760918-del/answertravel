import { z } from "zod";

export const citationKindSchema = z.enum([
  "inline_link",
  "source_list",
  "provider_citation",
  "content_absorption_candidate",
]);
export const citationScanSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  answerId: z.string().uuid(),
  extractorVersion: z.literal("citation-extractor.v1"),
  status: z.enum(["completed", "failed"]),
  candidateCount: z.number().int().nonnegative(),
  errorCode: z.string().min(1).max(120).nullable(),
  scannedAt: z.string().datetime({ offset: true }),
});
export const citationEventSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    scanId: z.string().uuid(),
    answerId: z.string().uuid(),
    kind: citationKindSchema,
    rawValue: z.string().min(1),
    rawUrl: z.string().min(1).nullable(),
    canonicalUrl: z.string().url().nullable(),
    domain: z.string().min(1).nullable(),
    evidenceStatus: z.enum(["candidate", "insufficient"]),
    createdAt: z.string().datetime({ offset: true }),
  })
  .superRefine((value, context) => {
    if (
      value.evidenceStatus === "candidate" &&
      (!value.canonicalUrl || !value.domain)
    )
      context.addIssue({
        code: "custom",
        message: "Candidate citations require a canonical URL and domain.",
      });
    if (value.evidenceStatus === "insufficient" && value.canonicalUrl)
      context.addIssue({
        code: "custom",
        message: "Insufficient citations cannot have a canonical URL.",
      });
  });
export const sourceSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    citationEventId: z.string().uuid(),
    attempt: z.number().int().positive(),
    canonicalUrl: z.string().url(),
    status: z.enum(["succeeded", "blocked", "failed"]),
    httpStatus: z.number().int().nullable(),
    redirectChain: z.array(z.string().url()).max(6),
    contentType: z.string().max(200).nullable(),
    title: z.string().max(500).nullable(),
    author: z.string().max(300).nullable(),
    publishedAt: z.string().max(100).nullable(),
    textExcerpt: z.string().max(10_000).nullable(),
    contentSha256: z
      .string()
      .length(64)
      .regex(/^[a-f0-9]+$/)
      .nullable(),
    errorCode: z.string().min(1).max(120).nullable(),
    capturedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((value, context) => {
    if (
      value.status === "succeeded" &&
      (!value.contentSha256 || value.errorCode)
    )
      context.addIssue({
        code: "custom",
        message: "Successful snapshots require a hash and no error.",
      });
    if (
      value.status !== "succeeded" &&
      (value.contentSha256 || !value.errorCode)
    )
      context.addIssue({
        code: "custom",
        message: "Unsuccessful snapshots require an error and no hash.",
      });
  });

export type CitationScan = z.infer<typeof citationScanSchema>;
export type CitationEvent = z.infer<typeof citationEventSchema>;
export type CitationKind = z.infer<typeof citationKindSchema>;
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;

export type NormalizedCitationUrl =
  | { ok: true; canonicalUrl: string; domain: string }
  | { ok: false; errorCode: string };

const trackingParameter = /^(utm_.+|fbclid|gclid|dclid|msclkid)$/i;
export function normalizeCitationUrl(rawUrl: string): NormalizedCitationUrl {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, errorCode: "invalid_url" };
  }
  if (!(["http:", "https:"] as string[]).includes(parsed.protocol))
    return { ok: false, errorCode: "unsupported_protocol" };
  if (parsed.username || parsed.password)
    return { ok: false, errorCode: "embedded_credentials" };
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  const parameters = [...parsed.searchParams.entries()]
    .filter(([name]) => !trackingParameter.test(name))
    .sort(
      ([nameA, valueA], [nameB, valueB]) =>
        nameA.localeCompare(nameB) || valueA.localeCompare(valueB),
    );
  parsed.search = "";
  for (const [name, value] of parameters)
    parsed.searchParams.append(name, value);
  if (parsed.pathname.length > 1)
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return { ok: true, canonicalUrl: parsed.toString(), domain: parsed.hostname };
}

type ExtractedCandidate = {
  kind: CitationKind;
  rawValue: string;
  rawUrl: string | null;
  canonicalUrl: string | null;
  domain: string | null;
  evidenceStatus: "candidate" | "insufficient";
};
const trailingPunctuation = /[.,;:!?，。；：！？）)\]}]+$/u;
const urlPattern = /https?:\/\/[^\s<>"']+/giu;
const sourceLinePattern = /^\s*(?:参考来源|参考资料|来源|sources?)\s*[:：]?/iu;

function candidate(
  kind: CitationKind,
  rawValue: string,
  rawUrl: string | null,
): ExtractedCandidate {
  if (!rawUrl)
    return {
      kind,
      rawValue,
      rawUrl: null,
      canonicalUrl: null,
      domain: null,
      evidenceStatus: "insufficient",
    };
  const normalized = normalizeCitationUrl(rawUrl);
  return normalized.ok
    ? {
        kind,
        rawValue,
        rawUrl,
        canonicalUrl: normalized.canonicalUrl,
        domain: normalized.domain,
        evidenceStatus: "candidate",
      }
    : {
        kind,
        rawValue,
        rawUrl,
        canonicalUrl: null,
        domain: null,
        evidenceStatus: "insufficient",
      };
}

function structuredSources(providerResponse: unknown): ExtractedCandidate[] {
  if (
    !providerResponse ||
    typeof providerResponse !== "object" ||
    Array.isArray(providerResponse)
  )
    return [];
  const record = providerResponse as Record<string, unknown>;
  const values = [record.citations, record.sources]
    .filter(Array.isArray)
    .flat() as unknown[];
  return values.flatMap((value) => {
    if (typeof value === "string")
      return [
        candidate(
          "provider_citation",
          value,
          value.match(/^https?:\/\//iu) ? value : null,
        ),
      ];
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const source = value as Record<string, unknown>;
    const rawUrl = typeof source.url === "string" ? source.url : null;
    const rawValue = typeof source.title === "string" ? source.title : rawUrl;
    return rawValue ? [candidate("provider_citation", rawValue, rawUrl)] : [];
  });
}

export function extractCitationCandidates(
  answerText: string,
  providerResponse: unknown,
): ExtractedCandidate[] {
  const found: ExtractedCandidate[] = [];
  for (const line of answerText.split(/\r?\n/u)) {
    for (const match of line.matchAll(urlPattern)) {
      const rawUrl = match[0].replace(trailingPunctuation, "");
      found.push(
        candidate(
          sourceLinePattern.test(line) ? "source_list" : "inline_link",
          line.trim() || rawUrl,
          rawUrl,
        ),
      );
    }
  }
  found.push(...structuredSources(providerResponse));
  const unique = new Map<string, ExtractedCandidate>();
  for (const item of found) {
    const key = `${item.kind}:${item.canonicalUrl ?? item.rawValue}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}
