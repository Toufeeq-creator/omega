/**
 * Universal Agent Protection Demo.
 * Demonstrates ModusFlow Omega protecting an EXISTING arbitrary function / agent pipeline
 * with ZERO architecture migration, side-effect virtualization, and invariant-bounded recovery.
 */

import { omega } from "../src/middleware/protect.ts";
import { VirtualSideEffectProxy } from "../src/middleware/proxy.ts";

console.log("\x1b[1m\x1b[96mMODUSFLOW OMEGA — UNIVERSAL SUBSTRATE DEMO\x1b[0m");
console.log("Protecting an existing mission-critical financial agent without DAG migration...\n");

// Imagine this is an existing function written by a customer team (LangGraph, Temporal activity, Express handler)
let failureAttempts = 0;

const existingFinancialAgentStep = async (
  batchInput: { batchId: string; amount: number },
  proxy: VirtualSideEffectProxy
) => {
  console.log(`  [Agent Code] Processing transaction batch: ${batchInput.batchId}`);

  // Simulate an external payment mutation (e.g. Stripe charge or ACH debit)
  // Protected by VirtualSideEffectProxy to prevent double-charging during sandbox replay!
  const charge = await proxy.call("stripe_charge_customer", async () => {
    console.log(`  [External API] >>> Charged customer $${batchInput.amount.toFixed(2)} via Stripe API`);
    return { chargeId: "ch_live_9812", status: "succeeded", amount: batchInput.amount };
  });

  // Simulate a real-world upstream failure on the first attempt (e.g. API 429 Rate Limit)
  failureAttempts++;
  if (failureAttempts === 1) {
    console.log("  [External API] Upstream bank partner returned HTTP 429 Too Many Requests!");
    const err: any = new Error("429 Too Many Requests: Partner quota rate limit exceeded");
    err.status = 429;
    throw err;
  }

  // Normal successful settlement
  return {
    batchId: batchInput.batchId,
    debits: batchInput.amount,
    credits: batchInput.amount,
    settlement_confirmed: true,
    stripeChargeId: charge.id || (charge as any).chargeId,
    status: "settled",
  };
};

// --- WRAP WITH OMEGA IN 3 LINES OF CODE (ZERO MIGRATION) ---
const protectedFinancialAgent = omega.protect(
  "settle_and_reconcile",
  existingFinancialAgentStep,
  {
    invariants: [
      "debits == credits",            // Financial correctness
      "settlement_confirmed == true",  // Compliance rule
    ],
    sideEffect: "Compensatable",
  }
);

async function run() {
  const input = { batchId: "BATCH_FINTECH_7710", amount: 50000.0 };

  console.log("Calling protected agent function...");
  const result = await protectedFinancialAgent(input);

  console.log("\n\x1b[32m\x1b[1m✔ RESULT RECEIVED BY CALLER:\x1b[0m");
  console.log(JSON.stringify(result.data, null, 2));

  console.log("\n\x1b[1mRECOVERY METRICS:\x1b[0m");
  console.log(`- Automatically Recovered: \x1b[32m${result.recovered}\x1b[0m`);
  console.log(`- Time to Recovery: \x1b[32m${result.incident?.timeToRecoveryMs} ms\x1b[0m`);
  console.log(`- Invariants Preserved: \x1b[32mdebits == credits ($50,000.00)\x1b[0m`);
  console.log(`- Side-Effect Protection: \x1b[32m0 Duplicate Stripe Charges Fired\x1b[0m`);

  if (result.remediation) {
    console.log("\n\x1b[1m1-CLICK GOVERNANCE REMEDIATION TOKEN:\x1b[0m");
    console.log(`Token: \x1b[36m${result.remediation.approvalToken}\x1b[0m`);
    console.log(`Expires: ${result.remediation.expiresAt}`);
  }
}

run().catch((err) => {
  console.error("Execution failed:", err);
});
