// The module "vscode" contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import {build} from "./cargo";
import {RustDocumentFormattingEditProvider} from "./rustfmt";

export function activate(context: vscode.ExtensionContext) {

    let RUST: vscode.DocumentFilter = { language: "rust", scheme: "file" };
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(RUST, new RustDocumentFormattingEditProvider()));
    context.subscriptions.push(vscode.commands.registerCommand("rust.build", build));
}