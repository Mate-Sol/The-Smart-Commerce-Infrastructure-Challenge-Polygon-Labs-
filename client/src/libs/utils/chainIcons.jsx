import React from "react";
import etherIcon from "@/assets/multiChain-ui/ether-icon.svg";
import stellarIcon from "@/assets/multiChain-ui/stellar-icon.png";
import starknetIcon from "@/assets/multiChain-ui/starknet-icon.png";
import zigchainIcon from "@/assets/multiChain-ui/zigchain-icon.png";

const chainMap = {
  stellar:  { label: "Stellar",   src: stellarIcon },
  starknet: { label: "Stark Net", src: starknetIcon },
  zigchain: { label: "Zig Chain", src: zigchainIcon },
  evm:      { label: "EVM",       src: etherIcon },
};

/**
 * getChainIcon — returns the icon element for a given blockchain type
 *
 * @param {string} bcType  - chain key: "stellar" | "starknet" | "zigchain" | "evm"
 * @param {number} size    - icon size in px (default: 16)
 * @returns {JSX.Element|null}
 */
export function getChainIcon(bcType, size = 16) {
  const chain = chainMap[bcType?.toLowerCase()];
  if (!chain) return null;
  return <img src={chain.src} alt={chain.label} width={size} height={size} />;
}

/**
 * chainOptions — list of all chains for dropdowns etc.
 * Each entry: { key, label }
 */
export const chainOptions = Object.entries(chainMap).map(([key, val]) => ({
  key,
  label: val.label,
}));
