import { getUsdcBalance } from "@/stellar/stellarMethod";
import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  user: null,
  success: false,
};

const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    loginSuccess: (state, action) => {
      state.user = { ...state.user, ...action.payload };
      state.success = true;
    },
    updateTokenBalance: (state, action) => {
      console.log("🚀 ~ action.payload:", action.payload);
      state.user = {
        ...state.user,
        usdc: action.payload.usdc,
        dlp: action.payload.dlp,
      };
      state.success = true;
    },

    logOut: (state) => {
      state.user = null;
      state.success = false;
    },
  },
});

export function getUserTokensBlances(address, chain, signTransaction) {
  console.log("🚀 ~ getUserTokensBlances ~ address, chain:", address, chain);
  return async (dispatch) => {
    try {
      debugger;
      const usdc = await getUsdcBalance(address, signTransaction);
      // const dlp = await getDefaLpTokensBalance(
      //   chain?.chainId,
      //   address,
      //   "Low Risk Pool"
      // );
      console.log("🚀 ~ return ~ usdc:", usdc);
      dispatch(
        updateTokenBalance({
          usdc: usdc < 0.000001 ? 0 : usdc,
          // dlp: dlp < 0.000001 ? 0 : dlp,
        }),
      );
    } catch (error) {
      console.log("🚀 ~ getUserTokensBlances ~ error:", error);
    }
  };
}

export const { loginSuccess, logOut, updateTokenBalance } = userSlice.actions;
export default userSlice.reducer;
