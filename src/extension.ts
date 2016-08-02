import {Rustfmt} from "./rustfmt";
import {Racer} from "./racer";
import {Rustsym} from "./rustsym";

import * as tasks from "./tasks";
import {RUST_MODE} from "./utils";

import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
    let rustfmt = new Rustfmt();
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(RUST_MODE, rustfmt));

    let racer = new Racer();
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(RUST_MODE, racer));
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(RUST_MODE, racer));
    context.subscriptions.push(vscode.languages.registerHoverProvider(RUST_MODE, racer));
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(RUST_MODE, racer, ...["(", ","]));

    let rustsym = new Rustsym();
    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(RUST_MODE, rustsym));
    context.subscriptions.push(vscode.languages.registerWorkspaceSymbolProvider(rustsym));

    context.subscriptions.push(vscode.commands.registerCommand("rust.tasks.create", tasks.create));
}
