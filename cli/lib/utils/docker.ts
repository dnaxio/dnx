/**
 * Parse Docker `{{.Ports}}` output into a clean `hostPort:containerPort` format.
 *
 * Input:  "0.0.0.0:3000->3000/tcp, 0.0.0.0:3001->3001/tcp"
 * Output: "3000:3000, 3001:3001"
 */
export function formatPorts(raw: string): string {
  if (!raw || raw === "-") return "-";
  return raw
    .split(", ")
    .map((mapping) => {
      // "0.0.0.0:3000->3000/tcp" → host=3000, container=3000
      const match = mapping.match(/->(\d+)\//);
      if (!match) return mapping.trim();
      const containerPort = match[1]!;
      // Extract host port: everything after the last ':' before '->'
      const hostMatch = mapping.match(/:(\d+)->/);
      const hostPort = hostMatch ? hostMatch[1]! : containerPort;
      return `${hostPort}:${containerPort}`;
    })
    .join(", ");
}
