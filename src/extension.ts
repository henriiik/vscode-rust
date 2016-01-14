// The module "vscode" contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import {Racerd} from "./racerd";
import * as rustfmt from "./rustfmt";
import * as tasks from "./tasks";

const RUST_MODE: vscode.DocumentFilter = { language: "rust", scheme: "file" };

export function activate(context: vscode.ExtensionContext) {
    // racerd
    let racerd = new Racerd();
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(RUST_MODE, racerd));
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(RUST_MODE, racerd));
    context.subscriptions.push(vscode.languages.registerHoverProvider(RUST_MODE, racerd));
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(RUST_MODE, racerd, ...["(", ","]));

    // rustfmt
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(RUST_MODE, new rustfmt.DocumentFormattingEditProvider()));

    // tasks
    context.subscriptions.push(vscode.commands.registerCommand("rust.tasks.create", tasks.create));

    // restart racerd
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => {
        racerd.stop();
        racerd.start();
    }));
}