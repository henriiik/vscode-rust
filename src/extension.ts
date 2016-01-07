// The module "vscode" contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as racer from "./racer";
import * as rustfmt from "./rustfmt";
import * as tasks from "./tasks";

const RUST_MODE: vscode.DocumentFilter = { language: "rust", scheme: "file" };

export function activate(context: vscode.ExtensionContext) {
    // racer
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(RUST_MODE, new racer.CompletionItemProvider()));
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(RUST_MODE, new racer.DefinitionProvider()));
    context.subscriptions.push(vscode.languages.registerHoverProvider(RUST_MODE, new racer.HoverProvider()));
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(RUST_MODE, new racer.SignatureHelpProvider(), ...["(", ","]));

    // rustfmt
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(RUST_MODE, new rustfmt.DocumentFormattingEditProvider()));

    // tasks
    context.subscriptions.push(vscode.commands.registerCommand("rust.tasks.create", tasks.create));
}