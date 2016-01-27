// The module "vscode" contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import {DefinitionProvider} from "./definitions";
import {FormattingProvider} from "./rustfmt";
import * as tasks from "./tasks";

export function activate(context: vscode.ExtensionContext) {
    let definitionProvider = new DefinitionProvider(context);
    let formattingProvider = new FormattingProvider(context);

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(() => {
        definitionProvider.racerd.restart();
    }));

    context.subscriptions.push(vscode.commands.registerCommand("rust.tasks.create", tasks.create));
}
