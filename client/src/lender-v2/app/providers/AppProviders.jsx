import React from "react";
import { Provider } from "react-redux";
import { store } from "@/store/store";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export function AppProviders({ children }) {
  return (
    <Provider store={store}>
      {children}
      <ToastContainer
        position="top-right"
        autoClose={3000}
        pauseOnHover
        closeOnClick
        toastStyle={{
          background:
            "linear-gradient(135deg, rgba(6, 70, 176, 0.6), rgba(43, 103, 255, 0.2))",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(43, 103, 255, 0.3)",
          color: "var(--color-text)",
          borderRadius: "12px",
          boxShadow: "0 4px 24px rgba(43, 103, 255, 0.15)",
        }}
        progressStyle={{
          background: "linear-gradient(to right, var(--color-primary-card), var(--color-secondary))",
        }}
      />
    </Provider>
  );
}
