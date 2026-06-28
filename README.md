# TipTip: Programmatic Escrow and Subjective Milestone Verification

A decentralized, trustless escrow tipping protocol on GenLayer. Fund creators with custom criteria, verified by independent AI consensus, with secure deadline-enforced refunds.

---

**Frontend Portal:** [tiptip-seven.vercel.app](https://tiptip-seven.vercel.app/)  
**Contract (GenLayer Studionet):** `0x1A247D4F65a92Ec862b8dBCa05215e481b64bE89`

---

## Protocol Overview and the Trust Gap

Online tipping and creator sponsorship suffer from a fundamental trust gap. Supporters deposit capital upfront based on social promises, with no programmatic guarantee of delivery or quality. If creators produce low-effort content, recycle old work, or fail to follow through, supporters have no recourse. This friction discourages high-value micro-patronage.

**TipTip** resolves this trust gap by introducing **Conditional Escrow Tipping**:
* **Milestone Escrow:** Supporter funds are locked in the smart contract, bound to a specific natural-language milestone description and an expiry deadline.
* **On-Chain Oracles:** Creators submit a live Web URL as proof of completion.
* **Subjective Consensus:** GenLayer’s decentralized AI validators read the live page content, verify it against the locked criteria, and vote on-chain to release the funds.
* **Deterministic Expiry:** If the milestone remains unverified past the deadline, the tipper reclaims 100% of their locked capital.

> [!NOTE]
> Unlike standard oracles that only fetch raw API data, TipTip utilizes GenLayer to perform **subjective semantic verification** of unstructured human work (like articles, code releases, or video uploads) against natural-language criteria.

---

## State Machine and Escrow Lifecycle

```
                       [ Fund Milestone ]
                               │
                               ▼
                   GEN Capital Locked in Escrow
                   (Criteria + Expiry Deadline)
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
         [ Submit Proof ]              [ Expiry Timeout ]
                │                             │
                ▼                             ▼
       Updates Proof URL               Deadline Passed?
                │                             │
                ▼                             ▼
      [ Trigger Verification ]          [ Claim Refund ]
                │                             │
                ▼                             ▼
        GenLayer Consensus            Funds Returned to Tipper
     (Validators Fetch Web Page)         (Escrow Terminated)
                │
                ▼
        Subjective AI Review
       (Equivalence Principle)
                │
        ┌───────┴───────┐
        ▼               ▼
    [ PASS ]        [ FAIL ]
        │               │
        ▼               ▼
  Release Capital  Remains Pending
    to Creator     (Refined URL/Try Again)
```

---

## Cryptographic VM Determinism and Timestamps

One of the primary challenges in consensus-based execution environments is avoiding non-deterministic state evaluation.

> [!WARNING]
> Calling system-level clocks (like `datetime.now()` in Python) inside write transactions causes validators to generate different storage outputs depending on their physical clock synchronization. This leads to state root mismatches and consensus failures.

**TipTip** resolves this by enforcing **Client-Provided Deterministic Timestamps**:
1. When creating a tip or claiming a refund, the client computes the current Unix epoch (`Math.floor(Date.now() / 1000)`) and passes it as a transaction argument (`client_now`).
2. The contract uses this argument to compute and write the exact deadline deterministically:
   $$\text{deadline} = \text{client\_now} + (\text{duration\_days} \times 86400)$$
3. All validators process the exact same integer timestamp, guaranteeing complete consensus finalization.

---

## Intelligent Contract Interface Specification (`contracts/tiptip.py`)

The contract stores tip escrows in a native `TreeMap[str, str]` (mapping `tip_id` to serialized JSON strings) to optimize space and validator lookup performance.

### Write Operations

* **`create_tip(creator: str, criteria: str, proof_url: str, duration_days: i32, client_now: i32) -> i32 (payable)`**
  Initializes a new escrow tip. Receives the locked `gl.message.value` and returns the incremental `tip_id`.
  > [!IMPORTANT]
  > Reverts with `UserError` if `gl.message.value == 0`.

* **`update_proof_url(tip_id: str, new_url: str) -> None`**
  Updates the target proof link for verification.
  * *Access Control:* Restricted exclusively to the `creator` address declared in the tip configuration.
  * *Constraint:* Reverts if the tip status is not `0` (Pending).

* **`verify_and_release(tip_id: str) -> None`**
  Triggers the decentralized AI verification loop. Queries the proof page, parses content, runs consensus, and transfers funds on validation.

* **`claim_refund(tip_id: str, client_now: i32) -> None`**
  Allows the tipper to reclaim the locked GEN funds.
  * *Access Control:* Restricted exclusively to the `tipper` address.
  * *Constraint:* Reverts if `client_now` is less than the tip's computed `deadline`.

### View Operations

* **`get_tip(tip_id: str) -> str`**
  Returns the raw JSON metadata of a specific tip escrow.

* **`get_tip_count() -> i32`**
  Returns the total count of tips registered.

* **`get_tips(start: i32, limit: i32) -> list[str]`**
  **Paginated batch reader.** Avoids loop-based RPC roundtrips by retrieving multiple tips in a single call, optimizing network overhead and frontend load speeds.

---

## Subjective Consensus and the Equivalence Principle

When `verify_and_release` is invoked, GenLayer validators run an independent consensus round using the **Equivalence Principle** to grade the creator's proof:

```python
# Normalized output validation schema
{
    "verified": True or False,
    "quality_score": 1-10,
    "reasoning": "Reasoning string"
}
```

1. **Output Normalization:** The leader and validators run `_parse_verdict()` to strip markdown JSON fences and coerce the model's text into structured fields (`bool` and `int`). This prevents validators from disagreeing over minor text formatting differences (e.g. whitespace, capitalization, JSON markdown styling).
2. **Semantic Verification:** In `validator_fn`, the validator checks if:
   * The boolean `verified` decision matches the leader's decision exactly.
   * The numeric `quality_score` matches within a tolerance of $\pm 2$ points.
3. **Agreement:** If the validators agree on the semantic verdict, consensus is reached, the transaction commits, and funds are disbursed via an EVM transfer.

---

## Frontend Integration and Wallet Architecture

The Next.js client is configured to deliver a premium user experience while bypassing typical dApp onboarding friction:

* **Direct EVM provider switch:** Bypasses browser Snap plugins. It uses the MetaMask/Rabby provider directly to switch the client's wallet to the **GenLayer Studio Network** parameters (Chain ID `61999`, RPC `https://studio.genlayer.com/api`).
* **Terminal Status Mapping:** The transaction monitor polls for terminal consensus states (`ACCEPTED`, `FINALIZED`, `UNDETERMINED`, `VALIDATORS_TIMEOUT`) to display precise, user-friendly feedback if consensus fails or times out.

---

## Developer Setup and Simulation Suite

### 1. Compile and Lint Check
Ensure your py-genlayer environment is set up and run the static linter:
```bash
# Install linter
pip install genvm-linter

# Execute validation checks
genvm-lint check contracts/tiptip.py
```

### 2. Local Simulation Tests
Run the mock test suite to simulate state transitions, deadlines, and validation logic locally in Python:
```bash
python3 tests/test_tiptip.py
```

### 3. Deploy to Testnet
```bash
# Point CLI to Studionet
genlayer network set studionet

# Unlock deployer account
genlayer account unlock

# Deploy contract
genlayer deploy --contract contracts/tiptip.py
```

---

## License
Distributed under the MIT License.
