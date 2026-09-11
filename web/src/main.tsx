import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "@/App";
import { ThemeProvider } from "@/components/theme-provider";
import "@/tailwind.css";
import "@/styles.css";

const chunkReloadKey = "ha-chunk-reload";

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  if (sessionStorage.getItem(chunkReloadKey)) return;
  sessionStorage.setItem(chunkReloadKey, "1");
  window.location.reload();
});

window.addEventListener("load", () => {
  window.setTimeout(() => sessionStorage.removeItem(chunkReloadKey), 3000);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
