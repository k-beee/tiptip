# ✦ TipTip: Conditional Tipping & Verification Escrow

**Secure, milestone-based tipping for web creators, verified by decentralized AI consensus.**

---

🔗 **Vercel Deploy:** [tiptip-frontend.vercel.app](https://tiptip-frontend.vercel.app) (Replace with your live URL)  
📜 **Contract (GenLayer Studionet):** `0x4f079033484B806e42385E53bE20209B89049Bee` (Replace with your deployed address)

---

## 1. Executive Summary

Traditional content tipping and micro-patronage rely on blind faith. Supporters send funds upfront hoping the creator will produce high-quality work, research a topic honestly, or write promised features. When creators underdeliver, use low-effort AI copy-paste, or fail to follow through, supporters have no recourse—leading to donor fatigue and reduced patronage.

**TipTip** resolves this trust deficit. It introduces **Conditional Escrow Tipping**:
* Tippers lock funds in a secure smart contract along with a specific description of what they expect (e.g., "Write a deep dive about GenLayer validator economics").
* Creators register their work by providing a live Web URL showing proof of execution.
* GenLayer's independent AI validators fetch the live webpage content, analyze it against the tipper's specific criteria, and reach consensus on whether to release the escrow.
* If the creator fails to meet the deadline, the tipper can claim their funds back.

---

## 2. System Workflow (Dragon Chart)

```
                       [ Tipper Creates Tip ]
                                 │
                                 ▼
                     Locks GEN in secure Escrow
                     (Criteria + Deadline set)
                                 │
                                 ├────────────────────────┐
                                 ▼                        ▼
                       [ Creator Works ]           [ Time Passes ]
                                 │                        │
                                 ▼                        ▼
                       Updates Proof URL          Deadline Exceeded?
                                 │                        │
                                 ▼                        ▼
                       [ Trigger Verification ]    [ claim_refund ]
                                 │                        │
                                 ▼                        ▼
                        GenLayer Consensus         Reclaim Locked GEN
                    (Validators fetch Proof)       (Returned to Tipper)
                                 │
                                 ▼
                         AI Checks Proof
                        against Criteria
                                 │
               ┌─────────────────┴─────────────────┐
               ▼                                   ▼
          [ Verify Pass ]                    [ Verify Fail ]
               │                                   │
               ▼                                   ▼
        Release GEN to Creator            Escrow remains Pending
       (Settle Transaction)            (Creator can refine URL)
```

---

## 3. Intelligent Contract API (`contracts/tiptip.py`)

The contract is written in Py-GenLayer and compiles to GenVM. It enforces complete execution determinism by utilizing client-provided timestamps instead of physical server clocks, preventing validator state-root divergence.

### Write Methods

#### `create_tip(creator, criteria, proof_url, duration_days, client_now) -> i32 (payable)`
Locks `gl.message.value` in escrow.
* `creator` (str): Wallet address of the content creator.
* `criteria` (str): Plain-text milestone instructions the creator must fulfill.
* `proof_url` (str): Initial webpage where proof will be hosted (can be empty).
* `duration_days` (i32): Expiry countdown. After this elapsed period, the tipper can reclaim the escrow.
* `client_now` (i32): Current Unix timestamp passed from the client for VM determinism.

#### `update_proof_url(tip_id, new_url)`
Allows the creator to set or update the proof link as their work progresses.
* Restricted: Only the designated `creator` of the specific tip can invoke this method.

#### `verify_and_release(tip_id)`
Triggers the AI validator consensus loop.
* Validators query the `proof_url` via `gl.nondet.web.get()`.
* An LLM evaluates the text content against the custom `criteria`.
* The **Equivalence Principle** enforces exact agreement on the boolean verdict (`verified`) and a tolerance of $\le 2$ points on the numeric score.
* If verification passes, the contract executes an EVM transfer paying the creator.

#### `claim_refund(tip_id, client_now)`
Allows the tipper to reclaim their escrowed GEN.
* Restricted: Only the original `tipper` of the specific tip can call this.
* Condition: Executable only if `client_now` is greater than or equal to the tip's `deadline`.

### View Methods

#### `get_tip(tip_id) -> str`
Returns the JSON representation of a specific tip.

#### `get_tip_count() -> i32`
Returns the total count of tips created.

#### `get_tips(start, limit) -> list[str]`
Optimized paginated batch reader. Allows the frontend to fetch multiple tips in a single RPC query, solving sequential loop-loading delays.

---

## 4. Frontend & Integration Features

The web client is built with **Next.js (static export)** and **TypeScript** under a refined, editorial dark-mode theme.

* **Direct EVM Integration (No Snap Needed):** The wallet manager switches standard EVM wallets (MetaMask, Rabby) to the GenLayer Studionet chain parameters. Signing is handled via standard EVM JSON-RPC provider calls, removing the need for specialized browser Snap plugins.
* **Granular Transaction Feedback:** The client polls transaction hashes for terminal states, displaying friendly diagnostics if transactions fail consensus (`UNDETERMINED`) or time out (`VALIDATORS_TIMEOUT`).
* **Performance Enhancements:** Uses the paginated contract query to load all active escrow records in a single RPC trip.

---

## 5. Local Setup & Deployment

### Smart Contract Linting
Ensure `genvm-linter` is installed, then run the validation check:
```bash
# Install genlayer tools
pip install genvm-linter

# Verify contract
genvm-lint check contracts/tiptip.py
```

### Local Simulation Tests
Run the mock test suite to verify contract flow locally in Python:
```bash
python3 tests/test_tiptip.py
```

### Deploying the Contract
```bash
# Set network targets
genlayer network set studionet
genlayer account unlock

# Deploy
genlayer deploy --contract contracts/tiptip.py
```

### Frontend Development
1. Navigate to the `frontend/` directory.
2. Edit `next.config.js` to point `NEXT_PUBLIC_CONTRACT_ADDRESS` to your deployed contract address.
3. Install dependencies and start the dev server:
```bash
cd frontend
npm install
npm run dev
```

---

## 6. License
MIT License.
