import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env";
import { authRoutes } from "./routes/auth";
import { usersRoutes } from "./routes/users";
import { meRoutes } from "./routes/me";
import { categoriesRoutes } from "./routes/categories";
import { productsRoutes } from "./routes/products";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/health", (c: any) => c.json({ ok: true }));

app.route("/v1/auth", authRoutes);
app.route("/v1/users", usersRoutes);
app.route("/v1/me", meRoutes);
app.route("/v1/categories", categoriesRoutes);
app.route("/v1/products", productsRoutes);

export default {
  port: env.PORT,
  hostname: env.HOSTNAME,
  fetch: app.fetch,
};
