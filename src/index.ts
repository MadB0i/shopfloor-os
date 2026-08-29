import { build } from "./app.js";

const app = await build();
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: "0.0.0.0" });
