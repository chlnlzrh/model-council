/**
 * Tests for Fact-Check mode:
 * - parseClaims
 * - parseVerifications
 * - calculateConsensus
 * - parseReliabilityScore
 * - countWords
 * - buildGeneratePrompt
 * - buildExtractionPrompt
 * - buildVerificationPrompt
 * - buildReportPrompt
 * - DEFAULT_FACT_CHECK_CONFIG
 */

import { describe, it, expect } from "vitest";
import {
  parseClaims,
  parseVerifications,
  calculateConsensus,
  parseReliabilityScore,
  countWords,
  buildGeneratePrompt,
  buildExtractionPrompt,
  buildVerificationPrompt,
  buildReportPrompt,
  DEFAULT_FACT_CHECK_CONFIG,
} from "@/lib/council/modes/fact-check";
import type {
  ExtractedClaim,
  ClaimVerification,
  ClaimType,
  Verdict,
  ConfidenceLevel,
} from "@/lib/council/modes/fact-check";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClaimText(count: number): string {
  const types: ClaimType[] = [
    "STATISTIC",
    "DATE",
    "ATTRIBUTION",
    "TECHNICAL",
    "COMPARISON",
    "CAUSAL",
  ];
  return Array.from({ length: count }, (_, i) => {
    const num = i + 1;
    const type = types[i % types.length];
    return `CLAIM ${num}: Claim text number ${num}
Context: Context for claim ${num}
Type: ${type}`;
  }).join("\n\n");
}

function makeClaim(overrides: Partial<ExtractedClaim> = {}): ExtractedClaim {
  return {
    id: "claim_1",
    claim: "Test claim",
    context: "Test context",
    type: "STATISTIC",
    ...overrides,
  };
}

function makeVerification(
  overrides: Partial<ClaimVerification> = {}
): ClaimVerification {
  return {
    claimId: "claim_1",
    verdict: "VERIFIED",
    evidence: "Supporting evidence",
    correction: null,
    confidence: "HIGH",
    checkerModel: "model-a",
    ...overrides,
  };
}

