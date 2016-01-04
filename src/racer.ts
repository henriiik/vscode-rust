import * as vscode from "vscode";
import * as cp from "child_process";

let itemKindMap = {
    "Function": vscode.CompletionItemKind.Function,
    "Module": vscode.CompletionItemKind.Module,
};

function spawnRacer(document: vscode.TextDocument, position: vscode.Position, command: string): Thenable<cp.ChildProcess> {
    return document.save().then(() => {
        return cp.spawn("racer", [
            "--interface",
            "tab-text",
            command,
            String(position.line + 1),
            String(position.character),
            document.fileName
        ]);
    });
}

function makeCompletionItem(data: string[], root: string): vscode.CompletionItem {
    let item = new vscode.CompletionItem(data[1]);
    item.kind = itemKindMap[data[6]];
    item.detail = data[5].replace(root, "");
    item.documentation = data[7];
    return item;
}

export class RustCompletionItemProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.CompletionItem[]> {
        return spawnRacer(document, position, "complete-with-snippet").then((child) => {
            return new Promise((resolve, reject) => {
                let root = vscode.workspace.rootPath + "/";
                let items = [];

                child.stdout.on("data", (data: Buffer) => {
                    let lines = data.toString().split("\n");
                    for (let line of lines) {
                        let data = line.split("\t");
                        if (data[0] === "MATCH") {
                            items.push(makeCompletionItem(data, root));
                        }
                    }
                });

                let stderr = "";
                child.stderr.on("data", (data: Buffer) => {
                    stderr += data.toString();
                });

                child.on("close", (code) => {
                    if (code > 0) {
                        reject(null);
                    } else {
                        resolve(items);
                    }
                });

            });
        });
    }
}

function makeDefinition(data: string[]): vscode.Definition {
    return new vscode.Location(vscode.Uri.file(data[4]), new vscode.Position(
        Number(data[2]) - 1,
        Number(data[3])
    ));
}


export class RustDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Definition> {
        return spawnRacer(document, position, "find-definition").then((child) => {
            return new Promise((resolve, reject) => {
                let root = vscode.workspace.rootPath + "/";
                let def: vscode.Definition = null;

                child.stdout.on("data", (data: Buffer) => {
                    let lines = data.toString().split("\n");
                    for (let line of lines) {
                        let data = line.split("\t");
                        if (data[0] === "MATCH") {
                            def = makeDefinition(data);
                        }
                    }
                });

                let stderr = "";
                child.stderr.on("data", (data: Buffer) => {
                    stderr += data.toString();
                });

                child.on("close", (code) => {
                    if (code > 0) {
                        reject(null);
                    } else {
                        resolve(def);
                    }
                });
            });
        });
    }
}