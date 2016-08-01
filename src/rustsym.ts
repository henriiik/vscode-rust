import * as cp from "child_process";
import * as vscode from "vscode";
import {fsExists, fsWriteFile} from "./utils";

const ItemKindMap = {
    struct: vscode.SymbolKind.Class,
    method: vscode.SymbolKind.Method,
    field: vscode.SymbolKind.Field,
    function: vscode.SymbolKind.Function,
    constant: vscode.SymbolKind.Constant,
    static: vscode.SymbolKind.Constant,
    enum: vscode.SymbolKind.Enum,
};

interface RustsymSymbolInformation {
    container: string;
    kind: string;
    line: number;
    name: string;
    path: string;
}

function itemMapper(item: RustsymSymbolInformation): vscode.SymbolInformation {
    let kind = ItemKindMap[item.kind];
    let range = new vscode.Range(item.line - 1, 0, item.line - 1, Number.MAX_VALUE);
    let uri = vscode.Uri.file(item.path);
    return new vscode.SymbolInformation(item.name, kind, range, uri, item.container);
}

function search(args: string[], token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
    return new Promise((resolve, reject) => {
        let config = vscode.workspace.getConfiguration("rust.path");
        let rustsymPath = config.get("rustsym", "rustsym");

        let child = cp.spawn(rustsymPath, [
            "search",
        ].concat(args));

        let matches = [];
        let out = "";

        child.stdout.on("data", (data: Buffer) => {
            out += data.toString();
        });

        child.stderr.on("data", console.error);

        child.on("close", code => {
            let stuff = JSON.parse(out).map(itemMapper);
            resolve(stuff);
        });
    });
}

export class Rustsym {
    provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
        return search(["-l", document.uri.fsPath], token);
    }

    provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): Thenable<vscode.SymbolInformation[]> {
        return search(["-g", vscode.workspace.rootPath, query], token);
    }
}