function makeVerificationText(
  claims: ExtractedClaim[],
  verdicts: Verdict[] = []
): string {
  return claims
    .map((claim, i) => {
      const verdict = verdicts[i] ?? "VERIFIED";
      const correction =
        verdict === "DISPUTED" ? "The correct information" : "N/A";
      return `VERIFICATION ${claim.id}: ${verdict}
Evidence: Evidence for ${claim.id}
Correction: ${correction}
Confidence: HIGH`;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// parseClaims
// ---------------------------------------------------------------------------

describe("parseClaims", () => {
  it("parses 3 claims correctly", () => {
    const text = makeClaimText(3);
    const claims = parseClaims(text);
    expect(claims).toHaveLength(3);
    expect(claims[0].id).toBe("claim_1");
    expect(claims[1].id).toBe("claim_2");
    expect(claims[2].id).toBe("claim_3");
  });

  it("extracts claim text, context, and type", () => {
    const text = `CLAIM 1: The Earth is 4.5 billion years old
Context: Scientists estimate the Earth is 4.5 billion years old.
Type: STATISTIC`;
    const claims = parseClaims(text);
    expect(claims).toHaveLength(1);
    expect(claims[0].claim).toBe("The Earth is 4.5 billion years old");
    expect(claims[0].context).toBe(
      "Scientists estimate the Earth is 4.5 billion years old."
    );
    expect(claims[0].type).toBe("STATISTIC");
  });

  it("handles all 6 claim types", () => {
    const text = makeClaimText(6);
    const claims = parseClaims(text);
    expect(claims).toHaveLength(6);
    const types = claims.map((c) => c.type);
    expect(types).toContain("STATISTIC");
    expect(types).toContain("DATE");
    expect(types).toContain("ATTRIBUTION");
    expect(types).toContain("TECHNICAL");
    expect(types).toContain("COMPARISON");
    expect(types).toContain("CAUSAL");
  });

  it("generates correct IDs from claim numbers", () => {
    const text = `CLAIM 5: Claim five
Context: Context five
Type: DATE

CLAIM 10: Claim ten
Context: Context ten
Type: STATISTIC`;
    const claims = parseClaims(text);
    expect(claims).toHaveLength(2);
    expect(claims[0].id).toBe("claim_5");
    expect(claims[1].id).toBe("claim_10");
  });

  it("deduplicates claims by exact string", () => {
    const text = `CLAIM 1: Duplicate claim
Context: Context one
Type: STATISTIC

CLAIM 2: Duplicate claim
Context: Context two
Type: DATE`;
    const claims = parseClaims(text);
    expect(claims).toHaveLength(1);
    expect(claims[0].id).toBe("claim_1");
  });

  it("returns empty array for empty input", () => {
    expect(parseClaims("")).toEqual([]);
    expect(parseClaims("  ")).toEqual([]);
  });

  it("returns empty array for null-like input", () => {
    expect(parseClaims(undefined as unknown as string)).toEqual([]);
    expect(parseClaims(null as unknown as string)).toEqual([]);
  });

  it("handles case-insensitive CLAIM keyword", () => {
    const text = `claim 1: Lower case claim
Context: Context here
Type: STATISTIC`;
    const claims = parseClaims(text);
    expect(claims).toHaveLength(1);
    expect(claims[0].claim).toBe("Lower case claim");
  });

  it("handles case-insensitive Type value", () => {
    const text = `CLAIM 1: Some claim
Context: Some context
Type: statistic`;
    const claims = parseClaims(text);
    expect(claims).toHaveLength(1);
    expect(claims[0].type).toBe("STATISTIC");
  });

  it("parses a single claim", () => {
    const text = `CLAIM 1: Only one claim here
Context: The only context
Type: TECHNICAL`;
    const claims = parseClaims(text);
    expect(claims).toHaveLength(1);
    expect(claims[0].type).toBe("TECHNICAL");
  });

  it("skips claims with missing Type field", () => {
    const text = `CLAIM 1: Good claim
Context: Good context
Type: DATE

CLAIM 2: Bad claim missing type
Context: Some context`;
    const claims = parseClaims(text);
    expect(claims).toHaveLength(1);
    expect(claims[0].id).toBe("claim_1");
  });

  it("handles non-sequential numbering", () => {
    const text = `CLAIM 3: Third claim
Context: Context three
Type: ATTRIBUTION

CLAIM 7: Seventh claim
Context: Context seven
Type: CAUSAL`;
    const claims = parseClaims(text);
    expect(claims).toHaveLength(2);
    expect(claims[0].id).toBe("claim_3");
    expect(claims[1].id).toBe("claim_7");
  });

  it("handles text with unrelated content before and after", () => {
    const text = `Here is some preamble text.

CLAIM 1: A valid claim
Context: Valid context
Type: COMPARISON

Some trailing text here.

EXTRACTION SUMMARY:
Total claims: 1`;
    const claims = parseClaims(text);
    expect(claims).toHaveLength(1);
    expect(claims[0].type).toBe("COMPARISON");
  });

  it("trims whitespace from claim and context", () => {
    const text = `CLAIM 1:   Spaced out claim
Context:   Spaced context
Type: STATISTIC`;
    const claims = parseClaims(text);
    expect(claims).toHaveLength(1);
    expect(claims[0].claim).toBe("Spaced out claim");
    expect(claims[0].context).toBe("Spaced context");
  });

  it("skips invalid type values", () => {
    const text = `CLAIM 1: Good claim
Context: Good context
Type: STATISTIC

CLAIM 2: Bad type claim
Context: Some context
Type: OPINION`;
    const claims = parseClaims(text);
    expect(claims).toHaveLength(1);
    expect(claims[0].id).toBe("claim_1");
  });

  it("parses many claims efficiently", () => {
    const text = makeClaimText(20);
    const claims = parseClaims(text);
    expect(claims).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// parseVerifications
// ---------------------------------------------------------------------------

describe("parseVerifications", () => {
  const claims = [
    makeClaim({ id: "claim_1" }),
    makeClaim({ id: "claim_2", claim: "Second claim" }),
    makeClaim({ id: "claim_3", claim: "Third claim" }),
  ];
  const expectedIds = claims.map((c) => c.id);

  it("parses 3-claim verification correctly", () => {
    const text = makeVerificationText(claims);
    const results = parseVerifications(text, "model-a", expectedIds);
    expect(results).toHaveLength(3);
    expect(results[0].claimId).toBe("claim_1");
    expect(results[1].claimId).toBe("claim_2");
    expect(results[2].claimId).toBe("claim_3");
  });

  it("parses all three verdict types", () => {
    const text = makeVerificationText(
      claims,
      ["VERIFIED", "DISPUTED", "UNVERIFIABLE"]
    );
    const results = parseVerifications(text, "model-a", expectedIds);
    expect(results[0].verdict).toBe("VERIFIED");
    expect(results[1].verdict).toBe("DISPUTED");
    expect(results[2].verdict).toBe("UNVERIFIABLE");
  });

  it("extracts evidence text", () => {
    const text = makeVerificationText(claims);
    const results = parseVerifications(text, "model-a", expectedIds);
    expect(results[0].evidence).toBe("Evidence for claim_1");
  });

  it("extracts correction for DISPUTED verdicts", () => {
    const text = makeVerificationText(claims, ["DISPUTED", "VERIFIED", "VERIFIED"]);
    const results = parseVerifications(text, "model-a", expectedIds);
    expect(results[0].correction).toBe("The correct information");
    expect(results[1].correction).toBeNull();
  });

  it("normalizes N/A correction to null for VERIFIED", () => {
    const text = `VERIFICATION claim_1: VERIFIED
Evidence: Supporting evidence
Correction: N/A
Confidence: HIGH`;
    const results = parseVerifications(text, "model-a", ["claim_1"]);
    expect(results[0].correction).toBeNull();
  });

  it("normalizes N/A correction to null for DISPUTED", () => {
    const text = `VERIFICATION claim_1: DISPUTED
Evidence: Counter evidence
Correction: N/A
Confidence: MEDIUM`;
    const results = parseVerifications(text, "model-a", ["claim_1"]);
    expect(results[0].correction).toBeNull();
  });

  it("fills missing claims as UNVERIFIABLE", () => {
    const text = `VERIFICATION claim_1: VERIFIED
Evidence: Some evidence
Correction: N/A
Confidence: HIGH`;
    const results = parseVerifications(text, "model-a", [
      "claim_1",
      "claim_2",
    ]);
    expect(results).toHaveLength(2);
    expect(results[1].verdict).toBe("UNVERIFIABLE");
    expect(results[1].evidence).toBe("Checker did not address this claim");
  });

  it("returns all UNVERIFIABLE for empty text", () => {
    const results = parseVerifications("", "model-a", expectedIds);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.verdict === "UNVERIFIABLE")).toBe(true);
    expect(results.every((r) => r.confidence === "LOW")).toBe(true);
  });

  it("returns all UNVERIFIABLE for whitespace-only text", () => {
    const results = parseVerifications("   ", "model-a", expectedIds);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.verdict === "UNVERIFIABLE")).toBe(true);
  });

  it("drops unrecognized claim IDs", () => {
    const text = `VERIFICATION claim_1: VERIFIED
Evidence: Good
Correction: N/A
Confidence: HIGH

VERIFICATION claim_99: VERIFIED
Evidence: Unknown claim
Correction: N/A
Confidence: HIGH`;
    const results = parseVerifications(text, "model-a", ["claim_1"]);
    expect(results).toHaveLength(1);
    expect(results[0].claimId).toBe("claim_1");
  });

  it("assigns checkerModel correctly", () => {
    const text = makeVerificationText([claims[0]]);
    const results = parseVerifications(text, "google/gemini", ["claim_1"]);
    expect(results[0].checkerModel).toBe("google/gemini");
  });

  it("handles case-insensitive VERIFICATION keyword", () => {
    const text = `verification claim_1: verified
Evidence: Evidence here
Correction: N/A
Confidence: high`;
    const results = parseVerifications(text, "model-a", ["claim_1"]);
    expect(results).toHaveLength(1);
    expect(results[0].verdict).toBe("VERIFIED");
    expect(results[0].confidence).toBe("HIGH");
  });

  it("handles case-insensitive claim IDs", () => {
    const text = `VERIFICATION CLAIM_1: VERIFIED
Evidence: Evidence here
Correction: N/A
Confidence: HIGH`;
    const results = parseVerifications(text, "model-a", ["claim_1"]);
    expect(results).toHaveLength(1);
    expect(results[0].claimId).toBe("claim_1");
  });

  it("preserves order matching expectedClaimIds", () => {
    const text = `VERIFICATION claim_3: VERIFIED
Evidence: Third
Correction: N/A
Confidence: HIGH

VERIFICATION claim_1: DISPUTED
Evidence: First
Correction: Some correction
Confidence: MEDIUM`;
    const results = parseVerifications(text, "model-a", [
      "claim_1",
      "claim_2",
      "claim_3",
    ]);
    expect(results[0].claimId).toBe("claim_1");
    expect(results[0].verdict).toBe("DISPUTED");
    expect(results[1].claimId).toBe("claim_2");
    expect(results[1].verdict).toBe("UNVERIFIABLE");
    expect(results[2].claimId).toBe("claim_3");
    expect(results[2].verdict).toBe("VERIFIED");
  });

  it("extracts confidence levels correctly", () => {
    const text = `VERIFICATION claim_1: VERIFIED
Evidence: Test
Correction: N/A
Confidence: LOW

VERIFICATION claim_2: DISPUTED
Evidence: Test
Correction: Fix
Confidence: MEDIUM

VERIFICATION claim_3: VERIFIED
Evidence: Test
Correction: N/A
Confidence: HIGH`;
    const results = parseVerifications(text, "model-a", expectedIds);
    expect(results[0].confidence).toBe("LOW");
    expect(results[1].confidence).toBe("MEDIUM");
    expect(results[2].confidence).toBe("HIGH");
  });

  it("returns all UNVERIFIABLE for null input", () => {
    const results = parseVerifications(
      null as unknown as string,
      "model-a",
      expectedIds
    );
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.verdict === "UNVERIFIABLE")).toBe(true);
  });

  it("handles single expected claim ID", () => {
    const text = `VERIFICATION claim_1: VERIFIED
Evidence: Good evidence
Correction: N/A
Confidence: HIGH`;
    const results = parseVerifications(text, "model-a", ["claim_1"]);
    expect(results).toHaveLength(1);
    expect(results[0].verdict).toBe("VERIFIED");
  });
});

// ---------------------------------------------------------------------------
// calculateConsensus
// ---------------------------------------------------------------------------

describe("calculateConsensus", () => {
  const claims = [
    makeClaim({ id: "claim_1", claim: "First claim", context: "Ctx 1" }),
    makeClaim({
      id: "claim_2",
      claim: "Second claim",
      context: "Ctx 2",
      type: "DATE",
    }),
  ];

  it("returns unanimous VERIFIED consensus", () => {
    const verifications: ClaimVerification[][] = [
      [
        makeVerification({ claimId: "claim_1", verdict: "VERIFIED" }),
        makeVerification({ claimId: "claim_2", verdict: "VERIFIED" }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          checkerModel: "model-b",
        }),
        makeVerification({
          claimId: "claim_2",
          verdict: "VERIFIED",
          checkerModel: "model-b",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          checkerModel: "model-c",
        }),
        makeVerification({
          claimId: "claim_2",
          verdict: "VERIFIED",
          checkerModel: "model-c",
        }),
      ],
    ];
    const result = calculateConsensus(claims, verifications);
    expect(result[0].consensusVerdict).toBe("VERIFIED");
    expect(result[0].agreementRate).toBe(100);
    expect(result[1].consensusVerdict).toBe("VERIFIED");
  });

  it("returns unanimous DISPUTED consensus", () => {
    const verifications: ClaimVerification[][] = [
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          correction: "Fix",
        }),
        makeVerification({ claimId: "claim_2", verdict: "DISPUTED", correction: "Fix2" }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          correction: "Fix",
          checkerModel: "model-b",
        }),
        makeVerification({
          claimId: "claim_2",
          verdict: "DISPUTED",
          correction: "Fix2",
          checkerModel: "model-b",
        }),
      ],
    ];
    const result = calculateConsensus(claims, verifications);
    expect(result[0].consensusVerdict).toBe("DISPUTED");
    expect(result[0].agreementRate).toBe(100);
    expect(result[0].correction).toBe("Fix");
  });

  it("returns unanimous UNVERIFIABLE consensus", () => {
    const verifications: ClaimVerification[][] = [
      [
        makeVerification({ claimId: "claim_1", verdict: "UNVERIFIABLE" }),
        makeVerification({ claimId: "claim_2", verdict: "UNVERIFIABLE" }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "UNVERIFIABLE",
          checkerModel: "model-b",
        }),
        makeVerification({
          claimId: "claim_2",
          verdict: "UNVERIFIABLE",
          checkerModel: "model-b",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "UNVERIFIABLE",
          checkerModel: "model-c",
        }),
        makeVerification({
          claimId: "claim_2",
          verdict: "UNVERIFIABLE",
          checkerModel: "model-c",
        }),
      ],
    ];
    const result = calculateConsensus(claims, verifications);
    expect(result[0].consensusVerdict).toBe("UNVERIFIABLE");
    expect(result[0].agreementRate).toBe(100);
  });

  it("majority VERIFIED wins (2 vs 1)", () => {
    const verifications: ClaimVerification[][] = [
      [makeVerification({ claimId: "claim_1", verdict: "VERIFIED" })],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          checkerModel: "model-b",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          checkerModel: "model-c",
          correction: "Some correction",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].consensusVerdict).toBe("VERIFIED");
    expect(result[0].agreementRate).toBe(67);
  });

  it("majority DISPUTED wins (2 vs 1)", () => {
    const verifications: ClaimVerification[][] = [
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          correction: "Fix",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          checkerModel: "model-b",
          correction: "Fix",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          checkerModel: "model-c",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].consensusVerdict).toBe("DISPUTED");
    expect(result[0].agreementRate).toBe(67);
    expect(result[0].correction).toBe("Fix");
  });

  it("majority UNVERIFIABLE wins (2 vs 1)", () => {
    const verifications: ClaimVerification[][] = [
      [makeVerification({ claimId: "claim_1", verdict: "UNVERIFIABLE" })],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "UNVERIFIABLE",
          checkerModel: "model-b",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          checkerModel: "model-c",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].consensusVerdict).toBe("UNVERIFIABLE");
    expect(result[0].agreementRate).toBe(67);
  });

  it("tie VERIFIED vs DISPUTED resolves to DISPUTED (conservative)", () => {
    const verifications: ClaimVerification[][] = [
      [makeVerification({ claimId: "claim_1", verdict: "VERIFIED" })],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          checkerModel: "model-b",
          correction: "Fix",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].consensusVerdict).toBe("DISPUTED");
    expect(result[0].agreementRate).toBe(50);
  });

  it("tie VERIFIED vs UNVERIFIABLE resolves to VERIFIED", () => {
    const verifications: ClaimVerification[][] = [
      [makeVerification({ claimId: "claim_1", verdict: "VERIFIED" })],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "UNVERIFIABLE",
          checkerModel: "model-b",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].consensusVerdict).toBe("VERIFIED");
    expect(result[0].agreementRate).toBe(50);
  });

  it("tie DISPUTED vs UNVERIFIABLE resolves to DISPUTED", () => {
    const verifications: ClaimVerification[][] = [
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          correction: "Fix",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "UNVERIFIABLE",
          checkerModel: "model-b",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].consensusVerdict).toBe("DISPUTED");
    expect(result[0].agreementRate).toBe(50);
  });

  it("three-way tie resolves to DISPUTED", () => {
    const verifications: ClaimVerification[][] = [
      [makeVerification({ claimId: "claim_1", verdict: "VERIFIED" })],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          checkerModel: "model-b",
          correction: "Fix",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "UNVERIFIABLE",
          checkerModel: "model-c",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].consensusVerdict).toBe("DISPUTED");
    expect(result[0].agreementRate).toBe(33);
  });

  it("calculates agreement rate correctly", () => {
    // 2 VERIFIED, 1 DISPUTED out of 3
    const verifications: ClaimVerification[][] = [
      [makeVerification({ claimId: "claim_1", verdict: "VERIFIED" })],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          checkerModel: "model-b",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          checkerModel: "model-c",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].agreementRate).toBe(67); // 2/3 = 66.67 → rounded to 67
  });

  it("resolves confidence from majority verdicts", () => {
    const verifications: ClaimVerification[][] = [
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          confidence: "HIGH",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          confidence: "MEDIUM",
          checkerModel: "model-b",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          confidence: "HIGH",
          checkerModel: "model-c",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].consensusConfidence).toBe("HIGH"); // 2 HIGH vs 1 MEDIUM
  });

  it("populates correction for DISPUTED consensus", () => {
    const verifications: ClaimVerification[][] = [
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          correction: "Correction A",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          checkerModel: "model-b",
          correction: "Correction A",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          checkerModel: "model-c",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].correction).toBe("Correction A");
  });

  it("returns null correction for VERIFIED consensus", () => {
    const verifications: ClaimVerification[][] = [
      [makeVerification({ claimId: "claim_1", verdict: "VERIFIED" })],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          checkerModel: "model-b",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].correction).toBeNull();
  });

  it("returns null correction for UNVERIFIABLE consensus", () => {
    const verifications: ClaimVerification[][] = [
      [makeVerification({ claimId: "claim_1", verdict: "UNVERIFIABLE" })],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "UNVERIFIABLE",
          checkerModel: "model-b",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].correction).toBeNull();
  });

  it("handles single checker", () => {
    const verifications: ClaimVerification[][] = [
      [makeVerification({ claimId: "claim_1", verdict: "VERIFIED" })],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].consensusVerdict).toBe("VERIFIED");
    expect(result[0].agreementRate).toBe(100);
  });

  it("returns empty array for empty claims", () => {
    const result = calculateConsensus([], []);
    expect(result).toEqual([]);
  });

  it("preserves claim metadata (claim text, context, type)", () => {
    const verifications: ClaimVerification[][] = [
      [makeVerification({ claimId: "claim_1", verdict: "VERIFIED" })],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].claim).toBe("First claim");
    expect(result[0].context).toBe("Ctx 1");
    expect(result[0].type).toBe("STATISTIC");
  });

  it("handles multiple claims with different verdicts", () => {
    const verifications: ClaimVerification[][] = [
      [
        makeVerification({ claimId: "claim_1", verdict: "VERIFIED" }),
        makeVerification({ claimId: "claim_2", verdict: "DISPUTED", correction: "Fix" }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          checkerModel: "model-b",
        }),
        makeVerification({
          claimId: "claim_2",
          verdict: "DISPUTED",
          checkerModel: "model-b",
          correction: "Fix",
        }),
      ],
    ];
    const result = calculateConsensus(claims, verifications);
    expect(result[0].consensusVerdict).toBe("VERIFIED");
    expect(result[1].consensusVerdict).toBe("DISPUTED");
    expect(result[1].correction).toBe("Fix");
  });

  it("selects most common correction among DISPUTED verdicts", () => {
    const verifications: ClaimVerification[][] = [
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          correction: "Correction A",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          checkerModel: "model-b",
          correction: "Correction B",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          checkerModel: "model-c",
          correction: "Correction A",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].correction).toBe("Correction A"); // 2 vs 1
  });

  it("handles claims with no matching verifications gracefully", () => {
    // No verifications for claim_1
    const verifications: ClaimVerification[][] = [
      [makeVerification({ claimId: "claim_2", verdict: "VERIFIED" })],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].consensusVerdict).toBe("UNVERIFIABLE");
    expect(result[0].agreementRate).toBe(0);
  });

  it("handles 4 checkers with clear majority", () => {
    const verifications: ClaimVerification[][] = [
      [makeVerification({ claimId: "claim_1", verdict: "VERIFIED" })],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          checkerModel: "model-b",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "VERIFIED",
          checkerModel: "model-c",
        }),
      ],
      [
        makeVerification({
          claimId: "claim_1",
          verdict: "DISPUTED",
          checkerModel: "model-d",
        }),
      ],
    ];
    const result = calculateConsensus([claims[0]], verifications);
    expect(result[0].consensusVerdict).toBe("VERIFIED");
    expect(result[0].agreementRate).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// parseReliabilityScore
