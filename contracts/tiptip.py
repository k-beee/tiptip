# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json
import typing

def _coerce_bool(value: typing.Any) -> bool:
    """Normalize whatever the model emits for `verified` into a real bool."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in ("true", "yes", "y", "1", "approve", "approved", "pass", "verified", "verify")
    return False

def _coerce_score(value: typing.Any) -> int:
    """Normalize `quality_score` into an int clamped to 1..10."""
    try:
        score = int(round(float(value)))
    except (TypeError, ValueError):
        score = 0
    if score < 1:
        score = 1
    if score > 10:
        score = 10
    return score

def _parse_verdict(raw: str) -> dict:
    """Sanitize and normalize raw LLM output into a canonical verdict dictionary.
    
    This ensures that validators compare structured, sanitized data rather than 
    raw text that might contain minor formatting differences (e.g. JSON markdown tags).
    """
    text = (raw or "").strip()

    # Strip a ```json ... ``` (or plain ``` ... ```) markdown fence if present.
    if "```" in text:
        start = text.find("```") + 3
        rest = text[start:]
        end = rest.find("```")
        if end != -1:
            rest = rest[:end]
        newline = rest.find("\n")
        if newline != -1 and rest[:newline].strip().isalpha():
            rest = rest[newline + 1:]
        text = rest.strip()

    # Keep only the outermost JSON object, dropping any surrounding prose.
    lo = text.find("{")
    hi = text.rfind("}")
    if lo != -1 and hi != -1 and hi > lo:
        text = text[lo:hi + 1]

    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        data = {}
    if not isinstance(data, dict):
        data = {}

    return {
        "verified": _coerce_bool(data.get("verified", data.get("approved", False))),
        "quality_score": _coerce_score(data.get("quality_score", 0)),
        "reasoning": str(data.get("reasoning", "")).strip()[:500],
    }


class TipTip(gl.Contract):
    tip_count: i32
    tips: TreeMap[str, str] # Maps tip_id (str) -> JSON serialized tip details

    def __init__(self):
        """Initialize the contract state with a zero tip counter."""
        self.tip_count = i32(0)

    @gl.public.write.payable
    def create_tip(self, creator: str, criteria: str, proof_url: str, duration_days: i32, client_now: i32) -> i32:
        """Create a conditional escrow tip with a deadline and specific criteria.
        
        Args:
            creator (str): The address of the content creator.
            criteria (str): The specific performance or quality conditions the creator must meet.
            proof_url (str): The initial URL where proof of work is expected to be published.
            duration_days (i32): Number of days until the tipper can claim a refund if unverified.
            client_now (i32): Deterministic Unix timestamp provided by the client.
            
        Returns:
            i32: The new tip's sequential ID.
        """
        value = gl.message.value
        if value == u256(0):
            raise gl.vm.UserError("Tip amount must be greater than zero")

        self.tip_count = i32(int(self.tip_count) + 1)
        tip_id = str(int(self.tip_count))
        deadline = int(client_now) + int(duration_days) * 86400

        tip_data = {
            "id": tip_id,
            "tipper": str(gl.message.sender_address),
            "creator": creator,
            "amount": str(value),
            "criteria": criteria,
            "proof_url": proof_url,
            "status": 0, # 0 = Pending, 1 = Verified & Released, 2 = Refunded
            "deadline": deadline,
            "created_at": int(client_now),
            "review": ""
        }
        self.tips[tip_id] = json.dumps(tip_data)
        return self.tip_count

    @gl.public.write
    def update_proof_url(self, tip_id: str, new_url: str) -> None:
        """Allow the designated creator of a tip to update the proof URL.
        
        Args:
            tip_id (str): The ID of the tip to update.
            new_url (str): The new URL pointing to the proof of work.
        """
        if tip_id not in self.tips:
            raise gl.vm.UserError("Tip does not exist")
            
        tip_data = json.loads(self.tips[tip_id])
        if tip_data["status"] != 0:
            raise gl.vm.UserError("Tip has already been processed")
            
        if str(gl.message.sender_address) != tip_data["creator"]:
            raise gl.vm.UserError("Only the designated creator can update the proof URL")
            
        tip_data["proof_url"] = new_url
        self.tips[tip_id] = json.dumps(tip_data)

    @gl.public.write
    def verify_and_release(self, tip_id: str) -> typing.Any:
        """Run AI consensus to evaluate proof URL content and release funds.
        
        Args:
            tip_id (str): The ID of the tip to evaluate.
        """
        if tip_id not in self.tips:
            raise gl.vm.UserError("Tip does not exist")
            
        tip_data = json.loads(self.tips[tip_id])
        if tip_data["status"] != 0:
            raise gl.vm.UserError("Tip has already been processed")
            
        url = tip_data["proof_url"]
        if not url or url.strip() == "":
            raise gl.vm.UserError("Proof URL is not set")
            
        criteria = tip_data["criteria"]
        creator = tip_data["creator"]

        def leader_fn():
            # Fetch content of the proof page
            web_data = gl.nondet.web.get(url).body.decode("utf-8", errors="ignore")
            
            prompt = f"""You are evaluating a content creator's proof of work to determine if an escrowed tip should be released.

