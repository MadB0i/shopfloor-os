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

// ── Capabilities ────────────────────────────────────────────────────────────
// Single source of truth for what each role may do. Every guard (backend) and
// the board UI (via GET /v1/me) derive from this map — change a rule here and
// both the server and the buttons follow.

export type Capability =
  | "run.write" // run.*, qty.*, downtime.*, handoff.submit, record.correct
  | "handoff.resolve" // handoff.accept / handoff.override (skip the gate)
  | "catalog.write" // create asset / reason code / work order / operation
  | "tape.read"; // read the full plant event tape

const CAPABILITIES: Record<Capability, readonly ActorRole[]> = {
  "run.write": ["operator", "supervisor", "planner"],
  "handoff.resolve": ["supervisor", "planner"],
  "catalog.write": ["planner"],
  "tape.read": ["auditor"],
};

export function can(role: ActorRole, cap: Capability): boolean {
  return CAPABILITIES[cap].includes(role);
}

/** Flat capability map for a role — the shape returned by GET /v1/me. */
export function capabilitiesFor(role: ActorRole): Record<Capability, boolean> {
  const out = {} as Record<Capability, boolean>;
  for (const cap of Object.keys(CAPABILITIES) as Capability[]) {
    out[cap] = can(role, cap);
  }
  return out;
}

export function canReadFullTape(role: ActorRole) {
  return can(role, "tape.read");
}
