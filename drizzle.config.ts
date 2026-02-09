import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env.local for local dev (Vercel loads env vars automatically in production)
config({ path: ".env.local" });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.POSTGRES_URL!,
  },
});