CREATOR: {creator}
PROOF URL: {url}
REQUIRED CRITERIA: {criteria}

WEBPAGE CONTENT (first 3000 characters):
{web_data[:3000]}

Evaluate:
1. Does the webpage content verify that the creator has fulfilled the required criteria?
2. Is there clear evidence of work on this page that matches the criteria?

Return ONLY a valid JSON object, with no markdown fences and no extra text:
{{
    "verified": true or false,
    "quality_score": 1-10,
    "reasoning": "brief explanation of how the criteria were met or why they failed"
}}"""
            response = gl.nondet.exec_prompt(prompt)
            # Normalize model output to prevent validator consensus mismatches on formatting noise
            return _parse_verdict(response)

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader_data = leader_result.calldata
            if not isinstance(leader_data, dict):
                return False
            validator_data = leader_fn()
            
            # Equivalence principle verification:
            # 1. Exact match on 'verified' boolean verdict.
            # 2. Score must be close within a tolerance of 2 points.
            return (leader_data.get("verified") == validator_data.get("verified")
                    and abs(leader_data.get("quality_score", 0) - validator_data.get("quality_score", 0)) <= 2)

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        amount = u256(int(tip_data["amount"]))
        if result["verified"]:
            tip_data["status"] = 1
            self._pay(tip_data["creator"], amount)
        else:
            # Leave status as 0 (Pending) so they can fix and try again.
            # Storing the review result lets the creator see why it failed.
            pass

        tip_data["review"] = json.dumps(result)
        self.tips[tip_id] = json.dumps(tip_data)

    @gl.public.write
    def claim_refund(self, tip_id: str, client_now: i32) -> None:
        """Allow the tipper to reclaim their escrowed funds if the deadline has passed.
        
        Args:
            tip_id (str): The ID of the tip to reclaim.
            client_now (i32): Deterministic Unix timestamp provided by the client.
        """
        if tip_id not in self.tips:
            raise gl.vm.UserError("Tip does not exist")
            
        tip_data = json.loads(self.tips[tip_id])
        if tip_data["status"] != 0:
            raise gl.vm.UserError("Tip has already been processed")
            
        if str(gl.message.sender_address) != tip_data["tipper"]:
            raise gl.vm.UserError("Only the tipper can claim a refund")
            
        if int(client_now) < int(tip_data["deadline"]):
            raise gl.vm.UserError("Cannot claim refund before the deadline")
            
        tip_data["status"] = 2 # Refunded
        self.tips[tip_id] = json.dumps(tip_data)
        
        amount = u256(int(tip_data["amount"]))
        self._pay(tip_data["tipper"], amount)

    def _pay(self, recipient: str, amount: u256) -> None:
        @gl.evm.contract_interface
        class _Recipient:
            class View:
                pass
            class Write:
                pass
        _Recipient(Address(recipient)).emit_transfer(value=amount)

    @gl.public.view
    def get_tip(self, tip_id: str) -> str:
        """Fetch the JSON serialized details of a specific tip.
        
        Args:
            tip_id (str): The ID of the tip.
            
        Returns:
            str: The JSON string of tip details.
        """
        if tip_id not in self.tips:
            raise gl.vm.UserError("Tip does not exist")
        return self.tips[tip_id]

    @gl.public.view
    def get_tip_count(self) -> i32:
        """Fetch the total count of tips registered in the contract.
        
        Returns:
            i32: The total number of tips.
        """
        return self.tip_count

    @gl.public.view
    def get_tips(self, start: i32, limit: i32) -> typing.List[str]:
        """Fetch a paginated list of JSON serialized tip details.
        
        This prevents the frontend from needing to perform sequential RPC polling loops,
        improving performance and data loading times significantly.
        
        Args:
            start (i32): The starting tip ID (inclusive).
            limit (i32): The maximum number of tips to return.
            
        Returns:
            typing.List[str]: A list of JSON strings representing tips.
        """
        out = []
        count = int(self.tip_count)
        s = int(start)
        l = int(limit)
        if s < 1:
            s = 1
        for i in range(s, min(s + l, count + 1)):
            tip_id = str(i)
            if tip_id in self.tips:
                out.append(self.tips[tip_id])
        return out
