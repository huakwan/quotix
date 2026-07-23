import QRCode from "qrcode";
import { keepButtonsUnfocused } from "../buttonFocus";
import { promptPayPayload } from "../../payment/promptPay";

declare global {
  interface Window {
    about: {
      close(): void;
    };
  }
}

declare const __APP_VERSION__: string;

const PROMPTPAY_PHONE = "0902811123";

document.getElementById("version")!.textContent = `Version ${__APP_VERSION__}`;
keepButtonsUnfocused();
document.getElementById("close")!.addEventListener("click", () => window.about.close());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { window.about.close(); }
});

const canvas = document.getElementById("promptpay-qr") as HTMLCanvasElement;
void QRCode.toCanvas(canvas, promptPayPayload(PROMPTPAY_PHONE), {
  errorCorrectionLevel: "H",
  margin: 2,
  width: 174,
  color: {
    dark: "#ffffff",
    light: "#00000000",
  },
});
