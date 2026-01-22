import { Pooder } from "./index";
import { fullExtension } from "./test-extension-full";
import { ContributionPointIds } from "./contribution";
import CommandService from "./services/CommandService";

async function runTest() {
  console.log("Starting Test...");
  const app = new Pooder();

  // Register the full extension
  console.log("Registering extension...");
  app.extensionManager.register(fullExtension);
  const commandService = app.getService<CommandService>("CommandService")!;

  // 1. Verify Command Contributions
  console.log("\n--- Verifying Commands ---");

  // 1.1 Imperative Command
  try {
    const res = await commandService.executeCommand(
      "test.imperative.hello",
      "User",
    );
    console.log(
      `[Imperative] "test.imperative.hello" result: "${res}"` ===
        `[Imperative] "test.imperative.hello" result: "Hello Imperative User"`
        ? "✅ PASS"
        : "❌ FAIL",
    );
  } catch (e) {
    console.error("❌ FAIL: Imperative command failed", e);
  }

  // 1.2 Declarative Auto-Registered Command
  try {
    const res = await commandService.executeCommand("test.declarative.auto");
    console.log(
      `[Declarative] "test.declarative.auto" result: "${res}"` ===
        `[Declarative] "test.declarative.auto" result: "Auto Registered Result"`
        ? "✅ PASS"
        : "❌ FAIL",
    );
  } catch (e) {
    console.error("❌ FAIL: Declarative auto-registered command failed", e);
  }

  // 2. Verify Registry Entries
  console.log("\n--- Verifying Contribution Registry ---");

  const commands = app.getContributions(ContributionPointIds.COMMANDS);
  console.log(
    `Commands registered: ${commands.length}` === "Commands registered: 2"
      ? "✅ PASS (2 commands found)"
      : `❌ FAIL (${commands.length} commands found)`,
  );

  const tools = app.getContributions(ContributionPointIds.TOOLS);
  console.log(
    `Tools registered: ${tools.length}` === "Tools registered: 1"
      ? "✅ PASS (1 tool found)"
      : `❌ FAIL (${tools.length} tools found)`,
  );

  const views = app.getContributions(ContributionPointIds.VIEWS);
  console.log(
    `Views registered: ${views.length}` === "Views registered: 1"
      ? "✅ PASS (1 view found)"
      : `❌ FAIL (${views.length} views found)`,
  );

  // 3. Unregister and Verify Cleanup
  console.log("\n--- Verifying Unregistration/Cleanup ---");
  // The ID is now explicit: "full-feature-test-extension"
  const extensionId = "full-feature-test-extension";
  app.extensionManager.unregister(extensionId);

  const commandsAfter = app.getContributions(ContributionPointIds.COMMANDS);
  console.log(
    `Commands after unregister: ${commandsAfter.length}` ===
      "Commands after unregister: 0"
      ? "✅ PASS"
      : `❌ FAIL (${commandsAfter.length} left)`,
  );

  // Verify command service cleanup
  const cmdMap = commandService.getCommands();
  const hasCmd = cmdMap.has("test.declarative.auto");
  console.log(
    `Command service cleaned up: ${!hasCmd}` ===
      "Command service cleaned up: true"
      ? "✅ PASS"
      : "❌ FAIL (Command still exists)",
  );

  console.log("\nTest Completed.");
}

runTest().catch(console.error);
