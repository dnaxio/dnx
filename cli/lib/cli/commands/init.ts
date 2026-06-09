import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import * as fs from "node:fs";
import * as path from "node:path";

const INIT_TEMPLATE = `# dnx.yaml — DNX Deploy Configuration
version: "1"
name: "my-project"

environments:
  staging:
    servers:
      - name: staging-1
        host: $STAGING_HOST
        user: $USER
        # password: $SSH_PASS   # mot de passe SSH (optionnel)
        # key_path: ~/.ssh/id_ed25519

  production:
    servers:
      - name: prod-1
        host: $PROD_HOST
        user: $USER

workloads:
  - name: web
    type: web              # web | api | database | cache | worker | cron | other
    driver: flox
    # image: nginx:alpine  # optional OCI image
    ports:
      - 3000
    env:
      NODE_ENV: "{{ .Environment }}"
`;

export class InitCommand extends BaseCommand {
  override name = "init";
  override description = "Initialize a DNX project (creates dnx.yaml)";
  override options = [
    { flags: "-f, --force", description: "Overwrite existing dnx.yaml" },
    { flags: "-n, --name <name>", description: "Project name" },
    { flags: "--docker", description: "Use Docker driver by default" },
  ];

  override async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    const cwd = ctx.cwd;
    const targetPath = path.join(cwd, "dnx.yaml");
    const force = opts?.force as boolean | undefined;

    if (fs.existsSync(targetPath) && !force) {
      logger.warn("dnx.yaml already exists. Use --force to overwrite.");
      return;
    }

    let content = INIT_TEMPLATE;
    const projectName = opts?.name;
    if (typeof projectName === "string") {
      content = content.replace('name: "my-project"', `name: "${projectName}"`);
    }
    if (opts?.docker) {
      content = content.replace("driver: flox", "driver: docker");
      content = content.replace(
        "# image:",
        "dockerfile: ./Dockerfile\n    registry: ghcr.io/org/web\n    # image:",
      );
    }

    const spin = spinner("Creating dnx.yaml...");
    fs.writeFileSync(targetPath, content, "utf-8");

    // Add .dnx/ to .gitignore
    const gitignorePath = path.join(cwd, ".gitignore");
    const gitignoreEntry = ".dnx/";
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, "utf-8");
      if (!gitignore.includes(gitignoreEntry)) {
        fs.appendFileSync(gitignorePath, `\n# DNX\n${gitignoreEntry}\n`);
      }
    } else {
      fs.writeFileSync(gitignorePath, `# DNX\n${gitignoreEntry}\n`);
    }

    spin.succeed("dnx.yaml created!");

    logger.info(`  📄 ${path.relative(process.cwd(), targetPath)}`);

    logger.section("Next steps:");
    console.log("  1. Edit dnx.yaml to configure your servers");
    console.log('  2. Configure your workloads in the "workloads" section');
    console.log("  3. Deploy: dnx deploy --env staging");
    console.log("");
  }
}
