// The module "vscode" contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import {build} from "./cargo";
import {RustDocumentFormattingEditProvider} from "./rustfmt";
import {RustCompletionItemProvider} from "./racer";

export function activate(context: vscode.ExtensionContext) {

    let RUST_MODE: vscode.DocumentFilter = { language: "rust", scheme: "file" };
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(RUST_MODE, new RustDocumentFormattingEditProvider()));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(RUST_MODE, new RustCompletionItemProvider()));

    context.subscriptions.push(vscode.commands.registerCommand("rust.build", build));
}