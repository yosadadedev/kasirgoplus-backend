import postgres from "postgres";
import { envDb } from "./envDb";

export const sql = postgres(envDb.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export type Sql = typeof sql;
