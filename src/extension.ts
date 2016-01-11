// The module "vscode" contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import {Racer} from "./racer";
import * as rustfmt from "./rustfmt";
import * as tasks from "./tasks";

const RUST_MODE: vscode.DocumentFilter = { language: "rust", scheme: "file" };

export function activate(context: vscode.ExtensionContext) {
    // racer
    let racer = new Racer();
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(RUST_MODE, racer));
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(RUST_MODE, racer));
    context.subscriptions.push(vscode.languages.registerHoverProvider(RUST_MODE, racer));
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(RUST_MODE, racer, ...["(", ","]));

    // rustfmt
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(RUST_MODE, new rustfmt.DocumentFormattingEditProvider()));

    // tasks
    context.subscriptions.push(vscode.commands.registerCommand("rust.tasks.create", tasks.create));
}