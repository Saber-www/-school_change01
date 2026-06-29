import { createApp } from "vue";
import App from "./App.vue";
import "./styles/main.css";

async function bootstrap() {
  createApp(App).mount("#root");
  await import("./legacy/campusMarketController.js");
}

bootstrap().catch((error) => {
  console.error("应用启动失败", error);
});
