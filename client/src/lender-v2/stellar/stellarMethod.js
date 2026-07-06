import { Client } from "@stellar/stellar-sdk/contract";
import { Networks } from "stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { Asset } from "@stellar/stellar-sdk";

export const STELLAR_RPC_URL = import.meta.env.VITE_PUBLIC_RPC_URL;

// =======================================
function fromBaseUnit(value, decimals) {
  return Number(value) / 10 ** decimals;
}
function formatTo2DecimalsNoRounding(value) {
  const num = parseFloat(value);

  if (Number.isInteger(num)) {
    return num;
  }

  const truncated = Math.floor(num * 100) / 100;
  return parseFloat(truncated.toFixed(2));
}
// =======================================

export const getClient = async (
  userAddress,
  contractId,
  signTransactionFn = async (txXdr) => txXdr,
) => {
  return await Client.from({
    contractId: contractId,
    networkPassphrase: Networks.TESTNET,
    rpcUrl: STELLAR_RPC_URL,
    publicKey: userAddress,
    signTransaction: async (txXdr) => {
      debugger;
      console.log("🚀 ~ getClient ~ txXdr:", txXdr);
      const signed = await signTransactionFn(txXdr);
      return {
        signedTxXdr: signed.signedTxXdr,
        signerAddress: userAddress,
      };
    },
  });
};

export const getUsdcBalance = async (userAddress, signTransaction) => {
  debugger;
  try {
    const server = new Server(STELLAR_RPC_URL);
    console.log("🚀 ~ getUsdcBalance ~ server:", server);
    const asset = new Asset(
      "USDC",
      "GDINMBYYTFY72K42FJVPV7JDAVCVOBBY7F5VTLEJZKBSSJ6QVPKZ77YI",
    );
    const entry = await server.getAssetBalance(userAddress, asset);
    console.log(entry);
    // const client = await getClient(userAddress, USDC_CONTRACT_ID, signTransaction);
    // const { result } = await client.balance({
    //   id: userAddress,
    // });

    const formattedData = fromBaseUnit(entry?.balanceEntry?.amount, 7);
    return formatTo2DecimalsNoRounding(formattedData);
    // return balance;
  } catch (error) {
    console.error("❌ Error checking balance:", error);
    throw error;
  }
};
