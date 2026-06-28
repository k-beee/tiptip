const { createClient, createAccount } = require("genlayer-js");
const { studionet } = require("genlayer-js/chains");

const CONTRACT_ADDRESS = "0x1A247D4F65a92Ec862b8dBCa05215e481b64bE89";
const PRIVATE_KEY = process.env.PRIVATE_KEY || ""; 
const ACCOUNT_ADDRESS = process.env.ACCOUNT_ADDRESS || ""; 

async function main() {
  if (!PRIVATE_KEY || !ACCOUNT_ADDRESS) {
    console.error("Please set PRIVATE_KEY and ACCOUNT_ADDRESS environment variables to run this script.");
    process.exit(1);
  }

  console.log("Initializing GenLayer client on Studionet...");
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({
    chain: studionet,
    account,
  });

  console.log(`Using account: ${ACCOUNT_ADDRESS}`);
  console.log(`Target Contract: ${CONTRACT_ADDRESS}`);

  // 1. Get current tip count
  const tipCount = Number(await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_tip_count",
    args: [],
  }));
  console.log(`Current Tip Count: ${tipCount}`);

  // 2. Create a new conditional escrow tip
  const criteria = "Verify that this page contains the word 'TipTip'";
  const proofUrl = "https://raw.githubusercontent.com/k-beee/tiptip/main/README.md";
  const durationDays = 1;
  const now = Math.floor(Date.now() / 1000);
  const value = BigInt(1 * 1e18); // 1 GEN

  console.log("\nCreating a test tip (locking 1 GEN)...");
  const createHash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "create_tip",
    args: [ACCOUNT_ADDRESS, criteria, proofUrl, durationDays, now],
    value,
  });
  console.log(`Transaction submitted. Hash: ${createHash}`);

  // Wait for receipt
  console.log("Waiting for block finalization...");
  let receipt = await waitForReceipt(client, createHash);
  console.log(`Transaction finalized in state: ${receipt.status}`);

  const newCount = Number(await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_tip_count",
    args: [],
  }));
  const newTipId = String(newCount);
  console.log(`New Tip Count: ${newCount} (Tip ID: ${newTipId})`);

  // 3. Read the registered tip
  let tipJson = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_tip",
    args: [newTipId],
  });
  console.log("\nRegistered Tip Details:");
  console.log(JSON.stringify(JSON.parse(tipJson), null, 2));

  // 4. Update the proof URL (acting as creator, which is also ACCOUNT_ADDRESS)
  console.log("\nUpdating proof URL to raw README file...");
  const updateHash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "update_proof_url",
    args: [newTipId, "https://raw.githubusercontent.com/k-beee/tiptip/main/README.md"],
  });
  console.log(`Update submitted. Hash: ${updateHash}`);
  receipt = await waitForReceipt(client, updateHash);
  console.log(`Update finalized in state: ${receipt.status}`);

  // 5. Trigger AI verification and release
  console.log("\nTriggering AI Consensus Verification...");
  const verifyHash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "verify_and_release",
    args: [newTipId],
  });
  console.log(`AI Verification request submitted. Hash: ${verifyHash}`);
  console.log("Running decentralized AI validators (can take 30-60s)...");
  receipt = await waitForReceipt(client, verifyHash);
  console.log(`Verification completed with transaction status: ${receipt.status}`);

  // 6. Get final tip state
  tipJson = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_tip",
    args: [newTipId],
  });
  console.log("\nFinal Settled Tip Details:");
  console.log(JSON.stringify(JSON.parse(tipJson), null, 2));
}

async function waitForReceipt(client, hash) {
  for (let i = 0; i < 60; i++) {
    try {
      const txn = await client.getTransaction({ hash });
      const status = String(txn?.statusName ?? txn?.status_name ?? txn?.status ?? "").toUpperCase();
      console.log(`  > Current transaction status: ${status || "PENDING"}`);
      if (["ACCEPTED", "FINALIZED", "UNDETERMINED", "CANCELED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT", "7"].includes(status)) {
        return txn;
      }
    } catch (e) {
      console.log(`  > Pending: waiting for block inclusion... (Error: ${e.message || e})`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("Transaction polling timed out");
}

main().catch(console.error);
