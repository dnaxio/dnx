/**
 * Dockerfile auto-generation based on project type detection.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

interface DockerfileTemplate {
  name: string;
  detect: (cwd: string) => boolean;
  generate: (cwd: string, config: { nodeVersion?: string; pythonVersion?: string; goVersion?: string }) => string;
}

const templates: DockerfileTemplate[] = [
  {
    name: "Node.js",
    detect: (cwd) => existsSync(join(cwd, "package.json")),
    generate: (_cwd, config) => `FROM node:${config.nodeVersion ?? "22"}-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:${config.nodeVersion ?? "22"}-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3000
CMD ["node", "dist/server.js"]
`,
  },
  {
    name: "Python",
    detect: (cwd) =>
      existsSync(join(cwd, "requirements.txt")) ||
      existsSync(join(cwd, "pyproject.toml")),
    generate: (_cwd, config) => `FROM python:${config.pythonVersion ?? "3.12"}-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["python", "main.py"]
`,
  },
  {
    name: "Go",
    detect: (cwd) => existsSync(join(cwd, "go.mod")),
    generate: (_cwd, config) => `FROM golang:${config.goVersion ?? "1.23"}-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app/bin/app .

FROM alpine:3.19
COPY --from=builder /app/bin/app /usr/local/bin/app
EXPOSE 8080
CMD ["app"]
`,
  },
  {
    name: "Rust",
    detect: (cwd) => existsSync(join(cwd, "Cargo.toml")),
    generate: () => `FROM rust:1.80-alpine AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
COPY . .
RUN cargo build --release

FROM alpine:3.19
COPY --from=builder /app/target/release/app /usr/local/bin/app
EXPOSE 8080
CMD ["app"]
`,
  },
];

/**
 * Detect project type and generate a Dockerfile if none exists.
 */
export function generateDockerfileIfMissing(
  cwd: string,
  config: { nodeVersion?: string; pythonVersion?: string; goVersion?: string } = {}
): { generated: boolean; path: string; type: string } {
  const dockerfilePath = join(cwd, "Dockerfile");

  if (existsSync(dockerfilePath)) {
    return { generated: false, path: "Dockerfile", type: "existing" };
  }

  for (const template of templates) {
    if (template.detect(cwd)) {
      const content = template.generate(cwd, config);
      const { writeFileSync } = require("node:fs");
      writeFileSync(dockerfilePath, content, "utf-8");
      return { generated: true, path: "Dockerfile", type: template.name };
    }
  }

  throw new Error(
    "Impossible de détecter le type de projet. Créez un Dockerfile manuellement."
  );
}

/**
 * Check if a project has a Dockerfile.
 */
export function hasDockerfile(cwd: string): boolean {
  return existsSync(join(cwd, "Dockerfile"));
}
