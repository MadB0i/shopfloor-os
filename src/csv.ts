function iso(value: Date | string | null | undefined) {
  if (value == null) return "";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

export function csvField(value: unknown) {
  let text: string;
  if (value == null) text = "";
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}

export function eventsToCsv(
  rows: Array<{
    event_id: string;
    type: string;
    schema_version: number;
    actor_id: string;
    asset_id: string | null;
    work_order_id: string | null;
    operation_id: string | null;
    payload: unknown;
    occurred_at: Date | string;
    recorded_at: Date | string;
    voided: boolean;
  }>,
) {
  const header = [
    "event_id",
    "type",
    "schema_version",
    "actor_id",
    "asset_id",
    "work_order_id",
    "operation_id",
    "payload",
    "occurred_at",
    "recorded_at",
    "voided",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvField(row.event_id),
        csvField(row.type),
        csvField(row.schema_version),
        csvField(row.actor_id),
        csvField(row.asset_id),
        csvField(row.work_order_id),
        csvField(row.operation_id),
        csvField(row.payload),
        csvField(iso(row.occurred_at)),
        csvField(iso(row.recorded_at)),
        csvField(row.voided ? "true" : "false"),
      ].join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
