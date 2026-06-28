"use client";

import { useState, useEffect, useCallback } from "react";
import {
  CONTRACT_ADDRESS,
  connectWallet,
  readClient,
  shortAddr,
  type WalletState,
} from "@/lib/genlayer";

type Tip = {
  id: string;
  tipper: string;
  creator: string;
  amount: string;
  criteria: string;
  proof_url: string;
  status: number; // 0 = pending, 1 = verified & released, 2 = refunded
  deadline: number; // Unix timestamp
  created_at: number; // Unix timestamp
  review: string; // JSON serialized string of LLM verification result
};

const STATUS_LABELS = ["Escrow Pending", "Verified & Released", "Refunded"];
const STATUS_COLORS = ["#d4af37", "#10b981", "#ef4444"];
const STATUS_BG = ["rgba(212, 175, 55, 0.1)", "rgba(16, 185, 129, 0.1)", "rgba(239, 68, 68, 0.1)"];

export default function Home() {
  const [wallet, setWallet] = useState<WalletState>({ address: null, client: null });
  const [tips, setTips] = useState<Tip[]>([]);
  const [tipCount, setTipCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "pending" | "settled">("all");
  const [txStatus, setTxStatus] = useState("");
  const [consoleMode, setConsoleMode] = useState<"create" | "update" | "none">("create");

  // Form states
  const [createForm, setCreateForm] = useState({
    creator: "",
    criteria: "",
    proofUrl: "",
    durationDays: "7",
    amount: "",
  });

  const [updateForm, setUpdateForm] = useState({
    tipId: "",
    newUrl: "",
  });

  const load = useCallback(async () => {
    try {
      const rc = readClient();
      const countRaw = await rc.readContract({
        address: CONTRACT_ADDRESS,
        functionName: "get_tip_count",
        args: [],
      });
      const count = Number(countRaw);
      setTipCount(count);

      if (count > 0) {
        // Optimized: Fetch all tips in a single call using the contract's get_tips pagination
        const rawTips = (await rc.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_tips",
          args: [1, count],
        })) as string[];

        const parsedTips = rawTips.map((raw) => JSON.parse(raw) as Tip);
        setTips(parsedTips.reverse());
      } else {
        setTips([]);
      }
    } catch (e) {
      console.error("Error fetching contract state:", e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConnect() {
    setTxStatus("Connecting to wallet...");
    try {
      const w = await connectWallet();
      setWallet(w);
      setTxStatus("");
    } catch (e: any) {
      setTxStatus(e.message || "Failed to connect wallet");
    }
  }

  const SUCCESS_STATES = ["ACCEPTED", "FINALIZED"];
  const FAILURE_STATES = ["UNDETERMINED", "CANCELED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"];

  function getFailureExplanation(status: string): string {
    if (status === "UNDETERMINED") {
      return "🤖 Consensus mismatch: AI validators disagreed on whether the proof URL met the criteria. Escrow remains pending.";
    }
    if (status === "LEADER_TIMEOUT" || status === "VALIDATORS_TIMEOUT") {
      return "⏱️ Timeout: The target proof page failed to respond in time. Escrow remains pending.";
    }
    if (status === "CANCELED") {
      return "Transaction was canceled by user.";
    }
    return `Transaction ended in state: ${status}. No funds were moved.`;
  }

  async function waitForFinalState(client: any, hash: string): Promise<string> {
    for (let i = 0; i < 120; i++) {
      let txn: any;
      try {
        txn = await client.getTransaction({ hash });
      } catch {
        txn = null;
      }
      const status: string = txn?.status ?? txn?.statusName ?? "";
      if (SUCCESS_STATES.includes(status) || FAILURE_STATES.includes(status)) {
        return status;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    return "TIMEOUT";
  }

  async function sendTransaction(fn: string, args: any[], value?: bigint) {
    if (!wallet.client) {
      setTxStatus("Please connect your wallet first.");
      return;
    }
    setLoading(true);
    setTxStatus(`Submitting transaction ${fn}...`);
    try {
      const hash = await wallet.client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: fn,
        args,
        value: value ?? BigInt(0),
      });

      if (fn === "verify_and_release") {
        setTxStatus("Running decentralized AI verification. This may take up to a minute...");
      } else {
        setTxStatus("Waiting for transaction confirmation...");
      }

      const status = await waitForFinalState(wallet.client, hash as string);

      if (SUCCESS_STATES.includes(status)) {
        setTxStatus("");
        await load();
      } else if (status === "TIMEOUT") {
        setTxStatus("⏳ Transaction is still processing. Check the dashboard status below.");
        await load();
      } else {
        setTxStatus(getFailureExplanation(status));
        await load();
      }
    } catch (e: any) {
      setTxStatus(e?.message ? `Failed: ${e.message}` : "Transaction execution encountered an error.");
      await load();
    }
    setLoading(false);
  }

  const handleCreateTip = async (e: React.FormEvent) => {
    e.preventDefault();
    const valueBigInt = BigInt(Math.floor(Number(createForm.amount) * 1e18));
    const nowTimestamp = Math.floor(Date.now() / 1000);
    await sendTransaction(
      "create_tip",
      [
        createForm.creator,
        createForm.criteria,
        createForm.proofUrl,
        Number(createForm.durationDays),
        nowTimestamp,
      ],
      valueBigInt
    );
  };

  const handleUpdateProof = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendTransaction("update_proof_url", [updateForm.tipId, updateForm.newUrl]);
  };

  const handleVerify = async (tipId: string) => {
    await sendTransaction("verify_and_release", [tipId]);
  };

  const handleRefund = async (tipId: string) => {
    const nowTimestamp = Math.floor(Date.now() / 1000);
    await sendTransaction("claim_refund", [tipId, nowTimestamp]);
  };

  const filteredTips = tips.filter((t) => {
    if (activeTab === "pending") return t.status === 0;
    if (activeTab === "settled") return t.status !== 0;
    return true;
  });

  return (
    <div className="container">
      {/* Brand Header */}
      <header className="brand-header">
        <div className="header-inner">
          <div className="logo-group">
            <span className="logo-icon">✦</span>
            <h1 className="logo-text">TIPTIP</h1>
            <span className="network-tag">STUDIONET</span>
          </div>

          <div className="wallet-group">
            {wallet.address ? (
              <div className="wallet-badge">
                <span className="status-dot" />
                <span className="address-text">{shortAddr(wallet.address)}</span>
              </div>
            ) : (
              <button onClick={handleConnect} className="connect-btn">
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-content">
          <p className="hero-tagline">De-risking Creator Funding via Subjective Escrow</p>
          <h2 className="hero-title">Milestone-Based Tipping & AI Consensus Verification</h2>
          <p className="hero-desc">
            Fund creators with programmatic peace of mind. Tips are locked in secure escrows and only released
            if independent AI validators confirm the creator's live proof URL fulfills the custom milestone criteria.
          </p>
        </div>
      </section>

      {/* Main Grid */}
      <main className="main-grid">
        {/* Left: Escrow Feed */}
        <section className="feed-column">
          <div className="feed-header">
            <h3 className="section-title">Milestone Escrows</h3>
            <div className="tab-filters">
              <button
                className={`tab-btn ${activeTab === "all" ? "active" : ""}`}
                onClick={() => setActiveTab("all")}
              >
                All
              </button>
              <button
                className={`tab-btn ${activeTab === "pending" ? "active" : ""}`}
                onClick={() => setActiveTab("pending")}
              >
                Pending
              </button>
              <button
                className={`tab-btn ${activeTab === "settled" ? "active" : ""}`}
                onClick={() => setActiveTab("settled")}
              >
                Settled
              </button>
            </div>
          </div>

          {txStatus && (
            <div className="tx-status-banner">
              <span className="spinner-icon">✦</span>
              <p className="tx-status-text">{txStatus}</p>
            </div>
          )}

          <div className="escrow-list">
            {filteredTips.length === 0 ? (
              <div className="empty-state">
                <p>No escrow records found matching the active filter.</p>
              </div>
            ) : (
              filteredTips.map((tip) => {
                const isExpired = Math.floor(Date.now() / 1000) >= tip.deadline;
                const reviewData = tip.review ? JSON.parse(tip.review) : null;

                return (
                  <div key={tip.id} className="escrow-card">
                    <div className="card-header">
                      <div className="card-meta">
                        <span className="escrow-id">Escrow #{tip.id}</span>
                        <span
                          className="status-badge"
                          style={{
                            color: STATUS_COLORS[tip.status],
                            backgroundColor: STATUS_BG[tip.status],
                          }}
                        >
                          {STATUS_LABELS[tip.status]}
                        </span>
                      </div>
                      <span className="card-amount">
                        {(Number(BigInt(tip.amount)) / 1e18).toFixed(2)} GEN
                      </span>
                    </div>

                    <div className="card-addresses">
                      <div>
                        <span className="addr-label">Funding Account:</span>
                        <span className="addr-val">{shortAddr(tip.tipper)}</span>
                      </div>
                      <div>
                        <span className="addr-label">Creator Destination:</span>
                        <span className="addr-val">{shortAddr(tip.creator)}</span>
                      </div>
                    </div>

                    <div className="card-criteria">
                      <h4 className="detail-title">Milestone Criteria:</h4>
                      <p className="detail-val">{tip.criteria}</p>
                    </div>

                    <div className="card-proof">
                      <h4 className="detail-title">Proof URL:</h4>
                      {tip.proof_url ? (
                        <a
                          href={tip.proof_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="proof-link"
                        >
                          {tip.proof_url} ↗
                        </a>
                      ) : (
                        <span className="no-proof-text">No proof URL submitted yet.</span>
                      )}
                    </div>

                    {reviewData && (
                      <div className="card-review">
                        <div className="review-header">
                          <span className="review-title">🤖 AI Consensus Verdict</span>
                          <span className="review-score">Score: {reviewData.quality_score}/10</span>
                        </div>
                        <p className="review-reason">{reviewData.reasoning}</p>
                      </div>
                    )}

                    <div className="card-actions">
                      {tip.status === 0 && (
                        <>
                          <button
                            onClick={() => handleVerify(tip.id)}
                            disabled={loading || !tip.proof_url}
                            className="verify-action-btn"
                          >
                            Execute AI Verification
                          </button>

                          {isExpired && wallet.address?.toLowerCase() === tip.tipper.toLowerCase() && (
                            <button
                              onClick={() => handleRefund(tip.id)}
                              disabled={loading}
                              className="refund-action-btn"
                            >
                              Reclaim Refund (Deadline Passed)
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    <div className="card-timeline">
                      <span>Created: {new Date(tip.created_at * 1000).toLocaleDateString()}</span>
                      <span>
                        Deadline: {new Date(tip.deadline * 1000).toLocaleDateString()}{" "}
                        {isExpired ? "(Expired)" : ""}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Right: Actions / Console */}
        <section className="console-column">
          <div className="console-card">
            <div className="console-tabs">
              <button
                className={`console-tab-btn ${consoleMode === "create" ? "active" : ""}`}
                onClick={() => setConsoleMode("create")}
              >
                Fund Milestone
              </button>
              <button
                className={`console-tab-btn ${consoleMode === "update" ? "active" : ""}`}
                onClick={() => setConsoleMode("update")}
              >
                Creator Panel
              </button>
            </div>

            <div className="console-content">
              {consoleMode === "create" && (
                <form onSubmit={handleCreateTip} className="console-form">
                  <div className="form-group">
                    <label>Creator Wallet Address</label>
                    <input
                      type="text"
                      placeholder="0x..."
                      value={createForm.creator}
                      onChange={(e) => setCreateForm({ ...createForm, creator: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Milestone Criteria / Deliverables</label>
                    <textarea
                      placeholder="E.g., Write a deep-dive technical article about GenLayer's consensus and publish it."
                      value={createForm.criteria}
                      onChange={(e) => setCreateForm({ ...createForm, criteria: e.target.value })}
                      required
                      rows={3}
                    />
                  </div>

                  <div className="form-group">
                    <label>Initial Proof URL (Optional)</label>
                    <input
                      type="url"
                      placeholder="https://..."
                      value={createForm.proofUrl}
                      onChange={(e) => setCreateForm({ ...createForm, proofUrl: e.target.value })}
                    />
                  </div>

                  <div className="form-group-row">
                    <div className="form-group">
                      <label>Escrow Period (Days)</label>
                      <input
                        type="number"
                        min="1"
                        value={createForm.durationDays}
                        onChange={(e) => setCreateForm({ ...createForm, durationDays: e.target.value })}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label>Amount (GEN)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="0.00"
                        value={createForm.amount}
                        onChange={(e) => setCreateForm({ ...createForm, amount: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <button type="submit" disabled={loading} className="console-submit-btn">
                    Lock Funds in Escrow
                  </button>
                </form>
              )}

              {consoleMode === "update" && (
                <form onSubmit={handleUpdateProof} className="console-form">
                  <p className="console-helper-text">
                    Select the Tip ID you want to submit work for and enter the URL showcasing your completed
                    milestone criteria.
                  </p>

                  <div className="form-group">
                    <label>Escrow Tip ID</label>
                    <input
                      type="text"
                      placeholder="E.g., 1"
                      value={updateForm.tipId}
                      onChange={(e) => setUpdateForm({ ...updateForm, tipId: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Proof URL</label>
                    <input
                      type="url"
                      placeholder="https://..."
                      value={updateForm.newUrl}
                      onChange={(e) => setUpdateForm({ ...updateForm, newUrl: e.target.value })}
                      required
                    />
                  </div>

                  <button type="submit" disabled={loading} className="console-submit-btn secondary">
                    Update Proof URL
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Workflow Guide */}
          <div className="guide-card">
            <h4 className="guide-title">How TipTip Works</h4>
            <ul className="guide-steps">
              <li>
                <span className="step-num">1</span>
                <div>
                  <strong>Fund</strong>
                  <p>Tipper locks GEN in the contract with explicit criteria and a refund deadline.</p>
                </div>
              </li>
              <li>
                <span className="step-num">2</span>
                <div>
                  <strong>Submit</strong>
                  <p>Creator updates the escrow URL pointing to their completed proof of work.</p>
                </div>
              </li>
              <li>
                <span className="step-num">3</span>
                <div>
                  <strong>Verify</strong>
                  <p>
                    GenLayer AI validators query the proof URL, verify details, and vote to release the escrow.
                  </p>
                </div>
              </li>
              <li>
                <span className="step-num">4</span>
                <div>
                  <strong>Settle</strong>
                  <p>Passed verification pays the creator. Unresolved tips can be refunded after deadline.</p>
                </div>
              </li>
            </ul>
          </div>
        </main>

        <footer className="brand-footer">
          <p>
            Powered by GenLayer AI Consensus · Contract:{" "}
            <span className="monospace">{shortAddr(CONTRACT_ADDRESS)}</span>
          </p>
        </footer>

        {/* CSS Design System Style Block */}
        <style jsx global>{`
          :root {
            --bg-obsidian: #09090b;
            --bg-card: #121214;
            --border-zinc: #27272a;
            --accent-bronze: #d4af37;
            --accent-bronze-light: #c5a880;
            --accent-bronze-dark: #8a704c;
            --text-primary: #f4f4f5;
            --text-secondary: #a1a1aa;
            --font-display: "Cinzel", serif;
            --font-body: "Plus Jakarta Sans", sans-serif;
            --font-mono: "JetBrains Mono", monospace;
          }

          body {
            background-color: var(--bg-obsidian);
            color: var(--text-primary);
            font-family: var(--font-body);
            -webkit-font-smoothing: antialiased;
            margin: 0;
            padding: 0;
          }

          .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 24px;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
          }

          /* Header Styling */
          .brand-header {
            padding: 24px 0;
            border-bottom: 1px solid var(--border-zinc);
          }

          .header-inner {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .logo-group {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .logo-icon {
            color: var(--accent-bronze);
            font-size: 24px;
          }

          .logo-text {
            font-family: var(--font-display);
            font-size: 26px;
            letter-spacing: 3px;
            margin: 0;
            font-weight: 700;
          }

          .network-tag {
            font-family: var(--font-mono);
            font-size: 10px;
            background: rgba(212, 175, 55, 0.15);
            color: var(--accent-bronze);
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid rgba(212, 175, 55, 0.3);
            letter-spacing: 1.5px;
          }

          .wallet-badge {
            display: flex;
            align-items: center;
            gap: 8px;
            background: #18181b;
            border: 1px solid var(--border-zinc);
            padding: 8px 16px;
            border-radius: 6px;
          }

          .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #10b981;
            box-shadow: 0 0 8px #10b981;
          }

          .address-text {
            font-family: var(--font-mono);
            font-size: 13px;
          }

          .connect-btn {
            background: linear-gradient(135deg, var(--accent-bronze), var(--accent-bronze-dark));
            color: var(--bg-obsidian);
            font-family: var(--font-body);
            font-weight: 700;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.3s ease;
            letter-spacing: 0.5px;
          }

          .connect-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 15px rgba(212, 175, 55, 0.3);
          }

          /* Hero Section */
          .hero-section {
            padding: 60px 0;
            border-bottom: 1px solid var(--border-zinc);
            background: radial-gradient(circle at top right, rgba(212,175,55,0.05), transparent 50%);
          }

          .hero-content {
            max-width: 800px;
          }

          .hero-tagline {
            color: var(--accent-bronze);
            font-family: var(--font-mono);
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 3px;
            margin-bottom: 12px;
          }

          .hero-title {
            font-family: var(--font-display);
            font-size: 42px;
            line-height: 1.2;
            margin: 0 0 16px 0;
            font-weight: 400;
            letter-spacing: -0.5px;
          }

          .hero-desc {
            color: var(--text-secondary);
            font-size: 16px;
            line-height: 1.6;
            margin: 0;
            font-weight: 300;
          }

          /* Main Grid Layout */
          .main-grid {
            display: grid;
            grid-template-columns: 1.2fr 0.8fr;
            gap: 40px;
            padding: 48px 0;
            flex: 1;
          }

          /* Feed Column */
          .feed-column {
            display: flex;
            flex-direction: column;
            gap: 24px;
          }

          .feed-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .section-title {
            font-family: var(--font-display);
            font-size: 20px;
            margin: 0;
            letter-spacing: 1px;
          }

          .tab-filters {
            display: flex;
            background: #18181b;
            border: 1px solid var(--border-zinc);
            border-radius: 6px;
            padding: 3px;
          }

          .tab-btn {
            background: transparent;
            border: none;
            color: var(--text-secondary);
            font-family: var(--font-body);
            font-size: 13px;
            padding: 6px 16px;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
          }

          .tab-btn.active {
            background: var(--border-zinc);
            color: var(--text-primary);
          }

          .tx-status-banner {
            background: rgba(212, 175, 55, 0.05);
            border: 1px solid rgba(212, 175, 55, 0.2);
            padding: 16px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .spinner-icon {
            color: var(--accent-bronze);
            animation: spin 3s linear infinite;
            font-size: 16px;
          }

          @keyframes spin {
            100% { transform: rotate(360deg); }
          }

          .tx-status-text {
            margin: 0;
            font-size: 14px;
            color: var(--accent-bronze-light);
          }

          /* Escrow List & Cards */
          .escrow-list {
            display: flex;
            flex-direction: column;
            gap: 20px;
          }

          .empty-state {
            padding: 60px 0;
            text-align: center;
            color: var(--text-secondary);
            border: 1px dashed var(--border-zinc);
            border-radius: 8px;
            font-size: 14px;
          }

          .escrow-card {
            background: var(--bg-card);
            border: 1px solid var(--border-zinc);
            border-radius: 8px;
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            transition: border-color 0.3s ease;
          }

          .escrow-card:hover {
            border-color: rgba(212, 175, 55, 0.3);
          }

          .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .card-meta {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .escrow-id {
            font-family: var(--font-display);
            font-weight: 700;
            font-size: 16px;
            letter-spacing: 0.5px;
          }

          .status-badge {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            padding: 4px 10px;
            border-radius: 4px;
          }

          .card-amount {
            font-family: var(--font-mono);
            font-size: 18px;
            color: var(--accent-bronze);
            font-weight: 500;
          }

          .card-addresses {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 12px;
            background: rgba(255, 255, 255, 0.02);
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.03);
          }

          .card-addresses > div {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
          }

          .addr-label {
            color: var(--text-secondary);
          }

          .addr-val {
            font-family: var(--font-mono);
            color: var(--text-primary);
          }

          .detail-title {
            font-size: 12px;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 1px;
            margin: 0 0 6px 0;
          }

          .detail-val {
            margin: 0;
            font-size: 14px;
            line-height: 1.5;
            color: var(--text-primary);
          }

          .proof-link {
            color: var(--accent-bronze);
            font-family: var(--font-mono);
            font-size: 13px;
            text-decoration: none;
            word-break: break-all;
            transition: color 0.2s ease;
          }

          .proof-link:hover {
            color: var(--accent-bronze-light);
            text-decoration: underline;
          }

          .no-proof-text {
            font-size: 13px;
            color: var(--text-secondary);
            font-style: italic;
          }

          .card-review {
            background: rgba(255, 255, 255, 0.02);
            border-left: 3px solid var(--accent-bronze);
            padding: 16px;
            border-radius: 0 6px 6px 0;
          }

          .review-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 12px;
            margin-bottom: 8px;
          }

          .review-title {
            font-weight: 700;
            letter-spacing: 0.5px;
          }

          .review-score {
            color: var(--accent-bronze);
            font-family: var(--font-mono);
          }

          .review-reason {
            margin: 0;
            font-size: 13px;
            line-height: 1.5;
            color: var(--text-secondary);
          }

          .card-actions {
            display: flex;
            gap: 12px;
            margin-top: 8px;
          }

          .verify-action-btn {
            flex: 1;
            background: transparent;
            border: 1px solid var(--accent-bronze);
            color: var(--accent-bronze);
            padding: 10px;
            border-radius: 6px;
            font-family: var(--font-body);
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s ease;
          }

          .verify-action-btn:hover:not(:disabled) {
            background: var(--accent-bronze);
            color: var(--bg-obsidian);
          }

          .verify-action-btn:disabled {
            border-color: var(--border-zinc);
            color: var(--text-secondary);
            cursor: not-allowed;
            opacity: 0.5;
          }

          .refund-action-btn {
            background: transparent;
            border: 1px solid #ef4444;
            color: #ef4444;
            padding: 10px;
            border-radius: 6px;
            font-family: var(--font-body);
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s ease;
          }

          .refund-action-btn:hover:not(:disabled) {
            background: #ef4444;
            color: var(--text-primary);
          }

          .card-timeline {
            display: flex;
            justify-content: space-between;
            border-top: 1px solid var(--border-zinc);
            padding-top: 12px;
            font-size: 11px;
            color: var(--text-secondary);
          }

          /* Console Column */
          .console-column {
            display: flex;
            flex-direction: column;
            gap: 28px;
          }

          .console-card {
            background: var(--bg-card);
            border: 1px solid var(--border-zinc);
            border-radius: 8px;
            overflow: hidden;
          }

          .console-tabs {
            display: flex;
            border-bottom: 1px solid var(--border-zinc);
            background: #18181b;
          }

          .console-tab-btn {
            flex: 1;
            background: transparent;
            border: none;
            color: var(--text-secondary);
            font-family: var(--font-display);
            font-size: 14px;
            letter-spacing: 0.5px;
            padding: 14px;
            cursor: pointer;
            transition: all 0.2s ease;
            text-align: center;
          }

          .console-tab-btn.active {
            background: var(--bg-card);
            color: var(--text-primary);
            border-bottom: 2px solid var(--accent-bronze);
          }

          .console-content {
            padding: 24px;
          }

          .console-form {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }

          .console-helper-text {
            font-size: 13px;
            color: var(--text-secondary);
            margin: 0 0 8px 0;
            line-height: 1.5;
          }

          .form-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }

          .form-group-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
          }

          .form-group label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-secondary);
            font-weight: 500;
          }

          .form-group input,
          .form-group textarea {
            background: #09090b;
            border: 1px solid var(--border-zinc);
            color: var(--text-primary);
            font-family: var(--font-body);
            font-size: 14px;
            padding: 10px 12px;
            border-radius: 6px;
            transition: border-color 0.2s ease;
          }

          .form-group input:focus,
          .form-group textarea:focus {
            outline: none;
            border-color: var(--accent-bronze);
          }

          .form-group textarea {
            resize: vertical;
          }

          .console-submit-btn {
            background: linear-gradient(135deg, var(--accent-bronze), var(--accent-bronze-dark));
            color: var(--bg-obsidian);
            border: none;
            font-family: var(--font-display);
            font-weight: 700;
            padding: 12px;
            border-radius: 6px;
            cursor: pointer;
            letter-spacing: 1px;
            transition: all 0.3s ease;
            margin-top: 8px;
          }

          .console-submit-btn:hover:not(:disabled) {
            box-shadow: 0 4px 15px rgba(212, 175, 55, 0.2);
            transform: translateY(-1px);
          }

          .console-submit-btn.secondary {
            background: transparent;
            border: 1px solid var(--accent-bronze);
            color: var(--accent-bronze);
          }

          .console-submit-btn.secondary:hover:not(:disabled) {
            background: var(--accent-bronze);
            color: var(--bg-obsidian);
          }

          /* Guide Card */
          .guide-card {
            background: var(--bg-card);
            border: 1px solid var(--border-zinc);
            border-radius: 8px;
            padding: 24px;
          }

          .guide-title {
            font-family: var(--font-display);
            font-size: 16px;
            margin: 0 0 20px 0;
            letter-spacing: 1px;
          }

          .guide-steps {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 20px;
          }

          .guide-steps li {
            display: flex;
            gap: 16px;
          }

          .step-num {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background: rgba(212, 175, 55, 0.1);
            color: var(--accent-bronze);
            border: 1px solid rgba(212, 175, 55, 0.3);
            display: grid;
            place-items: center;
            font-size: 12px;
            font-weight: 700;
            flex-shrink: 0;
            font-family: var(--font-mono);
          }

          .guide-steps li div strong {
            font-size: 14px;
            font-weight: 600;
            color: var(--text-primary);
            display: block;
            margin-bottom: 4px;
          }

          .guide-steps li div p {
            margin: 0;
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.4;
          }

          /* Footer */
          .brand-footer {
            padding: 40px 0;
            border-top: 1px solid var(--border-zinc);
            text-align: center;
            margin-top: auto;
          }

          .brand-footer p {
            margin: 0;
            font-size: 12px;
            color: var(--text-secondary);
          }

          .monospace {
            font-family: var(--font-mono);
          }
        `}</style>
      </main>
    </div>
  );
}
