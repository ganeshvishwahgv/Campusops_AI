import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { Role } from "../src/generated/prisma/enums";
import { createInterface, emitKeypressEvents } from "node:readline";
import { randomUUID } from "node:crypto";
import {
  hashPassword,
  isValidUsername,
  normalizeUsername,
  validatePassword,
} from "../src/lib/auth/password";

class SetupError extends Error {}

function ask(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = createInterface({ input: process.stdin, output: process.stdout });
    reader.once("SIGINT", () => {
      reader.close();
      reject(new SetupError("Setup cancelled. No login was saved."));
    });
    reader.question(prompt, (answer) => {
      reader.close();
      resolve(answer.trim());
    });
  });
}

function askPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const wasRaw = input.isRaw;
    let value = "";
    let overflow = false;
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    process.stdout.write(prompt);

    function finish() {
      input.removeListener("keypress", onKey);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      process.stdout.write("\n");
    }

    function onKey(text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) {
      if (key.ctrl && key.name === "c") {
        finish();
        reject(new SetupError("Setup cancelled. No login was saved."));
      } else if (key.name === "return" || key.name === "enter") {
        finish();
        if (overflow || value.length > 128) {
          reject(new SetupError("Password exceeds 128 characters. Nothing was saved; run setup again with a shorter password."));
        } else {
          resolve(value);
        }
      } else if (key.name === "backspace") {
        value = Array.from(value).slice(0, -1).join("");
      } else if (key.ctrl && key.name === "u") {
        value = "";
        overflow = false;
      } else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) {
        // Never echo typed characters or paste contents into terminal logs.
        // Keep a bounded buffer, but reject overlong input rather than silently
        // saving a truncated password. Ctrl+U clears an accidental large paste.
        if ((value + text).length <= 1024) value += text;
        else overflow = true;
      }
    }

    input.on("keypress", onKey);
  });
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new SetupError("Open a normal PowerShell terminal and run npm.cmd run auth:setup. Piped input is disabled to keep passwords out of logs.");
  }
  if (process.argv.length > 2) {
    throw new SetupError("This command does not accept arguments. Enter passwords only at its hidden terminal prompts.");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./campusops.db" }),
  });

  try {
    console.log("\nCampusOps local login setup");
    console.log("Passwords stay in this terminal and are stored only as salted hashes.");
    console.log("This command does not reseed or customise campus records. Ctrl+C cancels.\n");
    const users = await prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, active: true, credential: { select: { username: true } } },
    });
    console.table(users.map((user) => ({
      id: user.id,
      name: user.name,
      role: user.role,
      active: user.active,
      username: user.credential?.username ?? "(no login)",
    })));

    const choice = await ask("Enter an existing user ID (demo-admin opens the operations dashboard), or NEW: ");
    const existing = users.find((user) => user.id === choice);
    const creating = choice.toUpperCase() === "NEW";
    if (!creating && !existing) throw new SetupError("No matching user ID. Run the command again and copy an ID from the table.");
    if (existing && !existing.active) throw new SetupError("This user is inactive. Setup will not reactivate users or grant access implicitly.");

    let name = existing?.name ?? "";
    let role: Role = existing?.role ?? Role.STUDENT;
    if (creating) {
      name = await ask("Display name for this fictional demo user: ");
      if (!name || name.length > 100) throw new SetupError("Use a display name between 1 and 100 characters.");
      const roles = Object.values(Role);
      console.log(`Available roles: ${roles.join(", ")}`);
      const selectedRole = (await ask("Enter the role exactly: ")).toUpperCase();
      if (!roles.includes(selectedRole as Role)) throw new SetupError("Unknown role. No user was created.");
      role = selectedRole as Role;
    }

    const username = normalizeUsername(await ask("Choose a username (3–64 letters, numbers, dots, underscores or hyphens): "));
    if (!isValidUsername(username)) throw new SetupError("Invalid username. Use 3–64 letters, numbers, dots, underscores or hyphens.");
    const owner = await prisma.credential.findUnique({ where: { username }, select: { userId: true } });
    if (owner && owner.userId !== existing?.id) throw new SetupError("That username belongs to another user. Nothing was changed.");

    console.log(`\nTarget: ${name} | ${role} | username: ${username}`);
    if (existing?.credential) {
      const confirmation = await ask(`This replaces ${existing.credential.username}'s password and signs this user out everywhere. Type RESET to continue: `);
      if (confirmation !== "RESET") throw new SetupError("Setup cancelled. Existing login is unchanged.");
    } else if (await ask("Type SAVE to create this login: ") !== "SAVE") {
      throw new SetupError("Setup cancelled. No login was saved.");
    }

    console.log("Choose a unique password of 12–128 characters. Spaces are allowed. Nothing appears while you type.");
    const password = await askPassword("Password: ");
    const passwordError = validatePassword(password);
    if (passwordError) throw new SetupError(passwordError);
    if (password !== await askPassword("Repeat password: ")) throw new SetupError("Passwords did not match. Nothing was changed.");
    const passwordHash = await hashPassword(password);
    const newId = `demo-login-${randomUUID()}`;

    await prisma.$transaction(async (tx) => {
      const userId = existing?.id ?? newId;
      if (existing) {
        const current = await tx.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
        if (!current?.active || current.role !== role) {
          throw new SetupError("The user's status or role changed during setup. Run setup again to review it.");
        }
        const credential = await tx.credential.findUnique({ where: { userId }, select: { username: true } });
        if (credential?.username !== existing.credential?.username) {
          throw new SetupError("The login changed during setup. Run setup again to review it.");
        }
      } else {
        await tx.user.create({
          data: { id: userId, name, role, email: `${newId}@campus.example`, department: "Demo" },
        });
      }

      await tx.credential.upsert({
        where: { userId },
        create: { username, passwordHash, userId },
        update: { username, passwordHash },
      });
      await tx.session.deleteMany({ where: { userId } });
    });

    console.log(`\nLogin saved for ${name} (${role}). Username: ${username}`);
    console.log("Start npm.cmd run dev, open http://localhost:3000, and enter the password you just chose.");
    console.log("Only FACILITIES_ADMIN and SYSTEM_ADMIN currently receive the operations dashboard.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Prisma errors can embed query input; never print a hash or input payload.
  console.error(error instanceof SetupError
    ? error.message
    : "Login setup failed. Check that the database exists, migrations are applied, and the selected username is available. No partial changes are saved.");
  process.exitCode = 1;
});
