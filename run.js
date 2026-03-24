import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function removeDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

function compareScore(candidate, baseline, objective) {
  if (baseline == null) {
    return true;
  }

  if (objective === "maximize") {
    return candidate > baseline;
  }

  return candidate < baseline;
}

function runCommand(command, cwd) {
  return new Promise((resolve) => {
    const [file, ...args] = command;
    const child = spawn(file, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runGit(args, cwd) {
  return runCommand(["git", ...args], cwd);
}

async function getHeadCommit(cwd) {
  const result = await runGit(["rev-parse", "HEAD"], cwd);
  if (result.code !== 0) {
    throw new Error("Unable to resolve HEAD commit.");
  }

  return result.stdout.trim();
}

async function workspaceHasChanges(rootDir, workspaceDir) {
  const relativeWorkspace = path.relative(rootDir, workspaceDir);
  const result = await runGit(["status", "--porcelain", "--", relativeWorkspace], rootDir);
  if (result.code !== 0) {
    throw new Error("Unable to inspect workspace changes.");
  }

  return result.stdout.trim().length > 0;
}

async function commitWorkspaceChanges(rootDir, workspaceDir, message) {
  const relativeWorkspace = path.relative(rootDir, workspaceDir);

  const addResult = await runGit(["add", "--all", "--", relativeWorkspace], rootDir);
  if (addResult.code !== 0) {
    throw new Error("Failed to stage workspace changes.");
  }

  const commitResult = await runGit(["commit", "-m", message], rootDir);
  if (commitResult.code !== 0) {
    throw new Error("Failed to create experiment commit.");
  }

  return getHeadCommit(rootDir);
}

async function revertCommit(rootDir, commitHash) {
  const revertResult = await runGit(["revert", "--no-edit", commitHash], rootDir);
  if (revertResult.code !== 0) {
    throw new Error(`Failed to revert commit ${commitHash}.`);
  }

  return getHeadCommit(rootDir);
}

async function workspaceTrackedInHead(rootDir, workspaceDir) {
  const relativeWorkspace = path.relative(rootDir, workspaceDir);
  const result = await runGit(["ls-tree", "-r", "--name-only", "HEAD", "--", relativeWorkspace], rootDir);
  if (result.code !== 0) {
    throw new Error("Unable to inspect tracked workspace files in HEAD.");
  }

  return result.stdout.trim().length > 0;
}

async function main() {
  const configPath = path.join(__dirname, "autoresearch.config.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));

  const workspaceDir = path.resolve(__dirname, config.workspaceDir);
  const runsDir = path.resolve(__dirname, config.runsDir);
  const bestResultFile = path.resolve(__dirname, config.bestResultFile);
  const scoreFile = path.join(workspaceDir, config.scoreFile);

  await ensureDir(runsDir);

  const runId = new Date().toISOString().replaceAll(":", "-");
  const runDir = path.join(runsDir, runId);

  await ensureDir(runDir);

  const relativeWorkspace = path.relative(__dirname, workspaceDir);
  const hadChanges = await workspaceHasChanges(__dirname, workspaceDir);
  const previousHead = await getHeadCommit(__dirname);
  const workspaceTrackedBeforeRun = await workspaceTrackedInHead(__dirname, workspaceDir);

  let experimentCommit = null;
  if (hadChanges) {
    experimentCommit = await commitWorkspaceChanges(
      __dirname,
      workspaceDir,
      `${config.commitPrefix} ${runId}`,
    );
  }

  const execution = await runCommand(config.command, workspaceDir);

  if (execution.code !== 0) {
    const failure = {
      runId,
      accepted: false,
      reason: "command_failed",
      workspace: relativeWorkspace,
      experimentCommit,
      previousHead,
      exitCode: execution.code,
      signal: execution.signal,
      generatedAt: new Date().toISOString(),
    };

    if (experimentCommit) {
      failure.revertCommit = await revertCommit(__dirname, experimentCommit);
    }

    await fs.writeFile(path.join(runDir, "run.json"), JSON.stringify(failure, null, 2));
    console.error("Evaluation command failed.");
    process.exitCode = execution.code ?? 1;
    return;
  }

  if (!(await exists(scoreFile))) {
    const failure = {
      runId,
      accepted: false,
      reason: "missing_score_file",
      workspace: relativeWorkspace,
      experimentCommit,
      previousHead,
      generatedAt: new Date().toISOString(),
    };

    if (experimentCommit) {
      failure.revertCommit = await revertCommit(__dirname, experimentCommit);
    }

    await fs.writeFile(path.join(runDir, "run.json"), JSON.stringify(failure, null, 2));
    console.error(`Missing score file: ${scoreFile}`);
    process.exitCode = 1;
    return;
  }

  const candidateResult = JSON.parse(await fs.readFile(scoreFile, "utf8"));
  const bestResult = JSON.parse(await fs.readFile(bestResultFile, "utf8"));
  const bootstrapWorkspace = !workspaceTrackedBeforeRun && experimentCommit !== null;
  const accepted =
    bootstrapWorkspace || compareScore(candidateResult.score, bestResult.score, config.objective);

  const runRecord = {
    runId,
    accepted,
    workspace: relativeWorkspace,
    bootstrapWorkspace,
    objective: config.objective,
    command: config.command,
    previousHead,
    experimentCommit,
    candidate: candidateResult,
    previousBest: bestResult,
    generatedAt: new Date().toISOString(),
  };

  if (accepted) {
    await fs.writeFile(
      bestResultFile,
      JSON.stringify(
        {
          ...candidateResult,
          runId,
          acceptedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
  } else if (experimentCommit) {
    runRecord.revertCommit = await revertCommit(__dirname, experimentCommit);
  }

  await fs.writeFile(path.join(runDir, "run.json"), JSON.stringify(runRecord, null, 2));

  console.log("");
  if (!experimentCommit) {
    console.log("No workspace changes detected; evaluated current state without creating a commit.");
  } else if (bootstrapWorkspace) {
    console.log("Accepted candidate and established the initial git baseline for workspace.");
  } else if (accepted) {
    console.log("Accepted candidate and kept experiment commit.");
  } else {
    console.log("Rejected candidate and reverted experiment commit.");
  }
  console.log(`Run log: ${path.join(runDir, "run.json")}`);
  console.log(`Best score: ${accepted ? candidateResult.score : bestResult.score}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
