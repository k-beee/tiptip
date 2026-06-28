import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { GenLayerClient } from "genlayer-js/types";

export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
  "0x4f079033484B806e42385E53bE20209B89049Bee") as `0x${string}`;

declare global {
  interface Window {
    ethereum?: any;
  }
}

export type WalletState = {
  address: `0x${string}` | null;
  client: GenLayerClient<any> | null;
};

// GenLayer Studio Network parameters
const STUDIONET = {
  chainId: "0xF22F", // 61999
  chainName: "GenLayer Studio Network",
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  rpcUrls: ["https://studio.genlayer.com/api"],
  blockExplorerUrls: ["https://genlayer-explorer.vercel.app"],
};

export function hasWallet(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

// Bypasses the GenLayer Snap requirement.
// Relies on standard EVM provider signing directly on the custom network chain.
export async function connectWallet(): Promise<WalletState> {
  if (!hasWallet()) {
    throw new Error("No EVM wallet detected. Please install MetaMask, Rabby, or a similar wallet.");
  }

  const accounts: string[] = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) {
    throw new Error("No accounts authorized");
  }
  const address = accounts[0] as `0x${string}`;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET.chainId }],
    });
  } catch (e: any) {
    if (e?.code === 4902 || /Unrecognized chain/i.test(e?.message || "")) {
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [STUDIONET] });
    } else if (e?.code !== 4001) {
      // Ignore other switch-chain errors, standard sign popup will try chain addition
    } else {
      throw e;
    }
  }

  const client = createClient({
    chain: studionet,
    account: address,
    provider: window.ethereum,
  } as any);

  return { address, client };
}

export function readClient(): GenLayerClient<any> {
  return createClient({ chain: studionet }) as GenLayerClient<any>;
}

export function shortAddr(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
