export type TokenMap = Record<string, { userId: string; plantId: string; role: ActorRole }>;
export type ActorRole = "operator" | "supervisor" | "planner" | "auditor";

export function tokensFromEnv(): TokenMap {
  return {
    [process.env.OPERATOR_TOKEN ?? "dev-operator"]: {
      userId: "U-OP-1",
      plantId: "PL-DEMO",
      role: "operator",
    },
    [process.env.SUPERVISOR_TOKEN ?? "dev-supervisor"]: {
      userId: "U-SUP-1",
      plantId: "PL-DEMO",
      role: "supervisor",
    },
    [process.env.PLANNER_TOKEN ?? "dev-planner"]: {
      userId: "U-PL-1",
      plantId: "PL-DEMO",
      role: "planner",
    },
    [process.env.AUDITOR_TOKEN ?? "dev-auditor"]: {
      userId: "U-AUD-1",
      plantId: "PL-DEMO",
      role: "auditor",
    },
  };
}

export function actorFromHeader(header: string | undefined, tokens: TokenMap) {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return tokens[token] ?? null;
}

export function canReadFullTape(role: ActorRole) {
  return role === "auditor";
}
