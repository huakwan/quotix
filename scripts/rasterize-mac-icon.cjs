const { app, BrowserWindow } = require("electron");
const { readFileSync, writeFileSync } = require("node:fs");

const [source, output] = process.argv.slice(2);

app.whenReady().then(async () => {
  const svg = readFileSync(source).toString("base64");
  const window = new BrowserWindow({ show: false });
  await window.loadURL("data:text/html,<canvas width=1024 height=1024></canvas>");
  const png = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      document.querySelector("canvas").getContext("2d").drawImage(image, 0, 0, 1024, 1024);
      resolve(document.querySelector("canvas").toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("failed to decode SVG"));
    image.src = "data:image/svg+xml;base64,${svg}";
  })`);
  writeFileSync(output, Buffer.from(png.slice(png.indexOf(",") + 1), "base64"));
  window.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
