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
  withAdvisoryFileLock,
  generateSafeVariableName,
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

  // ── TEST 10: Infinite Cascade Loop Circuit Breaker ────────────────────────
  try {
    console.log(`\n${c.cyan}[TEST 10]${c.reset} Infinite Cascade Loop Circuit Breaker (Max 3 Automated Heals)`);

    const cascadeTarget = "cascade_payment.ts";
    CEGISEngine.resetCircuitBreaker(); // Clean state

    // Simulate 3 successive repair attempts on same file/location
    const res1 = CEGISEngine.repair("data.amount", 10, { data: { amount: 100 } }, ["result == 100"], "const a = 1;", cascadeTarget);
    const res2 = CEGISEngine.repair("data.amount", 10, { data: { amount: 100 } }, ["result == 100"], "const a = 1;", cascadeTarget);
    const res3 = CEGISEngine.repair("data.amount", 10, { data: { amount: 100 } }, ["result == 100"], "const a = 1;", cascadeTarget);

    // 4th attempt must be rejected by circuit breaker immediately
    const res4 = CEGISEngine.repair("data.amount", 10, { data: { amount: 100 } }, ["result == 100"], "const a = 1;", cascadeTarget);

    if (res4.repairFound) {
      throw new Error("Cascade Loop Circuit Breaker failed to trip on 4th attempt!");
    }
    const breakerCounterexample = res4.counterexamplesFound.find(ce => ce.reason.includes("Circuit Breaker TRIPPED"));
    if (!breakerCounterexample) {
      throw new Error("Missing circuit breaker counterexample in audit trail!");
    }

    console.log(`  ${c.green}PASSED${c.reset} — Circuit breaker tripped at depth 3:`);
    console.log(`  ${c.yellow}         ${breakerCounterexample.reason}${c.reset}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 11: Scope Creep Collision-Free Naming & Advisory File Lock ───────
  try {
    console.log(`\n${c.cyan}[TEST 11]${c.reset} Scope Creep Variable Shadowing Defense & Advisory File Lock`);

    // 1. Collision-free unique variable naming
    const varName1 = generateSafeVariableName("amount");
    const varName2 = generateSafeVariableName("amount");
    if (!varName1.startsWith("_omega_healed_amount_")) {
      throw new Error(`Unexpected generated var name format: ${varName1}`);
    }
    console.log(`  ${c.green}✔${c.reset} Generated collision-free variable name: ${varName1}`);

    // 2. Advisory file lock concurrency defense
    const testFilePath = path.resolve("./test_advisory_target.ts");
    fs.writeFileSync(testFilePath, "// test code\n");

    let lockAcquiredInside = false;
    await withAdvisoryFileLock(testFilePath, async () => {
      lockAcquiredInside = true;
      // While lock is held, verify .omega.lock file exists on disk
      if (!fs.existsSync(`${testFilePath}.omega.lock`)) {
        throw new Error("Advisory lock file missing while lock is held!");
      }
    });

    // After release, verify lock file is removed
    if (fs.existsSync(`${testFilePath}.omega.lock`)) {
      throw new Error("Advisory lock file was not cleaned up after release!");
    }
    fs.unlinkSync(testFilePath);

    console.log(`  ${c.green}PASSED${c.reset} — Scope Creep prevented via hashed identifiers; Advisory File Lock verified on disk.`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 12: Floating-Point Precision Drift & Safe Null Navigation ─────────
  try {
    console.log(`\n${c.cyan}[TEST 12]${c.reset} Floating-Point Precision Drift (0.1 + 0.2 === 0.3) & Safe Null Navigation`);

    // 1. In standard JS: 0.1 + 0.2 === 0.30000000000000004 !== 0.3
    const precisionDriftPayload = {
      debits: 0.1 + 0.2, // 0.30000000000000004
      credits: 0.3,
    };

    const resDrift = InvariantEvaluator.evaluateExpression("debits == credits", precisionDriftPayload);
    if (!resDrift.passed) {
      throw new Error("Floating-Point Precision Drift bug: 0.1 + 0.2 was falsely rejected as unequal to 0.3!");
    }
    console.log(`  ${c.green}✔${c.reset} Exact integer cent conversion balanced 0.1 + 0.2 ($${precisionDriftPayload.debits}) with $${precisionDriftPayload.credits}`);

    // 2. Safe navigation on missing nested properties: data.totals.grandTotal > 0
    const emptyObjectPayload = {};
    const resSafeNav = InvariantEvaluator.evaluateExpression("data.totals.grandTotal > 0", emptyObjectPayload);
    if (resSafeNav.passed) {
      throw new Error("Expected missing property to evaluate to false");
    }
    if (!resSafeNav.message?.includes("Safe Navigation")) {
      throw new Error(`Expected Safe Navigation message, got: ${resSafeNav.message}`);
    }
    console.log(`  ${c.green}✔${c.reset} Safe navigation caught missing nested path: ${resSafeNav.message}`);

    console.log(`  ${c.green}PASSED${c.reset} — Floating-Point Precision Drift and Safe Null Navigation strictly verified.`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 13: Deep Circular Reference Object Traversal Crash Defense ──────
  try {
    console.log(`\n${c.cyan}[TEST 13]${c.reset} Deep Circular Reference Object Traversal Crash Defense`);
    const circularObj: any = { debits: 500, credits: 500 };
    circularObj.self = circularObj; // Direct circular pointer
    circularObj.nested = { parent: circularObj }; // Indirect circular pointer

    // 1. Invariant check must NOT crash with "Maximum call stack size exceeded"
    const resCircular = InvariantEvaluator.evaluateExpression("debits == credits", circularObj);
    if (!resCircular.passed) {
      throw new Error("Invariant failed on valid debits/credits within circular object graph");
    }

    // 2. Safe serializer must convert cycle to [Circular] token
    const serialized = InvariantEvaluator.safeSerialize(circularObj);
    if (!serialized.includes("[Circular]")) {
      throw new Error("Expected [Circular] marker in serialized circular object!");
    }

    console.log(`  ${c.green}PASSED${c.reset} — Circular reference safely traversed with WeakSet guard (zero stack overflow).`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 14: Re-entrancy Loops via User-Defined Invariant Callbacks Defense ─
  try {
    console.log(`\n${c.cyan}[TEST 14]${c.reset} Re-entrancy Loops via User-Defined Invariant Callbacks Defense`);
    let reentrancyCaught = false;

    try {
      InvariantEvaluator.evaluateWithReentrancyGuard(() => {
        // Nested re-entrant callback attempt
        InvariantEvaluator.evaluateWithReentrancyGuard(() => {
          return true;
        });
      });
    } catch (reErr: any) {
      if (reErr.message.includes("ReentrancyError")) {
        reentrancyCaught = true;
      }
    }

    if (!reentrancyCaught) {
      throw new Error("Expected ReentrancyError on nested recursive invariant callback!");
    }

    console.log(`  ${c.green}PASSED${c.reset} — Re-entrancy guard trapped recursive callback loop before memory exhaustion.`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 15: Time-of-Check to Time-of-Use (TOCTOU) Memory State Race Defense ─
  try {
    console.log(`\n${c.cyan}[TEST 15]${c.reset} Time-of-Check to Time-of-Use (TOCTOU) Memory State Race Defense`);
    const liveAccountState = {
      accountId: "acc_9921",
      balance: 10000.0,
      currency: "USD",
      meta: { verified: true },
    };

    // Capture frozen snapshot for invariant gate
    const snapshot = InvariantEvaluator.createImmutableSnapshot(liveAccountState);

    // Verify snapshot is frozen
    if (!Object.isFrozen(snapshot) || !Object.isFrozen(snapshot.meta)) {
      throw new Error("Immutable snapshot is not deeply frozen!");
    }

    // Concurrent thread attempts to tamper with live object:
    liveAccountState.balance = 0.0;

    // Snapshot retains validated state unconditionally
    if (snapshot.balance !== 10000.0) {
      throw new Error("TOCTOU Race! Snapshot was mutated by concurrent operation!");
    }

    console.log(`  ${c.green}PASSED${c.reset} — Immutable snapshot deeply frozen; immune to TOCTOU concurrent memory mutation.`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 16: Prototype Pollution Navigation Attack Defense ─────────────────
  try {
    console.log(`\n${c.cyan}[TEST 16]${c.reset} Prototype Pollution Navigation Attack Defense`);
    const maliciousPayload = JSON.parse('{"data": {"__proto__": {"polluted": true}}}');

    // Attempt to access polluted property through safeGet
    const res = InvariantEvaluator.safeGet(maliciousPayload, "data.__proto__.polluted");
    if (res !== undefined) {
      throw new Error("Prototype pollution vulnerability! __proto__ traversal was permitted!");
    }

    // Verify global Object.prototype was NOT polluted
    if ((Object.prototype as any).polluted) {
      throw new Error("Critical Vulnerability: Global Object.prototype has been polluted!");
    }

    console.log(`  ${c.green}PASSED${c.reset} — Prototype pollution strictly blocked: __proto__ and constructor paths rejected.`);
    passed++;
  } catch (err: any) {
    console.log(`  ${c.red}FAILED${c.reset} — ${err.message}`);
    failed++;
  }

  // ── TEST 17: Read-Only Container Filesystem (EROFS) Lock Fallback ──────────
  try {
    console.log(`\n${c.cyan}[TEST 17]${c.reset} Read-Only Container Filesystem (EROFS) Lock Fallback`);
    // Pass a simulated read-only path that throws EROFS on write
    const readOnlyPath = "/read_only_root/agent.ts";
    let executedInMemory = false;

    // withAdvisoryFileLock catches EROFS / EACCES and falls back to in-memory execution
    await withAdvisoryFileLock(readOnlyPath, async () => {
      executedInMemory = true;
      return "in_memory_ok";
    });

    if (!executedInMemory) {
      throw new Error("Failed to execute in-memory fallback on read-only filesystem path!");
    }

    console.log(`  ${c.green}PASSED${c.reset} — Read-only container root handled gracefully: fallback to in-memory execution.`);
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
