/**
 * Drizzle ORM client singleton.
 *
 * Uses @vercel/postgres under the hood which connects to Neon Postgres
 * via the POSTGRES_URL environment variable.
 */

import { sql } from "@vercel/postgres";
import { drizzle } from "drizzle-orm/vercel-postgres";
import * as schema from "./schema";

export const db = drizzle({ client: sql, schema });
