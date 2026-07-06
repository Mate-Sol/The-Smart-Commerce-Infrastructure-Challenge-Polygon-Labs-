import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  setWalletConnecting,
  setWalletConnected,
  setWalletError,
  setUsdcBalance,
  disconnectWallet,
} from "@/store/chainSlice";
import { getAddress, isConnected, setAllowed } from "@stellar/freighter-api";
import { getUsdcBalance } from "@/stellar/stellarMethod";
import { validateWalletMatch } from "@/libs/utils/utils";
import { toast } from "react-toastify";

// ── Stellar (Freighter) ──────────────────────────────────────────────────────
const connectStellar = async () => {
  const connected = await isConnected();
  if (!connected.isConnected) {
    throw new Error(
      "Freighter wallet is not installed. Please install it from the Chrome Web Store.",
    );
  }

  await setAllowed();

  const { address, error } = await getAddress();
  if (error) throw new Error(error.message ?? "Failed to get Stellar address");
  if (!address) throw new Error("No address returned from Freighter.");

  return address;
};

// ── Chain connector map ──────────────────────────────────────────────────────
const connectors = {
  stellar: connectStellar,
  // starknet: connectStarknet,
  // evm:      connectEvm,
  // zigchain: connectZigchain,
};

// ── USDC balance fetcher map (add more chains here as you integrate them) ────
const balanceFetchers = {
  stellar: getUsdcBalance,
  // starknet: getStarknetUsdcBalance,
  // evm:      getEvmUsdcBalance,
  // zigchain: getZigchainUsdcBalance,
};

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useWalletConnect() {
  const dispatch = useDispatch();
  const { selected, walletAddress, walletStatus, walletError, usdcBalance } =
    useSelector((s) => s.chain);

  const isConnected = walletStatus === "connected";
  const isConnecting = walletStatus === "connecting";

  const fetchUsdcBalance = async () => {
    const chainType = validateWalletMatch(walletAddress);
    const fetcher = balanceFetchers[chainType.toLowerCase()];
    if (!fetcher) return;

    try {
      const balance = await fetcher(walletAddress);
      dispatch(setUsdcBalance(balance));
    } catch (err) {
      console.error("Failed to fetch USDC balance:", err);
      dispatch(setUsdcBalance(null));
    }
  };

  useEffect(() => {
    if (walletAddress) fetchUsdcBalance();
  }, [walletAddress]);

  const connect = async () => {
    const connector = connectors[selected?.key];
    if (!connector) {
      const msg = `No wallet connector for chain: ${selected?.label}`;
      dispatch(setWalletError(msg));
      toast.error(msg);
      return;
    }

    dispatch(setWalletConnecting());
    try {
      const address = await connector();
      dispatch(setWalletConnected(address));
      toast.success("Wallet connected successfully.");
    } catch (err) {
      const msg = err.message ?? "Wallet connection failed";
      dispatch(setWalletError(msg));
      toast.error(msg);
    }
  };

  function disconnect() {
    dispatch(disconnectWallet());
  }

  return {
    connect,
    disconnect,
    walletAddress,
    walletStatus,
    walletError,
    usdcBalance,
    isConnected,
    isConnecting,
  };
}
