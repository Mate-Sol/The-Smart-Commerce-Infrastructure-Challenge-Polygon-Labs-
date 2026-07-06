/**
 * userSlice — lender identity + session.
 *
 * Chunk D3: dropped the getUserTokensBlances thunk that read USDC balance
 * from a Stellar contract client. wagmi's useReadContract (in the
 * useWalletConnect hook) now feeds `chainSlice.usdcBalance` directly, so
 * this slice can stay focused on identity + session state.
 */

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

export const { loginSuccess, logOut, updateTokenBalance } = userSlice.actions;
export default userSlice.reducer;