// ---------------------------------------------------------------------------

describe("parseReliabilityScore", () => {
  it("parses a valid score", () => {
    const text = "## Overall Reliability Score: 78\nSome justification.";
    expect(parseReliabilityScore(text)).toBe(78);
  });

  it("parses score of 0", () => {
    const text = "Reliability Score: 0";
    expect(parseReliabilityScore(text)).toBe(0);
  });

  it("parses score of 100", () => {
    const text = "Reliability Score: 100";
    expect(parseReliabilityScore(text)).toBe(100);
  });

  it("clamps score above 100", () => {
    const text = "Reliability Score: 150";
    expect(parseReliabilityScore(text)).toBe(100);
  });

  it("handles case insensitivity", () => {
    const text = "reliability score: 85";
    expect(parseReliabilityScore(text)).toBe(85);
  });

  it("returns null for empty input", () => {
    expect(parseReliabilityScore("")).toBeNull();
    expect(parseReliabilityScore("  ")).toBeNull();
  });

  it("returns null for null-like input", () => {
    expect(parseReliabilityScore(null as unknown as string)).toBeNull();
    expect(parseReliabilityScore(undefined as unknown as string)).toBeNull();
  });

  it("returns null when score not found", () => {
    const text = "This is a report with no score.";
    expect(parseReliabilityScore(text)).toBeNull();
  });

  it("parses score embedded in larger text", () => {
    const text = `# Fact-Check Report

## Content Summary
Overview of the topic.

## Overall Reliability Score: 92
Highly reliable content.

## Evidence Table
...`;
    expect(parseReliabilityScore(text)).toBe(92);
  });

  it("handles extra whitespace around score", () => {
    const text = "Reliability Score:   42  ";
    expect(parseReliabilityScore(text)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------

describe("countWords", () => {
  it("counts words in a normal sentence", () => {
    expect(countWords("hello world foo bar")).toBe(4);
  });

  it("handles multiple spaces", () => {
    expect(countWords("hello   world    foo")).toBe(3);
  });

  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
  });

  it("handles newlines and tabs", () => {
    expect(countWords("hello\nworld\tfoo")).toBe(3);
  });

  it("counts a single word", () => {
    expect(countWords("word")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildGeneratePrompt
// ---------------------------------------------------------------------------

describe("buildGeneratePrompt", () => {
  it("contains the user query", () => {
    const prompt = buildGeneratePrompt("What is quantum computing?");
    expect(prompt).toContain("What is quantum computing?");
  });

  it("contains the QUESTION marker", () => {
    const prompt = buildGeneratePrompt("test");
    expect(prompt).toContain("QUESTION:");
  });

  it("contains instruction for facts and statistics", () => {
    const prompt = buildGeneratePrompt("test");
    expect(prompt).toContain("facts");
    expect(prompt).toContain("statistics");
  });

  it("instructs comprehensive response", () => {
    const prompt = buildGeneratePrompt("test");
    expect(prompt).toContain("comprehensively");
  });
});

// ---------------------------------------------------------------------------
// buildExtractionPrompt
// ---------------------------------------------------------------------------

describe("buildExtractionPrompt", () => {
  it("contains the content", () => {
    const prompt = buildExtractionPrompt("The sky is blue. Water is wet.");
    expect(prompt).toContain("The sky is blue. Water is wet.");
  });

  it("contains the CONTENT marker", () => {
    const prompt = buildExtractionPrompt("test");
    expect(prompt).toContain("CONTENT:");
  });

  it("mentions all claim types", () => {
    const prompt = buildExtractionPrompt("test");
    expect(prompt).toContain("STATISTIC");
    expect(prompt).toContain("DATE");
    expect(prompt).toContain("ATTRIBUTION");
    expect(prompt).toContain("TECHNICAL");
    expect(prompt).toContain("COMPARISON");
    expect(prompt).toContain("CAUSAL");
  });

  it("contains format instructions", () => {
    const prompt = buildExtractionPrompt("test");
    expect(prompt).toContain("CLAIM 1:");
    expect(prompt).toContain("Context:");
    expect(prompt).toContain("Type:");
  });

  it("contains exclusion rules", () => {
    const prompt = buildExtractionPrompt("test");
    expect(prompt).toContain("Opinions");
    expect(prompt).toContain("predictions");
  });
});

// ---------------------------------------------------------------------------
// buildVerificationPrompt
// ---------------------------------------------------------------------------

describe("buildVerificationPrompt", () => {
  const testClaims = [
    makeClaim({ id: "claim_1", claim: "Claim one", context: "Ctx one" }),
    makeClaim({
      id: "claim_2",
      claim: "Claim two",
      context: "Ctx two",
      type: "DATE",
    }),
  ];

  it("contains the content", () => {
    const prompt = buildVerificationPrompt("Content here", testClaims);
    expect(prompt).toContain("Content here");
  });

  it("contains all claims", () => {
    const prompt = buildVerificationPrompt("Content", testClaims);
    expect(prompt).toContain("Claim one");
    expect(prompt).toContain("Claim two");
  });

  it("contains claim IDs", () => {
    const prompt = buildVerificationPrompt("Content", testClaims);
    expect(prompt).toContain("claim_1");
    expect(prompt).toContain("claim_2");
  });

  it("contains claim types", () => {
    const prompt = buildVerificationPrompt("Content", testClaims);
    expect(prompt).toContain("STATISTIC");
    expect(prompt).toContain("DATE");
  });

  it("contains verdict format instructions", () => {
    const prompt = buildVerificationPrompt("Content", testClaims);
    expect(prompt).toContain("VERIFIED");
    expect(prompt).toContain("DISPUTED");
    expect(prompt).toContain("UNVERIFIABLE");
  });

  it("contains evidence and correction format", () => {
    const prompt = buildVerificationPrompt("Content", testClaims);
    expect(prompt).toContain("Evidence:");
    expect(prompt).toContain("Correction:");
    expect(prompt).toContain("Confidence:");
  });
});

// ---------------------------------------------------------------------------
// buildReportPrompt
// ---------------------------------------------------------------------------

describe("buildReportPrompt", () => {
  const testConsensus = [
    {
      claimId: "claim_1",
      claim: "First claim",
      context: "Context one",
      type: "STATISTIC",
      verdicts: [
        makeVerification({ claimId: "claim_1", verdict: "VERIFIED" }),
      ],
      consensusVerdict: "VERIFIED" as Verdict,
      consensusConfidence: "HIGH" as ConfidenceLevel,
      agreementRate: 100,
      correction: null,
    },
  ];

  const testStats = {
    totalClaims: 1,
    checkerCount: 3,
    verifiedCount: 1,
    disputedCount: 0,
    unverifiableCount: 0,
    extractorModel: "anthropic/claude-opus-4-6",
    checkerModels: ["openai/o3", "google/gemini-2.5-pro"],
    reporterModel: "anthropic/claude-opus-4-6",
  };

  it("contains the content", () => {
    const prompt = buildReportPrompt("Original content", testConsensus, testStats);
    expect(prompt).toContain("Original content");
  });

  it("contains consensus data", () => {
    const prompt = buildReportPrompt("Content", testConsensus, testStats);
    expect(prompt).toContain("First claim");
    expect(prompt).toContain("VERIFIED");
    expect(prompt).toContain("100%");
  });

  it("contains statistics", () => {
    const prompt = buildReportPrompt("Content", testConsensus, testStats);
    expect(prompt).toContain("Total claims extracted: 1");
    expect(prompt).toContain("Independent checkers: 3");
  });

  it("contains reliability score instruction", () => {
    const prompt = buildReportPrompt("Content", testConsensus, testStats);
    expect(prompt).toContain("Reliability Score:");
    expect(prompt).toContain("0-100");
  });

  it("contains evidence table format", () => {
    const prompt = buildReportPrompt("Content", testConsensus, testStats);
    expect(prompt).toContain("Evidence Table");
    expect(prompt).toContain("Verdict");
    expect(prompt).toContain("Agreement");
  });

  it("contains methodology section", () => {
    const prompt = buildReportPrompt("Content", testConsensus, testStats);
    expect(prompt).toContain("Methodology");
    expect(prompt).toContain("anthropic/claude-opus-4-6");
    expect(prompt).toContain("openai/o3");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_FACT_CHECK_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_FACT_CHECK_CONFIG", () => {
  it("has extractorModel set to claude-opus-4-6", () => {
    expect(DEFAULT_FACT_CHECK_CONFIG.extractorModel).toBe(
      "anthropic/claude-opus-4-6"
    );
  });

  it("has 3 checker models", () => {
    expect(DEFAULT_FACT_CHECK_CONFIG.checkerModels).toHaveLength(3);
  });

  it("includes diverse checker models", () => {
    const checkers = DEFAULT_FACT_CHECK_CONFIG.checkerModels;
    expect(checkers).toContain("openai/o3");
    expect(checkers).toContain("google/gemini-2.5-pro");
    expect(checkers).toContain("anthropic/claude-opus-4-6");
  });

  it("has reporterModel set to claude-opus-4-6", () => {
    expect(DEFAULT_FACT_CHECK_CONFIG.reporterModel).toBe(
      "anthropic/claude-opus-4-6"
    );
  });

  it("has maxContentLength of 20_000", () => {
    expect(DEFAULT_FACT_CHECK_CONFIG.maxContentLength).toBe(20_000);
  });

  it("has timeoutMs of 120_000", () => {
    expect(DEFAULT_FACT_CHECK_CONFIG.timeoutMs).toBe(120_000);
  });

  it("has no generatorModel by default", () => {
    expect(DEFAULT_FACT_CHECK_CONFIG.generatorModel).toBeUndefined();
  });

  it("has no contentToCheck by default", () => {
    expect(DEFAULT_FACT_CHECK_CONFIG.contentToCheck).toBeUndefined();
  });
});
