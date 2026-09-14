import { describe, expect, it, vi } from "vitest";
import {
  extractCitationCandidates,
  normalizeCitationUrl,
} from "../../src/modules/citation-source/citation-source.js";
import {
  assertPublicSourceUrl,
  SafeSourceFetcher,
  SourceFetchError,
} from "../../src/modules/citation-source/safe-source-fetcher.js";

describe("citation and source evidence contracts", () => {
  it("normalizes URLs without losing the original evidence value", () => {
    expect(
      normalizeCitationUrl(
        "HTTPS://Example.COM/path/?utm_source=x&b=2&a=1#part",
      ),
    ).toEqual({
      ok: true,
      canonicalUrl: "https://example.com/path?a=1&b=2",
      domain: "example.com",
    });
    expect(
      normalizeCitationUrl("https://name:secret@example.com/path"),
    ).toEqual({ ok: false, errorCode: "embedded_credentials" });
    expect(normalizeCitationUrl("file:///etc/passwd")).toEqual({
      ok: false,
      errorCode: "unsupported_protocol",
    });
  });

  it("separates inline links, source lists and provider citations", () => {
    const extracted = extractCitationCandidates(
      "正文 https://example.com/a?utm_medium=x\n参考来源：https://source.example/b。",
      {
        citations: [{ title: "结构化来源", url: "https://provider.example/c" }],
      },
    );
    expect(extracted.map((item) => [item.kind, item.canonicalUrl])).toEqual([
      ["inline_link", "https://example.com/a"],
      ["source_list", "https://source.example/b"],
      ["provider_citation", "https://provider.example/c"],
    ]);
  });

  it("blocks local and private destinations including redirect targets", async () => {
    await expect(
      assertPublicSourceUrl("http://127.0.0.1/admin"),
    ).rejects.toMatchObject({
      code: "private_address",
    } satisfies Partial<SourceFetchError>);
    await expect(
      assertPublicSourceUrl("https://internal.example", async () => [
        "10.0.0.8",
      ]),
    ).rejects.toMatchObject({
      code: "private_address",
    } satisfies Partial<SourceFetchError>);
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
    ) as typeof fetch;
    const result = await new SafeSourceFetcher({
      fetchImpl,
      lookupAddresses: async () => ["93.184.216.34"],
      allowedDomains: ["public.example"],
    }).capture("https://public.example/start");
    expect(result).toMatchObject({
      status: "blocked",
      errorCode: "domain_not_allowed",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("captures bounded public text with metadata and a content hash", async () => {
    const html =
      '<html><head><title>示例文章</title><meta name="author" content="作者甲"><meta property="article:published_time" content="2026-09-14"></head><body><h1>旅行建议</h1><p>真实正文</p></body></html>';
    const fetchImpl = (async () =>
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as typeof fetch;
    const result = await new SafeSourceFetcher({
      fetchImpl,
      lookupAddresses: async () => ["93.184.216.34"],
      allowedDomains: ["example.com"],
    }).capture("https://example.com/article");
    expect(result).toMatchObject({
      status: "succeeded",
      title: "示例文章",
      author: "作者甲",
      publishedAt: "2026-09-14",
      errorCode: null,
    });
    expect(result.textExcerpt).toContain("真实正文");
    expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("records unsupported content and oversized bodies as blocked evidence", async () => {
    const lookupAddresses = async () => ["93.184.216.34"];
    const binary = await new SafeSourceFetcher({
      lookupAddresses,
      allowedDomains: ["example.com"],
      fetchImpl: (async () =>
        new Response("x", {
          headers: { "content-type": "application/pdf" },
        })) as typeof fetch,
    }).capture("https://example.com/a.pdf");
    expect(binary).toMatchObject({
      status: "blocked",
      errorCode: "unsupported_content_type",
    });
    const large = await new SafeSourceFetcher({
      lookupAddresses,
      allowedDomains: ["example.com"],
      maximumBytes: 3,
      fetchImpl: (async () =>
        new Response("1234", {
          headers: { "content-type": "text/plain" },
        })) as typeof fetch,
    }).capture("https://example.com/large");
    expect(large).toMatchObject({
      status: "blocked",
      errorCode: "body_too_large",
    });
  });

  it("defaults to no network access until a domain is explicitly allowed", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await new SafeSourceFetcher({
      fetchImpl,
      lookupAddresses: async () => ["93.184.216.34"],
    }).capture("https://example.com/article");
    expect(result).toMatchObject({
      status: "blocked",
      errorCode: "domain_not_allowed",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
