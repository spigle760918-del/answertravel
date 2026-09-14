import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { normalizeCitationUrl } from "./citation-source.js";

export type LookupAddresses = (hostname: string) => Promise<string[]>;
export type SourceFetchResult = {
  status: "succeeded" | "blocked" | "failed";
  httpStatus: number | null;
  redirectChain: string[];
  contentType: string | null;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  textExcerpt: string | null;
  contentSha256: string | null;
  errorCode: string | null;
  retryable: boolean;
};

const defaultLookup: LookupAddresses = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map(
    (item) => item.address,
  );

function publicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  const [a, b] = parts as [number, number, number, number];
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 2, 168].includes(b)) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  );
}

function publicIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return publicIpv4(address);
  if (version !== 6) return false;
  const value = address.toLowerCase();
  if (value.startsWith("::ffff:")) return publicIpv4(value.slice(7));
  return !(
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    /^fe[89ab]/u.test(value) ||
    value.startsWith("2001:db8")
  );
}

export async function assertPublicSourceUrl(
  rawUrl: string,
  lookupAddresses: LookupAddresses = defaultLookup,
): Promise<URL> {
  const normalized = normalizeCitationUrl(rawUrl);
  if (!normalized.ok)
    throw new SourceFetchError(normalized.errorCode, false, true);
  const url = new URL(normalized.canonicalUrl);
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  )
    throw new SourceFetchError("private_host", false, true);
  const addresses = isIP(host) ? [host] : await lookupAddresses(host);
  if (!addresses.length || addresses.some((address) => !publicIp(address)))
    throw new SourceFetchError("private_address", false, true);
  return url;
}

export class SourceFetchError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly blocked: boolean,
    public readonly httpStatus: number | null = null,
  ) {
    super(code);
  }
}

function metadata(html: string, names: string[]): string | null {
  for (const name of names) {
    const first = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "iu",
    ).exec(html)?.[1];
    const second = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
      "iu",
    ).exec(html)?.[1];
    if (first || second) return (first ?? second)!.trim().slice(0, 500);
  }
  return null;
}
const decode = (value: string) =>
  value
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'");
function parseDocument(body: string, contentType: string) {
  if (!contentType.includes("html"))
    return {
      title: null,
      author: null,
      publishedAt: null,
      textExcerpt: body.replace(/\s+/gu, " ").trim().slice(0, 10_000) || null,
    };
  const title =
    decode(
      (/<title[^>]*>([\s\S]*?)<\/title>/iu.exec(body)?.[1] ?? "")
        .replace(/\s+/gu, " ")
        .trim(),
    ).slice(0, 500) || null;
  const author = metadata(body, ["author", "article:author"]);
  const publishedAt = metadata(body, [
    "article:published_time",
    "datePublished",
    "date",
  ]);
  const textExcerpt =
    decode(
      body
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
        .replace(/<[^>]+>/gu, " ")
        .replace(/\s+/gu, " ")
        .trim(),
    ).slice(0, 10_000) || null;
  return { title, author, publishedAt, textExcerpt };
}

async function limitedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximumBytes)
    throw new SourceFetchError("body_too_large", false, true, response.status);
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maximumBytes)
        throw new SourceFetchError(
          "body_too_large",
          false,
          true,
          response.status,
        );
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export class SafeSourceFetcher {
  constructor(
    private readonly options: {
      fetchImpl?: typeof fetch;
      lookupAddresses?: LookupAddresses;
      allowedDomains?: string[];
      timeoutMs?: number;
      maximumBytes?: number;
      maximumRedirects?: number;
    } = {},
  ) {}

  async capture(rawUrl: string): Promise<SourceFetchResult> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const lookupAddresses = this.options.lookupAddresses ?? defaultLookup;
    const redirectChain: string[] = [];
    let current = rawUrl;
    try {
      for (
        let redirect = 0;
        redirect <= (this.options.maximumRedirects ?? 4);
        redirect++
      ) {
        const normalized = normalizeCitationUrl(current);
        if (!normalized.ok)
          throw new SourceFetchError(normalized.errorCode, false, true);
        const candidateUrl = new URL(normalized.canonicalUrl);
        const allowedDomains = (this.options.allowedDomains ?? [])
          .map((domain) => domain.trim().toLowerCase())
          .filter(Boolean);
        if (
          !allowedDomains.some(
            (domain) =>
              candidateUrl.hostname === domain ||
              candidateUrl.hostname.endsWith(`.${domain}`),
          )
        ) {
          throw new SourceFetchError("domain_not_allowed", false, true);
        }
        const url = await assertPublicSourceUrl(
          candidateUrl.toString(),
          lookupAddresses,
        );
        redirectChain.push(url.toString());
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          this.options.timeoutMs ?? 15_000,
        );
        let response: Response;
        try {
          response = await fetchImpl(url, {
            redirect: "manual",
            signal: controller.signal,
            headers: {
              accept: "text/html,text/plain;q=0.9",
              "user-agent": "AnswerTravelSourceEvidence/1.0",
            },
          });
        } catch (error) {
          if ((error as Error).name === "AbortError")
            throw new SourceFetchError("timeout", true, false);
          throw new SourceFetchError("network_error", true, false);
        } finally {
          clearTimeout(timer);
        }
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get("location");
          if (!location)
            throw new SourceFetchError(
              "redirect_without_location",
              false,
              false,
              response.status,
            );
          if (redirect === (this.options.maximumRedirects ?? 4))
            throw new SourceFetchError(
              "too_many_redirects",
              false,
              true,
              response.status,
            );
          current = new URL(location, url).toString();
          continue;
        }
        if (response.status >= 500)
          throw new SourceFetchError(
            `http_${response.status}`,
            true,
            false,
            response.status,
          );
        if (!response.ok)
          throw new SourceFetchError(
            `http_${response.status}`,
            false,
            false,
            response.status,
          );
        const contentType = (response.headers.get("content-type") ?? "")
          .split(";")[0]!
          .trim()
          .toLowerCase();
        if (!(contentType === "text/html" || contentType === "text/plain"))
          throw new SourceFetchError(
            "unsupported_content_type",
            false,
            true,
            response.status,
          );
        const bytes = await limitedBody(
          response,
          this.options.maximumBytes ?? 1_000_000,
        );
        const body = new TextDecoder().decode(bytes);
        const parsed = parseDocument(body, contentType);
        return {
          status: "succeeded",
          httpStatus: response.status,
          redirectChain,
          contentType,
          ...parsed,
          contentSha256: createHash("sha256").update(bytes).digest("hex"),
          errorCode: null,
          retryable: false,
        };
      }
      throw new SourceFetchError("too_many_redirects", false, true);
    } catch (error) {
      const known =
        error instanceof SourceFetchError
          ? error
          : new SourceFetchError("unexpected_error", false, false);
      return {
        status: known.blocked ? "blocked" : "failed",
        httpStatus: known.httpStatus,
        redirectChain,
        contentType: null,
        title: null,
        author: null,
        publishedAt: null,
        textExcerpt: null,
        contentSha256: null,
        errorCode: known.code,
        retryable: known.retryable,
      };
    }
  }
}
