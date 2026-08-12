export interface Env {
  DB: D1Database;
  MATCH_QUEUE: DurableObjectNamespace;
}

export interface AuthedVars {
  userId: string;
}
