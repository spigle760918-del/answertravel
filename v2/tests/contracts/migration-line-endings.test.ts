import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  migrationChecksumCandidates,
  normalizeMigrationSql
} from "../../src/platform/migrations.js";

const hash = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

describe("migration line ending compatibility", () => {
  const lfSql = "create table probe (id integer);\ninsert into probe values (1);\n";
  const crlfSql = lfSql.replace(/\n/g, "\r\n");

  it("accepts a historical CRLF checksum when the current file uses LF", () => {
    expect(migrationChecksumCandidates(lfSql)).toContain(hash(crlfSql));
  });

  it("accepts a historical LF checksum when the current file uses CRLF", () => {
    expect(migrationChecksumCandidates(crlfSql)).toContain(hash(lfSql));
  });

  it("normalizes new migrations to LF before execution and checksum storage", () => {
    expect(normalizeMigrationSql(crlfSql)).toBe(lfSql);
  });

  it("rejects a checksum from genuinely different SQL", () => {
    const changedSql = lfSql.replace("values (1)", "values (2)");
    expect(migrationChecksumCandidates(lfSql)).not.toContain(hash(changedSql));
  });
});
