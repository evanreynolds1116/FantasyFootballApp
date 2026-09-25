import type { Db } from "../db/client.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}
