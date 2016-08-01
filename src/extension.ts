// The module "vscode" contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import {create} from "./tasks";
import {DefinitionProvider} from "./definitions";
import {FormattingProvider} from "./rustfmt";
import {RUST_MODE} from "./utils";
import {Rustsym} from "./rustsym";
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
    let definitionProvider = new DefinitionProvider(context);
    let formattingProvider = new FormattingProvider(context);

    let rustsym = new Rustsym();
    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(RUST_MODE, rustsym));
    context.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(rustsym));

    context.subscriptions.push(vscode.commands.registerCommand("rust.tasks.create", create));
}
