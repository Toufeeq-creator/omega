import fs from "node:fs";
import path from "node:path";
import {
  CEGISEngine,
  generateCandidates,
  testCandidate,
  generateFuzzPayloads,
  generateUnifiedDiff,
  generateAttestation,
  parseExpression,
  extractMemberAccessExpressions,
  extractSourceLocation,
  parseAST,
} from "../../src/recovery/cegis-engine.ts";
import { PrattParser, CodeGenerator } from "../../src/recovery/ast-parser.ts";
import { InvariantEvaluator } from "../../src/recovery/invariant-eval.ts";

// Colors for terminal reporting
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

async function runCEGISTestSuite() {
  console.log(`\n${c.bold}${c.magenta}${"═".repeat(78)}${c.reset}`);
  console.log(`${c.bold}${c.magenta}  MODUSFLOW OMEGA — CEGIS AST SELF-HEALING TEST SUITE                 ${c.reset}`);
  console.log(`${c.bold}${c.magenta}  (AST Fuzzing, Invariant Verification, Unified Diff, SHA-256 Sign)   ${c.reset}`);
  console.log(`${c.bold}${c.magenta}${"═".repeat(78)}${c.reset}\n`);

  let passed = 0;
  let failed = 0;

  // ── TEST 1: Expression Parsing & AST Analysis ─────────────────────────────
  try {
    console.log(`${c.cyan}[TEST 1]${c.reset} Expression Parsing & AST Structural Extraction`);
    
    const expr1 = "payload.data.attributes.amount";
    const ast1 = parseExpression(expr1);
    if (ast1.kind !== "member_access" || ast1.propertyChain?.length !== 4) {
      throw new Error(`Unexpected AST for ${expr1}: ${JSON.stringify(ast1)}`);
    }

    const expr2 = "response?.details?.status";
    const ast2 = parseExpression(expr2);
    if (ast2.kind !== "optional_chain") {
      throw new Error(`Unexpected AST for ${expr2}: ${JSON.stringify(ast2)}`);
    }

    const sourceLine = "  const total = response.data.charges.amount + fee.cost;";
    const extracted = extractMemberAccessExpressions(sourceLine);
    if (!extracted.includes("response.data.charges.amount") || !extracted.includes("fee.cost")) {
      throw new Error(`Failed to extract member access expressions: ${JSON.stringify(extracted)}`);
    }

    console.log(`  ${c.green}PASSED${c.reset} — Structural parser parsed AST chains and extracted expressions correctly.`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 2: Stack Trace Source Location Extractor ─────────────────────────
  try {
    console.log(`\n${c.cyan}[TEST 2]${c.reset} Stack Trace Surgical Location Extractor`);

    const mockStack = `TypeError: Cannot read properties of undefined (reading 'amount')
    at processSettlement (D:\\Mota Startup\\src\\agent\\settlement.ts:42:18)
    at async ProtectedExecution (D:\\Mota Startup\\src\\middleware\\protect.ts:113:16)`;

    const loc = extractSourceLocation(mockStack);
    if (!loc || loc.lineNumber !== 42 || !loc.filePath.includes("settlement.ts")) {
      throw new Error(`Failed to extract correct location from stack trace: ${JSON.stringify(loc)}`);
    }

    console.log(`  ${c.green}PASSED${c.reset} — Extracted target file '${path.basename(loc.filePath)}' at line ${loc.lineNumber}:${loc.columnNumber}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 3: Field Path Remap & Nested Schema Drift Synthesis ─────────────
  try {
    console.log(`\n${c.cyan}[TEST 3]${c.reset} Schema Drift Synthesis — Field Path Shift (data.amount → data.attributes.amount)`);

    const crashPayload = {
      data: {
        id: "tx_9981",
        attributes: {
          amount: 50000.0,
          currency: "USD",
        },
      },
    };

    // The legacy code called `data.amount`, which is undefined in the new API schema
    const failingExpr = "data.amount";
    const sampleSource = [
      "export async function processPayment(data) {",
      "  const settlementAmount = data.amount;",
      "  return { debits: settlementAmount, credits: settlementAmount };",
      "}",
    ].join("\n");

    const result = CEGISEngine.repair(
      failingExpr,
      2,
      crashPayload,
      ["result === 50000.0", "result > 0"],
      sampleSource,
      "src/agent/payment.ts"
    );

    if (!result.repairFound) {
      throw new Error("CEGIS failed to find a valid repair candidate.");
    }

    if (!result.winningCandidate) {
      throw new Error("Winning candidate missing.");
    }

    if (result.winningCandidate.patchedExpression !== "data.data.attributes.amount" &&
        result.winningCandidate.patchedExpression !== "data.attributes.amount") {
      throw new Error(`Unexpected winning expression: ${result.winningCandidate.patchedExpression}`);
    }

    if (!result.unifiedDiff || !result.unifiedDiff.includes("--- a/src/agent/payment.ts")) {
      throw new Error("Missing or invalid unified diff patch.");
    }

    if (!result.attestation || !result.attestation.attestationHash) {
      throw new Error("Missing cryptographic attestation certificate.");
    }

    console.log(`  ${c.green}PASSED${c.reset} — Synthesized repair: ${c.bold}${result.winningCandidate.patchedExpression}${c.reset}`);
    console.log(`  ${c.yellow}         Strategy: ${result.winningCandidate.strategy}, Evaluated ${result.candidatesEvaluated} candidates`);
    console.log(`  ${c.yellow}         Diff lines:${c.reset}\n${result.unifiedDiff.split("\n").map(l => "           " + l).join("\n")}`);
    console.log(`  ${c.yellow}         Attestation SHA-256: ${result.attestation.attestationHash.slice(0, 32)}...${c.reset}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 4: Unit Conversion Synthesis (Cents to Dollars) ──────────────────
  try {
    console.log(`\n${c.cyan}[TEST 4]${c.reset} Unit Conversion Synthesis (Stripe-style total_amount_cents / 100)`);

    const crashPayload = {
      customer: "cust_772",
      total_amount_cents: 5000000, // 50,000 USD represented in cents
      currency: "usd",
    };

    const failingExpr = "payload.total_amount";
    const sampleSource = [
      "export async function processInvoice(payload) {",
      "  const finalTotal = payload.total_amount;",
      "  return finalTotal;",
      "}",
    ].join("\n");

    const result = CEGISEngine.repair(
      failingExpr,
      2,
      crashPayload,
      ["result === 50000", "result > 0"],
      sampleSource,
      "src/agent/invoice.ts"
    );

    if (!result.repairFound) {
      throw new Error("CEGIS failed to synthesize unit conversion repair.");
    }

    if (!result.winningCandidate?.patchedExpression.includes("/ 100")) {
      throw new Error(`Expected unit conversion (/ 100) in patch, got: ${result.winningCandidate?.patchedExpression}`);
    }

    console.log(`  ${c.green}PASSED${c.reset} — Successfully synthesized unit conversion: ${c.bold}${result.winningCandidate.patchedExpression}${c.reset}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 5: Counterexample Extraction & Sandbox Fuzzing Loop ──────────────
  try {
    console.log(`\n${c.cyan}[TEST 5]${c.reset} CEGIS Refinement & Counterexample Extraction under Fuzzing`);

    const crashPayload = {
      order: {
        pricing: {
          subtotal: 1200,
        },
      },
    };

    // Candidates test with strict invariant
    const candidateBad = {
      id: "cand_bad",
      description: "faulty mutation",
      strategy: "null_coalesce" as const,
      originalExpression: "order.total",
      patchedExpression: "(order.total ?? 0)",
      lineNumber: 1,
      columnOffset: 0,
    };

    // Invariant requires positive revenue (> 0)
    const testRes = testCandidate(candidateBad, crashPayload, ["result > 0"]);
    if (testRes.passed) {
      throw new Error("Candidate should have failed invariant and produced a counterexample.");
    }

    if (!testRes.counterexample) {
      throw new Error("Expected counterexample to be captured.");
    }

    // Fuzz generation check
    const fuzzPayloads = generateFuzzPayloads(crashPayload, 5);
    if (fuzzPayloads.length !== 5) {
      throw new Error(`Expected 5 fuzz payloads, generated ${fuzzPayloads.length}`);
    }

    console.log(`  ${c.green}PASSED${c.reset} — Fuzz sandbox generated ${fuzzPayloads.length} payloads & isolated counterexample: ${testRes.counterexample.reason}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 6: Cryptographic Attestation Integrity ───────────────────────────
  try {
    console.log(`\n${c.cyan}[TEST 6]${c.reset} Cryptographic Attestation Certificate Tamper-Resistance`);

    const origSource = "const x = data.amount;";
    const patchedSource = "const x = data.attributes.amount;";
    const diff = "--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-const x = data.amount;\n+const x = data.attributes.amount;";

    const cert1 = generateAttestation(origSource, patchedSource, diff, 10, 2, 3);
    const cert2 = generateAttestation(origSource, patchedSource, diff, 10, 2, 3);

    if (cert1.attestationHash !== cert2.attestationHash) {
      throw new Error("Deterministic attestation hashing failed!");
    }

    // Tamper test: change one character in diff
    const tamperedCert = generateAttestation(origSource, patchedSource, diff + " ", 10, 2, 3);
    if (cert1.attestationHash === tamperedCert.attestationHash) {
      throw new Error("Attestation failed to detect tampered diff content!");
    }

    console.log(`  ${c.green}PASSED${c.reset} — Attestation is deterministic and tamper-evident: ${cert1.attestationHash}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 7: Pratt AST Formal Round-Trip & Bracket Indexing ─────────────────
  try {
    console.log(`\n${c.cyan}[TEST 7]${c.reset} Pratt AST Engine — Deep Bracket Indexing, Nullish Coalesce & Statements`);

    // Statement with bracket notation and arithmetic
    const sourceCode = 'const amount = (payload["data"]?.[0]?.amount_cents / 100) ?? 0;';
    const ast = parseAST(sourceCode);

    if (ast.type !== "VariableDeclaration") {
      throw new Error(`Expected VariableDeclaration AST, got ${ast.type}`);
    }

    const unparsed = CodeGenerator.generate(ast);
    if (!unparsed.includes('payload["data"]?.[0]?.amount_cents') || !unparsed.includes("/ 100")) {
      throw new Error(`Unparsed code deviation: ${unparsed}`);
    }

    console.log(`  ${c.green}PASSED${c.reset} — Pratt AST parsed statement, optional bracket chain, arithmetic, and unparsed cleanly:`);
    console.log(`  ${c.yellow}         Input:  ${sourceCode}${c.reset}`);
    console.log(`  ${c.yellow}         Output: ${unparsed}${c.reset}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 8: Syntax Trap Defense — Rejection of Broken Brackets & Malformed ASTs ──
  try {
    console.log(`\n${c.cyan}[TEST 8]${c.reset} Syntax Trap Defense — Rejection of Unclosed Brackets & Broken ASTs`);

    // 1. Pratt Parser must reject unclosed delimiters
    let caughtParen = false;
    try {
      parseAST("(data.amount + 10");
    } catch (e: any) {
      caughtParen = true;
    }
    if (!caughtParen) throw new Error("PrattParser failed to reject unclosed parenthesis");

    let caughtBracket = false;
    try {
      parseAST('data["amount"');
    } catch (e: any) {
      caughtBracket = true;
    }
    if (!caughtBracket) throw new Error("PrattParser failed to reject unclosed bracket");

    let caughtTrailing = false;
    try {
      parseAST("data.amount +");
    } catch (e: any) {
      caughtTrailing = true;
    }
    if (!caughtTrailing) throw new Error("PrattParser failed to reject trailing operator");

    console.log(`  ${c.green}PASSED${c.reset} — Pratt AST strictly rejected unclosed parens, unclosed brackets, and trailing operators.`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 9: Invariant Engine — JSON Type Poisoning Defense ───────────────
  try {
    console.log(`\n${c.cyan}[TEST 9]${c.reset} Invariant Engine — JSON Type Poisoning Defense (Null, NaN, Malformed Strings)`);

    // Financial balance: debits == credits
    // In naive JS: null == null, 0 == 0, undefined == undefined, "" == ""
    const nullPayload = { debits: null, credits: null };
    const emptyPayload = { debits: "", credits: "" };
    const nanPayload = { debits: NaN, credits: NaN };
    const missingPayload = {};
    const stringCoercion = { debits: "invalid_number", credits: "invalid_number" };

    const resNull = InvariantEvaluator.evaluateExpression("debits == credits", nullPayload);
    if (resNull.passed) throw new Error("JSON Type Poisoning: null values falsely evaluated as balanced!");

    const resEmpty = InvariantEvaluator.evaluateExpression("debits == credits", emptyPayload);
    if (resEmpty.passed) throw new Error("JSON Type Poisoning: empty string values falsely evaluated as balanced!");

    const resNaN = InvariantEvaluator.evaluateExpression("debits == credits", nanPayload);
    if (resNaN.passed) throw new Error("JSON Type Poisoning: NaN values falsely evaluated as balanced!");

    const resMissing = InvariantEvaluator.evaluateExpression("debits == credits", missingPayload);
    if (resMissing.passed) throw new Error("JSON Type Poisoning: missing values falsely evaluated as balanced!");

    const resStr = InvariantEvaluator.evaluateExpression("debits == credits", stringCoercion);
    if (resStr.passed) throw new Error("JSON Type Poisoning: unparseable strings falsely evaluated as balanced!");

    // Valid numeric strings and numbers must pass
    const validNumericString = { debits: "50000.00", credits: 50000.00 };
    const resValid = InvariantEvaluator.evaluateExpression("debits == credits", validNumericString);
    if (!resValid.passed) throw new Error("Valid numeric string failed strict evaluation!");

    console.log(`  ${c.green}PASSED${c.reset} — Strict numerical evaluation rejected null, NaN, empty strings, and missing keys.`);
    console.log(`  ${c.yellow}         Financial ledger balance cannot be tricked by JSON type poisoning.${c.reset}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  console.log(`\n${c.bold}${c.magenta}${"═".repeat(78)}${c.reset}`);
  console.log(`${c.bold}  CEGIS SELF-HEALING RESULTS: ${c.green}${passed} PASSED${c.reset} / ${failed > 0 ? c.red : c.green}${failed} FAILED${c.reset}`);
  console.log(`${c.bold}${c.magenta}${"═".repeat(78)}${c.reset}\n`);

  if (failed > 0) process.exit(1);
}

runCEGISTestSuite().catch((err) => {
  console.error("Fatal test runner crash:", err);
  process.exit(1);
});
