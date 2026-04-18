import { Hono } from "hono";
import { cors } from "hono/cors";
import { ZodError } from "zod";
import { env } from "./env";
import { authRoutes } from "./routes/auth";
import { usersRoutes } from "./routes/users";
import { meRoutes } from "./routes/me";
import { categoriesRoutes } from "./routes/categories";
import { productsRoutes } from "./routes/products";
import { powersyncRoutes } from "./routes/powersync";
import { businessSettingsRoutes } from "./routes/businessSettings";

const app = new Hono();

app.onError((err, c: any) => {
  if (err instanceof ZodError) {
    return c.json(
      {
        error: "VALIDATION_ERROR",
        issues: err.issues,
      },
      400,
    );
  }

  console.error(err);
  return c.json({ error: "INTERNAL_SERVER_ERROR" }, 500);
});

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
app.route("/v1/business-settings", businessSettingsRoutes);
app.route("/v1/powersync", powersyncRoutes);

export default {
  port: env.PORT,
  hostname: env.HOSTNAME,
  fetch: app.fetch,
};
